# Team Notification Controls

**Status:** Draft. Decisions D1–D13 settled (§5). Reminder timing is deferred (D7).
**Scope:** web app (database, notification server, settings and event UI), then the mobile app.

Two features that share one place in the code, where recipients are resolved:

1. **Team mute (members):** anyone can stop notifications from one team without turning off every team.
2. **Reminder controls (coaches):** a coach decides which of the team's events get reminders, by event
   type or one event at a time. Choosing *when* they go out is deferred (§4.4, D7).

## 1. What happens today

- **Preferences are per account only.** `notification_preferences` has one row per profile: `email_enabled`,
  `push_enabled`, `chat_push_enabled`, `chat_digest_enabled`. None of them is scoped to a team. On the web,
  Settings has one "Email notifications" switch (`components/settings/notification-prefs-form.tsx`); mobile
  has the same switches in `app/(app)/settings/notifications.tsx`.
- **One resolver decides who gets what.** `resolveRecipients` (`lib/notifications/recipients.ts`) expands
  managed players to their guardians and reads each adult's own preferences. Both senders use it:
  - **Schedule changes:** `lib/notifications/worker.ts` drains `notification_jobs`. `planDeliveries` records
    each skipped delivery in `notification_deliveries` with a reason (`opted_out`, `no_address`,
    `no_subscription`).
  - **Reminders:** `api/cron/reminders` runs **once a day at 12:00 UTC** (`apps/web/vercel.json`) and
    reminds every team about every non-cancelled event starting in the next 24 hours, by email and push.
    Reminders don't write delivery records, and nothing records that a reminder was sent.
- **The schedule is fixed.** An event gets its one reminder somewhere between 0 and 24 hours before it
  starts, depending on its start time compared with 12:00 UTC. A 7:00 pm Pacific practice (02:00 UTC) is
  reminded about 14 hours ahead, and an 8:00 am Eastern game (12:00 UTC) about 24 hours ahead. Coaches have
  no setting for this. The cron's comment says the current Vercel plan allows **one run per day per cron
  job**, which limits any timing control (D7).
- **Event types:** `practice`, `game`, `other`, `tournament`. A tournament's games are `game` rows with a
  `tournament_id`, and each one is reminded about separately, as well as the tournament itself.
- **Emails have no unsubscribe link.** The footer of event, series and tournament emails says
  "You can manage your notification preferences in your account settings."

## 2. Goals

1. **A member can mute one team.** Notifications from that team stop. Their other teams, and their account
   settings, stay the same.
2. **A coach can choose whether a team sends reminders** at all, and **for which event types**.
3. **A coach can turn the reminder on or off for one event,** overriding the type rule.
4. **Existing teams keep working.** Teams nobody configures still get reminders for every event, exactly
   as they do today.

**Not in scope:**
- choosing when reminders are sent (deferred: it needs a scheduler that runs more often than daily; §4.4)
- the chat digest (still unbuilt; see `docs/roadmap.md`)
- more than one reminder per event
- per-member reminder timing (a member can mute a team, not move its reminders)
- one-click unsubscribe links that work without signing in (D11)
- org or club-wide reminder defaults

## 3. Member: team mute

### 3.1 Behavior

- In notification settings, each of the member's teams is listed with a switch: **"Notifications from
  [Team]"**. Turning it off mutes the team.
- **The account settings come first.** If email is off for the account, no team's email is sent, whatever
  that team's switch says. A team mute can only turn things off.
- **One switch per team (D1).** It mutes email and push together. The table stores them separately so
  they can be split later with a UI change only.
- **Who sees a team:** every team the adult gets notices for. That includes a team they're only on through a
  managed player (a guardian with no roster row). The list is the same set the resolver would reach them
  through.
- **A guardian mutes for themselves, not for the child.** A mute belongs to the adult who receives the
  notices. A second guardian of the same player keeps getting them.
- **Coaches and managers can mute their own team** like anyone else. The settings show a note that they
  won't see reminders their members get.
- **What a mute covers (D2):** every event notice from that team (new, updated, cancelled, series changes,
  reminders) on email and push, and the team's chat push, direct messages within the team included. Cancellations are muted like other schedule
  notices.
- **What a mute never covers (D3):** team deletion, ownership transfer and billing notices. Those go out
  whatever the mute says.

### 3.2 Data

New table, one row per muted (adult, team) pair:

```sql
create table team_notification_mutes (
  profile_id uuid not null references profiles(id) on delete cascade,
  team_id    uuid not null references teams(id) on delete cascade,
  -- D1: per channel here, one switch in the UI (it sets both)
  email_muted boolean not null default true,
  push_muted  boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (profile_id, team_id)
);
```

- **No row means not muted.** Nothing needs backfilling, and the resolver needs one extra query, keyed on
  the team.
- **RLS:** an adult can select, insert, update and delete their own rows (`profile_id = auth.uid()`). They
  can only insert a row for a team they reach: they're a member, or they manage a member. The team's
  coaches and managers (`is_team_admin`) can read, but not change, the team's rows (D4).
- **No managed-profile rows.** A managed player has no inbox, so the policy refuses a row for a profile with
  no `auth_user_id`.

### 3.3 Delivery

- `resolveRecipients` gains the team mute when it's called with `teamId`. It already loads preferences for
  every adult in one query, so it loads mutes for `(adultIds, teamId)` the same way.
  `emailEnabled` and `pushEnabled` become `account setting && !team mute`.
- `ResolvedRecipient` gets `mutedByTeam: { email, push }`, the channels the mute turned off where the account would have sent them, so `planDeliveries` can record the skip as
  **`team_muted`** rather than `opted_out`. That way the delivery log says why someone wasn't reached.
- **Mutes aren't private from the team's coaches (D4).** Team admins can already read
  `notification_deliveries`, profile and reason included. So a coach can tell who has muted the team, from
  the log or from the mute table. The event page keeps showing only counts ("2 skipped"). This spec adds
  no screen that lists mutes.
- **Chat:** the worker calls the resolver with `profileIds`, not `teamId`. A chat job already carries
  `team_id`, so it passes that as a new `muteScopeTeamId` option.

### 3.4 UI

- **Web:** Settings → Notifications gets a "Teams" section under the account switches, with one switch per
  team (D1).
- **Email footer:** "You're getting this because you're on [Team]. **Mute [Team]** or manage your
  notification settings." Both links go to Settings, signed in, with the team highlighted (D11).
- **Mobile:** the same section in `settings/notifications.tsx`, in the mobile PR (§7).

## 4. Coach: reminder controls

### 4.1 Behavior

Each team has **reminder settings**, editable by its coaches and managers (`is_team_admin`; club directors
can't, D5):

| Setting | Values | Default for existing and new teams |
| --- | --- | --- |
| Send reminders | on / off | on |
| Event types | practice, game, other, tournament: each on or off | all on |

And on each event:

| Setting | Values | Default |
| --- | --- | --- |
| Reminder | Team default / Always send / Don't send | Team default |

**How the reminder decision resolves for one event:**

1. Cancelled events get no reminder (as today).
2. If the event says **Always send** or **Don't send**, that wins, even if the team's switch is off (D9).
   A coach can turn reminders off for the team and still send one for the playoff game.
3. Otherwise, the team switch **and** the event's type must both be on.
4. A tournament game (`game` with a `tournament_id`) follows the **game** rule (D12). The tournament event
   itself follows the **tournament** rule. A coach who wants only the tournament reminder turns off games,
   or turns off the reminder on each game.

**Recurring events:** setting the reminder on a series applies to every occurrence. Editing a single
occurrence overrides it for that occurrence only. This uses the "this event / all events" choice the event
form already has for other fields.

**Who is reminded doesn't change.** These settings decide whether a reminder goes out. The team's members,
and their own account and team-mute settings, still decide who gets it.

**Channels:** the controls apply to the reminder on **email and push** alike (D2). Schedule-change notices
(new, updated, cancelled) aren't reminders: these settings don't affect them.

**Changing reminder settings never notifies anyone (D13).** A reminder setting is about lista's
behavior, not the schedule, so it is never a change the team is told about:

- **One event.** The change trigger (`enqueue_event_notification_from_change`) only fires on start, end,
  zone, arrival and location changes, and `events.reminder` stays off that list. The event page's **"Notify
  the team"** switch is hidden when the only change is the reminder, and the save ignores it. If the
  reminder changes along with other fields, the switch works as it does today, and the notice doesn't
  mention the reminder.
- **A series.** Today `apply_series_edit` enqueues one "updated" notice whenever the plan touches an
  upcoming occurrence. It's changed to enqueue only when the plan has an insert, a cancellation, or an
  update to a field other than `reminder`. The series summary (`seriesEditSummary`, `plan.summary`) never
  lists the reminder, so a mixed edit's notice lists only the other changes.
- **Team settings.** Saving `team_reminder_settings` writes no event rows, so it notifies nobody.

**Coach-facing copy:** the settings say when reminders go out, so nobody expects a time setting: "Reminders
are sent once a day, for events in the next 24 hours."

### 4.2 Data

```sql
create table team_reminder_settings (
  team_id uuid primary key references teams(id) on delete cascade,
  enabled boolean not null default true,
  remind_practice   boolean not null default true,
  remind_game       boolean not null default true,
  remind_other      boolean not null default true,
  remind_tournament boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

alter table events add column reminder text
  check (reminder in ('always', 'never'));  -- null = team default
```

- **No row means the defaults.** Existing teams need no backfill, and the cron treats a missing row as the
  default row.
- **RLS:** team members can read their team's row (so the event form can say what the team default is).
  Only `is_team_admin(team_id)` can insert or update it.
- **`events.reminder`** is covered by the existing event policies: anyone who can edit the event can set it.
- **Series edits:** `apply_series_edit` copies `reminder` onto inserted occurrences and applies it in the
  plan's `updates`, like the other fields. Its notice condition changes as D13 describes.
- **Columns, not an array, for the types.** There are four types and the check constraint lists them. A new
  type gets a new column and a migration, the same as the constraint does.

### 4.3 Sending

The daily job (`api/cron/reminders`, 12:00 UTC) stays as it is, with one new filter step:

1. Read non-cancelled events starting in the next 24 hours, as today, joined with their team's
   `team_reminder_settings`.
2. Drop each event `shouldRemind(event, settings)` rejects (§4.1).
3. Send the rest to the resolved recipients. Team mutes (§3.3) are applied by the resolver.

**Moved events (D8):** each event falls into one daily window, so an unmoved event is reminded once. An
event moved to a later window after its reminder is reminded again, with the right time. That's what D8
asks for, and the daily job already does it. No send record is needed.

**Reminders go through the delivery log.** The send moves onto `planDeliveries`, so skipped reminders get a
reason (`opted_out`, `team_muted`) in `notification_deliveries` like schedule changes do.

### 4.4 Deferred: reminder timing (D6, D7, D10)

Letting a coach choose *when* reminders go out ("evening before at 6 pm", "2 hours before") needs the job
to run every 15 minutes or so. Vercel's plan allows one run a day, and there's no plan to change the
scheduler for now (D7, option C). Until then:

- Every team's reminder goes out at 12:00 UTC, for events in the next 24 hours, as today.
- D6 (timing presets) doesn't apply. D10 (keep today's timing for existing teams) holds by default.

When this is picked up, the design notes are:

- **Scheduler options:** Vercel Pro cron (`*/15 * * * *`), or Supabase `pg_cron` + `pg_net` calling the
  route with `CRON_SECRET`.
- **Settings:** a `timing` preset on `team_reminder_settings` (2 hours before, morning of, evening before,
  24 hours before, 2 days before), in the team's time zone. The time is counted back from `arrival_time`
  when the event has one. Existing teams default to "24 hours before" (D10).
- **Due times are computed in the job,** not stored on events, so a coach changing the team's timing
  doesn't rewrite every future event.
- **A send record is needed then:** `event_reminder_sends (event_id, start_time)`, claimed with
  `insert … on conflict do nothing` before sending, so overlapping 15-minute runs can't double-send. Keying
  on `start_time` keeps D8.
- **Late events:** an event created or moved after its due time, and not yet started, is reminded on the
  next run.

## 5. Decisions

Settled 2026-10-20; D4 revised and D13 added 2026-10-22.

| # | Question | Decision |
| --- | --- | --- |
| D1 | Is a team mute one switch, or email and push separately? | One switch in the UI. The table stores email and push separately, so splitting them later is UI only. |
| D2 | Does a team mute, or a coach's reminder setting, cover push as well as email? | Both. |
| D3 | Which notices ignore a team mute? | Team deletion, ownership and billing notices only. Cancellations are muted like other schedule notices. |
| D4 | Can a coach see who has muted the team? | Yes (revised 2026-10-22). The delivery log already shows team admins each skip's profile and reason, so the mute table is readable by them too. No new screen lists mutes. |
| D5 | Can club directors edit a club team's reminder settings? | No: coaches and managers only, same as editing events. |
| D6 | Timing presets | Doesn't apply while timing is deferred (§4.4). |
| D7 | Scheduler | C: keep the daily job. No coach-chosen timing for now. |
| D8 | Is a moved event reminded again? | Yes, if its start moved into a later window. |
| D9 | Does "Always send" on an event override the team's switch being off? | Yes. |
| D10 | Default timing for existing teams | Today's timing. Under C that's automatic; when timing ships, "24 hours before". |
| D11 | A no-sign-in "Mute this team" link in emails | A settings link now. A signed one-click link (and a `List-Unsubscribe` header) is a separate change. |
| D12 | Do tournament games get their own type switch? | No: they follow the game rule. |
| D13 | Does changing a reminder setting notify the team? | No, never: one event, a series, or the team's settings (§4.1). Added 2026-10-22. |

## 6. Test plan

All tests are written before the code, per `CLAUDE.md`.

**RLS (`tests/rls/team-notification-mutes.test.ts`, `team-reminder-settings.test.ts`, new):**
- A member can create, read, update and delete their own mute, and can't see or change anyone else's.
- A guardian can mute a team they reach only through a managed player. A non-member can't mute a team.
- No mute row can be created for a managed profile.
- The team's coaches and managers can read its mutes but can't change them. A parent, player, or another
  team's coach can't read them (D4).
- Members can read their team's reminder settings. Only coaches and managers can write them. A parent,
  player or club director gets `permission denied` (D5). Another team's coach can't read or write them.
- `events.reminder` can be set by whoever can edit the event, and no one else.

**Resolver (`tests/notification-recipients` unit and RLS):**
- A muted team gives `emailEnabled: false`, `pushEnabled: false`, `mutedByTeam: { email: true, push: true }`. A different team for
  the same adult is unaffected.
- A mute can't turn email on when the account has it off.
- A guardian muting a team doesn't affect the other guardian.
- Chat jobs respect the mute through `muteScopeTeamId`.
- `planDeliveries` records `team_muted`.
- Team deletion notices still reach someone who muted the team (D3).

**Reminder decision (pure function, `shouldRemind(event, settings)`):**
- Each type rule, the team switch, and both event overrides, including "Always send" with the team off (D9).
- A tournament game follows the game rule (D12). The tournament follows the tournament rule.
- A missing settings row behaves like the defaults.
- A cancelled event is never reminded, even with "Always send".

**Reminder job (`tests/reminders-cron.test.ts`):**
- Events the rules reject are not sent. The rest are, as today.
- Muted and opted-out recipients are logged as skipped, with the reason.

**Silent reminder edits (D13):**
- Changing only `events.reminder` enqueues no `notification_jobs` row (trigger test, RLS suite).
- On the event page, a reminder-only change hides "Notify the team", and saving enqueues nothing even if the
  switch was on before. A reminder change with a title change still notifies when the switch is on, and the
  notice doesn't mention the reminder.
- `apply_series_edit` with a reminder-only plan enqueues nothing. A plan that also changes another field,
  inserts or cancels enqueues one notice, and its summary has no reminder row.
- Saving team reminder settings enqueues nothing.

**UI:** the settings switches and the event form's reminder field save and load. A non-admin sees the
team's reminder settings read-only.

## 7. Delivery plan

Separate PRs, in order:

1. **Team mute, web:** the table and RLS, the resolver and `planDeliveries`, the Settings section, the email
   footer.
2. **Reminder rules, web:** the settings table, `events.reminder`, `shouldRemind` in the daily job,
   reminders through the delivery log, the team settings and event form UI
   (`components/settings/team-settings-form.tsx`, `components/calendar/event-form-dialog.tsx`).
3. **Mobile:** the team mutes in `settings/notifications.tsx`, reminder settings in `settings/team.tsx`, the
   reminder field on the event screen. This waits until mobile 1.1.0 is tagged.

Reminder timing (§4.4) is a later spec revision, when the scheduler changes.
