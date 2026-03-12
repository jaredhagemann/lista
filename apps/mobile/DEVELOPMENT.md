# Lista Mobile — Development Status

Last updated: 2026-03-11

---

## Current Status

**Phases 0–5 complete.** Branch: `feature/ios-app`. PR #7 open → main.

### What's been built

#### Phase 0 — Monorepo
- Turborepo monorepo. Next.js app at `apps/web/`, Expo app at `apps/mobile/`.
- Stub shared packages: `@lista/types`, `@lista/utils`, `@lista/supabase`.
- 128/128 RLS tests pass. Web app deployed to Vercel.

#### Phase 1 — Auth + Navigation shell
- **Auth gate** (`app/_layout.tsx`) — session-driven routing via `supabase.auth.onAuthStateChange`.
- **Login** — email/password via `supabase.auth.signInWithPassword`.
- **Signup** — calls web `/api/auth/signup` to reuse Resend email flow.
- **Forgot password** — `supabase.auth.resetPasswordForEmail`.
- **Bottom tab navigator** — Home, Schedule, Team, Chat, Settings.
- **Session persistence** — Supabase session in `expo-secure-store`.
- **NativeWind v4** — Tailwind CSS v3 syntax for React Native.

#### Phase 2 — Dashboard + Schedule
- **Dashboard** (`app/(app)/index.tsx`) — upcoming events (5), member count, pull-to-refresh.
- **Schedule list** (`app/(app)/schedule/index.tsx`) — SectionList grouped by date, event type badges, per-row RSVP indicator (✓/?/✗ or dashed placeholder), pull-to-refresh.
- **Event detail** (`app/(app)/schedule/[eventId].tsx`) — time/location/notes, RSVP buttons with optimistic updates, responses list.

#### Team & Profile Switcher (between Phase 2–3)
- **AppContext** (`contexts/AppContext.tsx`) — single load of own profile, managed profiles, all team memberships. `switchTeam()` / `switchProfile()` update Supabase + SecureStore, instantly re-render all consumers.
- **TeamProfileStrip** (`components/TeamProfileStrip.tsx`) — persistent strip above all tab screens. Amber "Viewing as" label when on managed profile.
- **SwitcherSheet** (`components/SwitcherSheet.tsx`) — slide-up modal with deduplicated team list and "View as" section.

#### Phase 3 — Team roster
- **Roster** (`app/(app)/team/index.tsx`) — Players (by jersey number) and Staff sections. Pending invites with dashed border + clock badge (admins only).
- **Member detail** (`app/(app)/team/[memberId].tsx`) — Read-only: avatar, profile fields, managers list. Email gated to admin/own profile.

#### Phase 4 — Chat
- **Channel list** (`app/(app)/chat/index.tsx`) — Team Chat, DMs, Groups sections. Unread badges via Realtime. New DM sheet (resolves managed profiles → manager accounts). New Group sheet (same resolution, multi-select).
- **Channel thread** (`app/(app)/chat/[channelId].tsx`) — Inverted FlatList, optimistic send, Realtime INSERT/UPDATE, soft-delete on long-press, mark-read on open.
- **DM thread** (`app/(app)/chat/dm/[dmId].tsx`) — Same pattern, position-aware `last_read_a`/`last_read_b`.
- **MessageItem** / **MessageInput** components.

#### Phase 5 — Settings
- **Hub** (`app/(app)/settings/index.tsx`) — Profile card, nav rows, Sign Out.
- **Edit Profile** (`app/(app)/settings/profile.tsx`) — Name, birthday, gender pill selector.
- **Notifications** (`app/(app)/settings/notifications.tsx`) — Email/push/chat toggles via `notification_preferences` upsert.
- **Managed Players** (`app/(app)/settings/managed-players.tsx`) — List from AppContext + inline add form. POSTs to `/api/managed-profiles` on the web app (Bearer token auth, service role creation).

### What's not built yet (Phase 6)

#### Track A — Code only (no Apple Developer Account needed)
- [ ] AASA file at `lista.team/.well-known/apple-app-site-association` (web)
- [ ] Associated Domains entitlement in `app.json` (`applinks:lista.team`)
- [ ] Invite accept screen (`app/(auth)/invite/[id].tsx`)
- [ ] Deep link routing via `expo-linking`
- [ ] Push notifications: `expo-notifications` setup, token registration, store `expo_push_token` in `push_subscriptions`, fan-out updates to `/api/notifications/send` and `/api/chat/notify`
- [ ] `eas.json` build profiles

#### Track B — Requires Apple Developer Account ($99/yr)
- [ ] Bundle ID registration (`com.acg.lista`) in Apple Developer Portal
- [ ] Associated Domains capability enabled on App ID
- [ ] APNs Auth Key (`.p8`) — generate in Developer Portal, upload via `eas credentials`
- [ ] App Store Connect app record
- [ ] EAS Build (signed `.ipa`)
- [ ] TestFlight distribution

#### Also deferred from earlier phases
- [ ] Avatar upload in profile edit (requires `expo-image-picker`)
- [ ] Custom app icon + splash screen assets
- [ ] Event create/edit flow (admin only)
- [ ] Team settings edit (admin only)

---

## Running the App

### Targeting local Supabase (development)

`apps/mobile/.env.local` should contain:
```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<ES256 anon key from .env.test.local>
EXPO_PUBLIC_API_URL=http://localhost:3000
```

**Important:** The anon key must be the ES256-signed key (from `.env.test.local`), not the HS256 key. After any `supabase stop --no-backup` + `supabase start` cycle, the key stays the same (deterministic `kid: b81269f1-...`).

For device testing over LAN, replace `127.0.0.1` / `localhost` with your Mac's local IP (e.g. `192.168.86.44`).

### Targeting production

```
EXPO_PUBLIC_SUPABASE_URL=https://vnmwiwxhiwwrekjdwbml.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<production anon key from Vercel env vars>
EXPO_PUBLIC_API_URL=https://lista.team
```

### Start everything (local)

```bash
# Terminal 1
supabase start

# Terminal 2
pnpm dev                              # web server (needed for signup)

# Terminal 3 — iOS Simulator
pnpm --filter @lista/mobile run ios

# Or — Expo Go (same WiFi, real device, SDK 54 only until Expo Go 55 ships)
pnpm --filter @lista/mobile start

# Clear Metro cache (required after adding/removing packages)
pnpm --filter @lista/mobile run ios -- --clear
```

---

## Key Files

| File | Purpose |
|------|---------|
| `app/_layout.tsx` | Root auth gate |
| `app/(auth)/login.tsx` | Login |
| `app/(auth)/signup.tsx` | Signup (calls web `/api/auth/signup`) |
| `app/(auth)/forgot-password.tsx` | Forgot password |
| `app/(app)/_layout.tsx` | Tab navigator + AppProvider + TeamProfileStrip |
| `app/(app)/index.tsx` | Dashboard home |
| `app/(app)/schedule/` | Schedule list + event detail + RSVP |
| `app/(app)/team/` | Roster + member detail |
| `app/(app)/chat/` | Channel list + threads + DMs |
| `app/(app)/settings/` | Settings hub + sub-screens |
| `contexts/AppContext.tsx` | Global state: profile, team memberships, switch actions |
| `components/TeamProfileStrip.tsx` | Persistent team/profile header strip |
| `components/SwitcherSheet.tsx` | Team/profile switcher bottom sheet |
| `components/chat/MessageItem.tsx` | Chat message bubble |
| `components/chat/MessageInput.tsx` | Chat input bar |
| `lib/supabase.ts` | Supabase client (SecureStore session adapter) |
| `babel.config.js` | NativeWind/Expo Babel config |
| `metro.config.js` | NativeWind Metro config |
| `tailwind.config.js` | Tailwind v3 config (NativeWind uses v3, not v4) |

---

## Architecture Notes

- **No server components** — all data fetching is client-side (`useEffect` / Supabase JS).
- **Active profile** — stored in SecureStore key `active_profile_id` (mirrors web's `active_profile_id` cookie). Absent = viewing as own profile.
- **Active team** — stored in `profiles.active_team_id` in the database.
- **Chat sender** — always `session.user.id` (the authenticated user), never the managed profile. Enforced by RLS (`sender_id = auth.uid()`).
- **Managed profile creation** — requires service role; proxied through web `/api/managed-profiles` with Bearer token auth.
- **UUID generation** — use `expo-crypto` (`Crypto.randomUUID()`), not `crypto.randomUUID()` — the global `crypto` object is not available in Hermes.
- **NativeWind** — Tailwind CSS v3 (installed in `devDependencies`). Web app uses Tailwind v4. Same class names, different config syntax.
- **Expo Go compatibility** — app targets SDK 55. Expo Go on the App Store is v54 (SDK 54 only). Use iOS Simulator for testing until Expo Go 55 ships, or build a development build via EAS (requires Apple Developer Account).

---

## Expo Go vs. Development Build

| Method | SDK match | Requires Apple Dev Account | Use case |
|--------|-----------|---------------------------|----------|
| iOS Simulator | Any | No | Primary dev workflow |
| Expo Go (App Store v54) | SDK 54 only | No | ❌ Incompatible until Expo Go 55 ships |
| EAS Development Build | Any | Yes | Real device testing, APNs |
| TestFlight | Any | Yes | Beta distribution |

---

## Next: Phase 6 — Invite Deep Links + Polish

See Track A and Track B above. Blocked on Apple Developer Account enrollment decision before Track B work begins. Track A (AASA file, invite screen, push notification code, EAS config) can start immediately.
