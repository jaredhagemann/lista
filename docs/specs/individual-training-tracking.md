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
  -- The same nine values are mirrored by a TRAINING_CATEGORIES const in
  -- src/lib/training.ts (the client's category picker + validation read from
  -- it). Like has_club_access/hasClubAccess, the two lists can drift; a unit
  -- test asserts they agree (see Test Plan §4).
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

-- Resolve a team's timezone SAFELY. `teams.timezone` is nullable free text with
-- no CHECK, so besides null it can hold a non-IANA string ('', 'PST',
-- 'Pacific Time'). A bare `now() at time zone teams.timezone` on such a value
-- raises 'invalid value for parameter "TimeZone"', which would fail EVERY
-- training insert for that team. coalesce() guards only null, not invalid — so
-- probe the value and fall back to 'UTC' if Postgres won't accept it.
-- security definer so it reliably reads teams.timezone from any write path
-- regardless of the caller's RLS visibility of the team (search_path/qualify
-- hardening per "Security-definer hygiene").
create or replace function safe_team_tz(t_id uuid)
returns text language plpgsql stable security definer as $$
declare tz text;
begin
  select timezone into tz from teams where id = t_id;
  if tz is null then return 'UTC'; end if;
  perform now() at time zone tz;   -- raises if tz is not a valid zone
  return tz;
exception when others then
  return 'UTC';
end;
$$;

-- Is the team archived? Kept SEPARATE from is_team_player on purpose: archived
-- semantics are context-dependent (writes are blocked, but team-scope
-- aggregation still surfaces an archived team's board to its director), so the
-- archived test must not be folded into the "is this a roster player" predicate.
create or replace function is_team_archived(t_id uuid)
returns boolean as $$
  select archived_at is not null from teams where id = t_id;
$$ language sql security definer stable;
```

The trigger rejects a session when:

1. **`profile_id` is not a `player` on `team_id`** → `is_team_player(team_id, profile_id)` is false. Closes the same hole the availability migration closed: a parent-manager can *see* a team, so without this check they could write a row against it.
2. **`team_id` is archived** → `is_team_archived(team_id)` is true. A player's roster row survives their team being archived (`teams.archived_at`), and `is_team_player` only checks the role — so without this, insert/update could still write *new* training to a dead team, and those sessions would never surface (club aggregation already excludes archived teams). Blocking it here on **both insert and update** means an archived team stops accepting new logs and stops allowing edits to old ones, while existing rows stay readable and deletable (moderation/cleanup) — the same "history preserved, forward writes revoked" stance as leaving a team.
3. **`session_date` is in the future.** `session_date` is a bare calendar day, so the comparison is bare-date against the team-local "today": `today := (now() at time zone safe_team_tz(team_id))::date; if new.session_date > today then reject`. The team timezone is used **only** to pin down which calendar day "today" is (so a player logging at 8pm Pacific isn't rejected because it's already tomorrow in UTC) — it is never applied to `session_date` itself, which carries no time to convert. `safe_team_tz` (above) guarantees a valid zone, so a misconfigured `teams.timezone` degrades to UTC instead of erroring the insert.
4. **`session_date` is more than 7 days in the past** — `new.session_date < today - 7` using the same team-local `today`. Backdating exists so you can log Saturday's session on Sunday, not so you can fill in a month before the board closes. Note the consequence: **a week's totals are still mutable by the player for 7 days**, then go final. "Final" is enforced on *all* player mutations, not just inserts/edits: the RLS `delete` policy applies the same 7-day bound to self/managed deletes (see Access Control), so once a week scrolls out of the window a player can neither add, edit, nor remove a session in it. Team admins can still delete for moderation — the one intentional exception.
5. **The day's total would exceed 360 minutes** across all of that player's sessions on that `session_date` (all teams). Compute it as *the sum of the player's **other** sessions on that date plus the incoming row* — `select coalesce(sum(duration_minutes), 0) from training_sessions where profile_id = new.profile_id and session_date = new.session_date and id <> new.id` (a `plpgsql declare`d total), then reject when `total + new.duration_minutes > 360`. The `id <> new.id` exclusion is **essential on update**: a `before update` trigger still sees the row's *old* value in the table, so summing unconditionally would count the edited row twice and reject a legitimate edit (e.g. trimming a lone 300-min session to 200 would evaluate as 300 + 200 = 500). On insert the row isn't in the table yet, so the exclusion is a harmless no-op — the same expression serves both. Prevents the "twelve 300-minute sessions" attack that the per-session cap alone allows. To make this a genuinely **hard** cap and not just a per-statement one, the trigger takes a transaction-scoped advisory lock keyed on the player-day **before** it sums — `perform pg_advisory_xact_lock(hashtext(new.profile_id::text || new.session_date::text))` — so two concurrent inserts for the same player and date serialize instead of both reading `sum < 360` and both committing. The lock is on a tiny keyspace (one player-day) and released at transaction end, so it costs nothing in the common case where a player isn't racing parallel writes against themselves.

Each failure raises a distinct `errcode`/message so the client can map it to a specific field error.

**Beyond rejection, the trigger also stamps `created_by`.** On insert it overwrites `new.created_by` with the calling profile — the `profiles` row whose `auth_user_id = auth.uid()` — rather than trusting whatever the client sent:

```sql
-- Inside the before-insert branch, before the checks above run.
-- Only overwrite when there IS an authenticated caller: the service role
-- (auth.uid() null, used by tests/cron to seed rows) supplies created_by
-- explicitly and is trusted, and the NOT NULL constraint enforces its presence.
if auth.uid() is not null then
  new.created_by := (select id from profiles where auth_user_id = auth.uid());
  if new.created_by is null then
    raise exception 'no calling profile' using errcode = '...';
  end if;
end if;
```

This makes `created_by` unforgeable: it is definitionally "who entered this row", which is always the authenticated caller, so there is never a legitimate reason to accept a client-supplied value. Without this, a crafted PostgREST insert could set `created_by` to the child's own profile (hiding that a parent logged it) or to another coach — defeating the audit purpose the column exists for. `created_by` is left out of the assignment on `update` so it preserves the **original** author when a row is later edited by a *different* editor than the one who first logged it — the only such case, since the `update` policy is self/managed-only, is a player and their parent both being able to edit within the window (e.g. the player self-logged, a parent later tweaks the duration; `created_by` stays the player). **Coaches never reach this path: their moderation lever is delete, not edit** — so nothing about editing an entry is a coach action.

**On `update`, the trigger stamps `updated_at`.** `new.updated_at := now()` — nothing else in the schema maintains it. No table in the codebase currently has an `updated_at` column, so there is no shared `moddatetime`/`set_updated_at` convention to inherit and no client code that sets it; without this line the column would sit frozen at its insert value forever. Since a `before insert or update` trigger already exists for validation, the bump is a one-line add on the update branch rather than a separate trigger.

---

## Access Control (RLS)

`alter table training_sessions enable row level security;`

| Operation | Policy |
|---|---|
| `select` | `profile_id = auth.uid()` **or** `is_managed_by_me(profile_id)` **or** `is_team_admin(team_id)` |
| `insert` | `(profile_id = auth.uid() or is_managed_by_me(profile_id))` and `is_team_player(team_id, profile_id)` and `not is_team_archived(team_id)` and `has_club_access(team_org_id(team_id))` |
| `update` | Same as insert (incl. `not is_team_archived`), plus the row must still be inside the 7-day window (trigger) |
| `delete` | `is_team_admin(team_id)` **or** `((profile_id = auth.uid() or is_managed_by_me(profile_id))` and `session_date >= (now() at time zone safe_team_tz(team_id))::date - 7)` |

**Players cannot read each other's raw session rows.** The `select` policy grants self, managed children, and team admins (coach/manager/director — `is_team_admin` already covers directors org-wide). Teammate-visible numbers come exclusively from the aggregation RPC below, which returns totals and never notes. A note like "skipped, knee still hurts" should not be readable by twenty teammates.

`delete` for team admins is the moderation lever: a coach who sees "480 minutes of shooting on a school day" removes it, with **no** date bound. There is no flag/approve workflow.

**Self/managed deletes are bounded by the same 7-day window as edits** (`session_date >= team-local today − 7`), so they can't mutate a week that has already scrolled out and gone "final". This makes the finality claim honest: once the window closes, a *player* can no longer edit **or** delete a session — only a coach can, and a coach doing so is moderation, not a player rewriting their own standings. The trade-off is deliberate: the earlier "delete-only after the window, so history can be corrected" affordance is gone, so a player who wants a genuinely mistaken *old* entry removed asks a coach. For a training log that's low-stakes and preferable to leaving finalized weeks silently mutable. The window uses `safe_team_tz(team_id)` for the same reason the trigger does — a bad `teams.timezone` must not error the delete.

`insert`/`update` carry `not is_team_archived(team_id)` (matched by the trigger's rule 2, so the DB holds the line even if a policy is bypassed via PostgREST), but `delete` deliberately does **not** — archiving a team must not, by itself, block removing an existing row. Deletes remain governed by the normal `delete` policy, including the 7-day self/managed window. Note one consequence of reusing `is_team_admin`: that helper already **excludes archived teams for a plain coach/manager** (only org admins retain access to archived teams — the app-wide rule), so on an archived team the moderation-delete lever is a **director/owner**, not the team coach; a player can still delete their own in-window row. This is the same shape as the roster-departure rule: history is preserved, only forward writes are revoked.

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

### Security-definer hygiene

Every helper and RPC in this feature is `security definer` — deliberately, since they must bypass RLS (membership/plan lookups, the club-board privilege escalation). That elevated context is exactly why each needs the following, and none of it is optional. (The inline `create or replace` snippets elsewhere in this spec omit the `set search_path` and grant lines for readability; **this subsection is authoritative** — the migration applies them to every definer function.)

**1. Pin `search_path` and schema-qualify.** A `security definer` function that resolves an unqualified name (`teams`, `team_members`, `sum()`, `now()`) does so through the *caller's* `search_path`. An `authenticated` user can plant a shadowing object — most reliably in their temp schema, which Postgres searches first for unqualified names (`pg_temp.teams`, `pg_temp.sum(...)`) — and the definer function would run the attacker's object **with the definer's privileges**. So every function here is declared with `set search_path = ''` and references objects fully qualified (`public.team_members`, `public.teams`, `public.organizations`, …). This applies to all six: `is_team_player`, `is_team_archived`, `safe_team_tz`, `has_club_access`, `training_leaderboard`, `training_summary` (and any others the migration adds, including the validation-trigger function itself). Illustrative:

```sql
create or replace function is_team_player(t_id uuid, p_id uuid)
returns boolean
language sql security definer stable
set search_path = ''                      -- <- pin it
as $$
  select exists (
    select 1 from public.team_members tm  -- <- schema-qualified
    where tm.team_id = t_id and tm.profile_id = p_id and tm.role = 'player'
  );
$$;
```

> Note: the ~30 pre-existing `security definer` functions in the repo do **not** set `search_path` — a latent, codebase-wide hardening gap. This feature does it right for its own functions; backfilling the rest is a separate ticket (see [Open Questions](#open-questions)).

**2. Tighten `EXECUTE`, but keep `authenticated`.** Revoke execute from `anon` and `public` on all six so unauthenticated callers can't invoke them, then grant to `authenticated`:

```sql
revoke execute on function training_leaderboard(text, uuid, uuid, text, date) from anon, public;
grant  execute on function training_leaderboard(text, uuid, uuid, text, date) to authenticated;
-- …same for the other five.
```

Do **not** copy the `create_team` pattern (revoke from `authenticated`, grant only `service_role`): that function is a server-only admin call, whereas these must stay callable by `authenticated` — the RPCs are invoked directly by clients via `.rpc()`, and the helpers are evaluated *inside RLS policies*, where a missing `EXECUTE` for `authenticated` would make every gated insert/select fail with a permission error. Authorization for the RPCs comes from their in-function caller/subject checks, not from the grant.

**3. Validate parameters in the RPCs.** Before any work, both RPCs reject malformed input with a clear `raise exception`: `p_scope in ('team','club')`, `p_period in ('week','month')`, and the required-per-scope params (`p_team_id` for `'team'`; `p_org_id` for `'club'`) — so a bad combination fails loudly instead of silently returning an empty or wrong-scoped result that a client might trust. (The helpers take only uuids and already behave safely on null — `exists(...)` → false — so they need no extra validation.)

---

## Leaderboard Aggregation

The club-wide board is the reason this needs an RPC rather than a PostgREST query. A U10 parent is not a member of the U18 team, so `is_team_member` correctly denies them those rows — but they *are* entitled to see the U18 players' **totals** on the club board. That is a legitimate privilege escalation, so it goes through one `security definer` function with an explicit caller check, not through loosened RLS.

```sql
create or replace function training_leaderboard(
  p_scope text,          -- 'team' | 'club'
  p_team_id uuid,        -- required for 'team'; optional team filter for 'club'
  p_org_id uuid,         -- required for 'club'; IGNORED for 'team' (org is
                         --   derived via team_org_id(p_team_id) — see caller check)
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

- **Caller check first.** Each scope derives the org it gates on from a trusted source rather than an interchangeable parameter, so the club-access check can't be applied to the wrong org (or to `null`):
  - **`'team'`:** `is_team_member(p_team_id)` **and** `has_club_access(team_org_id(p_team_id))`. The org is **derived from the team**, not read from `p_org_id` — team scope doesn't require the caller to pass `p_org_id` at all, and trusting a passed value would both break the gate (`has_club_access(null)` is always false, so every team board would 404) and let a caller pair a team with an unrelated org's access status.
  - **`'club'`:** the caller (or a profile they manage) is on some non-archived team in `p_org_id`, or `is_org_admin(p_org_id)`; **and** `has_club_access(p_org_id)`. If a `p_team_id` filter is supplied, **additionally assert `team_org_id(p_team_id) = p_org_id`** — the filter team must belong to the queried org, or `raise exception`. Without that assertion a caller could pass a team from a *different* org as the filter and have it evaluated behind `p_org_id`'s gate.
  - Any failure `raise exception` — not an empty result, so a probing client gets a clear denial rather than an ambiguous zero.
- **Current-roster filter.** A session contributes to a board **only if its owner is currently a roster `player` on the team it was credited to** — the aggregation inner-joins `team_members` on `(session.team_id, profile_id, role = 'player')`, it does not sum raw `training_sessions` by `team_id`. This is what keeps a player who left in April off the July board, without deleting their rows. `is_team_player(session.team_id, profile_id)` is exactly this predicate. Note the two consequences: (a) a session whose owner has since left its team is invisible on every board but still readable by that player in *My Training* (raw self-`select`), and (b) a mid-period **transfer A→B** moves the player's A-credited sessions off A's board when their A membership ends — those minutes live only in their own history from then on. Club scope additionally restricts to **non-archived** teams (consistent with the caller check); an archived team's sessions drop off the club board while remaining visible to a director on that team's own board.
- **Period bounds** are computed from `p_anchor` with **no timezone conversion** — `date_trunc('week', p_anchor)` (Postgres weeks start Monday, which is what we want) or `date_trunc('month', p_anchor)` — because `session_date` is already a timezone-naive calendar day (see [Data Model](#training_sessions)). A session dated `2026-07-11` falls in the same Mon–Sun week no matter which team's timezone is involved, so a club-scoped board spanning teams in different timezones has **no cross-timezone ambiguity to resolve**: every row is bucketed by its bare `session_date` against the same anchor. (The only timezone-sensitive rule in the whole feature is the trigger's "today" boundary, above; aggregation never touches a timezone.)
- **Excludes opted-out players** (`profiles.training_leaderboard_opt_out = true`) from the returned rows entirely.
- **Excludes players with zero minutes** in the period — the board shows who trained, not a roster with a column of zeros. The board RPC does **not** return a roster size; the "you're 12th of 18" denominator comes solely from `training_summary.denominator` (defined below), so there is one source for it, not two.
- **Name masking:** `'team'` scope returns full name (teammates already know each other from the roster). `'club'` scope returns `first name + last initial` ("Marcus H."), since it exposes children to adults on other teams. The signup trigger defaults `last_name` to `''`, so the initial can be missing: when `last_name` is empty (or whitespace) the masked name is the **first name alone** ("Marcus"), never a dangling `"Marcus "` with a trailing space and no letter. Compute it as `first_name || case when nullif(btrim(last_name), '') is not null then ' ' || left(btrim(last_name), 1) || '.' else '' end`.
- **Avatar in club scope — deliberately unmasked.** `avatar_url` is returned in full for both scopes, including `'club'`. This is a conscious decision, not an oversight: a club is a single vetted organization, and showing a player's photo to other adults *inside that same club* is judged acceptable. Two things follow, and both must be honored so the choice stays defensible:
  - It is a **new** exposure. Today the `profiles` SELECT policy is same-team-only, so a U10 parent cannot see a U18 player's name *or* photo. The club board is the first surface to cross that boundary; the RPC's `security definer` caller check (org membership + `has_club_access`) is therefore the *only* thing gating who sees these photos — it must stay tight (no anonymous/probing access, no leaking beyond the org).
  - The **opt-out** is the escape hatch. A family uncomfortable with the child's photo appearing club-wide removes it by opting out of the leaderboard entirely (opted-out players are excluded from all board rows). The settings copy should make clear that appearing on leaderboards means name-initial **and photo** are visible to other club members, so opting in is informed.
- **Ranking** is standard competition rank (1, 2, 2, 4) on `total_minutes desc` **only** — two players with equal minutes genuinely **share** a rank ("you're both 2nd"), which is what the (1, 2, 2, 4) example means. The remaining keys — `session_count desc`, then `min(session_date)` ascending (whoever got there first), then **real** name (not the club-masked form), then `profile_id` — order the **display within a tie**; they do *not* change the rank number. Ordering by real name + `profile_id` keeps the sequence deterministic and stable across scopes.

A second RPC, `training_summary`, returns just the current user's own totals, rank, and denominator — so the header ("You: 145 min · 4 sessions · #3 of 18") does not require pulling the whole board. Its scope parameters **mirror `training_leaderboard` exactly**, because the header sits above the board and must report a rank in the *same* scope the board is showing:

```sql
create or replace function training_summary(
  p_profile_id uuid,
  p_scope text,          -- 'team' | 'club' — matches the board's scope toggle
  p_team_id uuid,        -- required for 'team'; optional team filter for 'club'
  p_org_id uuid,         -- required for 'club'; ignored for 'team' (same
                         --   team_org_id derivation as training_leaderboard)
  p_period text,         -- 'week' | 'month'
  p_anchor date
)
returns table (
  total_minutes integer,
  session_count integer,
  rank integer,          -- the caller's rank within the SAME scope as the board;
                         --   null if the subject has zero minutes (see below)
  denominator integer    -- peer-cohort size: distinct non-opted-out roster
                         --   players in scope (see below for exact definition)
)
```

- **Subject authorization — the caller may only ask about themselves or a managed child.** Before anything else, `require p_profile_id = auth.uid() or is_managed_by_me(p_profile_id)`, else `raise exception`. This is a *distinct* check from the mirrored scope/org gate: that gate authorizes the **scope** (are you allowed to see this org/team's board), this one authorizes the **subject** (whose header is this). Without it, any org member passing an arbitrary `p_profile_id` could read another player's rank/total — and because the summary computes a rank even for a player the board excludes, that would leak precisely the standings an **opted-out** player removed from public view. `training_summary` is **not** a coach/admin RPC: coaches read per-player detail through the raw-row `select` path (`is_team_admin`) and aggregate there, so no capability is lost by restricting the subject here. If a coach-facing "player rank" view is ever wanted, it should be a separate, explicitly-scoped function rather than a loosening of this one.
- **Same grouping, scope/org caller check, period bounds, and opt-out semantics as `training_leaderboard`** — the summary is that function's ranking restricted to one profile. In particular, an **opted-out** caller still gets their own `rank` here even though they are absent from the board rows others see (spec: "Opted-out user sees their own numbers in the header").
- **`'club'` scope** ranks the caller among all distinct club players for the period (per the one-row-per-player rule above); `p_team_id` optionally narrows it to a single team, matching the club board's team filter. Without this, the club board's header could only ever report a team rank while the list beneath it ranks the whole club — a scope the two views must not disagree on.
- **`denominator`** is the size of the peer cohort in scope (the "of 18"): the count of **distinct, non-opted-out roster `player`s** — zero-minute players **included** (it's the whole cohort you're measured against, not just who trained), current-roster only (a player who left the team isn't counted), and for `'club'` scope **distinct** across the org's non-archived teams. **Opted-out players are excluded from the denominator**, for the same privacy reason they're excluded from board rows: the count must not reveal how many people opted out, or let anyone infer that a specific hidden player exists. This is the single source for the "of N" — the board RPC doesn't return it.
- **`rank` edge cases.** A subject with **zero minutes** in the period is not in the ranked set, so `rank` is **null** — the page renders the empty-state CTA ("Log a session →") rather than "#0 of 18". An **opted-out** subject still gets a non-null `rank` (this RPC is self/managed-only, so only they see it), computed as the position they *would* hold if slotted into the non-opted-out ranked players — shown only to them, leaking nothing, matching "opted-out user sees their own numbers in the header". Note the intended asymmetry: an opted-out caller's `rank` can be a value like `4` while the `denominator` (16, say) excludes them — "you'd sit 4th among the 16 ranked players" — which is correct, not a bug.

---

## UX

### Navigation

A `Training` item (dumbbell icon) in `DashboardNav`, between **Availability** and **Team**. Rendered only when the active team's org passes `hasClubAccess`. `src/app/dashboard/layout.tsx` already fetches the active org's `plan` for subdomain routing — extend that select to include `subscription_status` and pass a `hasTrainingAccess` boolean into the nav. No extra query.

Route: `/dashboard/training`, a RSC that resolves the active profile/team (same preamble as the other dashboard pages) and redirects to `/dashboard/settings?tab=plan` if the org lacks club access — mirroring `src/app/dashboard/club/layout.tsx`.

### Tabs

**Leaderboard** (default)

- Scope switch: `My Team` / `Club`. Club view gets a team filter dropdown (All teams / specific team).
- Period switch: `Week` / `Month`, with `‹ ›` arrows to step back and forth. Landing state is the current week. The forward (`›`) arrow is **disabled once you reach the current week/month** — stepping into a future period would only ever show an empty board. Backward stepping is unbounded (history goes as far back as the org has data).
- Ranked list: rank, avatar, name, total minutes (primary), session count (secondary). The current user's row is highlighted and pinned into view if they're below the fold.
- A player who is on the roster but hasn't logged anything sees an empty-state CTA — "You haven't logged training this week. Log a session →" — rather than seeing themselves at rank 18 with 0 minutes, which is a reason to close the tab.
- Opted-out user sees their own numbers in the header and a small "You're hidden from this leaderboard — change in Settings" note.

**My Training** (for players and parents-of-players)

- "Log session" button → dialog: date (defaults today, min = 7 days ago, max = today — where "today" is the **team-local** day, matching the trigger boundary so the client and DB agree on the edge), duration (minutes; quick-pick chips 15/30/45/60 plus a free input), category, optional notes. Team selector appears **only** if the active player is on more than one **eligible** team — eligible meaning `role = 'player'`, non-archived, and the org has club access (exactly the conditions the insert policy/trigger enforce), so the dialog never offers a team whose insert would then be rejected. The default selection is an eligible team; if exactly one team is eligible, no selector shows and that team is used. (If *zero* are eligible the "Log session" button shouldn't be reachable — but the page is already behind the club gate for the active team, so in practice there's always at least one.)
- Chronological list of the active profile's sessions. **Edit and delete are both allowed only inside the 7-day window**; once a session's date scrolls past it, the row is read-only to the player (no edit, no delete) and the UI shows why — e.g. a disabled control with "Older than 7 days — ask a coach to change this." Coaches retain delete from the Team view for moderation.
- Month-to-date and week-to-date totals at the top.

**Team** (coaches, managers, directors only)

- Every player on the roster for the selected period, **including opted-out players and players with zero minutes** — a coach's job is precisely to notice the zeros.
- Row click → that player's session detail (dates, durations, categories, notes), which is the moderation surface: a coach can delete an entry from here.

### Settings

Settings → Account gets **"Show me on training leaderboards"** (default on). Toggling it for a managed child is available from the parent's account when the child profile is active. Copy states explicitly, and must name the club-wide photo exposure so opting in is informed: *"Your coaches can always see your training log. This only controls whether you appear on leaderboards other players can see — including the club-wide board, where your first name, last initial, and profile photo are visible to other members of your club."*

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

1. Migration (table, opt-out column, `is_team_player`, `is_team_archived`, `safe_team_tz`, `has_club_access`, validation trigger, RLS, both RPCs) — validated against staging by `.github/workflows/migrate.yml` on the PR, then production on merge.
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
- **Delete window:** player deletes own session dated **within** 7 days → allowed; player deletes own session dated **8+ days ago** → **denied** (finalized week is immutable to the player); a **coach/admin** deletes that same 8-day-old session → **allowed** (moderation has no date bound). Parent deleting a managed child's session follows the same window as the child's own.
- Player updates a session to `duration_minutes = 999` → denied by CHECK; `duration_minutes = 3` (below the 5-min floor) → denied by CHECK; the boundaries `5` and `300` → accepted
- **Opt-out toggle RLS:** a player sets their own `profiles.training_leaderboard_opt_out` → allowed; a **parent** sets a **managed child**'s opt-out → allowed (profiles update policy); a user sets a **non-managed** player's opt-out → denied

### 2. Validation trigger — `tests/rls/training-sessions.test.ts`

- `session_date` = tomorrow (team tz) → rejected
- `session_date` = 8 days ago → rejected; 7 days ago → accepted
- **Team with an invalid `timezone`** (`''`, `'PST'`, `'Pacific Time'`) → insert **still succeeds** (no `invalid value for parameter "TimeZone"`); the "today" boundary falls back to UTC via `safe_team_tz`. Also assert a team with `timezone = null` behaves the same.
- **Archived team** (`teams.archived_at is not null`) with the player's roster row still present → **insert rejected**, and **update** of a pre-existing session on that team rejected; a **director's** (org-admin) delete of an existing row still **allowed** — a plain coach is *not* an admin of an archived team (`is_team_admin` excludes it), so the moderation lever there is the director. A raw self-`select` still returns the row. Asserts writes are blocked while history stays readable and admin-removable.
- Sessions summing to 361 minutes on one day → last insert rejected; 360 → accepted
- Daily cap counts across **two different teams** for the same player → rejected
- **Concurrent** inserts of 300 + 300 min for the same player-day, fired in parallel → exactly one commits, the other is rejected by the cap (asserts the advisory lock serializes the sum-then-write; without it both would race past 360)
- **Cap excludes the edited row on update:** a single 300-min session edited *down* to 200 → **accepted** — the row must not count itself twice (must not evaluate as the old 300 + new 200 = 500). With a *second* 100-min session already on that day (day total 300), editing the first to 260 → **accepted** (260 + 100 = 360), and to 261 → **rejected** (261 + 100 = 361): proves the cap still counts the *other* rows on update, just not the edited one.
- **`created_by` is stamped, not trusted:** an authenticated insert always stores `created_by` = the caller's profile regardless of what the client sent (covered by the forged-`created_by` RLS test); a **service-role** insert (`auth.uid()` null) must supply `created_by` explicitly — omitting it hits the `NOT NULL` constraint. Unauthenticated (`anon`) inserts never reach the trigger — RLS denies them first.

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
- **Team scope derives the org, ignores `p_org_id`:** calling team scope for a club team with `p_org_id = null` (and with a *wrong/free-tier* `p_org_id`) still succeeds — the gate resolves via `team_org_id(p_team_id)`; conversely a team scope call for a team whose *own* org is free-tier → exception regardless of any `p_org_id` passed
- **Club scope filter must belong to the org:** club scope with `p_org_id = A` and a `p_team_id` that belongs to org **B** → exception (the `team_org_id(p_team_id) = p_org_id` assertion); the same filter with a team that does belong to A → succeeds
- **Parameter validation:** an invalid `p_scope` (`'org'`, `''`, `null`) → exception; an invalid `p_period` (`'day'`, `null`) → exception; `'team'` scope with `p_team_id = null` → exception; `'club'` scope with `p_org_id = null` → exception. Assert each fails loudly rather than returning an empty result set. (Applies to both `training_leaderboard` and `training_summary`.)
- Week boundary: a **Sunday-dated** session and a session dated the **following Monday** land in **different** weeks; a session dated that Monday and one dated the Sunday six days later (same Mon–Sun span) land in the **same** week
- Bucketing is timezone-independent: two teams with different `teams.timezone` values (or one team with `timezone = null`) produce the **same** week/month bucket for the same `session_date` — no session is misfiled by a timezone difference
- **`training_summary` scope tracks the board:** for a multi-team player, `training_summary` in `'team'` scope returns their team rank/denominator, and in `'club'` scope returns their club-wide rank over distinct players and the club-player denominator — the two disagree, and each matches the corresponding `training_leaderboard` scope
- **`training_summary` for an opted-out caller** still returns a non-null `rank` in both scopes even though that caller is absent from `training_leaderboard` rows
- **`denominator` excludes opted-out players:** on a team with 18 roster players where 2 have opted out, a non-opted-out member's `denominator` is **16**, not 18 — and flipping a third player's opt-out on drops it to 15. Zero-minute (but non-opted-out) players are still **counted** in the denominator. For club scope, a multi-team player counts **once**.
- **Zero-minute subject → null rank:** `training_summary` for a roster player with no sessions in the period returns `total_minutes = 0`, `session_count = 0`, and `rank = null` (the page uses this to show the empty-state CTA, not "#0 of N").
- **`training_summary` subject authorization:** caller requests their **own** summary → allowed; a **parent** requests a **managed child**'s → allowed; a caller requests a **teammate/another org member's** `p_profile_id` (even one on a team the caller can see) → **exception**, not another player's numbers
- **Opt-out leak guard:** a member **cannot** obtain an opted-out player's `rank`/`total_minutes` by passing that player's `p_profile_id` to `training_summary` — the subject check denies it before the ranking runs (assert this specifically, since it's the standing opt-out is meant to hide)

### 4. Unit — `tests/unit/training.test.ts` (new)

- `has_club_access` (SQL) and `hasClubAccess` (TS) agree across every `(plan, subscription_status)` pair — the drift guard
- **Category parity:** the `TRAINING_CATEGORIES` const in `src/lib/training.ts` equals the value set in the `training_sessions.category` CHECK constraint (query the constraint definition, or insert one row per TS value and assert none is rejected). Same drift guard as `has_club_access`, so the soccer-shaped list in [Open Question #2](#open-questions) can be changed in exactly one reviewed place
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
6. **Validate `teams.timezone` at the source?** This feature defends against a bad value with `safe_team_tz` (fall back to UTC), which is the right *local* fix. The more thorough fix — a CHECK constraint validating `teams.timezone` against `pg_timezone_names` plus a one-time backfill of any existing junk — belongs to the team-settings surface, not here, because it touches existing data and the settings UI. Worth a separate ticket so other timezone-dependent features (scheduling, reminders) don't each re-implement the same defense.
7. **Backfill `search_path` on the pre-existing security-definer functions.** This feature pins `set search_path = ''` on its own functions (see [Security-definer hygiene](#security-definer-hygiene)), but the ~30 definer functions already in the repo (`is_team_member`, `is_team_admin`, `is_org_admin`, `team_org_id`, `is_managed_by_me`, …) do not, which is a latent privilege-escalation surface across the whole schema. Out of scope for training tracking, but should be its own hardening PR that adds `set search_path = ''` + schema-qualification to all of them at once, with the RLS test suite as the regression net.
