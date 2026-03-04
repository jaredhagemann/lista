# Lista Roadmap & Process Notes

A living document for tracking feature ideas, process improvements, and architectural decisions. Update this as new ideas come up.

---

## Next Features to Build

Roughly prioritized — revisit ordering as the product evolves.

### 1. Managed Profiles
Parents managing player profiles on their behalf. Already spec'd in `docs/specs/managed-profiles.md`. Critical for youth sports adoption — unlocks the parent/player demographic and solves a real pain point in the existing role structure.

### 2. Team Chat / Messaging
Biggest engagement gap in the current app. Members have no reason to open the app between events. A simple per-team channel (pinned in the sidebar) would drive daily active usage. Supabase Realtime makes this achievable without a separate backend service.

### 3. Stats & Season Records
The schema already has `game_result`, `score_for`, `score_against` on events — the data exists but there's no UI for it. A season record view (W-L, goals for/against) and per-player stats dashboard would add significant value for coaches, mostly as a read layer on existing data.

### 4. Attendance Tracking
"Availability" is a pre-event RSVP — there's no record of who actually showed up. Coaches need this for rostering decisions and parent communication. Likely a lightweight addition: a second status on `availability` or a separate `attendance` table.

### 5. Media / Document Sharing
Supabase Storage is already configured with RLS policies (`tests/rls/storage.test.ts`). A shared team library for playbooks, game film links, and event photos would round out the feature set without much infrastructure work.

---

## Process Improvements

### Critical
- ~~**Pre-commit hooks**~~ ✓ — husky + lint-staged enforcing ESLint and `tsc --noEmit` on every commit.
- **Database migration strategy + Staging environment** — Workflow written (`.github/workflows/migrate.yml`), pending manual setup. See `docs/specs/migration-strategy.md` for the checklist. Remaining: create staging Supabase project, add 5 GitHub secrets, configure Vercel Preview env vars to point at staging.

### High Priority
- **Error monitoring** — No Sentry or equivalent. Silent failures in the cron job and notification fan-out could go unnoticed. Add error monitoring before user growth makes debugging harder.
- **E2E tests** — No Playwright/Cypress coverage for critical flows (signup → join team → RSVP). At minimum, smoke tests on auth, event creation, and availability submission.

### Medium Priority
- **Rate limiting** — `/api/auth/signup`, `/api/invitations/send`, and notification routes have no rate limiting. Add edge middleware (Upstash Redis or Vercel's built-in) to protect these endpoints.

---

## Mobile App Strategy

**Decision: Monorepo (Turborepo) with React Native / Expo**

`@supabase/supabase-js` works identically in React Native, meaning the existing auth patterns, RLS policies, and database types are immediately portable. Proposed structure:

```
lista/ (Turborepo root)
├── apps/
│   ├── web/        ← current Next.js app (moved here)
│   └── mobile/     ← new React Native / Expo app
├── packages/
│   ├── supabase/   ← shared Supabase client + config
│   ├── types/      ← shared database.ts types
│   └── utils/      ← shared rrule, date helpers, etc.
└── turbo.json
```

Shared packages eliminate duplicated type changes across repos. If native Swift/Kotlin is chosen instead of React Native, revisit this — the shared-code argument disappears when languages diverge.
