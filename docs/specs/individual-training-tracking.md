# Spec: Individual Training Tracking & Leaderboard

## Overview

A new **Training** section in the web app, available only to club-tier orgs, where players log the individual training they do on their own time (outside team practices) and see how their logged time ranks against their teammates and the wider club, per week and per month.

v1 is deliberately time-tracking only: a session is a date, a duration, a category, and an optional note. Curated content — standard drills, coach-authored sessions, video — is the intended follow-on and the schema is shaped so it can be added without rewriting v1 rows.

**Goal:** give players a reason to train between practices, and give coaches visibility into who is putting in the extra work.

---

## Background

Nothing in the product currently models work a player does alone. `events` + `availability` cover team-scheduled activity only, and the roster views answer "who showed up", not "who is improving". Clubs (the paying customers) consistently sell parents on player development, so this is a club-tier feature by design — it gives Club Small/Large a visible benefit that Free does not have, and it is the first feature aimed squarely at the *player* rather than the parent or coach.

---

## Scope

### In scope (v1)

- `Training` nav item, gated to club-tier orgs
- Leaderboard tab: team view (default) and club-wide view, per week and per month
- Log tab: create/edit/delete own (or managed child's) training sessions
- Coach/director view of any player's sessions on their team
- Per-player opt-out from public ranking

### Explicitly not in scope (v1)

- **Curated drills / coach-authored sessions** — Phase 2, see [Forward Compatibility](#forward-compatibility-curated-sessions)
- **Team events counting toward training totals** — practices and games are *not* individual training and must not be auto-credited. This is a frequent request; the answer is no, because it would make the leaderboard a measure of attendance rather than initiative.
- **Notifications** — no weekly recap push/email in v1 (see [Open Questions](#open-questions); this is the most likely first addition)
- **Mobile (`apps/mobile`)** — web only. The schema, RLS, and RPCs below are the shared contract, so the Expo app can add a Training tab later with no migration.
- Streaks, badges, goals/targets, media uploads

---

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Who can log | `role = 'player'` roster members only | Mirrors the roster-only rule already enforced for availability (`20260616000000_availability_roster_only.sql`). Coaches and parents logging their own gym time would muddy the board. |
| Who logs for a child | The parent, via the existing "viewing as" profile switcher | The session is attributed to the **child** (`profile_id`), with the parent recorded in `created_by`. Same managed-profile plumbing as availability. |
| Leaderboard scope | Team (default) + club-wide toggle | Team is the meaningful peer group; club-wide is the differentiator clubs pay for. Club-wide is filterable by team so a U10 isn't visibly ranked below a U18. |
| Trust model | Honor system + hard caps + coach moderation | Caps and a backdating window are enforced in the DB; coaches can delete a bogus entry. No approval queue — it would put the cost on the person with the least time. |
| Privacy | Included by default, per-player opt-out | Leaderboards die without density. Opt-out is the escape hatch for a family who doesn't want their child publicly ranked. |
| Periods | Mon–Sun weeks, calendar months, bucketed timezone-naive on `session_date` | `session_date` is a bare calendar day, so weeks/months are `date_trunc` with no timezone — no cross-tz misfiling. `teams.timezone` is used only for the trigger's "today" boundary. Weeks reset — that reset is most of the motivation. |
| Gating | `hasClubAccess(plan, subscription_status)` | Reuse `src/lib/plan.ts` verbatim. Never re-derive the gate. |

---

## Data Model

Migration: `supabase/migrations/YYYYMMDDNNNNNN_training_sessions.sql`

### `training_sessions`

```sql
create table training_sessions (
  id uuid primary key default gen_random_uuid(),

  -- The player the session belongs to. For a parent logging on behalf of a
  -- child this is the CHILD's profile, not the parent's.
  profile_id uuid not null references profiles(id) on delete cascade,

  -- The team the session is credited to. Denormalized (it is derivable from
  -- profile_id only when the player is on exactly one team) for three reasons:
  --   1. A player can be on multiple teams; the leaderboard needs to know which
  --      board this session lands on, and the player must choose.
  --   2. RLS can gate directly on is_team_member(team_id) / is_team_admin(team_id).
  --   3. The trigger's team-local "today" boundary needs teams.timezone,
  --      reachable in one join from team_id. (Bucketing itself is timezone-naive
  --      on session_date — see Leaderboard Aggregation — so this join is only
  --      for the insert/update window check, not for aggregation.)
  team_id uuid not null references teams(id) on delete cascade,

  -- The day the training happened, as the player reports it. A `date`, not a
  -- timestamptz: a session belongs to the day the player says it happened and
  -- must never drift across a week boundary because of a UTC conversion.
  session_date date not null,

  -- 5-minute floor filters out junk entries; 300-minute ceiling is well above
  -- any real solo session and blunts the obvious way to game the board.
  duration_minutes integer not null check (duration_minutes between 5 and 300),

  -- text + CHECK, not a Postgres enum: adding a category later is a one-line
  -- migration instead of an ALTER TYPE that can't run in a transaction.
  category text not null check (category in (
    'ball_mastery', 'dribbling', 'passing', 'shooting',
    'fitness', 'strength', 'agility', 'recovery', 'other'
  )),

  notes text check (char_length(notes) <= 500),

  -- Who actually entered the row (parent or the player themselves). Kept
  -- distinct from profile_id so a coach reviewing a suspicious entry can see
  -- whether a parent or the player logged it. NEVER trust the client for this:
  -- the validation trigger overwrites it with the calling profile on every
  -- insert (see below), so a crafted PostgREST request cannot forge it. The
  -- column is only nominally "supplied" — the trigger is the source of truth.
  created_by uuid not null references profiles(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Leaderboard aggregation is always (team | set of teams) × date range.
create index training_sessions_team_date_idx
  on training_sessions (team_id, session_date desc);

-- "My training" list and the per-player coach drill-down.
create index training_sessions_profile_date_idx
  on training_sessions (profile_id, session_date desc);
```

**Roster changes and retention.** There is deliberately **no** foreign key from `training_sessions` to `team_members`, and removing a player from a team does **not** delete their sessions. Removal is a hard delete of the `team_members` row (the access-revoking step in `removeMember`, `app/actions/team.ts`), and this feature follows the same rule that flow already applies to availability — *"delete upcoming responses, preserve historical ones"*: forward-facing access is revoked, history is kept. Sessions are therefore never orphaned to a missing player; they simply stop appearing on peer boards once the owner is no longer a current roster `player` on their `team_id` (enforced at aggregation, not by a constraint — see [Leaderboard Aggregation → Current-roster filter](#leaderboard-aggregation)). The `on delete cascade` on `team_id` fires only when a **team itself is hard-deleted**, which the product does via archiving (`teams.archived_at`), not deletion — so in practice training history is destroyed only on the same irreversible path that destroys every other team-scoped row, which is acceptable.

### `profiles.training_leaderboard_opt_out`

```sql
alter table profiles
  add column training_leaderboard_opt_out boolean not null default false;
```

Profile-level, not per-team: a player who doesn't want to be ranked doesn't want to be ranked on any of their teams. An opted-out player still logs sessions, still sees their own totals, and **is still visible to their own coaches** — opt-out removes them from the *peer-facing* leaderboard only. The settings copy must say this plainly rather than implying coaches are blinded too.

---

## Validation (trigger, not CHECK)

The date window and the daily cap depend on `now()` and on other rows, so they cannot live in a `CHECK` constraint. A `before insert or update` trigger enforces them. This is server-side truth — the client validates the same rules for UX, but the DB is what actually holds.

```sql
-- Is p_id a roster PLAYER on team t_id? Mirrors is_event_team_member() from
-- the availability roster-only migration. security definer so the membership
-- lookup bypasses RLS.
create or replace function is_team_player(t_id uuid, p_id uuid)
returns boolean as $$
  select exists (
    select 1 from team_members tm
    where tm.team_id = t_id
      and tm.profile_id = p_id
      and tm.role = 'player'
  );
$$ language sql security definer stable;
```

The trigger rejects a session when:

1. **`profile_id` is not a `player` on `team_id`** → `is_team_player(team_id, profile_id)` is false. Closes the same hole the availability migration closed: a parent-manager can *see* a team, so without this check they could write a row against it.
2. **`session_date` is in the future.** `session_date` is a bare calendar day, so the comparison is bare-date against the team-local "today": `today := (now() at time zone coalesce(teams.timezone, 'UTC'))::date; if new.session_date > today then reject`. The team timezone is used **only** to pin down which calendar day "today" is (so a player logging at 8pm Pacific isn't rejected because it's already tomorrow in UTC) — it is never applied to `session_date` itself, which carries no time to convert.
3. **`session_date` is more than 7 days in the past** — `new.session_date < today - 7` using the same team-local `today`. Backdating exists so you can log Saturday's session on Sunday, not so you can fill in a month before the board closes. Note the consequence: **the previous week's totals are still mutable for 7 days.** That is accepted — a week's numbers are final once it scrolls out of the window, and the UI does not claim otherwise.
4. **The day's total would exceed 360 minutes** across all of that player's sessions on that `session_date` (all teams). Prevents the "twelve 300-minute sessions" attack that the per-session cap alone allows.

Each failure raises a distinct `errcode`/message so the client can map it to a specific field error.

**Beyond rejection, the trigger also stamps `created_by`.** On insert it overwrites `new.created_by` with the calling profile — the `profiles` row whose `auth_user_id = auth.uid()` — rather than trusting whatever the client sent:

```sql
-- Inside the before-insert branch, before the checks above run:
new.created_by := (select id from profiles where auth_user_id = auth.uid());
if new.created_by is null then
  raise exception 'no calling profile' using errcode = '...';
end if;
```

This makes `created_by` unforgeable: it is definitionally "who entered this row", which is always the authenticated caller, so there is never a legitimate reason to accept a client-supplied value. Without this, a crafted PostgREST insert could set `created_by` to the child's own profile (hiding that a parent logged it) or to another coach — defeating the audit purpose the column exists for. `created_by` is left out of the assignment on `update` so it preserves the original author when a row is later edited by someone else (e.g. a coach correcting an entry).

---

## Access Control (RLS)

`alter table training_sessions enable row level security;`

| Operation | Policy |
|---|---|
| `select` | `profile_id = auth.uid()` **or** `is_managed_by_me(profile_id)` **or** `is_team_admin(team_id)` |
| `insert` | `(profile_id = auth.uid() or is_managed_by_me(profile_id))` and `is_team_player(team_id, profile_id)` and `has_club_access(team_org_id(team_id))` |
| `update` | Same as insert, plus the row must still be inside the 7-day window (trigger) |
| `delete` | `profile_id = auth.uid()` or `is_managed_by_me(profile_id)` or `is_team_admin(team_id)` |

**Players cannot read each other's raw session rows.** The `select` policy grants self, managed children, and team admins (coach/manager/director — `is_team_admin` already covers directors org-wide). Teammate-visible numbers come exclusively from the aggregation RPC below, which returns totals and never notes. A note like "skipped, knee still hurts" should not be readable by twenty teammates.

`delete` for team admins is the moderation lever: a coach who sees "480 minutes of shooting on a school day" removes it. There is no flag/approve workflow.

### Club-tier gate in the database

The nav item and the route guard are UI. The RPC and the insert policy must hold the line independently, or a canceled org keeps working via PostgREST.

```sql
-- SQL mirror of hasClubAccess() in src/lib/plan.ts. Both must change together;
-- a test asserts they agree on all (plan, subscription_status) pairs.
create or replace function has_club_access(o_id uuid)
returns boolean as $$
  select exists (
    select 1 from organizations o
    where o.id = o_id
      and o.plan in ('club_small', 'club_large')
      and o.subscription_status in ('trialing', 'active', 'past_due')
  );
$$ language sql security definer stable;
```

---

## Leaderboard Aggregation

The club-wide board is the reason this needs an RPC rather than a PostgREST query. A U10 parent is not a member of the U18 team, so `is_team_member` correctly denies them those rows — but they *are* entitled to see the U18 players' **totals** on the club board. That is a legitimate privilege escalation, so it goes through one `security definer` function with an explicit caller check, not through loosened RLS.

```sql
create or replace function training_leaderboard(
  p_scope text,          -- 'team' | 'club'
  p_team_id uuid,        -- required for 'team'; optional team filter for 'club'
  p_org_id uuid,         -- required for 'club'
  p_period text,         -- 'week' | 'month'
  p_anchor date          -- any date inside the target period
)
returns table (
  profile_id uuid,       -- one row PER PLAYER, never per (player, team)
  display_name text,     -- masked per scope; see below
  avatar_url text,
  team_id uuid,          -- see "Grouping" below: null on the unfiltered club board
  team_name text,        --   populated only for 'team' scope or a team-filtered club query
  total_minutes integer, -- sum of ALL the player's sessions in the scope+period
  session_count integer,
  rank integer
)
```

**Grouping — one row per player.** Both scopes group by `profile_id`, never by `(profile_id, team_id)`. Because each session is credited to exactly one team (the "pick one team per session" rule), summing a player's sessions across their teams counts every session exactly once — there is no double-count to avoid, and a multi-team player appears **once** with their true total rather than split across two rows and two rank slots. Consequently:

- **`'team'` scope** sums only sessions whose `team_id = p_team_id`; `team_id`/`team_name` are that team.
- **`'club'` scope, no team filter** (`p_team_id` null) sums every session the player logged on any non-archived team in `p_org_id`; `team_id`/`team_name` are **null** (the club list rows don't display a team, so there is nothing to resolve — and a player may span teams, so no single team is correct).
- **`'club'` scope, team-filtered** (`p_team_id` given) sums only that team's sessions; `team_id`/`team_name` are that team. This differs from `'team'` scope only in the caller check and name masking below — a U10 parent may filter the club board to U18 without being a U18 member.

Behavior:

- **Caller check first.** For `'team'`: `is_team_member(p_team_id)`. For `'club'`: the caller (or a profile they manage) is on some non-archived team in `p_org_id`, or `is_org_admin(p_org_id)`. Plus `has_club_access(p_org_id)` in both cases. Otherwise `raise exception` — not an empty result, so a probing client gets a clear denial rather than an ambiguous zero.
- **Current-roster filter.** A session contributes to a board **only if its owner is currently a roster `player` on the team it was credited to** — the aggregation inner-joins `team_members` on `(session.team_id, profile_id, role = 'player')`, it does not sum raw `training_sessions` by `team_id`. This is what keeps a player who left in April off the July board, without deleting their rows. `is_team_player(session.team_id, profile_id)` is exactly this predicate. Note the two consequences: (a) a session whose owner has since left its team is invisible on every board but still readable by that player in *My Training* (raw self-`select`), and (b) a mid-period **transfer A→B** moves the player's A-credited sessions off A's board when their A membership ends — those minutes live only in their own history from then on. Club scope additionally restricts to **non-archived** teams (consistent with the caller check); an archived team's sessions drop off the club board while remaining visible to a director on that team's own board.
- **Period bounds** are computed from `p_anchor` with **no timezone conversion** — `date_trunc('week', p_anchor)` (Postgres weeks start Monday, which is what we want) or `date_trunc('month', p_anchor)` — because `session_date` is already a timezone-naive calendar day (see [Data Model](#training_sessions)). A session dated `2026-07-11` falls in the same Mon–Sun week no matter which team's timezone is involved, so a club-scoped board spanning teams in different timezones has **no cross-timezone ambiguity to resolve**: every row is bucketed by its bare `session_date` against the same anchor. (The only timezone-sensitive rule in the whole feature is the trigger's "today" boundary, above; aggregation never touches a timezone.)
- **Excludes opted-out players** (`profiles.training_leaderboard_opt_out = true`) from the returned rows entirely.
- **Excludes players with zero minutes** in the period — the board shows who trained, not a roster with a column of zeros. Total roster size is returned separately by the page for the "you're 12th of 18" line.
- **Name masking:** `'team'` scope returns full name (teammates already know each other from the roster). `'club'` scope returns `first name + last initial` ("Marcus H."), since it exposes children to adults on other teams.
- **Ranking** is standard competition rank (1, 2, 2, 4) on `total_minutes desc`, tie-broken by `session_count desc`, then `min(session_date)` ascending (whoever got there first), then name.

A second RPC, `training_summary`, returns just the current user's own totals, rank, and denominator — so the header ("You: 145 min · 4 sessions · #3 of 18") does not require pulling the whole board. Its scope parameters **mirror `training_leaderboard` exactly**, because the header sits above the board and must report a rank in the *same* scope the board is showing:

```sql
create or replace function training_summary(
  p_profile_id uuid,
  p_scope text,          -- 'team' | 'club' — matches the board's scope toggle
  p_team_id uuid,        -- required for 'team'; optional team filter for 'club'
  p_org_id uuid,         -- required for 'club'
  p_period text,         -- 'week' | 'month'
  p_anchor date
)
returns table (
  total_minutes integer,
  session_count integer,
  rank integer,          -- the caller's rank within the SAME scope as the board
  denominator integer    -- roster size in scope: team roster, or club player count
)
```

- **Same grouping, caller check, period bounds, and opt-out semantics as `training_leaderboard`** — the summary is that function's ranking restricted to one profile. In particular, an **opted-out** caller still gets their own `rank` here even though they are absent from the board rows others see (spec: "Opted-out user sees their own numbers in the header").
- **`'club'` scope** ranks the caller among all distinct club players for the period (per the one-row-per-player rule above); `p_team_id` optionally narrows it to a single team, matching the club board's team filter. Without this, the club board's header could only ever report a team rank while the list beneath it ranks the whole club — a scope the two views must not disagree on.
- **`denominator`** is the roster size in scope (the "of 18"): the team roster for `'team'`, the count of club players for `'club'` — returned so the page needn't compute it separately.

---

## UX

### Navigation

A `Training` item (dumbbell icon) in `DashboardNav`, between **Availability** and **Team**. Rendered only when the active team's org passes `hasClubAccess`. `src/app/dashboard/layout.tsx` already fetches the active org's `plan` for subdomain routing — extend that select to include `subscription_status` and pass a `hasTrainingAccess` boolean into the nav. No extra query.

Route: `/dashboard/training`, a RSC that resolves the active profile/team (same preamble as the other dashboard pages) and redirects to `/dashboard/settings?tab=plan` if the org lacks club access — mirroring `src/app/dashboard/club/layout.tsx`.

### Tabs

**Leaderboard** (default)

- Scope switch: `My Team` / `Club`. Club view gets a team filter dropdown (All teams / specific team).
- Period switch: `Week` / `Month`, with `‹ ›` arrows to step back and forth. Landing state is the current week.
- Ranked list: rank, avatar, name, total minutes (primary), session count (secondary). The current user's row is highlighted and pinned into view if they're below the fold.
- A player who is on the roster but hasn't logged anything sees an empty-state CTA — "You haven't logged training this week. Log a session →" — rather than seeing themselves at rank 18 with 0 minutes, which is a reason to close the tab.
- Opted-out user sees their own numbers in the header and a small "You're hidden from this leaderboard — change in Settings" note.

**My Training** (for players and parents-of-players)

- "Log session" button → dialog: date (defaults today, min = 7 days ago, max = today — where "today" is the **team-local** day, matching the trigger boundary so the client and DB agree on the edge), duration (minutes; quick-pick chips 15/30/45/60 plus a free input), category, optional notes. Team selector appears **only** if the active player is on more than one team.
- Chronological list of the active profile's sessions with edit/delete (edit and delete allowed inside the 7-day window; delete-only after, so history can be corrected but not rewritten).
- Month-to-date and week-to-date totals at the top.

**Team** (coaches, managers, directors only)

- Every player on the roster for the selected period, **including opted-out players and players with zero minutes** — a coach's job is precisely to notice the zeros.
- Row click → that player's session detail (dates, durations, categories, notes), which is the moderation surface: a coach can delete an entry from here.

### Settings

Settings → Account gets **"Show me on training leaderboards"** (default on). Toggling it for a managed child is available from the parent's account when the child profile is active. Copy states explicitly: *"Your coaches can always see your training log. This only controls whether you appear on leaderboards other players can see."*

---

## Forward Compatibility (Curated Sessions)

Phase 2 adds coach-authored and standard drills. v1 rows must survive that without a backfill. The planned shape:

```sql
-- Phase 2, not built now:
create table training_drills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,  -- null = Lista standard drill
  name text not null,
  description text,
  category text not null,
  suggested_minutes integer,
  video_url text,
  created_by uuid references profiles(id),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

alter table training_sessions
  add column drill_id uuid references training_drills(id) on delete set null;
```

`drill_id` is nullable and additive, so every v1 row remains valid as a "freeform" session. `category` stays on `training_sessions` rather than being read through the drill, so a session's category is stable even if the drill is later edited or deleted. **Do not** make `category` a FK to a drill table in v1 — that's the change that would force a backfill.

---

## Rollout

1. Migration (table, opt-out column, `is_team_player`, `has_club_access`, validation trigger, RLS, both RPCs) — validated against staging by `.github/workflows/migrate.yml` on the PR, then production on merge.
2. Regenerate `src/types/database.ts`.
3. UI behind the existing club gate. No feature flag: the club gate *is* the flag, and the blast radius is a new route that no free org can reach.
4. Seed nothing. An empty leaderboard on day one is correct; the first player to log a session is rank 1, which is a fine story to tell in the launch email.

**On downgrade:** `training_sessions` rows are retained, the nav item disappears, the route redirects to the plan tab, and both the insert policy and the RPC deny via `has_club_access`. A club that re-upgrades gets its history back intact. Deleting a paying customer's training history on a lapsed card would be indefensible.

---

## Test Plan

Test-driven per `CLAUDE.md` — these are written before implementation.

### 1. RLS — `tests/rls/training-sessions.test.ts` (new)

- Player inserts a session for themselves on their own team → **allowed**
- Parent inserts a session for their managed child → **allowed**, `created_by` = parent, `profile_id` = child
- Parent inserts for their child but **sends a forged `created_by`** (the child's id, or another coach's id) → **allowed**, but the stored `created_by` is the **parent** — the trigger overwrites the client value
- Parent inserts a session for **themselves** (parent is not a `player`) → **denied** (the availability bug class)
- Coach inserts a session for a player who isn't theirs → **denied**
- Player inserts against a team they're not on → **denied**
- Player on a **free-tier** org inserts → **denied** by `has_club_access`
- Player on a **canceled** club org inserts → **denied**; `past_due` and `trialing` → **allowed**
- Player selects a teammate's raw session row → **denied**
- Coach selects any of their team's players' rows → **allowed**; a coach of another team in the same org → **denied**; a **director** → **allowed** org-wide
- Player deletes own session → allowed; deletes a teammate's → denied; coach deletes a player's → allowed
- Player updates a session to `duration_minutes = 999` → denied by CHECK

### 2. Validation trigger — `tests/rls/training-sessions.test.ts`

- `session_date` = tomorrow (team tz) → rejected
- `session_date` = 8 days ago → rejected; 7 days ago → accepted
- Sessions summing to 361 minutes on one day → last insert rejected; 360 → accepted
- Daily cap counts across **two different teams** for the same player → rejected

### 3. Leaderboard RPC — `tests/rls/training-leaderboard.test.ts` (new)

- Team scope returns only that team's players, ranked correctly
- Ties: equal minutes → equal rank, next rank skips (1, 2, 2, 4)
- Opted-out player is absent from both team and club scope, but their minutes still appear in their own `training_summary`
- Zero-minute players are absent
- Club scope: a U10 parent gets U18 players' **totals** (which they cannot read via a direct table select — assert both in the same test, since that contrast is the whole point of the RPC)
- **Multi-team player, club scope:** a player credited on two teams (90 min on each) appears in the unfiltered club board as **one row** with `total_minutes = 180`, `session_count = 2`, and **null** `team_id`/`team_name` — not two rows of 90
- **Club scope team filter:** the same player, with the club board filtered to one of their teams, appears with `total_minutes = 90` and that `team_id`/`team_name` populated
- **`'team'` scope for a multi-team player** returns only that team's minutes (90), not the cross-team sum — the per-team split still holds inside a single team board
- **Player who left the team:** a player with sessions on team T, whose `team_members` row for T is then deleted, is **absent** from T's board (team scope) and from the club board — but the rows still exist and are returned by a raw self-`select` (My Training history is intact)
- **Mid-period transfer A→B:** after the A membership is deleted and a B membership added, the player's A-credited sessions are absent from A's board, their B-credited sessions appear on B's board, and both remain in their own history
- **Archived team:** sessions on an archived team drop off the **club** board, but a director querying that team directly (team scope) still sees them
- Club scope masks names to first name + last initial; team scope does not
- Non-member of the org calling club scope → exception
- Free-tier org → exception
- Week boundary: a **Sunday-dated** session and a session dated the **following Monday** land in **different** weeks; a session dated that Monday and one dated the Sunday six days later (same Mon–Sun span) land in the **same** week
- Bucketing is timezone-independent: two teams with different `teams.timezone` values (or one team with `timezone = null`) produce the **same** week/month bucket for the same `session_date` — no session is misfiled by a timezone difference
- **`training_summary` scope tracks the board:** for a multi-team player, `training_summary` in `'team'` scope returns their team rank/denominator, and in `'club'` scope returns their club-wide rank over distinct players and the club-player denominator — the two disagree, and each matches the corresponding `training_leaderboard` scope
- **`training_summary` for an opted-out caller** still returns a non-null `rank` in both scopes even though that caller is absent from `training_leaderboard` rows

### 4. Unit — `tests/unit/training.test.ts` (new)

- `has_club_access` (SQL) and `hasClubAccess` (TS) agree across every `(plan, subscription_status)` pair — the drift guard
- Period label formatting ("Jul 7 – Jul 13", "July 2026") and anchor stepping across a month/year boundary

### 5. E2E — `tests/e2e/training.spec.ts` (new)

- Club player: log a session → appears in My Training → appears on the leaderboard
- Free-tier user: no Training nav item; direct navigation to `/dashboard/training` redirects to the plan tab
- Parent with two children: switch active profile, log for each, verify attribution

---

## Open Questions

1. **Weekly recap notification.** Deferred from v1, but a leaderboard with no Monday nudge tends to decay after two weeks. The cheapest version — a Monday cron alongside `/api/cron/reminders`, plus `training_digest_enabled` on `notification_preferences` (same pattern as `chat_digest_enabled`) — is likely worth doing before launch rather than after. Flagging for a call.
2. **Category list.** The nine above are soccer-shaped. If Lista is going to sell into other sports this year, the list should either be generic (technical / physical / recovery / other) or become org-configurable. Cheap to change now, annoying once there is data.
3. **Multi-team players.** ~~Open.~~ **Resolved.** Two sub-questions, both settled: (a) *crediting* — a session is credited to exactly one team, chosen by the player, never auto-credited to every team (that would inflate club totals). (b) *club-board aggregation* — the club board ranks **distinct players**, summing each player's sessions across all their teams (see [Leaderboard Aggregation → Grouping](#leaderboard-aggregation)); because each session is credited to one team, the sum counts every session once, so a multi-team player appears once with their true total rather than split across rows. The only residual gaming vector — manually entering the *same* session under two teams — is a moderation matter (coach delete), bounded by the 360-min daily cap, not an aggregation-design one. Still worth confirming in usability testing that a player on both a club team and an academy team finds the per-session team picker obvious.
4. **Duration vs. quality.** Ranking purely on minutes rewards the kid who juggles for two hours over the kid who does a focused 30-minute finishing session. Nothing in v1 fixes that; curated drills with an expected duration are the real answer, which is an argument for pulling Phase 2 forward.
5. **Should coaches log team-designated homework?** Not "a curated drill library", just "coach assigns 20 min of ball mastery before Thursday". It's a smaller feature than the drill library and probably the higher-value half of it.
