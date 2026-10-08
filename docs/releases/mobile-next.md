# Mobile release notes — next build

**Status:** unreleased. Everything below is merged to `main` and live on the web, but **only reaches phones
when a new build ships**.
**Current shipped version:** 1.0.12 (tag `ios-v1.0.12`, 2026-04-14; on the App Store).
**Next version:** 1.1.0, set in `apps/mobile/app.json`. Checkpoint builds for testing run from the Actions tab
("iOS TestFlight", Run workflow), which builds `main` at this version. The release is the `ios-v1.1.0` tag.
Build numbers increment remotely, so any number of 1.1.0 builds can reach TestFlight before 1.1.0 is released.
**Decision, 2026-09-18 (user):** hold the build until the open bug list is worked through, and ship these
together.

The point of this file is that "waiting on a build" is easy to forget. Each entry says what is broken on the
**installed** build, so the cost of waiting stays visible.

---

## Until this build ships

**Accept invitations on the web, not in the app.** It is the one deferred fix whose absence creates data
someone then has to repair: the installed build enrols the signed-in parent *as the player*. Chat and
notification gaps are annoyances; a wrong identity is a merge.

**Schema changes must tolerate the installed build.** This bit us once already —
[BUG-023](../bugs/023-device-token-stuck-on-previous-account.md) below — when a unique index written for the
new app broke registration on the old one.

---

## What is in the build

### Invitation acceptance asks who you are — [BUG-011](../bugs/fixed/011-identity-differs-web-vs-mobile.md)

**Installed build:** sends `self` for every invitation that is not a "manage an existing player" invite. A
parent accepting their child's player invitation is enrolled **as the player**, and the invitation's
birthday and gender land on the parent's profile.

**New build:** the screen asks *"Are you {player}?"*, the same question the web screen asks. A guardian picks
their relationship, and — when they already manage children — picks the child this invitation is for, so a
second team joins the existing child instead of creating a second record. An unanswered question is an
error rather than a guess.

Files: `app/invite/[id].tsx`, `lib/invite-accept.ts`, `__tests__/invite-accept.test.ts`.

### Messages sent from the phone notify people — [BUG-007](../bugs/fixed/007-push-delivery-cannot-reach-audience.md) gap 1

**Installed build:** inserts the message and stops. A message typed on a phone reaches nobody's lock screen;
the web client has always made this call.

**New build:** both chat screens post to `/api/chat/notify` with a bearer token after the message is saved.
Best effort by design — a failed call costs a notification, not the message.

Files: `app/(app)/chat/[channelId].tsx`, `app/(app)/chat/dm/[dmId].tsx`, `lib/chat-notify.ts`.

### A second device no longer silences the first — [BUG-007](../bugs/fixed/007-push-delivery-cannot-reach-audience.md) gap 4

**Installed build:** registration deletes every other Expo token the person has, then inserts. Installing on
a tablet silently stops delivery to the phone.

**New build:** registration upserts on the token itself, so every device keeps working, a reinstall refreshes
the row, and a handset moves to whoever signs in on it.

Files: `lib/notifications.ts`.

### Signing out detaches the handset — [BUG-023](../bugs/023-device-token-stuck-on-previous-account.md)

**Installed build:** the token row stays bound to the account that registered it. The handset keeps receiving
that account's notifications, and whoever signs in next sees them. Re-registering under the new account
fails silently, because the insert collides with the unique index the server now has.

**New build:** sign-out deletes this device's row by token, leaving the person's other devices alone, and both
registration and unregistration report a refused write instead of swallowing it.

Files: `lib/notifications.ts`, `app/(app)/settings/index.tsx`.

### Event times in the event's own zone — [BUG-010](../bugs/fixed/010-event-time-and-recurrence-boundaries.md)

**Installed build:** home, schedule and event screens format every time in the **phone's** zone, with no
label. A parent in another zone from the team, or travelling, sees the wrong clock time for practice. The
event screen's "Arrive by" line passes the arrival offset (a number of minutes) to a date formatter, so it
never shows a real time.

**New build:** times are shown in the event's own zone (else the team's), labeled — "4:00 PM MDT". "Arrive
by" is the start less the offset. The screens now select `events.timezone` and `teams(timezone)`; the
installed build never asks for either, so the new column cannot break it.

Files: `lib/event-time.ts`, `app/(app)/index.tsx`, `app/(app)/schedule/index.tsx`,
`app/(app)/schedule/[eventId].tsx`, `__tests__/event-time.test.ts`.

### A club owner deleting their account is told about the club — [BUG-028](../bugs/fixed/028-mobile-delete-account-club-owner.md)

**Installed build:** a club owner is told they own *teams* and offered Team Settings, which can't help.

**New build:** the message names the club and links to that club's settings on the web, where ownership is
handed over or the club closed. The link names the club, so the browser opens that club whatever team it last
had open, with one button per club. Each refusal (club, teams, only guardian) has its own message.

**Server dependency:** the club's id in the refusal and `/dashboard/club/open` ship with the web deploy of #99,
long before this build. The installed app ignores the new field.

Files: `lib/account-deletion.ts`, `app/(app)/settings/index.tsx`, `__tests__/account-deletion.test.ts`.

### A club director invitation reads as one — [BUG-029](../bugs/fixed/029-mobile-director-invitation.md)

**Installed build:** a director invitation shows as a team invitation: "Role: director", then "Who is
joining?" with player and guardian choices.

**New build:** "Help run SLOFC as a director", no identity question, accepted as the signed-in person. Team
roles read capitalized ("Role: Player").

Files: `lib/invite-accept.ts`, `app/invite/[id].tsx`, `__tests__/invite-accept.test.ts`.

### Labels and club branding, as on the web — [spec §1](../specs/mobile-next-build.md)

**Installed build:** stored values print raw or are capitalized by a style, so a relationship reads "mom" on
one screen and "Mom" on another. A club team shows only its own name, and no logo if it has none of its own.

**New build:** roles, relationships and event types read "Coach", "Step Parent", "Game" everywhere, through the
web's rule (`lib/labels.ts`). In the top strip and the team picker, a club team is "SLOFC - 12U Girls" with
the club's logo when it has none of its own (`lib/team-branding.ts`, the web's rule). Free teams are
unchanged. A scan test fails if a screen prints one of these values raw or capitalizes with a style.

**Logos in any format:** the web's uploaders accept SVG and keep the original. React Native's `Image` can't
draw SVG, so on the installed build an SVG team logo is a blank circle, and a club's would have been too once
inherited. `components/RemoteLogo.tsx` asks Storage for the file's type (one `HEAD` per logo), draws SVG with
`react-native-svg` and anything else with `Image`, and shows the team's initials when there's no logo or it
fails to load.

**New native dependency (#102):** `react-native-svg` (15.15.3, the version `expo install` pins for SDK 55). It
ships only in a full build, and this is one.

**Data:** the membership query also reads the team's club (`organizations(name, org_name_public, logo_url,
plan)`), which are existing columns the web's dashboard already reads the same way. No server change.

Files: `lib/labels.ts`, `lib/team-branding.ts`, `lib/membership.ts`, `contexts/AppContext.tsx`,
`components/TeamProfileStrip.tsx`, `components/SwitcherSheet.tsx`, `components/RemoteLogo.tsx`,
`lib/logo-kind.ts`, nine screens under `app/(app)/`, `__tests__/labels.test.ts`,
`__tests__/team-branding.test.ts`, `__tests__/TeamBrandingScreens.test.tsx`, `__tests__/RemoteLogo.test.tsx`.

### Games named and described, as on the web — [spec §1](../specs/mobile-next-build.md)

**Installed build:** a game shows its stored title ("Saturday game"), with no opponent, side, uniform or score
anywhere in the app.

**New build:** on the home screen, the schedule and the event screen, a game with an opponent is "U10 Girls vs
Rivals FC" at home (or unset) and "U10 Girls @ Rivals FC" away, plus " · 3–1" once both scores are entered
(`lib/game-display.ts`, the web's rule). The team is the event's own, so an event opened from another team's
notification is named for that team. The event screen adds **Game details**: the opponent, home or away, the
uniform by the team's name for it on a pill in its color (black or white text, and a border when the color
would vanish into the white card), and the result with the score.

**Data:** the event queries also read `opponent`, `home_away`, `uniform`, `score_for`, `score_against`,
`game_result`, and the team's name, uniform names and colors. All are existing columns; the uniform colors
arrived after 1.0.12, which never reads them. No server change.

Files: `lib/game-display.ts`, `components/UniformLabel.tsx`, `app/(app)/index.tsx`,
`app/(app)/schedule/index.tsx`, `app/(app)/schedule/[eventId].tsx`, `__tests__/game-display.test.ts`,
`__tests__/GameDisplayScreens.test.tsx`.

### Availability on the event screen, as on the web (trimmed) — [spec §1](../specs/mobile-next-build.md)

**Installed build:** the response list counts everyone who answered, coaches included, in one list, and your
own row doesn't move when you answer. The roster is the team the app has open, so an event opened from
another team's notification lists the wrong people. A failed save is undone without a word. The third
answer reads "Can't go".

**New build:** players are grouped by answer (Available, Maybe, Unavailable, No response) and only they count
in the summary ("3 available · 1 maybe"). Coaches, managers, parents and directors are listed apart under
"Coaches & staff" with their answer and role. The roster is the event's own team. Answering moves your row
at once, tapping the answer again clears it, and a failed save is undone with a message. The answers read
Available, Maybe, Unavailable, as on the web (`lib/availability.ts`, the web's rules). Coaches answering for
players stays on the web for now (spec §1).

**Who answers:** the picker answers for a profile of yours on the event's team, which may not be the one being
viewed: a parent viewing Ava who opens Bea's event (another team) answers for Bea, and the heading says so
("Availability for Bea Diaz"). When several of yours are on the team (siblings), it asks which, and the picker
waits until one is chosen. When none are, it says there's nothing to answer. The installed build always
answers as the profile being viewed, which the database refuses for another team's event.

Files: `lib/availability.ts`, `app/(app)/schedule/[eventId].tsx`, `__tests__/availability.test.ts`,
`__tests__/AvailabilityScreen.test.tsx`.

### Chat's message box stays above the keyboard — [BUG-031](../bugs/fixed/031-mobile-chat-input-hidden-by-keyboard.md)

**Installed build (and 1.1.0 build 18):** in a channel or a direct message, the keyboard covers the message box
and Send, so you can't see what you type or send it. The screens assumed they started at the top of the
screen, but they sit about 140–155 pt lower, below the safe area, team strip and header.

**New build:** `components/KeyboardScreen.tsx` measures where the chat sits on screen and offsets the keyboard
by that, so the box sits just above it.

Files: `components/KeyboardScreen.tsx`, `app/(app)/chat/[channelId].tsx`, `app/(app)/chat/dm/[dmId].tsx`,
`__tests__/ChatKeyboard.test.tsx`.

### The home screen's Team and Record cards, as on the web — [spec §1](../specs/mobile-next-build.md)

**Installed build:** the home screen's Team card shows only a member count.

**New build:**
- **Team card:** the team's logo (its own, or its club's) on a rounded tile, or its initials. Then its own
  name, with the club and season under it. Then its members by name and role, coaches and staff first
  (director, coach, manager) and then players by name, each opening their page. A long roster scrolls inside
  the card (up to 384 pt). Then the count and the roster link.
- **Record card:** shown once a past game has a result. The last game is a two-line scoreline: the team and
  its score, then "vs" or "at" the opponent and theirs, or the result word when there's no score. Under it,
  the date and time in the game's zone. Then wins, losses and ties, with a bar split in those proportions:
  wins in the club's secondary color (else lista blue), losses black, ties grey.

These are the web's rules (`lib/team-record.ts`, and `clubSecondaryColor` / `LISTA_BLUE` in
`lib/team-branding.ts`). The membership query also reads the club's `brand_color_secondary`, an existing
column. No server change.

Files: `components/TeamCard.tsx`, `components/RecordCard.tsx`, `components/RemoteLogo.tsx` (a tile shape),
`lib/team-record.ts`, `lib/team-branding.ts`, `lib/membership.ts`, `contexts/AppContext.tsx`,
`app/(app)/index.tsx`, `__tests__/team-record.test.ts`, `__tests__/DashboardCards.test.tsx`.

### Tournaments, as on the web — [spec §4, "Mobile app"](../specs/tournaments-and-leagues.md)

**Installed build (1.0.12):** see the compatibility review below.
- A tournament reads as a purple "Tournament" event, "Ends 12:00 AM", and drops off Upcoming on its first day.
- Its games are ordinary games, without their tournament or round.
- A game shows only its own answer (D14).

**New build:** display and answering only. Creating and managing stays on the web (D11).
- **Home and schedule:**
  - A tournament is one purple card with its dates ("Fri, Dec 11 – Sun, Dec 13") and game count, never times.
    It's marked **Now** while it's underway.
  - Upcoming is by end time, so a tournament stays listed until its last day ends. On the schedule, an
    underway tournament sits under Today.
  - Each game is its own row, with "Surf Cup · Semifinal" under its name.
- **Tournament screen:** its dates, location, placement and record, its games in order (each with its round,
  time and result, opening its screen), and the picker for the tournament.
- **A game's screen:**
  - "Part of Surf Cup · Pool A" links to the tournament.
  - The picker shows your tournament answer until you set one for the game ("From your Surf Cup answer").
    Choosing sets the game's own answer, and tapping it again goes back to the tournament's.
  - Responses group by each person's resulting answer, with inherited ones marked "from Surf Cup".
- **Schedule answer badges:** a game's badge is its resulting answer. An inherited one is dashed and faded.
- **Record card (D8):** after a tournament with a placement, it shows "Last tournament", with its name,
  placement, record (W–L–T) and dates, until a game starts after it.
- **Type colors, as on the web (2026-10-08):**
  - Practice blue, game green, tournament purple, and **other yellow** (other was purple).
  - They're defined once, in `lib/event-type-colors.ts`.
  - The "Surf Cup · Semifinal" line is the tournament's purple.
  - On 1.0.12, other events and tournaments both stay purple until people update.

These are the web's rules, copied (`lib/tournament.ts` and `effectiveAnswer` in `lib/availability.ts`).
No server change: the columns, embeds and rows are part 1's.

Files: `lib/tournament.ts`, `lib/availability.ts`, `lib/event-type-colors.ts`, `app/(app)/index.tsx`, `app/(app)/schedule/index.tsx`,
`app/(app)/schedule/[eventId].tsx`, `components/RecordCard.tsx`, `__tests__/tournament.test.ts`,
`__tests__/TournamentScreens.test.tsx`, `__tests__/event-type-colors.test.tsx`.

---

## Before shipping

1. `cd apps/mobile && npx jest`, and `npx tsc --noEmit`. CI runs both on every PR (#101), and the TestFlight
   workflow runs them again before it builds, so a failing commit never becomes a build.
2. `version` in `apps/mobile/app.json` is the version being released (1.1.0). The `ios-v1.1.0` tag must match it.
3. ~~Check that no schema change since the last build assumes behaviour only this build has.~~ Done
   2026-09-30: see **Compatibility review** below.

## Compatibility review: the installed 1.0.12 against `main` (2026-09-30)

Phones on 1.0.12 keep running it until they update, so nothing on the server may need 1.1.0 (spec D4). This
covers the 44 migrations after 1.0.12's commit (`b3473c71b`, 2026-04-14), and the web API routes 1.0.12 calls.

**Result: no change requires 1.1.0.** One known breakage (BUG-023), already documented, and two by-design
refusals that 1.0.12 reports poorly.

**What 1.0.12 does** (from its source at `b3473c71b`):
- **Writes:**
  - chat: `messages` insert, and soft delete via `deleted_at`; `channels` insert (groups); `channel_members`
    insert and the read-marker upsert; `dm_channels` insert and its read-marker update
  - `availability` upsert and delete
  - `feedback` insert, and `notification_preferences` upsert
  - `profiles`: name, birthday, gender, and `active_team_id` for your own and managed profiles
  - `push_subscriptions` delete and insert
- **API routes:** `invitations/send`, `invitations/[id]/resend`, `account/delete` (GET and DELETE),
  `account/owned-teams`, `account/transfer-ownership`, `managed-profiles`, `auth/signup`, `invite/[id]`,
  `invite/[id]/accept`, `teams`.

**Checked:**
- **No column 1.0.12 reads was dropped or renamed.** The schema only added columns and tables.
- **Identity-protection triggers** (`20260917000000`, `…0002`, `…0004`) lock only identity columns: a profile's
  id, login and email; a message's body, sender and channel; a channel member's or DM's ids. 1.0.12 never
  changes those:
  - its profile edit sets name, birthday and gender only
  - message edits set only `deleted_at`
  - its read markers keep their ids
- **New chat policies** (`20260917000004`): 1.0.12 sends as the signed-in user, and only to channels and DMs
  of teams it's on.
  - Its group creation adds members picked from the roster, with players resolved to their guardians, in one
    insert. `can_add_channel_member` allows that, because `profile_on_team` counts a player's guardian.
  - Covered by `tests/rls/chat-access.test.ts`: "a member creating a group can add themselves and teammates,
    as the app does", and the read-marker upserts.
- **API routes:** all ten still exist with the same methods, and accept 1.0.12's bodies:
  - `invite/[id]/accept` still takes `{ type: "self" | "manager" }`. The `self` harm is BUG-011, the reason
    for "Accept invitations on the web" above.
  - `invitations/send` takes a guardian invitation as `role: "manager"` with `managedProfileId`, exactly what
    BUG-012's rule now requires.
  - `invite/[id]` still returns every field 1.0.12 reads.
  - `account/delete` only added fields, which 1.0.12 ignores.
- **Untouched or unaffected:** `feedback`, `notification_preferences`, the `events` triggers and the new
  `teams` insert policy. 1.0.12 creates teams through `/api/teams`, not directly.

**Known breakage, documented:** `push_subscriptions_expo_push_token_key` (`20260918000000`), a unique index on
the push token. 1.0.12 re-registers by delete-then-insert. On a handset that changed accounts, the insert
collides and fails silently. That's [BUG-023](../bugs/023-device-token-stuck-on-previous-account.md), fixed in
this build.

**Refused by design; 1.0.12 shows it poorly:**
- **Answering for another team's event** (`20260616000000_availability_roster_only`): an answer must be for a
  profile on the event's team. 1.0.12 always answers as the profile being viewed, so an event opened from
  another team's notification is refused, and 1.0.12 undoes the tap silently. The data stays correct. 1.1.0
  answers for the right profile (#105).
- **A closed club** (`20260924000001`): writes on its teams, events, chat and availability are refused, by
  design (BUG-013). 1.0.12 shows a generic error or nothing.

**Cosmetic on 1.0.12:**
- **Roles:** a director role prints as "director". 1.1.0 capitalizes it.
- **Archived teams** (`teams.archived_at`) still appear in the team list. The web's team picker lists them
  too, so that's not a phone-only difference.

### Added 2026-10-01: tournaments (`20261001000000_tournaments.sql`)

Spec: `docs/specs/tournaments-and-leagues.md` §7. Additive: a new event type value, four nullable columns on
`events` (`tournament_id`, `round`, `placement_rank`, `placement_label`), row checks, a trigger, and three
functions. Checked against what 1.0.12 reads and writes:
- **Writes:** none affected. The new checks and the trigger apply to `events` writes, and 1.0.12 never writes
  events. Its availability writes are plain upserts and deletes, which the new rules leave alone.
- **Reads:** 1.0.12 selects named columns, never `*`, so the new columns are invisible to it.
- **What its users will see once tournaments exist:**
  - **A tournament:** an event with the default purple badge, reading "Tournament".
  - **Its event screen:** "Ends" with a time and no date (midnight, for an all-day tournament).
  - **Upcoming:** the tournament drops off its home screen's list on its first day, because that list queries
    by start time. Its games still show.
  - **Its games:** ordinary games, without their tournament or round.
- **Answers (spec D14, accepted):** on a tournament game, 1.0.12 shows only that game's own answer, or "no
  response", never the answer inherited from the tournament. Coaches on the web and on 1.1.0 see the
  inherited one. This ends when people update.

### Added 2026-10-06: tournament fixes (`20261001000001`, `20261002000000`, `20261006000000`)

Review fixes to the tournament functions and triggers (TL-001 to TL-007), and a check that a tournament game ends
after it starts (TL-012). None of it reaches 1.0.12: they change database functions, which 1.0.12 never calls,
and triggers on `events` writes, which it never makes (checked against `b3473c71b`).

### Added 2026-10-08: leagues (`20261008000000_leagues.sql`)

Spec: `docs/specs/tournaments-and-leagues.md` §5. It adds:
- a new `leagues` table
- a nullable `events.league_id`
- a check that only games carry one
- triggers on `leagues` and on `events` writes

None of it reaches 1.0.12. It never reads `leagues`, and it selects named columns from `events`, never
`*`, so it doesn't see `league_id`. The check and triggers act on writes it never makes. A league game shows
in 1.0.12 as an ordinary game, without its league.

## On the TestFlight build, before submitting for review

Each of these is the check recorded on its ticket. They need a real build, so run them on the 1.1.0
TestFlight build (production data: use a test team for anything that writes):

- **BUG-011:** invite a player whose guardian already manages a child on another team; accept **in the app**
  as the guardian. The app asks who you are, offers the child by name, and the existing child gains a team.
- **BUG-007 gap 1:** send a chat message from the app; another member's phone receives it.
- **BUG-007 gap 4:** register a second device, send again, and confirm **both** receive it.
- **BUG-010:** on a phone set to a different zone from the team, open an event: the time matches the web,
  carries a zone label (e.g. "PDT"), and "Arrive by" shows a time. Confirms Hermes formats named zones on
  device — the Jest run uses Node's `Intl`, not Hermes.
- **BUG-028:** as a club owner whose browser last had another club's team (or a non-club team) open, tap
  Delete Account: the message names the club, and the button opens *that* club's settings on the web.
- **BUG-029:** open a director invitation in the app: it reads as helping run the club, asks nothing about
  players, and accepting makes you a director.
- **Labels and branding:** on a club team without its own logo, the top strip and team picker show "[club] -
  [team]" and the club's logo; a free team shows its plain name. Do this with an **SVG** club logo and a
  PNG one: both draw (confirms `react-native-svg` on device; Jest mocks it). The roster, a member's page and an event
  read "Coach", "Mom", "Game".
- **Games:** a scored away game with a white away uniform reads "[Team] @ [opponent] · 3–1" on the home
  screen, the schedule and the event screen's heading, and the event screen's Game details show a white pill
  with a visible border. With a long opponent and uniform name, and iOS text size set large, the values wrap
  inside the card.
- **Availability:** as a player (or viewing as one), on an event with a coach, answer Available: your name moves to Available and
  the summary counts it; tap again and it returns to No response. The coach is listed under "Coaches & staff"
  and isn't counted. Open an event of a team the app doesn't have open (from a notification): the roster is
  that team's. As a parent viewing one player, open a sibling's event on another team: the picker reads
  "Availability for [sibling]" and the answer saves.
- **BUG-031:** in a team channel and in a direct message, tap the message box: it sits just above the
  keyboard, what you type is visible, and Send works. Repeat with iOS text size set large.
- **Dashboard cards:** on a club team, the home screen's Team card shows the club's logo (if the team has
  none), "[club] · [season]", and the members with coaches first, each opening their page. On a team with a
  scored past game, the Record card shows the last game's scoreline and date, and W–L–T with the bar's win
  segment in the club's secondary color.
- **Tournaments:** on a test team with a tournament and games (made on the web):
  - Home and the schedule show it as one card with its dates and game count, and "Now" while it's underway.
    Its games read "Surf Cup · [round]".
  - The tournament screen shows dates, not "Ends", and lists its games, each opening its screen.
  - Answer the tournament. A game's picker shows that answer "From your Surf Cup answer".
  - Set the game to something else, then tap it again: it goes back to the tournament's answer.
  - Set a placement on the web after the tournament: the Record card shows "Last tournament".
- **BUG-023:** sign in as A and confirm a `push_subscriptions` row exists for A with this device's token;
  sign out and confirm it is gone; sign in as B and confirm messages to B arrive while B's own do not come
  back.

## After release

Once 1.1.0 is live on the App Store: move BUG-023 to `fixed/`, and record the device checks above as
deployment verification on BUG-007, BUG-010, BUG-011, BUG-028, BUG-029 and BUG-031. Then start a fresh
`mobile-next.md` for the next build, with 1.1.0 as the shipped version.
