import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.RETRO_SOCIAL_CONFIG;
const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const authHost = $("#socialAuth");
const appHost = $("#socialApp");
const connectionLabel = $("#socialConnection");
const authFeedback = $("#authFeedback");
const socialFeedback = $("#socialFeedback");
if (!config?.supabaseUrl || !config?.supabaseAnonKey || config.supabaseUrl.includes("YOUR_PROJECT")) {
  connectionLabel.textContent = "setup required";
  authFeedback.textContent = "Copy config.example.js to config.js and add your Supabase project URL and anon key. Then apply supabase/migrations/001_social.sql to your project.";
} else {
  start(createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } }));
}

async function start(db) {
  let user = null;
  let profile = null;
  let activeConversation = null;
  let realtime = null;
  let messageChannel = null;
  let authMode = "signin";
  let messageOffset = 0;
  let loadingOlder = false;
  let conversations = [];
  const setFeedback = (node, message, error = false) => { node.textContent = message; node.dataset.error = String(error); };
  const initials = (p) => (p?.display_name || p?.username || "?").slice(0, 1).toUpperCase();
  const avatar = (p, size = "") => p?.avatar_url ? `<img class="social-avatar ${size}" src="${esc(p.avatar_url)}" alt="" loading="lazy">` : `<span class="social-avatar ${size}" aria-hidden="true">${esc(initials(p))}</span>`;
  const dateText = (date) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(date));
  const profileById = async (id) => { const { data, error } = await db.from("profiles").select("id,username,display_name,bio,avatar_url,created_at").eq("id", id).maybeSingle(); if (error) throw error; return data; };

  async function refresh() {
    const { data: { session }, error } = await db.auth.getSession();
    if (error) setFeedback(authFeedback, error.message, true);
    user = session?.user || null;
    if (!user) {
      profile = null; authHost.hidden = false; appHost.hidden = true;
      if (realtime) db.removeChannel(realtime); if (messageChannel) db.removeChannel(messageChannel);
      return;
    }
    const { data, error: profileError } = await db.from("profiles").select("*").eq("id", user.id).single();
    if (profileError) { setFeedback(socialFeedback, profileError.message, true); return; }
    profile = data; authHost.hidden = true; appHost.hidden = false;
    $("#socialIdentity").textContent = `@${profile.username}`;
    connectionLabel.textContent = "connected";
    await Promise.all([loadDirectory(), loadFriends(), loadConversations(), loadMyProfile()]);
    subscribe();
  }

  $$AuthMode();
  function $$AuthMode() {
    document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => {
      authMode = button.dataset.authMode;
      document.querySelectorAll("[data-auth-mode]").forEach((item) => { const selected = item === button; item.classList.toggle("is-active", selected); item.setAttribute("aria-selected", String(selected)); });
      document.querySelectorAll(".signup-only").forEach((item) => { item.hidden = authMode !== "signup"; const input = item.querySelector("input"); if (input) input.required = authMode === "signup" && input.name === "username"; });
      $("#authForm [name=password]").autocomplete = authMode === "signup" ? "new-password" : "current-password";
      $("#authForm .social-submit").innerHTML = `${authMode === "signup" ? "Create account" : "Sign in"} <svg class="ic"><use href="#i-arrow"></use></svg>`;
      $("#resetPassword").hidden = authMode === "signup";
      setFeedback(authFeedback, "");
    }));
  }
  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const email = String(form.get("email")).trim().toLowerCase(); const password = String(form.get("password"));
    const button = $(".social-submit", event.currentTarget); button.disabled = true; setFeedback(authFeedback, "Working…");
    try {
      if (authMode === "signup") {
        const username = String(form.get("username")).trim().toLowerCase();
        if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error("Username must be 3–24 characters: letters, numbers, or underscores.");
        if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new Error("Use at least 10 characters with both a letter and a number.");
        if (!form.get("terms")) throw new Error("Please accept the terms and privacy notice to register.");
        const { data: signupData, error } = await db.auth.signUp({ email, password, options: { data: { username, display_name: String(form.get("display_name") || "").trim() || username, terms_accepted: true, terms_version: "2026-10-12" } } });
        if (error) throw error;
        event.currentTarget.reset();
        if (signupData?.session?.user) {
          setFeedback(authFeedback, signupData.session.user.email_confirmed_at
            ? "Account created and verified. Welcome aboard."
            : "Account created. Check your email to verify it, then sign in.");
        } else {
          setFeedback(authFeedback, "Account created. Check your email to verify it, then sign in.");
        }
      } else {
        const { error } = await db.auth.signInWithPassword({ email, password }); if (error) throw error; setFeedback(authFeedback, "Signed in.");
      }
    } catch (error) { setFeedback(authFeedback, friendly(error), true); } finally { button.disabled = false; }
  });
  $("#resetPassword").addEventListener("click", async () => {
    const email = $("#authForm [name=email]").value.trim(); if (!email) return setFeedback(authFeedback, "Enter your email address first.", true);
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + "#social" });
    setFeedback(authFeedback, error ? friendly(error) : "If an account uses that email, a password reset link is on its way.", !!error);
  });
  db.auth.onAuthStateChange(() => setTimeout(refresh, 0));
  await refresh();

  function friendly(error) {
    const message = String(error?.message || "");
    const code = String(error?.code || "");
    if (/duplicate key|already registered|unique|username.*exists/i.test(message)) return "That username or email is already in use.";
    if (/invalid login|invalid password|bad password/i.test(message)) return "Email or password is incorrect.";
    if (/weak password|password too short|password requirements/i.test(message)) return "Password does not meet the project requirements.";
    if (/email already|already have an account/i.test(message)) return "An account with that email already exists.";
    if (/network|fetch|connection/i.test(message)) return "Could not reach the service. Check your connection and try again.";
    if (/confirm.*email|verify.*email|email.*confirm/i.test(message)) return "Please confirm your email before signing in.";
    if (/redirect/i.test(message)) return "Sign-in is misconfigured. Check the redirect settings in your Supabase project.";
    if (/webhook/i.test(message)) return "Service configuration error. Try again later.";
    if (code === "PGRST306" || code === "PGRST500" || code === "PGRST106") return "The backend rejected that request. Try again.";
    if (!message) return "Something went wrong.";
    return message;
  }

  document.querySelectorAll("[data-social-page]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.socialPage)));
  function showPage(page) {
    document.querySelectorAll("[data-social-page]").forEach((button) => { const selected = button.dataset.socialPage === page; button.classList.toggle("is-active", selected); button.setAttribute("aria-selected", String(selected)); });
    document.querySelectorAll("[data-social-view]").forEach((view) => { view.hidden = view.dataset.socialView !== page; });
    if (page === "messages") loadConversations();
  }
  $("#signOutBtn").addEventListener("click", async () => { const { error } = await db.auth.signOut(); if (error) setFeedback(socialFeedback, friendly(error), true); });
  $("#userSearch").addEventListener("input", debounce(loadDirectory, 220));
  $("#chatSearch").addEventListener("input", renderConversations);

  async function relationship(targetId) {
    if (targetId === user.id) return "self";
    const [friendResult, sent, received] = await Promise.all([
      db.from("friendships").select("user_low").or(`and(user_low.eq.${user.id},user_high.eq.${targetId}),and(user_low.eq.${targetId},user_high.eq.${user.id})`).maybeSingle(),
      db.from("friend_requests").select("id,status").eq("sender_id", user.id).eq("receiver_id", targetId).eq("status", "pending").maybeSingle(),
      db.from("friend_requests").select("id,status").eq("sender_id", targetId).eq("receiver_id", user.id).eq("status", "pending").maybeSingle()
    ]);
    if (friendResult.error) throw friendResult.error;
    return friendResult.data ? "friends" : sent.data ? "sent" : received.data ? "received" : "none";
  }
  async function loadDirectory() {
    if (!user) return;
    const term = $("#userSearch").value.trim().replace(/[^a-zA-Z0-9_ .-]/g, "");
    let query = db.from("profiles").select("id,username,display_name,bio,avatar_url").neq("id", user.id).order("username").limit(30);
    if (term) query = query.or(`username.ilike.%${term}%,display_name.ilike.%${term}%`);
    const { data, error } = await query; const host = $("#directoryList"); host.replaceChildren();
    if (error) { host.innerHTML = `<p class="social-empty">${esc(friendly(error))}</p>`; return; }
    if (!data.length) { host.innerHTML = `<p class="social-empty">${term ? "No players match that search." : "No other players yet. Invite a friend to create an account."}</p>`; return; }
    for (const person of data) {
      let state; try { state = await relationship(person.id); } catch { state = "none"; }
      host.insertAdjacentHTML("beforeend", `<article class="user-card" data-user="${esc(person.id)}">${avatar(person)}<div class="user-card-main"><h4>${esc(person.display_name || person.username)}</h4><p class="username">@${esc(person.username)}</p><p class="user-bio">${esc(person.bio || "No bio added yet.")}</p><div class="user-card-actions"><button class="btn btn-ghost btn-sm" data-action="profile">Profile</button>${actionMarkup(state)}</div></div></article>`);
    }
  }
  function actionMarkup(state) {
    if (state === "self") return "";
    if (state === "friends") return '<button class="btn btn-ghost btn-sm" data-action="message">Message</button><button class="btn btn-ghost btn-sm" data-action="remove">Remove</button>';
    if (state === "sent") return '<button class="btn btn-ghost btn-sm" data-action="cancel">Cancel request</button>';
    if (state === "received") return '<button class="btn btn-primary btn-sm" data-action="accept">Accept request</button>';
    return '<button class="btn btn-primary btn-sm" data-action="request">Add friend</button>';
  }
  async function changeRelation(action, targetId) {
    if (action === "profile") { await showPublicProfile(targetId); return; }
    if (action === "request") { const { error } = await db.rpc("send_friend_request", { target_user: targetId }); if (error) throw error; }
    if (action === "cancel") { const { error } = await db.from("friend_requests").delete().eq("sender_id", user.id).eq("receiver_id", targetId); if (error) throw error; }
    if (action === "accept") { const { error } = await db.rpc("accept_friend_request", { request_id: (await db.from("friend_requests").select("id").eq("sender_id", targetId).eq("receiver_id", user.id).eq("status", "pending").single()).data?.id }); if (error) throw error; }
    if (action === "reject") { const { error } = await db.from("friend_requests").update({ status: "rejected" }).eq("sender_id", targetId).eq("receiver_id", user.id).eq("status", "pending"); if (error) throw error; }
    if (action === "remove") { const { error } = await db.rpc("remove_friend", { other_user: targetId }); if (error) throw error; }
    if (action === "message") await openConversation(targetId);
    await Promise.all([loadDirectory(), loadFriends(), loadConversations()]);
  }
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]"); if (!button) return;
    const card = button.closest("[data-user]"); const targetId = card?.dataset.user || button.closest("[data-target]")?.dataset.target; if (!targetId) return;
    button.disabled = true;
    try { await changeRelation(button.dataset.action, targetId); setFeedback(socialFeedback, "Relationship updated."); }
    catch (error) { setFeedback(socialFeedback, friendly(error), true); button.disabled = false; }
  });

  async function loadFriends() {
    if (!user) return;
    const [requests, friendships] = await Promise.all([
      db.from("friend_requests").select("id,sender_id,receiver_id,status").or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`).eq("status", "pending"),
      db.from("friendships").select("user_low,user_high").or(`user_low.eq.${user.id},user_high.eq.${user.id}`)
    ]);
    if (requests.error || friendships.error) { setFeedback(socialFeedback, friendly(requests.error || friendships.error), true); return; }
    const incoming = requests.data.filter((item) => item.receiver_id === user.id); const outgoing = requests.data.filter((item) => item.sender_id === user.id);
    $("#friendBadge").textContent = incoming.length; $("#friendBadge").hidden = incoming.length === 0;
    $("#incomingRequests").replaceChildren(); $("#outgoingRequests").replaceChildren();
    await renderRequestList(incoming, $("#incomingRequests"), true); await renderRequestList(outgoing, $("#outgoingRequests"), false);
    const ids = friendships.data.map((item) => item.user_low === user.id ? item.user_high : item.user_low);
    $("#friendCount").textContent = `${ids.length} total`;
    const list = $("#friendList"); list.replaceChildren();
    if (!ids.length) list.innerHTML = '<p class="social-empty">No friends yet. Search the directory and send a request to get started.</p>';
    for (const id of ids) { const p = await profileById(id); if (!p) continue; list.insertAdjacentHTML("beforeend", `<article class="user-card" data-user="${esc(id)}">${avatar(p)}<div class="user-card-main"><h4>${esc(p.display_name || p.username)}</h4><p class="username">@${esc(p.username)}</p><div class="user-card-actions"><button class="btn btn-ghost btn-sm" data-action="profile">Profile</button><button class="btn btn-primary btn-sm" data-action="message">Message</button><button class="btn btn-ghost btn-sm" data-action="remove">Remove</button></div></div></article>`); }
  }
  async function renderRequestList(items, host, incoming) {
    if (!items.length) { host.innerHTML = `<p class="social-empty">No ${incoming ? "incoming" : "outgoing"} requests.</p>`; return; }
    for (const item of items) { const id = incoming ? item.sender_id : item.receiver_id; const p = await profileById(id); if (!p) continue; host.insertAdjacentHTML("beforeend", `<div class="request-row" data-target="${esc(id)}">${avatar(p)}<div><strong>${esc(p.display_name || p.username)}</strong><br><span>@${esc(p.username)}</span></div><div class="request-actions">${incoming ? '<button class="btn btn-primary btn-sm" data-action="accept">✓</button><button class="btn btn-ghost btn-sm" data-action="reject">×</button>' : '<button class="btn btn-ghost btn-sm" data-action="cancel">Cancel</button>'}</div></div>`); }
  }
  async function loadMyProfile() {
    const { count } = await db.from("friendships").select("user_low", { count: "exact", head: true }).or(`user_low.eq.${user.id},user_high.eq.${user.id}`);
    $("#myProfileCard").innerHTML = `<article class="user-card profile-summary">${avatar(profile)}<div class="user-card-main"><h3>${esc(profile.display_name || profile.username)}</h3><p class="username">@${esc(profile.username)}</p><p>${esc(profile.bio || "No bio added yet.")}</p><p class="panel-kicker">Joined ${esc(new Date(profile.created_at).toLocaleDateString())} · ${count || 0} friends</p></div><button class="btn btn-ghost btn-sm" data-edit-profile>Edit profile</button></article>`;
  }
  async function showPublicProfile(id) {
    const p = await profileById(id); if (!p) return;
    const result = await db.from("friendships").select("user_low", {count:"exact",head:true}).or(`user_low.eq.${id},user_high.eq.${id}`);
    const state = await relationship(id); const content = $("#publicProfileContent");
    content.innerHTML = `<header><h2>PLAYER // @${esc(p.username)}</h2><button class="social-dialog-close" type="button" aria-label="Close">×</button></header><div class="public-profile-head">${avatar(p)}<div><h3>${esc(p.display_name || p.username)}</h3><span class="panel-kicker">Joined ${esc(new Date(p.created_at).toLocaleDateString())} · ${result.count || 0} friends</span></div></div><p class="public-profile-bio">${esc(p.bio || "This player hasn't written a bio yet.")}</p><div class="user-card-actions">${actionMarkup(state)}</div>`;
    const publicDialog = $("#publicProfileDialog"); publicDialog.showModal();
    $(".social-dialog-close", content).addEventListener("click", () => publicDialog.close());
    content.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", async () => { try { await changeRelation(button.dataset.action,id); publicDialog.close(); } catch (error) { setFeedback(socialFeedback,friendly(error),true); } }));
  }
  const dialog = $("#profileDialog");
  function editProfile() { $("#profileForm [name=display_name]").value = profile.display_name || ""; $("#profileForm [name=bio]").value = profile.bio || ""; dialog.showModal(); }
  $("#editProfileBtn").addEventListener("click", editProfile);
  document.addEventListener("click", (event) => { if (event.target.closest("[data-edit-profile]")) editProfile(); });
  $(".social-dialog-close").addEventListener("click", () => dialog.close());
  $("#profileForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const file = form.get("avatar"); let avatar_url = profile.avatar_url;
    try {
      if (file?.size) {
        if (file.size > 2 * 1024 * 1024) throw new Error("Avatar must be 2 MB or smaller.");
        if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) throw new Error("Choose a PNG, JPEG, or WebP image.");
        const { data: upload, error } = await db.storage.from("avatars").upload(`${user.id}/${crypto.randomUUID()}`, file, { contentType: file.type, upsert: false }); if (error) throw error;
        avatar_url = db.storage.from("avatars").getPublicUrl(upload.path).data.publicUrl;
      }
      const updates = { display_name: String(form.get("display_name")).trim() || profile.username, bio: String(form.get("bio")).trim(), avatar_url };
      const { data, error } = await db.from("profiles").update(updates).eq("id", user.id).select().single(); if (error) throw error;
      profile = data; dialog.close(); await Promise.all([loadMyProfile(), loadDirectory(), loadFriends()]); setFeedback(socialFeedback, "Profile saved.");
    } catch (error) { setFeedback($("#profileFeedback"), friendly(error), true); }
  });

  async function openConversation(otherId) {
    const { data, error } = await db.rpc("get_or_create_conversation", { other_user: otherId }); if (error) throw error;
    activeConversation = data; messageOffset = 0; showPage("messages"); await loadConversations(); await loadMessages(true); subscribeMessages();
  }
  async function loadConversations() {
    if (!user) return;
    const { data, error } = await db.from("conversation_members").select("conversation_id,last_read_at,conversations!inner(id,updated_at,conversation_members(user_id))").eq("user_id", user.id).limit(40);
    if (error) { $("#conversationList").innerHTML = `<p class="social-empty">${esc(friendly(error))}</p>`; return; }
    conversations = [];
    for (const row of data || []) {
      const c = row.conversations; const other = (c.conversation_members || []).find((m) => m.user_id !== user.id); if (!other) continue;
      const person = await profileById(other.user_id);
      const [lastResult, unreadResult] = await Promise.all([
        db.from("messages").select("id,body,sender_id,created_at").eq("conversation_id",c.id).order("created_at",{ascending:false}).limit(1).maybeSingle(),
        db.from("messages").select("id",{count:"exact",head:true}).eq("conversation_id",c.id).neq("sender_id",user.id).gt("created_at",row.last_read_at)
      ]);
      const last = lastResult.data; const unread = unreadResult.count || 0;
      conversations.push({ id:c.id, person, last, unread, updated_at:c.updated_at });
    }
    conversations.sort((a,b) => new Date(b.last?.created_at || b.updated_at)-new Date(a.last?.created_at || a.updated_at));
    const unreadCount = conversations.reduce((n,c) => n+c.unread, 0); $("#messageBadge").textContent = unreadCount; $("#messageBadge").hidden = !unreadCount; renderConversations();
  }
  function renderConversations() {
    const host = $("#conversationList"); host.replaceChildren(); const term = $("#chatSearch").value.toLowerCase();
    const rows = conversations.filter((c) => `${c.person?.username} ${c.person?.display_name}`.toLowerCase().includes(term));
    if (!rows.length) { host.innerHTML = '<p class="social-empty">No conversations yet. Add a friend and start chatting.</p>'; return; }
    for (const c of rows) host.insertAdjacentHTML("beforeend", `<button class="conversation-item ${c.id === activeConversation ? "is-active" : ""}" type="button" data-conversation="${esc(c.id)}">${avatar(c.person)}<span class="conversation-copy"><strong>${esc(c.person?.display_name || c.person?.username)}</strong><span>${esc(c.last?.body || "Start a conversation")}</span></span><span class="conversation-time">${c.last ? esc(new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(new Date(c.last.created_at))) : ""}</span>${c.unread ? `<span class="social-badge">${c.unread}</span>` : ""}</button>`);
  }
  $("#conversationList").addEventListener("click", async (event) => { const button = event.target.closest("[data-conversation]"); if (!button) return; activeConversation = button.dataset.conversation; messageOffset = 0; renderConversations(); await loadMessages(true); });
  async function loadMessages(reset = false) {
    if (!activeConversation) return;
    const host = $("#chatMessages"); if (reset) { host.replaceChildren(); messageOffset = 0; }
    const { data: members } = await db.from("conversation_members").select("user_id").eq("conversation_id", activeConversation).neq("user_id", user.id).single();
    const person = members ? await profileById(members.user_id) : null;
    $("#chatHeader").innerHTML = `${avatar(person)} <span>${esc(person?.display_name || person?.username || "Conversation")}</span><span class="connection-dot ${navigator.onLine ? "is-connected" : ""}" id="realtimeDot" title="${navigator.onLine ? "Connected" : "Offline"}"></span>`;
    $("#messageInput").disabled = false; $("#sendMessageBtn").disabled = false;
    const { data, error } = await db.from("messages").select("id,sender_id,body,created_at").eq("conversation_id", activeConversation).order("created_at", { ascending:false }).range(messageOffset,messageOffset+49);
    if (error) { host.innerHTML = `<p class="social-empty">${esc(friendly(error))}</p>`; return; }
    const messages = (data || []).reverse();
    if (!messages.length && reset) host.innerHTML = '<p class="social-empty">Say hello and kick off the conversation.</p>';
    const html = messages.map((m, index) => { const grouped = index > 0 && messages[index - 1].sender_id === m.sender_id; return `<article class="message-bubble ${m.sender_id === user.id ? "is-mine" : ""} ${grouped ? "is-grouped" : ""}" data-message="${esc(m.id)}">${esc(m.body)}<time datetime="${esc(m.created_at)}">${esc(dateText(m.created_at))}</time></article>`; }).join("");
    if (!reset) host.insertAdjacentHTML("afterbegin", html); else host.innerHTML = html || '<p class="social-empty">Say hello and kick off the conversation.</p>';
    messageOffset += messages.length;
    if (reset) host.scrollTop = host.scrollHeight;
    await db.from("conversation_members").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", activeConversation).eq("user_id", user.id);
    await loadConversations();
  }
  $("#chatMessages").addEventListener("scroll", async (event) => { const node = event.currentTarget; if (node.scrollTop < 25 && messageOffset >= 50 && !loadingOlder) { loadingOlder = true; const before = node.scrollHeight; await loadMessages(false); node.scrollTop = node.scrollHeight - before; loadingOlder = false; } });
  $("#messageForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const field = $("#messageInput"); const body = field.value.trim(); if (!body || !activeConversation) return;
    const send = $("#sendMessageBtn"); send.disabled = true; setFeedback(socialFeedback, "Sending…");
    try { const { error } = await db.from("messages").insert({ conversation_id:activeConversation, body }); if (error) throw error; field.value = ""; await loadMessages(true); setFeedback(socialFeedback, ""); }
    catch (error) { setFeedback(socialFeedback, `${friendly(error)} Your message is still here; press Send to retry.`, true); }
    finally { send.disabled = false; }
  });
  $("#messageInput").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#messageForm").requestSubmit(); } });
  function subscribe() {
    if (realtime) db.removeChannel(realtime);
    realtime = db.channel(`social:${user.id}`).on("postgres_changes", { event:"*", schema:"public", table:"friend_requests", filter:`receiver_id=eq.${user.id}` }, () => loadFriends()).on("postgres_changes", { event:"*", schema:"public", table:"friendships" }, () => { loadFriends(); loadDirectory(); }).subscribe((status) => { const dot = $("#realtimeDot"); if (dot) { dot.classList.toggle("is-connected", status === "SUBSCRIBED"); dot.title = status === "SUBSCRIBED" ? "Live" : "Reconnecting"; } });
    if (activeConversation) subscribeMessages();
    window.addEventListener("online", () => { const dot = $("#realtimeDot"); dot?.classList.add("is-connected"); if (activeConversation) subscribeMessages(); });
    window.addEventListener("offline", () => { const dot = $("#realtimeDot"); dot?.classList.remove("is-connected"); if (dot) dot.title = "Offline"; });
  }
  function subscribeMessages() {
    if (messageChannel) db.removeChannel(messageChannel);
    messageChannel = db.channel(`messages:${activeConversation}`).on("postgres_changes", { event:"INSERT", schema:"public", table:"messages", filter:`conversation_id=eq.${activeConversation}` }, async (payload) => {
      const message = payload.new;
      if (message.sender_id !== user.id && !$("[data-message='" + CSS.escape(message.id) + "']")) {
        const host = $("#chatMessages"); const shouldFollow = host.scrollHeight - host.scrollTop - host.clientHeight < 90;
        const bubble = document.createElement("article"); bubble.className = "message-bubble"; bubble.dataset.message = message.id;
        const body = document.createTextNode(message.body); const time = document.createElement("time"); time.dateTime = message.created_at; time.textContent = dateText(message.created_at); bubble.append(body,time); host.append(bubble);
        if (shouldFollow) { host.scrollTop = host.scrollHeight; await db.from("conversation_members").update({last_read_at:new Date().toISOString()}).eq("conversation_id",activeConversation).eq("user_id",user.id); }
      }
      loadConversations();
    }).subscribe();
  }
  window.addEventListener("hashchange", () => { if (location.hash === "#social" && user) { loadFriends(); loadDirectory(); } });
  function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }
}
