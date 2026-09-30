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

Files: `lib/availability.ts`, `app/(app)/schedule/[eventId].tsx`, `__tests__/availability.test.ts`,
`__tests__/AvailabilityScreen.test.tsx`.

---

## Before shipping

1. `cd apps/mobile && npx jest` — the suites run and pass (they were thought broken until 2026-09-17; see
   [BUG-018](../bugs/fixed/018-mobile-jest-suites-fail-to-start.md)).
2. `cd apps/mobile && npx tsc --noEmit`.
3. `version` in `apps/mobile/app.json` is the version being released (1.1.0). The `ios-v1.1.0` tag must match it.
4. Check that no schema change since the last build assumes behaviour only this build has.

## After shipping

Each of these is the check recorded on its ticket, and none of them can be run before the build exists:

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
  that team's.
- **BUG-023:** sign in as A and confirm a `push_subscriptions` row exists for A with this device's token;
  sign out and confirm it is gone; sign in as B and confirm messages to B arrive while B's own do not come
  back.

Then move BUG-023 to `fixed/`, and record the deploy verification on BUG-007 and BUG-011.
