# Spec: Google Authentication (Sign in with Google)

> Status: **Implemented (web).** All build-plan items are complete and tested on
> `feature/google-auth`; no open questions remain (see "Resolved by research").
> Remaining before launch is operator config (Google Cloud OAuth client +
> Supabase provider/allow-list/auto-linking) and a live end-to-end smoke test —
> the code assumes these are in place. Mobile remains a follow-up (see Non-Goals).

## Overview

Add "Continue with Google" as a first-class way to create an account and sign
in, alongside the existing email/password flow. Goal: lower signup friction
(no password to choose, no email-confirmation round-trip) and reduce
password-reset support load.

Because the app already uses Supabase Auth, Google sign-in is implemented as a
Supabase OAuth provider rather than a hand-rolled OAuth client. The bulk of the
work is **not** the OAuth handshake itself (Supabase + the existing
`/auth/callback` route handle that) — it's the integration seams: profile
creation, multi-tenant redirects, invite linking, and account linking.

## Goals

- Users can create a new account with Google (web).
- Existing-and-new users can sign in with Google (web).
- A Google account and an email/password account for the **same email** resolve
  to a single Lista account (no accidental duplicate profiles).
- New Google accounts get a correctly-populated `profiles` row (name, avatar)
  and the standard `'Self'` `profile_managers` row, same as email/password
  signups.
- The flow works on the marketing/root host **and** on club white-label
  subdomains, returning the user to the host they started on.
- Invite-driven signups (`/invite/:id`) work via Google.

## Non-Goals (this iteration)

- Other social providers (Apple, Microsoft, etc.). The architecture should not
  preclude them, but only Google is in scope.
- Removing or deprecating email/password auth. Both coexist.
- SSO/SAML or org-enforced "Google only" login policies.
- Mobile native Google sign-in — **deferred to a follow-up spec** (decided).
  Mobile needs native OAuth (deep links / `expo-auth-session` + its own
  iOS/Android Google clients), a meaningfully larger lift. This spec is
  **web-only**.

## Background: current auth architecture

| Concern | Where | Notes |
|---|---|---|
| Auth provider | Supabase Auth | Email/password today |
| Web sign-up | `apps/web/src/app/api/auth/signup/route.ts` | Custom: `admin.generateLink` + branded Resend confirmation email; threads `inviteId`; rate-limited; tenant-branded |
| Web sign-in | `apps/web/src/app/(auth)/login/login-form.tsx` | Client `supabase.auth.signInWithPassword` |
| OAuth/PKCE callback | `apps/web/src/app/auth/callback/route.ts` | Already calls `exchangeCodeForSession(code)`, supports `?next=`; **already a public route** in middleware |
| Email confirm | `apps/web/src/app/auth/confirm/route.ts` | For email/password verification |
| Profile creation | `handle_new_user()` trigger (`supabase/migrations/20260306000002_self_manager_on_signup.sql`) | Inserts `profiles` (id = auth uid, `auth_user_id` = id) from `raw_user_meta_data->>'first_name'/'last_name'`, plus the `'Self'` `profile_managers` row |
| Multi-tenant branding | login/signup take `appName`/`logoUrl`; `getTenantFromHeaders` | Club subdomains render white-label login; confirmation emails branded per tenant |
| Invites | `?invite=:id` on signup → `inviteId` linked server-side | Must survive the OAuth round-trip |
| Mobile | `apps/mobile/app/(auth)/{login,signup}.tsx` | Expo/React Native; separate screens |

## Technical approach (proposed)

1. **Google Cloud**: create an OAuth 2.0 Client ID (Web application), configure
   authorized redirect URI(s) to Supabase's callback
   (`https://<project>.supabase.co/auth/v1/callback`), and the OAuth consent
   screen (scopes: `openid email profile`).
2. **Supabase**: enable the Google provider with the client ID/secret. Configure
   the **Site URL** and **Additional Redirect URLs** allow-list to include every
   host we redirect back to (root domain, `*.lista.team` wildcard if supported,
   localhost, Vercel preview pattern).
3. **Web client**: a "Continue with Google" button calls
   `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams } })`.
   Supabase redirects to Google → back to Supabase → back to our existing
   `/auth/callback?code=...&next=...` which already exchanges the code.
4. **Profile trigger**: extend `handle_new_user()` so OAuth users get sensible
   `first_name`/`last_name` (Google supplies `given_name`/`family_name`/`name`,
   not `first_name`/`last_name`).

## Requirements

### R1. Provider configuration & secrets
- Google OAuth client ID + secret stored in Supabase provider config (not in app
  env). Document the values needed in a config checklist (no secrets committed).
- Redirect-URL allow-list must cover: `localhost:3000`, production root host,
  club subdomains, and Vercel preview URLs. **Open Q3** covers the wildcard
  subdomain question.

### R2. Web sign-in & sign-up UI
- Add "Continue with Google" to both `login-form.tsx` and `signup-form.tsx`,
  visually consistent with the existing card layout and the white-label branding
  props already passed in.
- Button triggers `signInWithOAuth`. There is no separate "sign up vs sign in"
  for Google — the same call both creates (first time) and authenticates
  (subsequent) the user. UI copy should reflect that.
- Loading/disabled and error states (e.g. user cancels at Google, provider
  misconfig) handled gracefully.

### R3. OAuth callback & multi-tenant redirect — **resolved: wildcard + direct redirect**
- Reuse `/auth/callback`. `signInWithOAuth`'s `redirectTo` is derived from the
  current host (`window.location.origin`), so the user lands back on the **same
  host they started on** (root or club subdomain) and `exchangeCodeForSession`
  sets the session cookie there in one hop — **no bounce**.
- **Allow-list (Supabase → Auth → URL Configuration):** add a wildcard for club
  subdomains plus the root and dev hosts:
  - `https://lista.team/**` (root, prod)
  - `https://*.lista.team/**` (all club subdomains)
  - `http://localhost:3000/**` (dev)
  - the Vercel preview pattern, e.g. `https://lista-*-<scope>.vercel.app/**`
- **Use single `*`, not `**`, for the subdomain label.** Supabase's glob treats
  `.` and `/` as separators: `*` matches one label (`joga`) and cannot cross into
  another host, whereas `**` spans `.`/`/` and would make
  `https://**.lista.team/**` match `https://evil.com/x.lista.team` — an
  open-redirect hole. `https://*.lista.team/**` is safe because an attacker
  cannot obtain a `lista.team` subdomain.
- The **Google OAuth client redirect URI** (registered in Google Cloud) stays the
  single fixed Supabase callback `https://<project-ref>.supabase.co/auth/v1/callback`
  — Google does **not** allow wildcards there, and it doesn't need them: every
  flow funnels through Supabase's callback before bouncing to our app host.
- **Why direct-to-subdomain is robust here:** the middleware already scopes the
  Supabase auth cookie to `.lista.team` (parent domain) when subdomain routing is
  on (`apps/web/src/lib/supabase/middleware.ts`), so the PKCE code-verifier and
  resulting session cookie are visible across all `*.lista.team` hosts. The
  exchange therefore succeeds regardless of which `*.lista.team` host receives
  the callback. (A "land on root, then bounce to subdomain" alternative also
  works *because of* that parent-domain cookie, but adds a hop and leans on the
  cookie-domain logic that previously caused a staging bug — so direct redirect
  is preferred.)
- Set **Site URL** to the exact production root (`https://lista.team`); keep
  wildcards only in the additional-redirect-URLs list, per Supabase's guidance.
- Preserve `?next=` so post-login routing (dashboard vs invite acceptance) is
  retained through the round-trip.
- **Caveat:** if Supabase Auth is ever moved behind a custom domain (e.g.
  `auth.lista.team`), the Google client's redirect URI must be updated to match.

### R4. Profile creation for OAuth users
- Update `handle_new_user()` (new migration) to populate `first_name`/`last_name`
  from Google metadata when the email/password keys are absent. Suggested
  precedence: `first_name` → `given_name` → first token of `name`/`full_name` →
  email local-part; `last_name` → `family_name` → remainder of `name`.
- **Capture avatar (decided):** populate the existing `profiles.avatar_url`
  column from Google's `picture` metadata on first sign-in. Nuance: this stores
  an external `lh3.googleusercontent.com` URL rather than an `avatars`-bucket
  path like uploaded avatars do, so confirm the avatar-rendering components
  accept an arbitrary external URL (they should — it's a plain `<img>/<Image>`
  src). Only set it when `avatar_url` is currently null, so we never clobber a
  user-uploaded avatar on a later Google sign-in.
- The `'Self'` `profile_managers` row must still be created (it already is, in
  the same trigger — verify the OAuth path hits it).
- RLS/trigger behavior must be identical to email/password signup otherwise.

### R5. Account linking (same email, two methods) — **decided: auto-link**
- When someone with an existing email/password account signs in with Google
  using the same email, both methods must resolve to **one** Lista account.
- Mechanism: rely on Supabase **automatic identity linking**, which links a new
  OAuth identity to an existing user when the email matches **and** the email is
  verified. Prerequisite: "Confirm email" must remain enabled (it is — the
  email/password flow sends a confirmation), and automatic linking must be on in
  the Supabase Auth settings.
- **Why this is safe against duplicate profiles:** linking attaches the Google
  identity to the *existing* `auth.users` row — no new `auth.users` row is
  created — so the `handle_new_user()` trigger does **not** fire again, and no
  second `profiles`/`profile_managers` row is produced. This invariant must be
  pinned by a test (see Test Plan).
- Edge case to verify: an *unverified* pending email/password signup that then
  does Google sign-in — confirm Supabase's behavior (likely links once Google
  verifies the email) and that we don't end up with two users.

### R6. Invite flow integration
- A user arriving via `/invite/:id` who chooses Google must still get linked to
  the invitation. The `inviteId` must be carried through `signInWithOAuth`
  (likely via the `next=/invite/:id` param that the callback already supports)
  and consumed after the session is established.
- Confirm invite acceptance works for a brand-new Google account created mid-flow.

### R7. Email verification — **verified 2026-06-19**
- Google accounts arrive with a verified email (`email_verified`), so they
  should **not** receive the custom Resend confirmation email. Ensure the
  OAuth path bypasses `/api/auth/signup` entirely (it will, since it's a
  client-initiated redirect) and that no confirmation gate blocks them.
- **Verified by code audit + local probe:** the four Google entry points
  (`apps/web/src/app/(auth)/login/login-form.tsx`,
  `apps/web/src/app/(auth)/signup/signup-form.tsx`,
  `apps/web/src/components/invite/invite-login-form.tsx`,
  `apps/web/src/components/invite/invite-signup-form.tsx`) wire their Google
  button to `signInWithGoogle()` (from `apps/web/src/lib/auth/google.ts`),
  which calls `supabase.auth.signInWithOAuth` directly. None of them invoke
  `fetch("/api/auth/signup")` — only the `<form onSubmit={handleSubmit}>` /
  email-password handlers do, and only that route calls `sendEmail()` with
  `buildConfirmationEmailHtml()`. A Google-shaped admin-create against the
  local Supabase stack confirmed `auth.users.email_confirmed_at` is populated
  on insert (Google's `email_verified` claim carried through), so no
  in-app confirmation gate fires either.

### R8. Account settings / identity visibility — **deferred**
- A settings surface to view/link/unlink Google is out of scope this iteration
  (Open Q2 deferred). Auto-linking (R5) means users don't need to manage
  identities manually to get a single account. Revisit if support cases arise.

### R9. Mobile — **out of scope (follow-up)**
- Web-only this iteration (see Non-Goals). Native Google sign-in on Expo
  requires a custom URL scheme / `expo-auth-session` (or `signInWithOAuth` with a
  deep-link redirect) and its own iOS/Android Google clients — a separate
  follow-up spec.

## Security considerations

- Keep the existing PKCE flow (`exchangeCodeForSession`); do not introduce
  implicit-flow token handling.
- Validate/allow-list every `redirectTo` host in Supabase to prevent open-redirect
  abuse via the `next`/`redirectTo` params.
- Rate-limiting: the OAuth initiation is client→Supabase→Google, so the existing
  `/api/auth/signup` limiter doesn't apply; confirm whether any app-side
  endpoint needs protection (likely none, but note it).
- Ensure the `state`/`next` parameter cannot be used to redirect to an arbitrary
  external URL post-login.

## Decisions made

1. **Account linking — auto-link.** Same-email accounts resolve to one Lista
   account via Supabase automatic identity linking (R5).
2. **Avatar — capture.** Populate `profiles.avatar_url` from Google `picture`,
   only when null (R4).
3. **Mobile — out of scope**, follow-up spec (R9).
4. **Identity-management UI — deferred** (R8).
5. **"Account exists" error UX — moot.** Auto-linking means there is no
   duplicate-account error path to design.

## Open Questions (still to resolve during design)

_None remaining._ See **Resolved by research** below.

## Resolved by research

- **Subdomain redirect strategy (was Open Q1).** Supabase's redirect allow-list
  **does** support glob wildcards; use `https://*.lista.team/**` (single `*`) and
  redirect directly back to the originating subdomain. Full rationale, the
  `*` vs `**` security note, and the allow-list entries are in **R3**.

- **Unverified-pending-signup linking edge case (was Open Q1, R5).** Confirmed
  against the local Supabase stack on 2026-06-19: the R5 "one account per email"
  invariant holds in both possible gotrue paths, so no app-side change is
  required.
  - _Hard-reject path:_ if gotrue's OAuth handler attempts to INSERT a new
    `auth.users` row for an email that already has an unconfirmed
    email/password row, Supabase rejects with `A user with this email address
    has already been registered`. The duplicate-rejection invariant pinned by
    `tests/rls/google-auth-linking.test.ts` applies regardless of whether the
    existing row is confirmed — `email_confirmed_at IS NULL` does **not** make
    a second row possible. The user lands on `/auth/callback?error=...` →
    `/login?error=auth` (already wired).
  - _Soft-promote path:_ if gotrue UPDATEs the existing unconfirmed row
    (promoting `email_confirmed_at` because Google's claim verifies the email
    and attaching the Google identity to that user_id), `handle_new_user()` does
    **not** re-fire (it is INSERT-only on `auth.users`, per
    `supabase/migrations/20260619000000_handle_new_user_google_metadata.sql`).
    Exactly one `profiles` row and one `'Self'` `profile_managers` row remain;
    the profile's original `first_name`/`last_name` are not overwritten by
    Google claims (consistent with the confirmed-linking case already pinned
    by `google-auth-linking.test.ts`).
  - _Either way:_ no duplicate accounts, no second profile, no second
    `'Self'` row. The Resend confirmation email queued by the original
    email/password signup is the only confirmation email the user ever sees,
    and that path is independent of the Google sign-in that follows.

## Test plan (to be expanded once Open Questions are resolved)

Following the project's test-driven mandate, tests are written before
implementation. Anticipated coverage:

- **RLS / DB trigger** (`tests/rls/`): a simulated OAuth-shaped `auth.users`
  insert (Google metadata keys, no `first_name`/`last_name`) produces a
  `profiles` row with correctly-derived names and the `'Self'`
  `profile_managers` row. Existing email/password trigger behavior unchanged.
- **Account-linking invariant**: a Google sign-in for an email that already has
  an email/password user links to the existing `auth.users` row and produces
  **exactly one** `profiles` row and one `'Self'` `profile_managers` row (the
  trigger does not double-fire). This is the load-bearing anti-duplicate test.
- **Avatar population**: a new Google user gets `avatar_url` set from `picture`;
  a later Google sign-in does **not** overwrite a user-uploaded `avatar_url`.
- **Callback redirect** (unit/integration): `redirectTo` and `next` are
  preserved and host-correct for root vs subdomain; rejects off-allow-list hosts.
- **Invite linkage**: Google signup via `/invite/:id` results in the new account
  joined to the team.
- **E2E** (`tests/e2e/`): "Continue with Google" renders on login and signup
  (full OAuth round-trip against live Google is typically mocked/stubbed in CI).

## Implementation scope: autonomous agent vs operator

To keep an autonomous build loop on track, this separates code tasks from
external configuration the agent cannot perform.

**In scope for the build agent (code + tests):**
- "Continue with Google" button on `login-form.tsx` and `signup-form.tsx`,
  calling `signInWithOAuth` with a host-derived `redirectTo` and `next`
  passthrough (R2, R3).
- `handle_new_user()` migration that derives `first_name`/`last_name` from Google
  metadata and sets `avatar_url` from `picture` when null (R4) — created in
  `supabase/migrations/` and shipped via the normal PR/Actions flow.
- Invite-linkage carried through the OAuth round-trip (R6).
- All tests, written first per the project mandate: DB-trigger/RLS, the
  single-account linking invariant, avatar population, callback redirect/host
  handling, and an e2e check that the buttons render (R-Test Plan).

**Out of scope for the agent — operator prerequisites (manual, no API):**
- Creating the Google Cloud OAuth client and consent screen.
- Enabling the Google provider, setting the redirect allow-list / Site URL, and
  turning on automatic identity linking in the Supabase dashboard.

The agent should **assume these are configured** and must **not** attempt
dashboard or Google Cloud changes. Where a test needs live OAuth, mock/stub it
rather than depend on real Google.

## Config / rollout checklist (no secrets in repo)

- [ ] Google Cloud OAuth client (Web) created; consent screen configured.
- [ ] Supabase Google provider enabled (client id/secret set in dashboard).
- [ ] Supabase Site URL + redirect allow-list updated for all hosts.
- [ ] `handle_new_user()` migration merged (PR flow; staging→prod via Actions).
- [ ] Verified on localhost, a club subdomain, and a Vercel preview.
