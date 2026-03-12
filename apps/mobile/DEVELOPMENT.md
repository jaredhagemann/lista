# Lista Mobile — Development Status

Last updated: 2026-03-11

---

## Current Status

**Phase 1 complete** (branch: `feature/ios-app`, commit `7e0094a`)

### What's been built
- **Auth gate** (`app/_layout.tsx`) — redirects unauthenticated users to login, authenticated users to the main app. Session state driven by `supabase.auth.onAuthStateChange`.
- **Auth screens** (`app/(auth)/`)
  - Login — email/password via `supabase.auth.signInWithPassword`
  - Signup — calls the web app's `/api/auth/signup` endpoint to reuse the custom Resend email flow
  - Forgot password — sends reset link via `supabase.auth.resetPasswordForEmail`
- **Tab navigator** (`app/(app)/`) — 5 tabs with placeholder screens:
  - Home, Schedule, Team, Chat, Settings
  - Settings screen has a working **Sign Out** button
- **Session persistence** — Supabase session stored in `expo-secure-store` (survives app restarts)
- **NativeWind v4** styling configured (Tailwind CSS v3 syntax, separate from web app's Tailwind v4)

### What's not built yet
- All tab screens are placeholders ("coming soon")
- Phase 2: Dashboard home + Schedule list + Event detail + RSVP
- Phase 3: Availability matrix + Team roster + Member detail
- Phase 4: Chat (channel list, message thread, real-time)
- Phase 5: Settings screens + Managed profiles + Profile switcher
- Phase 6: Universal Links (invite/auth emails opening the app) + App icon + TestFlight

---

## Running the App Locally

### Prerequisites
- **Xcode** installed and `xcode-select` pointing to it (`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`)
- **Expo account** — logged in via `eas login`
- **pnpm** installed

### 1. Start the local Supabase stack
Required for auth and all data queries. Docker must be running first.

```bash
supabase start
```

If it's the first time after a Docker image prune, this will re-pull images (~5 min).

### 2. Start the web app dev server
Required for signup (the mobile signup calls `/api/auth/signup` on the web app).

```bash
pnpm dev
# Runs on http://localhost:3000
```

### 3. Start the Expo dev server and open in iOS Simulator

```bash
pnpm --filter @lista/mobile run ios
```

This starts the Metro bundler and launches the app in the iOS Simulator (iPhone 17 Pro by default). **Keep this terminal open** — closing it stops the Metro bundler and the app loses hot reload.

To open on a different simulator, use:
```bash
pnpm --filter @lista/mobile run ios -- --device "iPhone 16"
```

To open in Expo Go on a real iPhone instead (no Apple Developer Account needed):
```bash
pnpm --filter @lista/mobile start
# Then scan the QR code with the Expo Go app
```

---

## Environment Variables

The file `apps/mobile/.env.local` is gitignored. It should already exist with the local dev values:

```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<local anon key>
EXPO_PUBLIC_API_URL=http://localhost:3000
```

If this file is missing, copy values from `apps/web/.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` → `EXPO_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Set `EXPO_PUBLIC_API_URL=http://localhost:3000`

See `apps/mobile/env.example` for the template.

---

## Key Files

| File | Purpose |
|------|---------|
| `app/_layout.tsx` | Root auth gate — drives login/app redirect |
| `app/(auth)/login.tsx` | Login screen |
| `app/(auth)/signup.tsx` | Signup screen (calls web `/api/auth/signup`) |
| `app/(auth)/forgot-password.tsx` | Forgot password screen |
| `app/(app)/_layout.tsx` | Bottom tab navigator |
| `app/(app)/settings.tsx` | Settings placeholder (has working sign out) |
| `lib/supabase.ts` | Supabase client with SecureStore session adapter |
| `babel.config.js` | NativeWind/Expo Babel config |
| `metro.config.js` | NativeWind Metro config |
| `tailwind.config.js` | Tailwind v3 config (NativeWind uses v3, not v4) |
| `global.css` | Tailwind directives, imported in root layout |

---

## Architecture Notes

- **No server components** — all data fetching is client-side in hooks/effects (React Native has no RSC equivalent)
- **Supabase client** (`lib/supabase.ts`) — uses `expo-secure-store` for token storage instead of cookies
- **Signup flow** — calls `EXPO_PUBLIC_API_URL/api/auth/signup` (the web app) to reuse the custom Resend email confirmation. The web dev server must be running locally.
- **NativeWind** uses Tailwind CSS **v3** (installed locally in `apps/mobile/devDependencies`). The web app uses Tailwind v4. Class names are the same but config syntax differs.
- **expo-router** replaces the old `App.tsx`/`index.ts` entry. The `main` field in `package.json` is set to `expo-router/entry`.
- **Tab layout** — 5 tabs (not 6): Availability will live under the Schedule tab in Phase 2.

---

## Monorepo Commands (from repo root)

```bash
pnpm dev              # Run web app dev server
pnpm build            # Build web app
pnpm test:rls         # Run RLS tests (requires supabase start)
pnpm --filter @lista/mobile run ios     # Run mobile app in iOS Simulator
pnpm --filter @lista/mobile start       # Run mobile Metro bundler (Expo Go / manual)
```

---

## Next: Phase 2 — Dashboard + Schedule

- Dashboard home: upcoming events list, team name header
- Schedule screen: chronological event list with date grouping
- Event detail screen: event info, location, RSVP buttons (available/maybe/unavailable)
- Event create/edit (admin only)
