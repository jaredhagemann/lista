# Lista iOS App — Design Spec

**Status:** Planning
**Started:** 2026-03-10
**Approach:** React Native + Expo SDK (monorepo with existing web app)

---

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | React Native + Expo | Shares Supabase client, DB types, and utilities with the web app |
| Repo structure | Turborepo monorepo | Single source of truth for shared packages; avoids type drift |
| Binary builds | EAS Build (cloud) | No local Xcode required for CI/CD; simpler cert management |
| Apple Developer Account | Deferred — enroll when ready for device testing or App Store | Development proceeds with Expo Go + iOS Simulator (free); enrollment unlocks APNs, TestFlight, App Store |
| Enrollment type | Individual (can upgrade to Organization later) | Individual enrolls in 24-48h; Organization requires D-U-N-S number (~1-2 weeks) but shows company name in App Store |
| Initial platform | iOS first | Android follow-on after iOS ships |
| Bundle identifier | `com.acg.lista` | `com.acg` = Ashton Consulting Group namespace for all future apps; permanent after first App Store submission |
| App display name | "Lista" | Name shown under app icon on device |
| Production domain | `lista.team` | Used for Universal Links (AASA file) |
| Universal Links scope | `/invite/*` and `/auth/*` | Auth emails (password reset, email confirm) open in-app on mobile |
| Schedule view | List only (no calendar grid) | Calendar grid not practical on vertical mobile screen |
| Active profile storage | `expo-secure-store` | Replaces HTTP cookie used on web for `active_profile_id` |
| Push token schema | Add `expo_push_token` column to `push_subscriptions` | Web-push rows leave it null; mobile rows populate it; API routes fan out to both |
| v1 scope | Web parity only | No mobile-exclusive features in v1 |

---

## Feature Scope (v1)

Parity with the current web app. Every screen the web app has, the mobile app has — using native navigation patterns and controls.

| Feature | Web status | Mobile v1 |
|---------|-----------|-----------|
| Auth (login, signup, forgot/reset password) | ✅ | ✅ |
| Invite flow (accept via email link) | ✅ | ✅ |
| Dashboard home (upcoming events + team overview) | ✅ | ✅ |
| Schedule (list view, event detail) | ✅ | ✅ (list only — no calendar grid on mobile) |
| Event create/edit (with recurrence) | ✅ | ✅ |
| Availability RSVP matrix | ✅ | ✅ |
| Team roster | ✅ | ✅ |
| Member profile detail | ✅ | ✅ |
| Team chat (team channel, DMs, groups) | ✅ | ✅ |
| Settings (profile, team, notifications, managed players) | ✅ | ✅ |
| Managed profiles / profile switching | ✅ | ✅ |
| Push notifications (events + chat) | Web-push (VAPID) | APNs via Expo |

---

## Monorepo Structure

The current Next.js app moves to `apps/web/`. A new `apps/mobile/` is created for Expo.

```
lista/ (Turborepo root)
├── apps/
│   ├── web/                    ← current Next.js app (moved)
│   └── mobile/                 ← new Expo app
├── packages/
│   ├── supabase/               ← shared Supabase client factory + config
│   ├── types/                  ← shared database.ts types (auto-generated)
│   └── utils/                  ← shared rrule helpers, date-fns wrappers
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### What moves to shared packages

| Currently in web | Moves to package |
|-----------------|-----------------|
| `src/types/database.ts` | `packages/types/` |
| `src/lib/supabase/client.ts` (factory only) | `packages/supabase/` |
| `src/lib/utils/rrule.ts` | `packages/utils/` |
| date-fns wrappers | `packages/utils/` |

The web app's server-only Supabase clients (RSC, middleware, service role) stay in `apps/web/` — they have no mobile equivalent.

---

## Dependencies

### Prerequisites (one-time setup)

| Dependency | How to get | Notes |
|-----------|-----------|-------|
| **Xcode 16+** | Mac App Store | Required to run iOS Simulator; ~15 GB install |
| **iOS Simulator** | Bundled with Xcode | Used for local dev; free, no Apple account needed |
| **Expo Go** | App Store (on iPhone) | Run dev builds on real device instantly; free, no Apple account needed |
| **EAS CLI** | `npm install -g eas-cli` | Expo cloud build + submit tool |
| **Expo account** | [expo.dev](https://expo.dev) | Free; needed for EAS |
| **Apple Developer Account** *(deferred)* | [developer.apple.com](https://developer.apple.com) | $99/year; enroll when ready to test APNs push notifications, run on a real device outside Expo Go, or submit to TestFlight/App Store. Can upgrade from Individual to Organization later. |

### Core Expo SDK packages

| Package | Purpose |
|---------|---------|
| `expo` (SDK 53) | Core runtime + managed workflow |
| `expo-router` (v4) | File-based routing — mirrors Next.js App Router feel |
| `react-native` | Native bridge |
| `react-native-screens` | Native navigation containers (required by expo-router) |
| `react-native-safe-area-context` | Safe area insets for notches/dynamic islands |

### Authentication

| Package | Purpose |
|---------|---------|
| `expo-secure-store` | Encrypted key-value storage — replaces cookies for Supabase session tokens |
| `expo-web-browser` | Handles OAuth flows (Google login if added later) |
| `expo-linking` | Deep link handling — invite links open the app |
| `react-native-url-polyfill` | URL polyfill required by Supabase JS in React Native |
| `@supabase/supabase-js` | Same client used in web — auth, DB queries, Realtime |

Supabase session storage requires a custom adapter. In the web app, sessions are stored in cookies. In the mobile app, they go in `expo-secure-store`:

```ts
import * as SecureStore from "expo-secure-store";

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

// Pass to createClient as storage option
```

### Push Notifications

The web app uses **web-push (VAPID)** — this does not work on iOS. Mobile push goes through **APNs (Apple Push Notification service)**, accessed via `expo-notifications`.

| Package | Purpose |
|---------|---------|
| `expo-notifications` | Register for APNs, receive push tokens, handle foreground/background notifications |

**Changes needed beyond the mobile app:**

1. **New push token type** — Expo push tokens look like `ExponentPushToken[xxx]`. The existing `push_subscriptions` table stores `{endpoint, p256dh, auth}` (web-push fields). The schema needs a new column or a separate row format for Expo tokens.
2. **API route updates** — `/api/notifications/send` and `/api/chat/notify` currently call `web-push`. They need to also fan out to Expo push tokens using the [Expo Push API](https://docs.expo.dev/push-notifications/sending-notifications/).
3. **APNs key** — After Apple Developer Account is set up, generate an APNs Auth Key (`.p8` file) in the Apple Developer Portal and configure it in EAS.

**Recommended schema change** (to be detailed in a follow-on migration):

```sql
-- Option A: add expo_push_token column alongside web-push fields
ALTER TABLE push_subscriptions ADD COLUMN expo_push_token text;
-- web-push rows: endpoint/p256dh/auth set, expo_push_token null
-- mobile rows: expo_push_token set, endpoint/p256dh/auth null
```

### Real-time (Chat)

`@supabase/supabase-js` includes Realtime support that works in React Native via native WebSocket. No additional packages needed. The existing Realtime subscription code from the web chat components is directly portable.

### UI

shadcn/ui is web-only (DOM-based). The mobile app needs a React Native UI approach. Recommendation: **NativeWind v4** — Tailwind CSS syntax for React Native. Closest to the existing web workflow; allows reusing Tailwind class knowledge.

| Package | Purpose |
|---------|---------|
| `nativewind` (v4) | Tailwind CSS for React Native |
| `tailwindcss` | Peer dependency |
| `expo-image` | Optimized image component (like `next/image`) |
| `expo-image-picker` | Select/capture avatar and team images |
| `@expo/vector-icons` | Icon set (Ionicons, MaterialIcons, etc.) |

### Forms & Validation

Both `react-hook-form` and `zod` work in React Native without changes. These can live in `packages/utils/` or be installed directly in `apps/mobile/` (both approaches work).

### Date & Recurrence

`date-fns` and `rrule` both work in React Native. These move to `packages/utils/`.

### Navigation (expo-router v4 structure)

```
apps/mobile/app/
├── _layout.tsx                  ← Root layout: auth state gate
├── (auth)/
│   ├── _layout.tsx              ← Auth stack navigator
│   ├── login.tsx
│   ├── signup.tsx
│   ├── forgot-password.tsx
│   └── invite/
│       └── [id].tsx             ← Accept invite deep link
└── (app)/
    ├── _layout.tsx              ← Bottom tab navigator (after login)
    ├── index.tsx                ← Dashboard home
    ├── schedule/
    │   ├── index.tsx            ← Schedule list/calendar
    │   └── [eventId].tsx        ← Event detail + RSVP
    ├── availability/
    │   └── index.tsx            ← Availability matrix
    ├── team/
    │   ├── index.tsx            ← Team roster
    │   ├── [memberId].tsx       ← Member profile detail
    │   └── new-member.tsx       ← Add member
    ├── chat/
    │   ├── index.tsx            ← Channel list
    │   └── [channelId].tsx      ← Message thread
    └── settings/
        ├── index.tsx            ← Settings hub
        └── managed-players.tsx  ← Manage child profiles
```

---

## Architecture Decisions

### Auth & Session Storage

| Web | Mobile |
|-----|--------|
| Supabase session in HTTP cookies (via `@supabase/ssr`) | Session stored in `expo-secure-store` |
| Middleware checks session on every request | App-level auth state via `supabase.auth.onAuthStateChange` listener |
| Server Components fetch data with server client | No RSCs — all data fetching in client components or route-level `useEffect` |

### Data Fetching

The web app uses RSCs for initial data fetching. React Native has no server component equivalent. Pattern for mobile:

- **Route-level fetching**: each screen owns its data fetch in a `useEffect` or a custom hook
- **Optimistic updates**: same pattern as web (update local state immediately, then write to Supabase)
- **Shared query logic**: DB query functions can live in `packages/supabase/` as plain async functions, called by both web (server actions) and mobile (client hooks)

### Profile Switching (Managed Profiles)

The web app stores `active_profile_id` in an HTTP cookie set by a server action. Mobile has no cookies. Options:

- **`expo-secure-store`** — store `active_profile_id` in secure storage, read at app launch and on profile switch
- App-level React context exposes the active profile and a `switchProfile(id)` function

### Deep Links

Email links should open the app instead of the browser when the app is installed. This applies to:

- `https://lista.team/invite/[id]` — team invite acceptance
- `https://lista.team/auth/confirm` — email confirmation after signup
- `https://lista.team/auth/callback` — password reset

This requires:

1. **Universal Links** (iOS) — serve an `apple-app-site-association` (AASA) file at `https://lista.team/.well-known/apple-app-site-association` from the Next.js web app, listing `/invite/*` and `/auth/*` paths
2. **Associated Domains** entitlement in `app.json` — `applinks:lista.team`
3. **Expo Linking** config in `app.json`
4. The invite/auth flows run natively inside the app

This is a production-only concern — development uses Expo's dev scheme (`lista://invite/[id]`, `lista://auth/confirm`, etc.).

### Offline Behavior

v1 does not implement offline-first. If the device has no connection, screens show an error state with a retry. This matches web app behavior (no service worker caching).

---

## Setup Checklist (pre-implementation)

### Immediate (can do now — free)

- [ ] **Install Xcode** — Mac App Store; install Command Line Tools via `xcode-select --install`
- [ ] **Install Expo Go on iPhone** — App Store (free) — for real-device testing during development
- [ ] **Create Expo account** — [expo.dev](https://expo.dev) (free)
- [ ] **Install EAS CLI** — `npm install -g eas-cli && eas login`

### When ready for TestFlight / App Store / real APNs push ($99/year)

- [ ] **Enroll Apple Developer Account** — [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/) — Individual enrollment; can upgrade to Organization (shows company name in App Store) later by contacting Apple Developer support with D-U-N-S number
- [ ] **Register App ID / Bundle Identifier** — `com.acg.lista` — in Apple Developer Portal → Identifiers
- [ ] **Generate APNs Auth Key** — Developer Portal → Keys → create key with "Apple Push Notifications service (APNs)" capability; download `.p8` file (cannot re-download; store securely)
- [ ] **Configure APNs in EAS** — `eas credentials` to upload the `.p8` key
- [ ] **Create App Store Connect app record** — [appstoreconnect.apple.com](https://appstoreconnect.apple.com) — needed for TestFlight and eventual release

### Monorepo restructure (code changes)

- [ ] Add `turbo.json` and root `pnpm-workspace.yaml`
- [ ] Move `apps/web/` → current Next.js files
- [ ] Extract `packages/types/` — move `src/types/database.ts`
- [ ] Extract `packages/utils/` — move rrule helpers, date-fns wrappers
- [ ] Create `packages/supabase/` — shared client factory (browser/RN variant)
- [ ] Update web app imports to use workspace packages
- [ ] Verify `pnpm build` and `pnpm test:rls` still pass in web

### Mobile app scaffold

- [ ] `cd apps/mobile && npx create-expo-app . --template blank-typescript`
- [ ] Install expo-router, nativewind, supabase-js, expo-secure-store, expo-notifications
- [ ] Configure Supabase client with SecureStore adapter
- [ ] Wire up expo-router file structure
- [ ] Confirm iOS Simulator launches the app

---

## Open Questions

All pre-implementation questions resolved. See Decision Log above. No blockers remaining before Phase 0.

---

## Implementation Phases

### Phase 0 — Setup & Monorepo (no new features)
Restructure repo, create shared packages, scaffold mobile app, confirm iOS Simulator runs. No user-facing functionality yet. Verify web app is unaffected.

### Phase 1 — Auth + Navigation shell
Login, signup, forgot/reset password screens. Bottom tab navigator with placeholder screens. Supabase session persists across app restarts.

### Phase 2 — Dashboard + Schedule
Dashboard home (upcoming events), schedule list, event detail, RSVP buttons. Read-only first, then add create/edit event flow.

### Phase 3 — Availability + Team
Availability matrix screen. Team roster, member detail. Add member flow.

### Phase 4 — Chat
Channel list, message thread, real-time delivery. New DM and group creation. Push notifications via APNs.

### Phase 5 — Settings + Managed Profiles
Profile edit (with avatar upload), team settings, notification preferences, managed players list/create, profile switcher.

### Phase 6 — Invite deep links + Polish
Universal Links for invite emails opening the app. App icon, splash screen, App Store metadata, TestFlight build.

---

*This document will be updated as decisions are made and implementation progresses.*
