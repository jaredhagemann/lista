# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # Start Next.js dev server (http://localhost:3000)
pnpm build            # Production build
pnpm lint             # ESLint
cd apps/web && pnpm test             # Run all Vitest tests
pnpm test:rls         # Run only Supabase RLS integration tests (root)
cd apps/web && npx vitest run tests/rls/teams.test.ts  # Run a single test file
```

RLS tests run against the live Supabase instance and require `.env.local` with valid credentials. They create/clean up test users via the service role key and include retry logic for auth rate limits.

## Architecture

Next.js 16 App Router + Supabase (PostgreSQL with RLS) + Tailwind CSS 4 + shadcn/ui. No separate backend services — the frontend talks directly to Supabase via PostgREST, with RLS policies as the authorization layer.

### Supabase Client Pattern

Three client variants, all typed with `Database` from `src/types/database.ts`:

- **Browser** (`src/lib/supabase/client.ts`) — `createBrowserClient` for `"use client"` components
- **Server** (`src/lib/supabase/server.ts`) — `createServerClient` with cookie access for RSCs and Server Actions
- **Middleware** (`src/lib/supabase/middleware.ts`) — refreshes sessions on every request, handles auth redirects

API routes that need to bypass RLS (e.g., cron jobs) create a service role client inline with `SUPABASE_SERVICE_ROLE_KEY`.

### Auth & Routing

Middleware (`src/middleware.ts` → `src/lib/supabase/middleware.ts`) protects all routes except: `/`, `/login`, `/signup`, `/invite/*`, `/auth/callback`. Authenticated users on `/login` or `/signup` are redirected to `/dashboard`. The database auto-creates a `profiles` row on signup via a Postgres trigger.

### Data Flow

- **Dashboard pages** (RSCs in `src/app/dashboard/`) fetch data server-side via the server Supabase client
- **Client components** (`src/components/`) perform mutations directly against Supabase (inserts, updates, deletes)
- **RLS policies** enforce all authorization — helper functions `is_team_member(team_id)` and `is_team_admin(team_id)` are used across policies
- **Insert pattern**: generate UUIDs client-side with `crypto.randomUUID()` to avoid needing `.select()` after insert (which can conflict with SELECT RLS policies)

### Notification System

Two API routes handle notifications beyond basic CRUD:

- **`/api/notifications/send`** — called by the frontend after event create/update/cancel; fans out emails (Resend) and push notifications (web-push) to team members based on their preferences
- **`/api/cron/reminders`** — Vercel cron (daily at 12:00 UTC, configured in `vercel.json`); uses service role to query upcoming events and notify members

### Database Schema

Defined in `supabase/migrations/`, types generated in `src/types/database.ts`. Key tables: `organizations` → `teams` → `team_members` (with roles: coach, manager, parent, player), `events`, `availability`, `invitations`, `profiles`, `push_subscriptions`, `notification_preferences`.

### Testing

`tests/rls/` contains integration tests for every table's RLS policies. Tests use a helper (`tests/rls/helpers.ts`) that creates real Supabase users via `auth.admin.createUser()`, signs them in, and verifies policy enforcement. Each test file has an `afterAll` cleanup.

All new feature development must be test-driven: write tests before implementation, and ensure they pass before considering a feature complete. If a feature request does not include enough detail to write meaningful tests (expected behavior, edge cases, access control rules, etc.), ask for clarification before proceeding with implementation.

## Git Workflow

- **All development must happen on feature branches** — never commit directly to `main`.
- Branch naming: `feature/<short-description>` (e.g. `feature/ios-app`, `feature/org-support`).
- Changes reach `main` exclusively via pull request. Open a PR, get it reviewed/approved, then merge.
- When a task is complete: commit changes on the feature branch, push, and open a PR to `main`.

## Database Migrations

**Never run `supabase db push` manually against the production (or staging) database.**

All schema changes go through the same PR flow as code:

1. Create a migration file in `supabase/migrations/` named `YYYYMMDDNNNNNN_description.sql`.
2. Commit it on a feature branch alongside any app code that depends on it.
3. Open a PR to `main`. GitHub Actions (`.github/workflows/migrate.yml`) automatically runs the migration against the **staging** DB to validate it applies cleanly.
4. Merge the PR. GitHub Actions then runs the migration against **production** in parallel with the Vercel deploy (migrations typically finish before the build completes).

The required GitHub Actions secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_STAGING_PROJECT_REF`, `SUPABASE_STAGING_DB_PASSWORD`) are already configured in the repo.

**Hotfix exception:** If a migration must be applied to production before a PR can be merged (e.g., a live outage), apply the raw SQL directly via the Supabase dashboard SQL editor as a temporary patch, then immediately commit the migration file to a PR so the permanent record is captured. Do not use `supabase db push` from the command line.

## Environment Variables

Copy `env.example` to `.env.local`. Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Optional for full functionality: `RESEND_API_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`.
