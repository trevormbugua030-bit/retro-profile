# Retro Profile

Trevor Mbugua's vanilla HTML/CSS/JavaScript portfolio, with an optional Supabase powered player network. The existing portfolio, theme switcher, music control, games, and Node static server remain in place.

## Local development

Requires Node.js 18 or newer. For the portfolio shell, run `npm run serve` and open `http://localhost:3000`. Social features are disabled until configured.

## Configure the social backend

1. Create a Supabase project.
2. In **SQL Editor**, run [`supabase/migrations/001_social.sql`](supabase/migrations/001_social.sql). This creates the Auth profile trigger, profiles, friend requests, normalized friendships, private conversations, read markers, messages, RLS rules, storage policies, and Realtime publication entry.
3. In **Authentication → URL Configuration**, set the Site URL to your deployed site and add local/deployed callback URLs to the redirect allow list. Enable email confirmation. Configure SMTP for dependable verification and password reset delivery. Set sensible Auth rate limits and enable CAPTCHA/bot protection before opening registrations publicly.
4. Copy `config.example.js` to `config.js`; fill in the project URL and the public `anon` key from **Project Settings → API**. The anon key is intended for browser use and is protected by RLS. Never put a `service_role` key here.
5. Enable Realtime for `public.messages` if it is not already enabled. The migration attempts to add it to `supabase_realtime`.
6. Deploy the static files to any static host that supports ES modules and serves unknown navigation paths with an index fallback. GitHub Pages works with the existing hash navigation. Add `config.js` as a deployment secret/file in CI; it is ignored by git.

The Terms & Privacy link opens `privacy.html`. Review that notice, add the operator contact details and any jurisdiction-specific terms, and have it reviewed before accepting public registrations.

## Security model

Signup requires the terms acceptance flag; the Auth trigger records the acceptance timestamp and notice version in a protected profile column. The browser only contains the Supabase project URL and anon key. Supabase Auth handles password hashing, email verification, sessions, reset emails, and token refresh. SQL policies restrict profile updates, relationship management, conversation access, and messages. Database functions validate friend acceptance, prevent self-requests, resolve reciprocal requests, and create one conversation per friend pair. The app escapes user content and renders messages with text nodes. Avatar bucket upload limits are enforced by Supabase Storage (2 MB, PNG/JPEG/WebP, owner folder).

## Verification and limits

`npm run serve` serves this project only; it is not an application API and cannot provide social features without Supabase configuration. No Supabase credentials are present in the repository, so account registration, email delivery, two-account friend/chat flows, RLS checks against a live database, and deployed behavior require setup in the Supabase project and have not been represented as verified here.
