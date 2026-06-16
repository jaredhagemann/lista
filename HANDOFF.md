# Handoff — Fix: managed-player availability misattribution

Branch: `feature/fix-managed-availability-rsvp` (off `main`)

> Temporary handoff doc. Delete before merging the PR.

## The bug (confirmed in production)

A parent marked their child's availability as "available", but:
- **iOS** event view showed the **parent's** name as available.
- **Web** Availability tab showed the **player** as "No Response".

### Root cause (verified against prod data)

The availability row was written with `profile_id = parent's profile` instead of
the child's. Specifically for event **"England v USA"**:

| field | value |
|---|---|
| event_id | `187896d1-d25d-4baa-8764-ebb3eab4386a` |
| team_id | `e6c7cad2-07e5-40f8-844c-b9a32a0f224c` |
| parent (Ali Stevens) profile_id | `750d82e2-b738-4505-9463-4b1c93d74c16` |
| child (Iris Stevens) profile_id | `1312d99c-1875-4eaf-8654-2f47734b5f6a` |

- The "available" row points to **Ali** (auth_user_id == id, **not** a roster member of the team).
- **Iris has no availability row** → web shows "No Response".
- iOS renders raw `availability` rows joined to `profiles`, so it shows whoever the
  row points to (Ali) even though she isn't on the roster. Web maps availability onto
  `team_members` only, so a non-member row is silently dropped.

### Why the wrong profile_id was written

On web, `getActiveMembership()` falls back to the managed child's membership (so a
parent-only manager can reach the team's events), but `getActiveProfileId()` returns
`active_profile_id` cookie `?? userId` = the **parent's own id** when the parent never
explicitly switched profiles. That id flowed into `<RsvpButtons profileId={currentUserId}>`,
so the upsert wrote a row for the parent, which RLS happily allowed
(`profile_id = auth.uid()`). The `?? user.id` fallback is duplicated across ~8 server files.

(Mobile `AppContext` auto-selects the managed child for parent-only managers, so it's
likely insulated — but the RLS fix below covers it regardless.)

---

## What's been implemented on this branch (#3 — code fix)

All changes are committed on the branch. **Not yet verified** — local Supabase
stack failed to start on the original machine (Docker socket mount error with
Rancher Desktop: `/Users/.../.rd/docker.sock ... operation not supported`).

### 1. App layer — `currentUserId` now derived from the resolved membership
So the RSVP profile is always the one whose membership grants event access (the
active player), never a parent-only manager reaching the event via their child.

- `apps/web/src/app/dashboard/schedule/[eventId]/page.tsx`
  — dropped the separate `getActiveProfileId()` call; `activeProfileId = activeMembership.profile_id ?? user.id`.
- `apps/web/src/app/dashboard/availability/page.tsx`
  — same change: `activeProfileId = membership.profile_id ?? user.id`.

### 2. RLS layer — defense in depth (catches web AND mobile)
New migration `supabase/migrations/20260616000000_availability_roster_only.sql`:
- Adds `is_event_team_member(e_id uuid, p_id uuid)` (security definer, stable).
- Tightens the self/managed **insert** and **update** policies to additionally
  require `is_event_team_member(event_id, profile_id)` — i.e. availability can only
  be written for a profile that is a roster member of the event's team.

### 3. Tests (written first)
`tests/rls/availability.test.ts` — two new cases under "Roster-membership guard":
- parent-only manager **cannot** insert own availability for a team they don't belong to (expect error).
- parent **can** insert their managed child's availability (child is a roster member; expect success).

---

## TODO to finish on the other machine

1. **Run the RLS suite** (live local Supabase required):
   ```bash
   # ensure Docker + local Supabase are up
   supabase start
   pnpm test:rls
   # or just the one file:
   cd apps/web && npx vitest run ../../tests/rls/availability.test.ts   # path may differ; tests live in repo-root tests/rls
   ```
   The two new tests should FAIL on `main` and PASS with the migration applied.
   (`pnpm test:rls` resets the DB so the new migration is applied.)
   - Env note from project memory: all `.env*.local` JWT keys must be ES256-signed;
     after any `supabase stop --no-backup` + `start`, copy the ES256 keys from
     `apps/web/.env.test.local` into `apps/web/.env.local` and `apps/mobile/.env.local`.

2. **Lint / build**:
   ```bash
   pnpm lint
   pnpm build
   ```
   (Sanity check the two edited RSCs compile and there are no unused-import errors
   from removing `getActiveProfileId`.)

3. **Open the PR** to `main` once green. GitHub Actions runs the migration against
   staging on PR, then production on merge. Remove this `HANDOFF.md` in the PR.

---

## Follow-ups deferred (do AFTER the code fix merges — agreed with user)

### #1 — Production data correction (re-point Ali's row to Iris)
No unique-constraint conflict since Iris has no row:
```sql
update availability
set profile_id = '1312d99c-1875-4eaf-8654-2f47734b5f6a'   -- Iris
where event_id = '187896d1-d25d-4baa-8764-ebb3eab4386a'
  and profile_id = '750d82e2-b738-4505-9463-4b1c93d74c16'; -- Ali
```

### #2 — Self-management row cleanup
Query surfaced a `manager_id == managed_id` row (Ali manages Ali). Code already
defends against it (`.neq("managed_id", userId)`), but it should be removed.
Check how widespread first:
```sql
select count(*) from profile_managers where manager_id = managed_id;
-- delete from profile_managers where manager_id = managed_id;
```

### Out of scope (noted, not done)
- The admin availability policy (`Admins manage team availability`) still lets an
  admin write availability for a non-roster profile_id. Not exploited by this bug
  (the parent isn't an admin); left untouched to keep the change focused. Consider
  adding the same `is_event_team_member` guard later for a complete invariant.
- Possibly hide non-roster rows in the iOS event view as well (display hardening).
