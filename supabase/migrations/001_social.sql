-- Retro Profile Social System. Apply in Supabase SQL Editor or with `supabase db push`.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '' check (char_length(display_name) <= 40),
  bio text not null default '' check (char_length(bio) <= 240),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 1024),
  terms_accepted_at timestamptz not null,
  terms_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_username_idx on public.profiles (username);
create index profiles_display_name_idx on public.profiles using btree (lower(display_name));

create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

create function public.create_profile_for_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare desired text;
begin
  desired := lower(coalesce(new.raw_user_meta_data->>'username', ''));
  if new.raw_user_meta_data->>'terms_accepted' is distinct from 'true' or coalesce(new.raw_user_meta_data->>'terms_version','') = '' then raise exception 'Terms and privacy notice acceptance is required'; end if;
  if desired !~ '^[a-z0-9_]{3,24}$' then raise exception 'Username must be 3–24 letters, numbers, or underscores'; end if;
  insert into public.profiles(id, username, display_name, terms_accepted_at, terms_version)
  values (new.id, desired, left(coalesce(nullif(new.raw_user_meta_data->>'display_name',''), desired), 40), now(), left(new.raw_user_meta_data->>'terms_version', 32));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile_for_user();

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','rejected')),
  created_at timestamptz not null default now(),
  unique (sender_id, receiver_id),
  check (sender_id <> receiver_id)
);
create index friend_requests_receiver_status_idx on public.friend_requests(receiver_id,status,created_at desc);
create index friend_requests_sender_status_idx on public.friend_requests(sender_id,status,created_at desc);

create table public.friendships (
  user_low uuid not null references public.profiles(id) on delete cascade,
  user_high uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low,user_high),
  check (user_low < user_high)
);
create index friendships_high_idx on public.friendships(user_high,user_low);

create function public.accept_friend_request(request_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare req public.friend_requests;
begin
  select * into req from public.friend_requests where id=request_id and receiver_id=auth.uid() and status='pending' for update;
  if not found then raise exception 'Friend request is unavailable'; end if;
  insert into public.friendships(user_low,user_high) values (least(req.sender_id,req.receiver_id),greatest(req.sender_id,req.receiver_id)) on conflict do nothing;
  delete from public.friend_requests where (sender_id=req.sender_id and receiver_id=req.receiver_id) or (sender_id=req.receiver_id and receiver_id=req.sender_id);
end $$;

create function public.send_friend_request(target_user uuid) returns void language plpgsql security definer set search_path = '' as $$
declare reverse_request uuid;
begin
  if auth.uid() is null or target_user=auth.uid() then raise exception 'You cannot add yourself'; end if;
  perform pg_advisory_xact_lock(hashtextextended(least(auth.uid()::text,target_user::text)||greatest(auth.uid()::text,target_user::text),0));
  if exists(select 1 from public.friendships where user_low=least(auth.uid(),target_user) and user_high=greatest(auth.uid(),target_user)) then return; end if;
  select id into reverse_request from public.friend_requests where sender_id=target_user and receiver_id=auth.uid() and status='pending' for update;
  if reverse_request is not null then
    insert into public.friendships(user_low,user_high) values(least(auth.uid(),target_user),greatest(auth.uid(),target_user)) on conflict do nothing;
    delete from public.friend_requests where (sender_id=auth.uid() and receiver_id=target_user) or (sender_id=target_user and receiver_id=auth.uid());
  else
    insert into public.friend_requests(sender_id,receiver_id) values(auth.uid(),target_user) on conflict(sender_id,receiver_id) do update set status='pending';
  end if;
end $$;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references public.profiles(id) on delete cascade,
  user_high uuid not null references public.profiles(id) on delete cascade,
  unique(user_low,user_high),
  check(user_low < user_high),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key(conversation_id,user_id)
);
create index conversation_members_user_idx on public.conversation_members(user_id,conversation_id);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_conversation_created_idx on public.messages(conversation_id,created_at desc);
create function public.touch_conversation() returns trigger language plpgsql security definer set search_path = '' as $$
begin update public.conversations set updated_at=new.created_at where id=new.conversation_id; return new; end $$;
create trigger messages_touch_conversation after insert on public.messages for each row execute function public.touch_conversation();
create function public.set_message_edited_at() returns trigger language plpgsql security definer set search_path = '' as $$
begin if new.body <> old.body then new.edited_at = now(); end if; return new; end $$;
create trigger messages_set_edited_at before update on public.messages for each row execute function public.set_message_edited_at();

create function public.get_or_create_conversation(other_user uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare found_id uuid;
begin
  if auth.uid() is null or other_user=auth.uid() then raise exception 'Invalid conversation member'; end if;
  if not exists (select 1 from public.friendships where user_low=least(auth.uid(),other_user) and user_high=greatest(auth.uid(),other_user)) then raise exception 'You can only message an accepted friend'; end if;
  select c.id into found_id from public.conversations c
    join public.conversation_members a on a.conversation_id=c.id and a.user_id=auth.uid()
    join public.conversation_members b on b.conversation_id=c.id and b.user_id=other_user
    where (select count(*) from public.conversation_members m where m.conversation_id=c.id)=2 limit 1;
  if found_id is null then
    insert into public.conversations(user_low,user_high) values(least(auth.uid(),other_user),greatest(auth.uid(),other_user)) on conflict(user_low,user_high) do nothing returning id into found_id;
    if found_id is null then select id into found_id from public.conversations where user_low=least(auth.uid(),other_user) and user_high=greatest(auth.uid(),other_user); end if;
    insert into public.conversation_members(conversation_id,user_id) values (found_id,auth.uid()),(found_id,other_user) on conflict do nothing;
  end if;
  return found_id;
end $$;

create function public.remove_friend(other_user uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or other_user=auth.uid() then raise exception 'Invalid relationship'; end if;
  delete from public.friendships where user_low=least(auth.uid(),other_user) and user_high=greatest(auth.uid(),other_user);
  delete from public.conversations c using public.conversation_members a, public.conversation_members b
    where a.conversation_id=c.id and b.conversation_id=c.id and a.user_id=auth.uid() and b.user_id=other_user;
end $$;

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
create policy "Profiles are discoverable to signed-in users" on public.profiles for select to authenticated using (true);
create policy "Users update their own profile" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy "Participants read requests" on public.friend_requests for select to authenticated using (sender_id=auth.uid() or receiver_id=auth.uid());
create policy "Send a request to another user" on public.friend_requests for insert to authenticated with check (sender_id=auth.uid() and receiver_id<>auth.uid() and not exists (select 1 from public.friendships f where f.user_low=least(auth.uid(),receiver_id) and f.user_high=greatest(auth.uid(),receiver_id)));
create policy "Sender cancels or recipient rejects requests" on public.friend_requests for delete to authenticated using (sender_id=auth.uid() or receiver_id=auth.uid());
create policy "Recipient may reject a request" on public.friend_requests for update to authenticated using (receiver_id=auth.uid() and status='pending') with check (receiver_id=auth.uid() and status='rejected');
create policy "Users read own friendships" on public.friendships for select to authenticated using (user_low=auth.uid() or user_high=auth.uid());
create function public.is_conversation_member(target_conversation uuid) returns boolean language sql stable security definer set search_path = '' as $$ select exists(select 1 from public.conversation_members where conversation_id=target_conversation and user_id=auth.uid()) $$;
create function public.is_chat_member(target_conversation uuid) returns boolean language sql stable security definer set search_path = '' as $$ select exists(select 1 from public.conversation_members own join public.conversation_members peer on peer.conversation_id=own.conversation_id and peer.user_id<>own.user_id join public.friendships f on f.user_low=least(own.user_id,peer.user_id) and f.user_high=greatest(own.user_id,peer.user_id) where own.conversation_id=target_conversation and own.user_id=auth.uid()) $$;
create policy "Members read conversations" on public.conversations for select to authenticated using (public.is_chat_member(id));
create policy "Members read membership rows" on public.conversation_members for select to authenticated using (public.is_chat_member(conversation_id));
create policy "Users update own read marker" on public.conversation_members for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "Members read messages" on public.messages for select to authenticated using(public.is_chat_member(conversation_id));
create policy "Members send their own messages" on public.messages for insert to authenticated with check(sender_id=auth.uid() and public.is_chat_member(conversation_id));
create policy "Sender edits their own message" on public.messages for update to authenticated using(sender_id=auth.uid() and public.is_chat_member(conversation_id)) with check(sender_id=auth.uid() and public.is_chat_member(conversation_id) and new.body=old.body and new.conversation_id=old.conversation_id and new.sender_id=old.sender_id and new.created_at=old.created_at) ;
create policy "Sender may soft delete their own message" on public.messages for update to authenticated using(sender_id=auth.uid() and public.is_chat_member(conversation_id)) with check(sender_id=auth.uid() and public.is_chat_member(conversation_id) and new.deleted_at is not null and old.deleted_at is null and new.body=old.body and new.conversation_id=old.conversation_id and new.sender_id=old.sender_id and new.created_at=old.created_at and new.edited_at=old.edited_at) ;

-- Explicitly reset table privileges before granting the narrow browser API.
revoke all on public.profiles, public.friend_requests, public.friendships, public.conversations, public.conversation_members, public.messages from anon, authenticated;
-- No direct browser writes to friendships, conversations or membership rows.
grant select on public.profiles, public.friend_requests, public.friendships, public.conversations, public.conversation_members, public.messages to authenticated;
grant update(display_name,bio,avatar_url) on public.profiles to authenticated;
grant delete on public.friend_requests to authenticated;
grant update(status) on public.friend_requests to authenticated;
grant insert on public.messages to authenticated;
grant update(body,edited_at,deleted_at) on public.messages to authenticated;
grant update(last_read_at) on public.conversation_members to authenticated;
revoke all on function public.accept_friend_request(uuid), public.send_friend_request(uuid), public.remove_friend(uuid), public.get_or_create_conversation(uuid), public.is_conversation_member(uuid), public.is_chat_member(uuid) from public, anon;
grant execute on function public.accept_friend_request(uuid), public.send_friend_request(uuid), public.remove_friend(uuid), public.get_or_create_conversation(uuid), public.is_conversation_member(uuid), public.is_chat_member(uuid) to authenticated;

-- Avatar uploads are restricted to the owner's folder and image files <=2 MB.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('avatars','avatars',true,2097152,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=true,file_size_limit=2097152,allowed_mime_types=array['image/png','image/jpeg','image/webp'];
create policy "Anyone signed in can view avatar files" on storage.objects for select to authenticated using(bucket_id='avatars');
create policy "Users upload into their own avatar folder" on storage.objects for insert to authenticated with check(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Users update their own avatar files" on storage.objects for update to authenticated using(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Users delete their own avatar files" on storage.objects for delete to authenticated using(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);

-- Enable message change feeds for Supabase Realtime (safe to re-run).
do $$ begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; when undefined_object then null; end $$;
