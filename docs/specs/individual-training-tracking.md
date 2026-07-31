# Spec: Individual Training Tracking & Leaderboard

## Overview

A new **Training** section in the web app, available only to club-tier orgs, where players log the individual training they do on their own time (outside team practices) and see how their logged time ranks against their teammates and the wider club, per week and per month.

v1 is deliberately time-tracking only: a session is a date, a duration, a category, and an optional note. The category is chosen from a **per-team list the coaching staff manages** — one seeded default ("General") plus any custom types a coach/manager/director adds, optionally seeded from sport-based suggestions — not a fixed, soccer-shaped enum (see [Training Categories](#training_categories)). Curated content — standard drills, coach-authored sessions, video — is the intended follow-on and the schema is shaped so it can be added without rewriting v1 rows.

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
| Session scope | **Global to the player**, counted on every current team/club board they belong to | Individual training is work the player did, not work done *for* one team. `training_sessions.team_id` is only the logging/category context; it never partitions leaderboard credit. A multi-team player logs once and the same session contributes to each team cohort they currently belong to, while a club board still counts the session only once for that player. |
| Trust model | Honor system + hard caps + coach moderation | Caps and a backdating window are enforced in the DB; coaches can delete a bogus entry. No approval queue — it would put the cost on the person with the least time. |
| Privacy | Included by default, per-player opt-out | Leaderboards die without density. Opt-out is the escape hatch for a family who doesn't want their child publicly ranked. |
| Periods | Mon–Sun weeks, calendar months, bucketed timezone-naive on `session_date` | `session_date` is a bare calendar day, so weeks/months are `date_trunc` with no timezone — no cross-tz misfiling. `teams.timezone` is used only for the trigger's "today" boundary. Weeks reset — that reset is most of the motivation. |
| Gating | `hasClubAccess(plan, subscription_status)` | Reuse `src/lib/plan.ts` verbatim. Never re-derive the gate. |
| Category model | Per-team managed list (`training_categories`), one seeded **"General"** default + custom types; `training_sessions.category_id` FK | The original nine values were soccer-specific and Lista sells into ~20 sports. A hardcoded enum can't serve them, and a free-text column gives no list to *manage*. A per-team lookup table lets each coaching staff own their own vocabulary. Scoped to the **team**, not the org, so a multi-sport club's teams keep distinct lists and coaches/managers retain control (a director reaches them via org-admin). Category is display metadata only — no leaderboard RPC groups or filters by it — so this touches no aggregation. |
| Sport suggestions | Static client map `SPORT_CATEGORY_SUGGESTIONS`, one-click seeding, never enforced | Convenience only. A coach can accept a sport's suggested set with one click (each becomes a real, editable `training_categories` row) or ignore it and add their own. The DB never requires a category to come from a suggestion — management is always the coach's. |

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

  -- The team context used when the session was logged. This does NOT determine
  -- which leaderboard receives the minutes: individual training is global to
  -- the player and is counted for every current team/club cohort they belong
  -- to. The context remains on the row for three reasons:
  --   1. Categories are team-managed, so category_id must belong to this team.
  --   2. Insert validation must prove the player was eligible to log through
  --      this team and its club-tier organization.
  --   3. The trigger's team-local "today" boundary needs teams.timezone,
  --      reachable in one join from team_id. (Bucketing itself is timezone-naive
  --      on session_date — see Leaderboard Aggregation — so this join is only
  --      for the insert/update window check, not for aggregation.)
  team_id uuid not null references teams(id), -- RESTRICT: context deletion must
                                              -- not erase a global player record

  -- The day the training happened, as the player reports it. A `date`, not a
  -- timestamptz: a session belongs to the day the player says it happened and
  -- must never drift across a week boundary because of a UTC conversion.
  session_date date not null,

  -- 5-minute floor filters out junk entries; 300-minute ceiling is well above
  -- any real solo session and blunts the obvious way to game the board.
  duration_minutes integer not null check (duration_minutes between 5 and 300),

  -- FK to the per-team managed category list (see "Training Categories"). A
  -- session's category is a row the team's coach/manager/director controls,
  -- not a hardcoded enum. No `on delete` action (RESTRICT is the default): a
  -- category that has sessions is archived (is_active=false), never
  -- hard-deleted, so this FK can never orphan a session. The referenced
  -- category must belong to the SAME team as the session — a plain FK can't
  -- span two columns, so the validation trigger enforces it (rule 6).
  category_id uuid not null references training_categories(id),

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

-- Global leaderboard aggregation, "My training", and coach drill-down all
-- resolve a player cohort first, then read each player's sessions by date.
create index training_sessions_profile_date_idx
  on training_sessions (profile_id, session_date desc);
```

**Roster changes and retention.** There is deliberately **no** foreign key from `training_sessions` to `team_members`, and removing a player from a team does **not** delete their sessions. Removal is a hard delete of the `team_members` row (the access-revoking step in `removeMember`, `app/actions/team.ts`), and this feature follows the same rule that flow already applies to availability — *"delete upcoming responses, preserve historical ones"*: history is kept. Because sessions are global to the player, removing them from team A removes them only from A's cohort; the same sessions continue to count on team B's board if they are still a current player there. Joining a new team makes the player's sessions in the selected week/month count on that team's board as well. The logging-context `team_id` therefore uses the FK default **RESTRICT**, not `on delete cascade`: deleting a team must not silently erase a player-owned session that still counts elsewhere. The product's normal removal path is archiving (`teams.archived_at`), which preserves the context. Any future irreversible team/account-erasure flow must handle these global rows explicitly rather than inheriting a team-scoped cascade.

### `profiles.training_leaderboard_opt_out`

```sql
alter table profiles
  add column training_leaderboard_opt_out boolean not null default false;
```

Profile-level, not per-team: a player who doesn't want to be ranked doesn't want to be ranked on any of their teams. An opted-out player still logs sessions, still sees their own totals, and **is still visible to their own coaches** — opt-out removes them from the *peer-facing* leaderboard only. The settings copy must say this plainly rather than implying coaches are blinded too.

### `training_categories`

The category vocabulary is data, not a hardcoded enum. Each team owns a list of categories that its coaching staff manages; a `training_session` references one of its team's categories by FK. **This table is created *before* `training_sessions` in the migration** (the FK depends on it) — it appears after it here only because the session is the feature's headline table.

```sql
create table training_categories (
  id uuid primary key default gen_random_uuid(),

  -- Scope: the team that owns this category. Team-level (not org-level) so a
  -- multi-sport club's teams keep independent lists and a team's coach/manager
  -- controls their own. A director reaches any of their org's teams via
  -- org-admin (see Access Control).
  team_id uuid not null references teams(id) on delete cascade,

  -- Display label as the coach typed it ("Ball mastery", "Set pieces"). The
  -- picker shows this verbatim; there is no separate slug/key — the id is the
  -- stable identifier. Non-default labels are freely renamable without touching
  -- sessions; the system-managed "General" default label is immutable.
  label text not null check (char_length(btrim(label)) between 1 and 40),

  -- Exactly one seeded "General" per team. The default is delete/archive-
  -- protected (Access Control) so a team always has at least one valid category
  -- and every session always has something to reference.
  is_default boolean not null default false,

  -- Picker ordering. "General" is seeded at 0; every custom/suggested insert
  -- supplies a server-assigned positive value so new rows append.
  sort_order integer not null check (sort_order >= 0),

  -- Soft-delete. "Removing" a category that has sessions must not orphan them,
  -- so removal flips is_active to false: it disappears from the picker and the
  -- management list's active set, while historical sessions keep resolving
  -- their label. A never-used category can also just be archived — the UI never
  -- hard-deletes, keeping the rule uniform.
  is_active boolean not null default true,

  -- Null for the system-seeded "General" default (created by the teams
  -- trigger); set to the acting profile for rows a coach adds. Not
  -- security-bearing — audit only. (Suggestions are never auto-seeded — they
  -- are applied only by an explicit coach click, so those rows carry a
  -- created_by like any other custom category.)
  created_by uuid references profiles(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Only the system-managed default may lack an acting-user audit value.
  check (is_default or created_by is not null)
);

-- No duplicate labels within a team (case/space-insensitive). Lets the manage
-- UI reject "Passing" when "passing " already exists, and makes the suggestion
-- "add these" idempotent — re-adding a sport's set can't create dupes.
create unique index training_categories_team_label_idx
  on training_categories (team_id, lower(btrim(label)));

-- At most one default per team. Partial unique index, not a CHECK.
create unique index training_categories_one_default_idx
  on training_categories (team_id) where is_default;

-- Picker load: a team's active categories in deterministic display order.
create index training_categories_team_active_idx
  on training_categories (team_id, sort_order, created_at, id) where is_active;
```

**Seeding the default.** Every team must have its "General" default the moment it could gain club access, so seeding is guaranteed DB-side, not left to the app:

- A `before/after insert` trigger on `teams` inserts the `is_default` "General" row for each new team (`created_by` null).
- The migration **backfills** one "General" default for every existing team. (There is no existing `training_sessions` data to migrate — the feature is unshipped — so this is a pure "one default row per team" backfill with nothing to remap.)

Seeding runs for **all** teams, not just club-tier ones: it's a single cheap row and it means the picker is never empty the instant a team upgrades. The default surfaces only behind the club gate like everything else.

**Sport suggestions** are a static client-side map in `src/lib/training.ts`, keyed by the existing `teams.sport` values, e.g.:

```ts
export const SPORT_CATEGORY_SUGGESTIONS: Partial<Record<Sport, string[]>> = {
  soccer:     ["Ball mastery", "Dribbling", "Passing", "Shooting", "Fitness", "Strength", "Agility", "Recovery"],
  basketball: ["Shooting", "Ball handling", "Finishing", "Conditioning", "Strength", "Agility", "Recovery"],
  // …the common sports; a sport with no entry simply shows only "add custom".
};
```

They are **UI suggestions, never a constraint** — the manage screen offers "Add suggested for {sport}", which inserts each as a normal `training_categories` row. The map need not cover every sport; missing sports fall back to the "General" default plus manual add.

**Idempotency mechanism (don't rely on `onConflict`).** The uniqueness that makes re-adding a sport's set safe is enforced by the *expression* index `(team_id, lower(btrim(label)))`, and the Supabase/PostgREST client **cannot cleanly target an expression index** via `onConflict` (it takes column names / a named constraint, not `lower(btrim(label))`). So the flow is **prefetch-filter**, not upsert: the manage screen loads the team's complete category set, including archived rows, and filters the sport's suggested labels down to those **not already present for the team, case-insensitively**. Active matches are skipped as already present. Archived matches are also skipped rather than silently resurrected, but the result reports them and offers the explicit Restore action described in UX. If a concurrent add causes a residual unique-violation, catch it, refetch, and treat it as success (the label exists either way) rather than surfacing an error. A small `security definer` RPC doing `insert … on conflict (team_id, lower(btrim(label))) do nothing` — which *can* infer the expression index in raw SQL — is an acceptable atomic alternative, but it must re-check the write authorization (`is_team_admin`/`is_org_admin` + `has_club_access`) inside, since a definer function bypasses the RLS that otherwise enforces it, and follow the [Security-definer hygiene](#security-definer-hygiene) rules.

**Ordering mechanism.** v1 has no drag-and-drop reorder control. "General" is seeded with `sort_order = 0`; the category server action assigns custom and suggested rows positive positions after the highest existing `sort_order` for that team, in increments of 10. A suggestion batch preserves the array order from `SPORT_CATEGORY_SUGGESTIONS`. Archived rows retain their position and a restore returns them to that position; new rows append after the maximum across active **and archived** rows. Concurrent writers may legitimately choose the same numeric position, so ordering is always deterministic with `order by is_default desc, sort_order, created_at, id`. The client never invents or directly edits `sort_order`; a future reorder feature can use the gaps without changing v1 behavior.

Because the suggestions map is the *only* remaining static category data and nothing in the DB references it, there is **no drift guard needed** — the old `TRAINING_CATEGORIES` ↔ CHECK parity test is removed along with the enum.

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
6. **`category_id` does not belong to the logging-context `team_id`, or is archived — checked only when the category link changes.** The FK guarantees the category *exists*, but not that it belongs to the team whose vocabulary was selected or is still selectable — a plain FK can't span two columns. So the trigger asserts `exists (select 1 from public.training_categories c where c.id = new.category_id and c.team_id = new.team_id and c.is_active)`. **This must be conditional, not run on every update:** guard it with `if tg_op = 'INSERT' or new.category_id is distinct from old.category_id or new.team_id is distinct from old.team_id then …`. An unconditional `is_active` check would **block editing the duration or notes of any session whose category was archived after it was logged** — the row's own historical category is now inactive, so a harmless edit would fail. Gating on "the link actually changed" means a session keeps resolving (and stays editable around) its archived label, while any attempt to newly *repoint* a row at a foreign or archived category is still rejected — on both insert and a category-changing update. Without the `team_id` half a player could use team A as the logging context while tagging the row with team B's private label; without `is_active` a client could newly select an archived category the picker no longer offers. This relationship is category integrity only; it does **not** limit which team leaderboards count the session.

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

This makes `created_by` unforgeable: it is definitionally "who entered this row", which is always the authenticated caller, so there is never a legitimate reason to accept a client-supplied value. Without this, a crafted PostgREST insert could set `created_by` to the child's own profile (hiding that a parent logged it) or to another coach — defeating the audit purpose the column exists for. **On every update, force `new.created_by := old.created_by`** (or equivalently reject a distinct value); merely omitting an assignment is not protection because an allowed updater can explicitly submit a replacement. This preserves the original author when a player or parent later edits the row. **Coaches never reach this path: their moderation lever is delete, not edit** — so nothing about editing an entry is a coach action.

**On `update`, the trigger stamps `updated_at`.** `new.updated_at := now()` — nothing else in the schema maintains it. No table in the codebase currently has an `updated_at` column, so there is no shared `moddatetime`/`set_updated_at` convention to inherit and no client code that sets it; without this line the column would sit frozen at its insert value forever. Since a `before insert or update` trigger already exists for validation, the bump is a one-line add on the update branch rather than a separate trigger.

---

## Access Control (RLS)

`alter table training_sessions enable row level security;`

| Operation | Policy |
|---|---|
| `select` | `profile_id = auth.uid()` **or** `is_managed_by_me(profile_id)` **or** `is_training_admin_for_profile(profile_id)` **or** `is_org_admin(team_org_id(team_id))` |
| `insert` | `(profile_id = auth.uid() or is_managed_by_me(profile_id))` and `is_team_player(team_id, profile_id)` and `not is_team_archived(team_id)` and `has_club_access(team_org_id(team_id))` |
| `update` | Same as insert (incl. `not is_team_archived`), plus the row must still be inside the 7-day window (trigger) |
| `delete` | `is_training_admin_for_profile(profile_id)` **or** `is_org_admin(team_org_id(team_id))` **or** `((profile_id = auth.uid() or is_managed_by_me(profile_id))` and `session_date >= (now() at time zone safe_team_tz(team_id))::date - 7)` |

**Players cannot read each other's raw session rows.** The `select` policy grants self, managed children, and staff who currently administer any team on which the subject is a roster player. `is_training_admin_for_profile(profile_id)` is a `security definer` helper that checks for a current, non-archived `team_members` row with `role = 'player'` where the caller satisfies `is_team_admin(team_id)` and that team's org satisfies `has_club_access`. It keys authorization to the **player's current teams**, not the session's logging-context `team_id`, because the global minutes affect every one of those teams' boards and their staff need the matching moderation detail. The additional `is_org_admin(team_org_id(team_id))` branch preserves director/owner access to historical rows whose logging-context team is archived or whose player has since left every team. Teammate-visible numbers still come exclusively from the aggregation RPC below, which returns totals and never notes. A note like "skipped, knee still hurts" should not be readable by twenty teammates.

**This coach visibility is deliberately cross-org.** Because a session is global to the player, `is_training_admin_for_profile` grants a coach on *any* of the player's current club teams read access to *all* of that player's rows — including the **notes** on sessions logged through a team in a **different organization**, since those minutes count on this coach's board too. That is the same cross-org reach as the moderation-`delete` lever below, extended to notes; it is an accepted consequence of the global-session model, not an oversight. The `security definer` caller checks keep it bounded to staff who *currently* administer a team the player actually belongs to (and whose org has club access) — a coach with no current relationship to the player sees nothing.

`delete` for team admins is the moderation lever: a coach who sees a suspicious global entry affecting their team's board removes that one underlying entry, with **no** date bound, and the correction consequently applies to every board where it was counted. This deliberately means that when a player belongs to teams in two organizations, an authorized coach from either current team can moderate the shared record. There is no flag/approve workflow.

**Self/managed deletes are bounded by the same 7-day window as edits** (`session_date >= team-local today − 7`), so they can't mutate a week that has already scrolled out and gone "final". This makes the finality claim honest: once the window closes, a *player* can no longer edit **or** delete a session — only a coach can, and a coach doing so is moderation, not a player rewriting their own standings. The trade-off is deliberate: the earlier "delete-only after the window, so history can be corrected" affordance is gone, so a player who wants a genuinely mistaken *old* entry removed asks a coach. For a training log that's low-stakes and preferable to leaving finalized weeks silently mutable. The window uses `safe_team_tz(team_id)` for the same reason the trigger does — a bad `teams.timezone` must not error the delete.

**Self-edit requires the logging context to still be live; self-delete does not — this asymmetry is intentional.** The `update` policy re-asserts insert eligibility (`is_team_player(team_id)`, `not is_team_archived(team_id)`, `has_club_access(team_org_id(team_id))`), and trigger rules 1–2 re-check membership and archival on update — so a player who has **left the logging-context team** (or whose context team was archived, or whose context org lapsed) can no longer **edit** an in-window session logged through it, even though the self-`delete` branch — keyed only to ownership plus the 7-day window — still lets them **remove** it. The rule of thumb: you can always retract your own recent entry, but you can only rewrite its *content* while the context that validated it is still live. Editing a global record whose originating context is gone would re-validate it against a team the player no longer belongs to (whose category vocabulary and timezone framed the row); retracting it needs no such context. A player who wants to *change* rather than remove such a session re-logs it through a team they are currently on. (The same rule cleanly covers the downgrade case: on a lapsed club a player can delete but not edit — `has_club_access` gates the edit, not the retraction.)

`insert`/`update` carry `not is_team_archived(team_id)` (matched by the trigger's rule 2, so the DB holds the line even if a policy is bypassed via PostgREST), but `delete` deliberately does **not** — archiving the logging-context team must not, by itself, block removing an existing global row. Deletes remain governed by the normal `delete` policy, including the 7-day self/managed window. A coach/manager can moderate while the player is currently on one of their active club teams; a director/owner of the logging-context org retains the historical moderation path even after that team is archived or the player leaves. History is preserved while forward writes through an archived context are revoked.

### `training_categories` access

`alter table training_categories enable row level security;`

| Operation | Policy |
|---|---|
| `select` | `is_team_member(team_id)` **or** an existing readable `training_session` references the category |
| `insert` | (`is_team_admin(team_id)` **or** `is_org_admin(team_org_id(team_id))`) **and** `has_club_access(team_org_id(team_id))` |
| `update` | Same as insert (plus the category write/invariant trigger below) |
| `delete` | (`is_team_admin(team_id)` **or** `is_org_admin(team_org_id(team_id))`) **and** `has_club_access(team_org_id(team_id))` **and** `is_default = false` |

- **Everyone on the team can `select`** so players (and parents logging for a child) can populate the picker. A second branch allows a category row when `exists (select 1 from training_sessions s where s.category_id = training_categories.id)` under the caller's normal `training_sessions` RLS visibility. That branch is needed for history: a player who leaves the logging-context team must still resolve their own old category label, and a coach viewing a current player's global detail must resolve labels on sessions logged through another team. It exposes only labels already attached to a session the caller is authorized to read, not that other team's full category list. Reading the label itself leaks nothing sensitive.
- **Managers get write access, which `is_team_admin` already grants** (it resolves `role in ('coach','manager')`), so the "coach *or* manager" half of the requirement needs no new predicate. The **director** half is `is_org_admin(team_org_id(team_id))` — the same org-admin helper the leaderboard RPC uses — which also covers `owner`. A plain `player` or `parent` cannot add, rename, or remove categories.
- **All three writes (`insert`/`update`/`delete`) require `has_club_access`**, mirroring session inserts: a lapsed club can neither grow, edit, nor prune its category list via PostgREST, and the manage UI is behind the same gate anyway. The `delete` policy carrying the gate is deliberate — without it, a canceled/free org's admin could still hard-delete unused categories through PostgREST, contradicting the "no category management without club access" story. (The seeded "General" default is created by the `teams` trigger with definer rights, so it exists regardless of plan; only *manual* management is gated.)
- **Category invariants and audit fields are protected by one `before insert or update or delete` trigger, not by client discipline or RLS alone.** RLS can't express immutable ownership, trustworthy authorship, or "leave at least one active default," so the trigger enforces the complete row contract:
  - **Inserts stamp audit metadata** — set `new.created_at := now()` and `new.updated_at := now()`. For an authenticated custom insert with `is_default = false`, overwrite `new.created_by` with the calling profile (`profiles.auth_user_id = auth.uid()`), regardless of the submitted value. A service-role custom insert must provide a non-null `created_by`; the table CHECK rejects it otherwise. The system-seeded default is the sole row allowed to keep `created_by = null`.
  - **Default inserts have one valid shape** — an `is_default = true` insert must be active, labeled exactly "General", use `sort_order = 0`, and have `created_by = null`; reject any other shape. The team-seeding trigger and migration backfill are the only intended callers.
  - **Audit fields are immutable/maintained on update** — force `new.created_by := old.created_by` and `new.created_at := old.created_at`, then set `new.updated_at := now()`. Renames, archives, restores, and any future ordering change therefore update the timestamp without allowing authorship to be rewritten.
  - **`team_id` is immutable post-insert** — reject any update where `new.team_id is distinct from old.team_id`. Moving a category would silently make every existing session that references it point at a category owned by another team; the session trigger cannot prevent that because no `training_sessions` row is being written.
  - **`is_default` is immutable post-seed** — reject any update where `new.is_default is distinct from old.is_default`. It is system-managed (seeded once); the app never exposes a control to toggle it. This alone makes "demote the default to zero" impossible and, with the partial unique index `training_categories_one_default_idx` (which blocks a *second* default), pins the count at **exactly one** default per team for the team's life.
  - **The default identity and position are immutable** — reject any update to `label` or `sort_order` on the `is_default` row. "General" at position 0 is the fixed system fallback in v1; teams express their vocabulary through custom categories rather than renaming or moving the invariant row.
  - **The default can't be archived** — reject an update that sets `is_active = false` on the `is_default` row. Combined with immutability above, the sole default is therefore always present and always active.
  - **The default can't be deleted** — reject a delete of an `is_default` row (belt-and-suspenders with the `is_default = false` delete policy, so the DB holds even if the policy is bypassed).
  Because the insert branch resolves the authenticated caller's profile, its trigger function is `security definer` and follows the pinned-`search_path`, schema-qualification, and execute-grant rules below. "Remove" in the UI remains a soft-archive of a **non-default** row (`update … set is_active = false`), and "Restore" sets that same row back to `is_active = true`.
- **Cross-team safety.** The session trigger (rule 6) requires a session's `category_id` to share its `team_id`, and the category write/invariant trigger makes the category's `team_id` immutable after insert. Together with the team-scoped policies, this prevents both attaching another team's category to a session and moving a referenced category across teams later.

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

**1. Pin `search_path` and schema-qualify.** A `security definer` function that resolves an unqualified name (`teams`, `team_members`, `sum()`, `now()`) does so through the *caller's* `search_path`. An `authenticated` user can plant a shadowing object — most reliably in their temp schema, which Postgres searches first for unqualified names (`pg_temp.teams`, `pg_temp.sum(...)`) — and the definer function would run the attacker's object **with the definer's privileges**. So every function here is declared with `set search_path = ''` and references objects fully qualified (`public.team_members`, `public.teams`, `public.organizations`, …). This applies to all seven callable helpers/RPCs — `is_team_player`, `is_team_archived`, `safe_team_tz`, `has_club_access`, `is_training_admin_for_profile`, `training_leaderboard`, `training_summary` — and to every definer trigger function, including session validation, category audit/invariants, and team seeding. Illustrative:

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

**2. Tighten `EXECUTE`, but keep `authenticated` on callable functions.** Revoke execute from `anon` and `public` on all seven callable helpers/RPCs so unauthenticated callers can't invoke them, then grant those seven to `authenticated`. Trigger functions are not client APIs: revoke their execute privilege from `anon`, `authenticated`, and `public`; PostgreSQL invokes them through their triggers.

```sql
revoke execute on function training_leaderboard(text, uuid, uuid, text, date) from anon, public;
grant  execute on function training_leaderboard(text, uuid, uuid, text, date) to authenticated;
-- …same for the other six callable helpers/RPCs.
```

Do **not** copy the `create_team` pattern onto the seven callable helpers/RPCs (revoke from `authenticated`, grant only `service_role`): the RPCs are invoked directly by clients via `.rpc()`, and the helpers are evaluated *inside RLS policies*, where a missing `EXECUTE` for `authenticated` would make every gated insert/select fail with a permission error. Authorization for the RPCs comes from their in-function caller/subject checks, not from the grant. The trigger functions are the deliberate exception described above because clients never invoke them directly.

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

**Grouping — build the current player cohort first, then sum global sessions.** Both scopes first select a **distinct set of current roster players** for the requested team or club. They then join `training_sessions` by `profile_id` and period only — never by `training_sessions.team_id` — and group by player. The row's `team_id` is logging/category context, not leaderboard credit. Building a distinct cohort before joining is essential: if a player belongs to two teams in one club, the same session must still be summed **once**, not once per membership row. Consequently:

- **`'team'` scope** selects the current roster players on `p_team_id`, then sums **all global sessions** for each of those players in the period, regardless of which team context each session was logged through. `team_id`/`team_name` in the result identify the queried team.
- **`'club'` scope, no team filter** (`p_team_id` null) selects distinct current players across all non-archived teams in `p_org_id`, then sums each player's global sessions once. `team_id`/`team_name` are **null** because no single team represents a multi-team player.
- **`'club'` scope, team-filtered** (`p_team_id` given) narrows the cohort to current players on that team, but still sums each selected player's **global** sessions. `team_id`/`team_name` identify the filter team. This differs from `'team'` scope only in the caller check and name masking below — a U10 parent may filter the club board to U18 without being a U18 member.

Behavior:

- **Caller check first.** Each scope derives the org it gates on from a trusted source rather than an interchangeable parameter, so the club-access check can't be applied to the wrong org (or to `null`):
  - **`'team'`:** `is_team_member(p_team_id)` **and** `has_club_access(team_org_id(p_team_id))`. The org is **derived from the team**, not read from `p_org_id` — team scope doesn't require the caller to pass `p_org_id` at all, and trusting a passed value would both break the gate (`has_club_access(null)` is always false, so every team board would 404) and let a caller pair a team with an unrelated org's access status.
  - **`'club'`:** the caller (or a profile they manage) is on some non-archived team in `p_org_id`, or `is_org_admin(p_org_id)`; **and** `has_club_access(p_org_id)`. If a `p_team_id` filter is supplied, **additionally assert `team_org_id(p_team_id) = p_org_id`** — the filter team must belong to the queried org, or `raise exception`. Without that assertion a caller could pass a team from a *different* org as the filter and have it evaluated behind `p_org_id`'s gate.
  - Any failure `raise exception` — not an empty result, so a probing client gets a clear denial rather than an ambiguous zero.
- **Current-roster cohort.** Membership determines **which boards include the player**, not which of their sessions count. Leaving team A removes the player and all of their totals from A's board, while the same global sessions continue to count anywhere they remain a current player. A mid-period transfer A→B removes them from A and makes their global sessions for that period count on B, including sessions logged before the transfer. Club scope builds its distinct player cohort only from non-archived teams, so a player with no remaining active team in that org drops off its club board; a player who still belongs to another active team in the org remains and keeps their full global total. The rows themselves always remain in *My Training*.
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

- "Log session" button → dialog: date (defaults today, min = 7 days ago, max = today — where "today" is the **logging-context team's local day**, matching the trigger boundary so the client and DB agree on the edge), duration (minutes; quick-pick chips 15/30/45/60 plus a free input), category, optional notes. The **category select is populated from the chosen team's active `training_categories`** (label + id), ordered by `is_default desc, sort_order, created_at, id`, and defaults to "General" — so the options track whatever that team's staff has configured with deterministic ordering. If the player switches the team selector, the category list reloads for the newly-selected team (categories are per-team). This selector chooses only the **category vocabulary and logging context**; it does not allocate leaderboard credit. The player logs the work once, and it counts on every team/club board where they are currently in the player cohort. A player never manages categories from here; they only pick one. Team selector appears **only** if the active player is on more than one **eligible** team — eligible meaning `role = 'player'`, non-archived, and the org has club access (exactly the conditions the insert policy/trigger enforce), so the dialog never offers a team whose insert would then be rejected. The default selection is the active eligible team; if exactly one team is eligible, no selector shows and that team is used. (If *zero* are eligible the "Log session" button shouldn't be reachable — but the page is already behind the club gate for the active team, so in practice there's always at least one.)
- Chronological list of the active profile's sessions. **Edit and delete are both allowed only inside the 7-day window**; once a session's date scrolls past it, the row is read-only to the player (no edit, no delete) and the UI shows why — e.g. a disabled control with "Older than 7 days — ask a coach to change this." Coaches retain delete from the Team view for moderation.
- Month-to-date and week-to-date totals at the top.

**Team** (coaches, managers, directors only)

- Every player on the roster for the selected period, **including opted-out players and players with zero minutes**. Each total is the player's global individual-training total for the period, matching the team leaderboard rather than filtering to rows logged through this team.
- Row click → that player's global session detail (dates, durations, categories, notes), which is the moderation surface: a coach can delete an entry from here. Deleting removes the one shared record and updates every board where it contributed.

### Managing categories (coaches, managers, directors)

A **"Training categories"** management surface, reachable from the Team tab (a "Manage categories" affordance) and mirrored in team settings. Visible only to `is_team_admin` (coach/manager) or the org's director/owner — the same predicate as the write RLS, so the UI never offers a control the DB would reject.

- **Active list** — display active categories in `order by is_default desc, sort_order, created_at, id`. "General" is pinned first and badged as the fixed system default; it has no rename or remove controls.
- **Archived section** — display archived non-default categories in a collapsed "Archived" section on the same screen. Each row retains its label and ordering metadata and has a **Restore** action (`is_active = true`). Archived rows are therefore visible tombstones, not hidden labels that mysteriously block reuse.
- **Add custom** — a text field creating a new `training_categories` row through the category server action. Inline-validated against the same rules the DB holds: 1–40 chars after trim, and unique within the team (the `lower(btrim(label))` index). If "Passing" matches active "passing", show that it already exists. If it matches an archived row, show **"This category is archived. Restore it?"** with a Restore action instead of attempting an insert.
- **Rename** — edits a non-default category's `label` in place; because sessions reference the category by `id`, a rename propagates to every historical session with no backfill. "General" is intentionally non-renamable in both the UI and invariant trigger.
- **Remove** — a soft-archive (`is_active = false`). Copy should say the category is hidden from future logging but past sessions keep it ("Existing sessions keep this category; it just won't appear for new ones"). The default has no remove control.
- **"Add suggested for {sport}"** — shown when `teams.sport` has an entry in `SPORT_CATEGORY_SUGGESTIONS`. One click inserts that sport's missing labels as real rows in suggestion-map order. Active matches are skipped; archived matches are not silently restored and are reported separately (for example, "5 added · 2 already active · 1 archived") with an affordance to review/restore the archived rows. After insertion they're ordinary categories — editable, archivable, and restorable like any custom one. If the team has no sport set, or the sport isn't in the map, this button is absent and only "add custom" shows. This is the *only* place suggestions appear; nothing is ever auto-applied without the coach clicking.

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

`drill_id` is nullable and additive, so every v1 row remains valid as a "freeform" session. `category_id` stays on `training_sessions` (a FK to the per-team `training_categories`, **not** to the drill) rather than being read through the drill, so a session's category is stable even if the drill is later edited or deleted. **Do not** make a session's category read *through* `drill_id` in Phase 2 — resolving category via the drill is the change that would force a backfill; keep the direct `category_id` reference.

Phase 2 also has to **reconcile the drill table's own category with the per-team model**: `training_drills` is org-level (`organization_id`) while `training_categories` is team-level, so a drill can't simply FK a single team's category. The likely shape is that a drill carries a category *label* (or an org-level category), and logging a session *from* a drill maps that label onto — or lazily creates — the logging-context team's matching `training_categories` row (idempotent against the unique index), so the session still lands on a real team category while its minutes remain global to the player. That mapping is a Phase 2 design point, explicitly out of scope here; v1 only needs the direct `category_id` reference to stay put.

---

## Rollout

1. Migration (`training_categories` table + indexes, the `teams`-insert seeding trigger and existing-team default backfill, the category audit/invariant `before insert or update or delete` trigger, `training_sessions` with `category_id` FK, opt-out column, `is_team_player`, `is_team_archived`, `safe_team_tz`, `has_club_access`, `is_training_admin_for_profile`, validation trigger, RLS on **both** tables, both RPCs) — validated against staging by `.github/workflows/migrate.yml` on the PR, then production on merge. Because this reworks the **unshipped** training migration in place (per the decision on this branch), there is no production `training_sessions` data to migrate; the only backfill is one "General" row per existing team.
2. Regenerate `src/types/database.ts`.
3. UI and category server action behind the existing club gate. The server action owns append-order assignment and performs category inserts/restores through the caller's normal RLS path. No feature flag: the club gate *is* the flag, and the blast radius is a new route that no free org can reach.
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
- **Global coach visibility:** a coach selects all rows for a current player on their team → **allowed**, including a row whose logging-context `team_id` is another team or another org; a coach with no current team relationship to that player → **denied**; a **director** → allowed for current players across their org and for historical rows logged through their org
- Player deletes own session → allowed; deletes a teammate's → denied; coach deletes a player's → allowed
- **Delete window:** player deletes own session dated **within** 7 days → allowed; player deletes own session dated **8+ days ago** → **denied** (finalized week is immutable to the player); a **coach/admin** deletes that same 8-day-old session → **allowed** (moderation has no date bound). Parent deleting a managed child's session follows the same window as the child's own.
- **Edit-vs-delete after leaving the logging-context team (intentional asymmetry):** a player on teams A and B logs a session through A, then their **team-A membership is removed** (still a player on B); within the 7-day window an **update** of that session → **denied** (context-team eligibility gone, via the update policy + trigger rules 1–2), while a **delete** of the same in-window session → **allowed** (self-delete needs only ownership + window). The same shape holds when A is **archived** or A's **org lapses**: edit denied, in-window self-delete allowed.
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
- **`created_by` is stamped and immutable, not trusted:** an authenticated insert always stores `created_by` = the caller's profile regardless of what the client sent (covered by the forged-`created_by` RLS test); a later player/parent update that sends a different `created_by` still stores the **original** author because the trigger forces `new.created_by := old.created_by`. A **service-role** insert (`auth.uid()` null) must supply `created_by` explicitly — omitting it hits the `NOT NULL` constraint. Unauthenticated (`anon`) inserts never reach the trigger — RLS denies them first.
- **Category must belong to the team and be active (trigger rule 6):** a session insert whose `category_id` is one of **another team's** categories → **rejected**; a `category_id` that is an **archived** category of the *same* team → **rejected**; an **active same-team** category → **accepted**. On **update**, repointing a row to a foreign or archived `category_id` → **rejected**.
- **Rule 6 is conditional — archiving a category must not freeze its sessions:** log a session, then **archive** that category, then **edit the session's `duration_minutes`/`notes`** (leaving `category_id` unchanged) → **accepted** (the `tg_op = 'INSERT' or category_id/team_id changed` guard skips the active-check for a link-unchanged update). This is the regression test for the "unconditional check blocks edits" bug — assert the same edit would fail if the guard were removed.

### 2b. Category management RLS + seeding — `tests/rls/training-categories.test.ts` (new)

- **Seeding on team creation:** inserting a new team auto-creates **exactly one** category — label "General", `is_default = true`, `sort_order = 0`, `created_by` null. Assert count = 1 and the flags.
- **Backfill:** every team that existed before the migration has exactly one `is_default` "General" category (assert against a team seeded by the suite's normal team-creation helper, which predates the training rows).
- **Default insert shape:** a service-role attempt to insert an `is_default` row with a different label, nonzero order, inactive state, or non-null `created_by` is rejected by the category trigger.
- **One-default invariant:** attempting to insert a **second** `is_default = true` row for a team → **rejected** by the partial unique index.
- **Select:** a roster `player` (and a `parent` of a player) can `select` their team's categories → **allowed**; a user on **another** team in the org selecting this team's unused categories → **denied**. After a player logs a session and then leaves its logging-context team, the player/parent can still resolve that session's category label but cannot list the rest of the old team's categories. A coach of one of the player's current teams can likewise resolve the labels attached to the global rows they can moderate, including a label owned by another team, without gaining access to that team's unused category list.
- **Write authorization:** **coach** adds a category → allowed; **manager** adds → allowed; **director** (org admin) and **owner** add → allowed; a plain **player** or **parent** adds → **denied**; a coach of a **different** team in the same org adds to this team → **denied** (`is_team_admin` is team-scoped and `is_org_admin` is false for a plain coach).
- **Club gate on all writes:** a coach on a **free-tier** or **canceled** club org **adds**, **renames** (update), or **deletes** a non-default category → **denied** by `has_club_access` on each of insert/update/delete; `trialing`/`past_due` → **allowed**. (The seeded default still exists on a free-tier team — seeding bypasses the gate — assert it's present even though manual management is denied.) This pins the delete-gate fix: a canceled org's admin cannot prune categories via PostgREST.
- **Unique label per team:** adding "Passing" when "passing " already exists on that team → **rejected** (the `lower(btrim(label))` index); the same label on a **different** team → **allowed**.
- **Category audit fields are DB-owned:** an authenticated custom insert that submits another profile's `created_by` stores the **caller**; a service-role custom insert with null `created_by` is rejected by the CHECK; renaming, archiving, restoring, or changing `sort_order` preserves `created_by`/`created_at` and advances `updated_at`.
- **Rename propagates without backfill:** renaming a **non-default** category that has sessions updates `label` in place; a join from those sessions now resolves the **new** label, with no change to `training_sessions` rows.
- **Team ownership is immutable:** changing a category's `team_id` after insert — both with and without existing sessions — is **denied** by the category-invariant trigger. This prevents moving a referenced category to another team without touching the session rows.
- **Archive + restore:** setting `is_active = false` removes the category from the active picker and moves it to the management screen's Archived section while a pre-existing session still resolves its label. Restoring the same row (`is_active = true`) returns it to the picker with the same `id`, label, `created_by`, and `sort_order`; no replacement row is inserted.
- **Default is protected (invariant trigger + policy):** a `delete` of the `is_default` "General" row → **denied** (both the `is_default = false` delete policy and the trigger's delete guard); setting **`is_active = false` on the default** (archive) → **denied**; changing its **`label` or `sort_order`** → **denied**; setting **`is_default = false`** (demote) → **denied**; setting **`is_default = true` on a second row** → **denied** (partial unique index). After each denied attempt, assert the team still has exactly one active default named "General" at position 0. A `delete` of a **non-default** category that **has sessions** → blocked by the FK (RESTRICT), whereas **archiving** it instead → allowed; a `delete` of a non-default category with **no** sessions → allowed (though the UI archives rather than deletes).

### 2c. Category server action — `tests/unit/training-category-actions.test.ts` (new)

- **Ordering is deterministic and server-assigned:** "General" remains at 0; two custom additions append in increasing increments of 10; a suggestion batch preserves map order; archived rows retain their position; restoring a row returns it to that position. Force two rows to the same `sort_order` and assert the query's `created_at, id` tie-break gives a stable result.
- **Suggestion seeding is idempotent via prefetch-filter (not `onConflict`):** applying a sport's suggested set, then applying it **again**, leaves each label present exactly once — the second pass filters out already-present labels (case-insensitively) and inserts nothing. A suggested label that matches an **archived** category is **skipped, not silently resurrected**; the result identifies it as archived so the user can restore it explicitly. Assert that a direct batch insert including a duplicate label raises the unique-violation (proving the index is the real guard) and that a residual concurrent duplicate is caught, refetched, and treated as success rather than aborting.
- **Archived duplicate UX:** with an archived "Shooting" row loaded, **Add custom "shooting"** makes no insert and returns the archived-match state with a Restore action. A suggestion set containing "Shooting" reports it in the archived count. Invoking Restore reactivates the existing row, after which both flows identify it as already active.

### 3. Leaderboard RPC — `tests/rls/training-leaderboard.test.ts` (new)

- Team scope returns only that team's players, ranked correctly
- Ties: equal minutes → equal rank, next rank skips (1, 2, 2, 4)
- Opted-out player is absent from both team and club scope, but their minutes still appear in their own `training_summary`
- Zero-minute players are absent
- Club scope: a U10 parent gets U18 players' **totals** (which they cannot read via a direct table select — assert both in the same test, since that contrast is the whole point of the RPC)
- **Multi-team player, global counting without duplication:** a player currently on teams A and B logs one 90-minute session through A's category context and one 60-minute session through B. Team A scope returns **150 minutes / 2 sessions**, and team B scope also returns **150 / 2**. The unfiltered club board returns the player as **one row** with `total_minutes = 150`, `session_count = 2`, and null `team_id`/`team_name` — never 300 minutes from joining the two membership rows.
- **Club scope team filter changes the cohort, not the minutes:** filtering that club board to A or B still returns the player's global **150 minutes / 2 sessions**, with the selected filter team's `team_id`/`team_name` populated.
- **A session logged once appears across teams:** after inserting a single session through team A, both A's and B's team boards include it. No second insert is required or offered for B.
- **Cross-org membership is still global:** a player who is currently on one club-tier team in org A and one in org B logs once through A. The session appears on both team boards and once on each org's club board; neither org needs or receives a duplicate row.
- **Player who leaves one of multiple teams:** removing the player's A membership removes them from A's board, but their same global sessions remain counted on B's board and on the club board through B. The rows remain in My Training.
- **Player who leaves the club entirely:** after deleting their final current player membership in that org, they are absent from its team and club boards, but their rows still exist and are returned by a raw self-`select`.
- **Mid-period transfer A→B:** after the A membership is deleted and a B membership added, the player disappears from A's board and their **full global period total**, including sessions logged before the transfer through A, appears on B's board.
- **Archived logging-context team:** if the player remains on another active team in the org, sessions logged through the now-archived context still count in their global total on the active-team and club boards. If that archived team was their only membership in the org, they leave the active club cohort and disappear from its board; a director can still read the historical rows.
- Club scope masks names to first name + last initial; team scope does not
- Non-member of the org calling club scope → exception
- Free-tier org → exception
- **Team scope derives the org, ignores `p_org_id`:** calling team scope for a club team with `p_org_id = null` (and with a *wrong/free-tier* `p_org_id`) still succeeds — the gate resolves via `team_org_id(p_team_id)`; conversely a team scope call for a team whose *own* org is free-tier → exception regardless of any `p_org_id` passed
- **Club scope filter must belong to the org:** club scope with `p_org_id = A` and a `p_team_id` that belongs to org **B** → exception (the `team_org_id(p_team_id) = p_org_id` assertion); the same filter with a team that does belong to A → succeeds
- **Parameter validation:** an invalid `p_scope` (`'org'`, `''`, `null`) → exception; an invalid `p_period` (`'day'`, `null`) → exception; `'team'` scope with `p_team_id = null` → exception; `'club'` scope with `p_org_id = null` → exception. Assert each fails loudly rather than returning an empty result set. (Applies to both `training_leaderboard` and `training_summary`.)
- Week boundary: a **Sunday-dated** session and a session dated the **following Monday** land in **different** weeks; a session dated that Monday and one dated the Sunday six days later (same Mon–Sun span) land in the **same** week
- Bucketing is timezone-independent: two teams with different `teams.timezone` values (or one team with `timezone = null`) produce the **same** week/month bucket for the same `session_date` — no session is misfiled by a timezone difference
- **`training_summary` scope tracks the board:** for a multi-team player, `training_summary` returns the same global `total_minutes`/`session_count` in every team or club scope where they are in the cohort, while rank and denominator can differ with each cohort. Each value matches the corresponding `training_leaderboard` scope.
- **`training_summary` for an opted-out caller** still returns a non-null `rank` in both scopes even though that caller is absent from `training_leaderboard` rows
- **`denominator` excludes opted-out players:** on a team with 18 roster players where 2 have opted out, a non-opted-out member's `denominator` is **16**, not 18 — and flipping a third player's opt-out on drops it to 15. Zero-minute (but non-opted-out) players are still **counted** in the denominator. For club scope, a multi-team player counts **once**.
- **Zero-minute subject → null rank:** `training_summary` for a roster player with no sessions in the period returns `total_minutes = 0`, `session_count = 0`, and `rank = null` (the page uses this to show the empty-state CTA, not "#0 of N").
- **`training_summary` subject authorization:** caller requests their **own** summary → allowed; a **parent** requests a **managed child**'s → allowed; a caller requests a **teammate/another org member's** `p_profile_id` (even one on a team the caller can see) → **exception**, not another player's numbers
- **Opt-out leak guard:** a member **cannot** obtain an opted-out player's `rank`/`total_minutes` by passing that player's `p_profile_id` to `training_summary` — the subject check denies it before the ranking runs (assert this specifically, since it's the standing opt-out is meant to hide)

### 4. Unit — `tests/unit/training.test.ts` (new)

- `has_club_access` (SQL) and `hasClubAccess` (TS) agree across every `(plan, subscription_status)` pair — the drift guard
- **Sport suggestions map:** `SPORT_CATEGORY_SUGGESTIONS` in `src/lib/training.ts` is keyed only by valid `Sport` values (every key is in the `teams.sport` CHECK set), every list is non-empty, and within each sport the labels are unique case-insensitively and ≤ 40 chars after trim (so the one-click seed can't produce a dupe or a label the DB CHECK would reject). There is **no** category ↔ CHECK parity test anymore — the enum and its CHECK are gone; categories are runtime data with no static mirror to drift against
- Period label formatting ("Jul 7 – Jul 13", "July 2026") and anchor stepping across a month/year boundary

### 5. E2E — `tests/e2e/training.spec.ts` (new)

- Club player: log a session → appears in My Training → appears on the leaderboard
- Free-tier user: no Training nav item; direct navigation to `/dashboard/training` redirects to the plan tab
- Parent with two children: switch active profile, log for each, verify attribution
- **Multi-team global session:** a player on teams A and B logs one session while using A's category list; the same minutes appear on both team leaderboards and once on the club leaderboard, while My Training contains only one row.
- **Coach manages categories:** open Manage categories → add a custom category → it appears in the log dialog's picker → a player logs a session with it → the session shows that category in My Training and the coach's Team view. Then the coach **archives** it → it disappears from the picker and appears under Archived while the already-logged session retains its label → restore it and verify the same category returns to the picker in its prior position. "General" has neither rename nor remove controls.
- **A plain player has no manage affordance** — the "Manage categories" control is absent from their Team/Training view (the tab itself is admin-only), and they can only *pick* a category when logging.

---

## Open Questions

1. **Weekly recap notification.** Deferred from v1, but a leaderboard with no Monday nudge tends to decay after two weeks. The cheapest version — a Monday cron alongside `/api/cron/reminders`, plus `training_digest_enabled` on `notification_preferences` (same pattern as `chat_digest_enabled`) — is likely worth doing before launch rather than after. Flagging for a call.
2. **Category list.** ~~The nine above are soccer-shaped…~~ **Resolved — team-managed categories.** The hardcoded soccer enum is replaced by a per-team `training_categories` table: one seeded "General" default plus custom types each team's coach/manager/director manages, with optional one-click sport suggestions (see [Training Categories](#training_categories) and the Key Decisions rows). Done *before* launch precisely because it's "cheap now, annoying once there is data" — and since the training migration is unshipped, there is no data to backfill beyond one default row per existing team.
3. **Multi-team players.** ~~Open.~~ **Resolved — sessions are global to the player.** A player logs an individual-training session once, using one team only as the category/timezone context, and that same row contributes to every current team and club cohort they belong to. Team and club RPCs build a distinct player cohort first and then sum sessions by `profile_id`, so a multi-team player receives the full total on each team board but appears once — with each session counted once — on an unfiltered club board. Leaving a team removes the player from that cohort; joining or transferring to another team makes their sessions in the viewed period count there. The team selector in the log dialog therefore changes category vocabulary, never leaderboard credit.
4. **Duration vs. quality.** Ranking purely on minutes rewards the kid who juggles for two hours over the kid who does a focused 30-minute finishing session. Nothing in v1 fixes that; curated drills with an expected duration are the real answer, which is an argument for pulling Phase 2 forward.
5. **Should coaches log team-designated homework?** Not "a curated drill library", just "coach assigns 20 min of ball mastery before Thursday". It's a smaller feature than the drill library and probably the higher-value half of it.
6. **Validate `teams.timezone` at the source?** This feature defends against a bad value with `safe_team_tz` (fall back to UTC), which is the right *local* fix. The more thorough fix — a CHECK constraint validating `teams.timezone` against `pg_timezone_names` plus a one-time backfill of any existing junk — belongs to the team-settings surface, not here, because it touches existing data and the settings UI. Worth a separate ticket so other timezone-dependent features (scheduling, reminders) don't each re-implement the same defense.
7. **Backfill `search_path` on the pre-existing security-definer functions.** This feature pins `set search_path = ''` on its own functions (see [Security-definer hygiene](#security-definer-hygiene)), but the ~30 definer functions already in the repo (`is_team_member`, `is_team_admin`, `is_org_admin`, `team_org_id`, `is_managed_by_me`, …) do not, which is a latent privilege-escalation surface across the whole schema. Out of scope for training tracking, but should be its own hardening PR that adds `set search_path = ''` + schema-qualification to all of them at once, with the RLS test suite as the regression net.
