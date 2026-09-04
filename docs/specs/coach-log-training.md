# Coach-logged training sessions

**Status:** Draft (pending review)
**Depends on:** [Individual Training Tracking & Leaderboard](./individual-training-tracking.md) — reuses its
`training_sessions` / `training_categories` tables, RLS policies, validation trigger, and helper functions.

## 1. Problem & goal

On the Training page, the Leaderboard empty-state CTA (`leaderboard-tab.tsx`) shows **"Log a session →"**
whenever the viewer has zero minutes in the period — including coaches, who are not roster players. Following
it routes to **My Training**, where `canLog` is false and the page shows the dead-end message *"Only roster
players can log training. Switch to a player profile to log sessions."*

**Goal:** let a team's coaches/managers (and org directors/owners) **log, edit, and delete training sessions on
behalf of any roster player** on a team they administer, and remove the misleading dead-end. This is especially
important for **managed (no-auth) players**, who cannot self-log at all — coach logging is their only path to a
training record.

## 2. Decisions (agreed)

| Decision | Choice |
| --- | --- |
| Entry points | **Both** the coach-only Team tab and the Leaderboard CTA |
| Coach rights | **Create, edit & delete**, without the 7-day window that binds players |
| Attribution | **None surfaced** — coach-logged sessions render identically to self-logged |
| Batch | **Single player per entry** for v1 (bulk is a follow-up) |

## 3. Authorization (DB) — one migration

The existing model already does the hard parts: the validation trigger stamps `created_by` from the caller
(unforgeable) and validates roster membership, team, category, archival, future dates, and the daily cap. The
DELETE policy already permits team/org admins. Only INSERT/UPDATE and one trigger rule need to change.

Migration: `supabase/migrations/20260904000000_coach_log_training_sessions.sql`.

### 3a. INSERT policy

Add an admin branch to the subject-eligibility clause, tied to the **logging-context team** (`team_id`):

```sql
create policy "training_sessions_insert" on public.training_sessions
  for insert with check (
    (
      profile_id = auth.uid()
      or public.is_managed_by_me(profile_id)
      or public.is_team_admin(team_id)                      -- NEW: coach/manager of the context team
      or public.is_org_admin(public.team_org_id(team_id))   -- NEW: director/owner of the context org
    )
    and public.is_team_player(team_id, profile_id)          -- subject is still a roster player
    and not public.is_team_archived(team_id)
    and public.has_club_access(public.team_org_id(team_id))
  );
```

Tying the admin check to `team_id` (not "any team the player belongs to") keeps it tight: a coach may log only
in the context of a team they actually administer, never for a shared player through a team they don't.

### 3b. UPDATE policy

Mirror the same admin addition in **both** the `using` and `with check` clauses of `training_sessions_update`.

Note this keys coach *edit* to the session's **logging-context `team_id`**, which is narrower than *delete*
(§3c, tied to the player across any of their teams). That asymmetry is intentional — editing changes content
within a specific team's category vocabulary and timezone, so it should require controlling that team, whereas
delete is a blunt moderation removal. The UI honors this in §5b (Edit is shown only for this-team rows).

### 3c. DELETE policy

No change — `is_training_admin_for_profile(profile_id)` / `is_org_admin(...)` already grant admins delete with
no date bound.

### 3d. Validation trigger

To honor "no 7-day window for coaches" (mirroring the admin delete-anytime moderation model), extend
`training_sessions_validate()`:

- Compute `v_is_admin := public.is_team_admin(new.team_id) or public.is_org_admin(public.team_org_id(new.team_id))`.
- **Skip the backdate rule (rule 4, `session_date < today - 7`) when `v_is_admin`.**
- **Keep for everyone:** no future dates (rule 3), the 360-minute/day cap (rule 5), roster membership,
  archived-team, and category-belongs-to-team checks.

So a coach may backfill an older session but can never create impossible data (future date, over-cap,
wrong-team category, non-roster subject). `created_by` remains immutable on update (it is the original author,
not an edit-audit field — see §4). The coach dialog relaxes its client-side date floor to match this (§5a).

## 4. Data model / attribution

**No attribution is surfaced, and v1 tracks original authorship only — there is no edit audit.**

- `created_by` records the **original author** and is immutable (the trigger forces `new.created_by :=
  old.created_by` on update). So it is the coach on a **coach-created** row, and remains the **player** on a
  player-created row a coach later edits. It answers "who first entered this row," not "who last changed it."
- There is **no `updated_by`** column and no edit-history log. `updated_at` advances on every edit, so we know
  *when* a row was last touched but not *by whom*. A coach editing a player-created session (or a player editing
  a coach-created one) therefore leaves **no attribution trail** in v1. This is an accepted v1 limitation, not an
  oversight; an `updated_by` / edit-audit trail is a follow-up (§8).
- Nothing about authorship is shown in the UI regardless — coach-logged sessions render identically to
  self-logged ones on every surface.

A direct consequence of the "indistinguishable rows" choice: a player can still edit or delete a coach-logged
session **within their own 7-day window** (their `profile_id` matches the self/managed branch) — consistent with
"it is simply the player's session."

## 5. UI

### 5a. `LogSessionDialog` — coach mode

Extend the existing dialog rather than forking it, so category-loading, validation, and error logic stay
single-sourced. Coach mode's one behavioral difference from the self-log flow is the date floor (see below).
New optional props:

- `players?: RosterPlayer[]` — the context team's roster players (including managed, no-auth players).
- `playerId?: string` — preselected subject.

When `players` is provided:

- Render a **required Player select** at the top of the form.
- `profile_id` = the selected player (not the coach). Team is fixed to the coach's active team (its timezone
  bounds the date; its active categories populate the picker) — **no team selector** in coach mode.
- Title: **"Log for a player"**. Error copy is phrased for the subject, e.g. *"That would put Ava over the
  360-minute daily limit."*
- **Date bounds — the one intentional divergence.** The self-log dialog hard-codes a `min` of 7 days ago
  (`BACKDATE_WINDOW_DAYS`) and clamps the selected date into `[minDate, today]`. Coach mode **removes the lower
  floor** — admins may backdate beyond the window (§3d) — while **keeping `max = today`** in the team's
  timezone, because future dates are still rejected for everyone (trigger rule 3). Concretely: gate `minDate`
  (and the date `<input min>`) on `!coachMode`, and make the clamp effect enforce only the upper bound (`d >
  today ? today : d`) in coach mode. A far-past floor isn't required, but if we want a sane guard the season/
  team-creation date is a reasonable one — deferred; v1 simply drops the floor.
- Duration quick-picks, category, and notes are unchanged.

### 5b. Team tab (coach-only) — primary home

- A top-level **"Log for player"** button that opens the dialog with an empty player selection.
- A per-roster-row **"Log"** action that opens the dialog with that player preselected.
- In the expanded per-player session list, add an **Edit** control **only on sessions logged through this team**
  (`session.team_id === activeTeam.id`); **Delete** remains on every visible row.

  This asymmetry is deliberate. The Team tab shows a player's **global** sessions (all teams — matching the
  leaderboard's global totals), but the DB ties coach *edit* to the logging-context `team_id` (§3b), while
  *delete* is a broad moderation lever tied to the player, not a team (§3c). Editing a session logged through
  another team would also require that team's category vocabulary and timezone, which the coach may not be able
  to read. So:
  - **Edit** ⟺ the row's context team is the team you're viewing (which, to be on this coach tab, you
    administer). The dialog's category picker and date window then use that team — exactly what the UPDATE
    policy and trigger expect, so the control never offers an edit the DB would reject.
  - **Delete** stays broad — a coach/admin of *any* of the player's current teams may remove a suspicious global
    entry (no team-context or date bound), which the existing DELETE policy already allows.
  - Contextless rows (`team_id` null, after a context team was hard-deleted) are therefore **Delete-only**.

  The `team_id === activeTeam.id` rule is intentionally conservative: it may hide Edit on a same-org team's
  session that an org director could technically update, but it keeps the client from ever surfacing an edit
  that would fail, without the Team tab needing to know the full set of teams the viewer administers.

### 5c. Leaderboard CTA — second entry point

Make the CTA viewer-aware (`LeaderboardTab` already receives `isTeamAdmin`):

- **Eligible player** → unchanged **"Log a session →"** (self-log, routes to My Training).
- **Team admin who is not a player** → **"Log for a player →"**, opening the coach dialog; suppress the
  personal "you haven't logged this week" nudge (it does not apply to a coach).
- **Neither** → no CTA.

### 5d. My Training tab

Replace the dead-end copy for non-players with a pointer instead of a "switch profiles" instruction:
*"Coaches log training for players from the **Team** tab."*

## 6. Edge cases

- **Managed (no-auth) players** — fully supported; coach logging is their only data path.
- **Daily cap** — sums across all of a player's sessions that day (any team, any author); a coach entry that
  would exceed 360 minutes is rejected with a clear message.
- **Multi-team coach** — logs in the active team's context; switching the active team logs for another team.
- **Global sessions on the Team tab** — a coach sees a player's sessions from all the player's teams. Foreign-
  context and contextless rows are **Delete-only**; **Edit** is limited to this-team rows (§5b), matching the
  DB's narrower update scope (§3b).
- **Backdating** — admins are exempt from the 7-day floor (§3d), so a coach can catch up an older session; the
  leaderboard's historical periods reflect it, as intended for moderation.

## 7. Testing plan (test-driven)

### RLS — `tests/rls/training-sessions.test.ts` (extend)

- Coach **inserts** a session for a player on a team they admin; `created_by` is stamped as the coach.
- Coach **updates** an editable (this-team) session; the change is accepted and `created_by` is **unchanged**
  (a coach editing a player-created row leaves `created_by` = the player, per §4).
- Coach is **denied** for: a player on a team they do **not** admin; a non-player subject (e.g. another coach)
  on their team.
- **Edit-vs-delete scope for global sessions**: a coach may **delete** a session logged through a *different*
  team the player also belongs to (moderation), but may **not update** that same session unless they also admin
  its context team — even for a player on their own roster.
- Regression: a plain **player**/**parent** still cannot write for another player.
- **Director/owner** of the org may insert/update for a team's player.
- **Window exemption**: an admin may backdate beyond 7 days; **future** dates and the **daily cap** are still
  rejected for admins.
- Coach **logs for a managed** roster player.
- A **player still edits/deletes** a coach-logged session within their own 7-day window.

### Component

- `LogSessionDialog` coach mode: player selector present and required; insert uses the selected `profile_id`;
  no team selector; the date input has **no `min` floor** while `max === today`, and a date older than 7 days is
  accepted (whereas the self-log dialog still enforces the 7-day floor).
- Team tab: top-level and per-row entry points open the dialog with the correct preselection. In the expanded
  session list, **Edit** appears only on rows whose `team_id === activeTeam.id`; **Delete** appears on every
  row (including foreign-context and `team_id`-null rows).
- Leaderboard CTA: correct affordance per viewer (player vs coach vs neither).
- My Training: updated copy for coaches.

### Unit

- Coach-context error mapping (cap / future / archived / non-roster) phrased for the subject.

## 8. Out of scope (follow-ups)

- **Bulk / multi-player** logging (one form applied to several players — e.g. a whole-team practice).
- **Edit audit** — an `updated_by` column (and/or an edit-history log) to record *who* last changed a row, not
  just when. v1 keeps only the immutable original `created_by` (§4).
- **Visible coach attribution** (surfacing `created_by` on the player's and team views).
- **Cross-team logging** from a single dialog.
