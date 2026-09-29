# Email Upgrade

**Status:** Built. PR 1 (#90), then part 2 (this spec's §4.3, §4.4, §4.7; D7–D11), with BUG-025 (#93) and BUG-026 (#94) first.
**Roadmap:** #1, Email Upgrade (`docs/roadmap.md`)
**Scope:** web app server only. Every email is sent from `apps/web`, so the mobile app is unaffected.

## 1. What's sent today

Every email is a hand-written HTML string, sent through Resend from `notifications@lista.team`.

| Email | Sent by | Built by | Branding today |
| --- | --- | --- | --- |
| Team invitation (single, bulk, resend) | `api/invitations/send`, `bulk-send`, `[id]/resend` | `buildInviteEmailHtml` | Club logo and public name on a club plan; otherwise "lista" text |
| Director invitation | `api/club/directors/invite` | `buildInviteEmailHtml` (kind `club`) | Same |
| Event reminder (daily cron) | `api/cron/reminders` | `buildEventEmailHtml` | None: "lista" text on every team |
| Schedule change (new, updated, cancelled) | `lib/notifications/worker.ts` | `buildEventEmailHtml` | None |
| Series / bulk schedule change | `worker.ts` | `buildSeriesUpdateEmailHtml` | None |
| Signup confirmation | `api/auth/signup` | `buildConfirmationEmailHtml` | The tenant's (subdomain) |
| Trial reminders (30, 7 and 1 day), trial converted or downgraded, payment succeeded or failed, subscription cancelled | `lib/notifications/billing-emails.ts`, `api/cron/trial-expiration`, the Stripe webhook | `build*EmailHtml` on `billingShell` | lista |
| Club ownership offer, declined, changed; club closed | `lib/club/ownership.ts`, `api/club/close` | `buildClubNoticeEmailHtml` on `billingShell` | lista |
| Team deleted | `lib/notifications/team-deletion.ts` | `buildTeamDeletionEmailHtml` | lista |

**Not sent yet:** the chat digest (`notification_preferences.chat_digest_enabled` exists, but nothing sends it).

## 2. Problems

- **Six copies of one layout.** The header, card, button and footer markup is repeated in each builder, with
  small differences between them: button colors, badge styles, and footer wording.
- **User text reaches the HTML unescaped.** Event titles, team names, locations, inviter names and change
  values are interpolated raw into the event, series and invite emails. Only the club notices escape.
  A coach could put markup into an event title, and it would render in every member's inbox.
- **Schedule emails carry no branding.** Reminders and schedule changes always say "lista", even for a club
  team with its own logo and colors, while that team's invitations are branded.
- **Thin content.** Reminders and changes don't show the opponent, home/away or uniform for a game, and use
  the stored title rather than the "[Team] vs [Opponent]" game title the app shows since #85. Guardians
  aren't told which of their players the email is about.
- **Stored values shown raw.** The invite role badge relies on CSS `text-transform` (ignored by some
  clients); the event type is capitalized by hand. The app uses `displayLabel` for these since #86.
- **No plain-text part.** Every email is HTML-only. That hurts deliverability, and readers whose mail
  client blocks HTML see nothing useful.
- **No logo image for lista.** The header prints "lista" as text; there is no hosted logo image.
- **No previews.** The only way to see an email is to trigger it. Tests check fragments of the HTML strings.

## 3. Goals

1. **One layout** that every email is built from: header, content card, button, detail rows, footer.
2. **Branding by team:** a club team's emails carry the club's logo, name and color; everything else
   carries lista's. The same rules as in the app (`docs/specs/team-branding-and-labels.md`, `teamBranding`).
3. **Safe by construction:** user text is escaped by default, not by remembering to.
4. **Richer event emails:** game details, the game title, arrival time, location and a way to answer
   availability (§6, D3).
5. **Every email has a plain-text part,** generated from the same template.
6. **A preview for every email** with sample data, and tests on each email's content.
7. **Checked in the main clients:** Gmail (web and phone), Outlook (web and desktop), Apple Mail
   (macOS and iOS), including dark mode.

**Not in scope:**
- the chat digest (§6, D5)
- changing *when* emails are sent, or *who* receives them
- the mobile app
- push notification text

## 4. Design

### 4.1 Templates

(Depends on D1.) Each email is a template function of typed props that returns `{ subject, html, text }`,
built from shared layout parts:

- **Layout:** the gray page, a 560px white card, the header (logo image, or name text when there's no logo)
  and the footer (why you got this email, and a link to notification settings where relevant).
- **Parts:**
  - a status badge (New, Updated, Cancelled, Reminder)
  - a heading
  - a paragraph
  - detail rows (label and value)
  - a button, with a fallback link underneath
  - a before/after change table
  - a hidden preheader, the preview line the inbox shows under the subject
- **Brand:** `{ name, logoUrl, color }`, resolved once per email (§4.2) and passed to the layout.

`sendEmail` takes the `{ subject, html, text }` result and sends both parts.

### 4.2 Branding

The brand is resolved from the team (or club) the email is about:

| Email is about | Brand |
| --- | --- |
| A team on a club plan | The club: `logo_url` (the team's own logo first, as in the app), public name (else internal name), and color: the secondary color (D2) |
| Any other team; billing; signup on lista.team | lista: the lista mark and wordmark (D4) and lista blue `#01D7F4` |
| A club (director invite, ownership, closure) | The club, when it is on a club plan |

- **Colors:** only valid hex values are used (as `clubSecondaryColor` does), falling back to lista blue.
- **Button text:** must stay readable on the brand color. White text on a light color like lista blue fails
  contrast, so the button text is chosen by the color's lightness: dark text on light colors, white on dark.
- **From name:** already the club's name on invitations. Extended to every email about a club team, so a
  reminder comes from "SLOFC" rather than "lista".

### 4.3 Event emails (reminder, new, updated, cancelled)

- **Heading:** the game title ("12U Girls vs Rivals FC" / "12U Girls @ Rivals FC") for games; the title for
  everything else. Built with the same `gameTitle` as the app.
- **Detail rows, in order:**
  - date
  - time, with the zone label (BUG-010)
  - arrive by
  - location
  - for games: home/away and uniform (with the color swatch)
  - notes, truncated
- **Updated:** the changed fields are highlighted, with the old value struck through (the series change
  table already does this).
- **Cancelled:** a red badge, and the details struck through.
- **Guardians:** a guardian's copy names the player(s) it's about: "For Ava and Zoey". Each recipient's
  `coversProfileIds` (`resolveRecipients`) already lists the players it's on behalf of.
- **Button:** "View event", plus availability answers (D3, §4.7).

**What the data holds today** (checked for PR 2):
- **Reminders** are built from the event row, which has everything above.
- **Change notices** are built from the job's snapshot (`event_notification_snapshot`). It has the title,
  times, arrival, location and cancelled flag, but no opponent, home/away, uniform or notes. It also has no
  previous values, so "what changed" can't be shown.

PR 2 adds a migration:
- The snapshot gains `opponent`, `home_away`, `uniform`, `notes` and `timezone`.
- An `updated` job also stores `previous`: the snapshot of the row before the change, so the email can show
  old values.
- Jobs queued before the migration have neither, and render as today.
- The worker loads the team's uniform colors alongside its brand.

### 4.7 Answering availability from an email (D3)

Each answer button, labelled "✓ Available / ? Maybe / ✗ Unavailable" as in the app,
links to the event page:
`/dashboard/schedule/<event>?answer=<available|maybe|unavailable>&for=<profile>`.

- **Rows of buttons:** one row per person the recipient answers for, taken from `coversProfileIds`:
  - themselves, when they're on the team (a player with a login, a coach, a manager)
  - each managed player the email is on behalf of

  A guardian of two players on the team gets two rows: "Ava: ✓ Available · ? Maybe · ✗ Unavailable" and one for Zoey.
  Because rows differ, event emails are rendered once per recipient, not once per event.
- **Signing in:** a signed-out reader is sent to sign in, then returned to the same link. This depends on
  BUG-025.
- **Right team:** if the event's team isn't the reader's active team, but they (or the `for` player) are on
  it, the page switches to it rather than sending them to the dashboard. This depends on BUG-026.
- **Recording:** the page records the answer (D7), for the `for` profile only if the reader is that person
  or one of their guardians. The same rules as answering on the page, enforced by RLS.
- **Current answer (D10):** each row also shows that person's current answer, or "No answer yet", with the chosen
  button highlighted.
- **Confirmation:** the page says what it did ("Ava is marked Available"). The answer can still be changed on the
  page, and the parameters are removed from the address so a reload doesn't repeat them.
- **When nothing is recorded:** an event that has started or been cancelled records nothing, and the page
  says why. So does a `for` the reader can't answer for.

### 4.4 Invitations

- Heading: "Join 12U Girls on SLOFC" (brand name), with the team or club logo.
- The inviter's name and the role, via `displayLabel`.
- The feature list is kept, without the emoji, which render inconsistently across clients.
- No expiry note: team and director invitations don't expire. Only a club ownership transfer does (14 days),
  and its offer email already says so.

### 4.5 Everything else

Signup confirmation, billing, club notices and team deletion move onto the shared layout, with the same
wording. Billing and club notices keep lista branding, unless the notice is about a club (§4.2).

### 4.6 Plain text

Generated from the same template, so it can't drift from the HTML. Links are written out in full.

## 5. Testing

- **Per email:** subject, preheader, heading, the key details, the button URL, and the plain-text part,
  for representative inputs:
  - a game and a practice
  - home and away
  - a guardian's copy
  - a cancelled event
  - a club team and a free team
- **Escaping:** a title, team name, location and inviter name containing `<b>` and `"` come out as text in
  every email.
- **Branding:**
  - a club team gets the club's logo, name, color and from-name
  - a club's invalid color falls back to lista blue
  - a free team gets lista
  - the button text color follows the brand color's lightness
- **Wiring:** the reminder cron, the notification worker and the invite routes pass the team's brand and the
  event's game fields (the page-level wiring tests from #85 and #86 showed why this matters).
- **Existing tests keep passing:** `tests/unit/email*.test.ts`, `billing-emails`, `reminders-cron`,
  `notification-times` and the invite route tests, updated where the HTML changes.
- **Previews:** `src/emails/samples.tsx` has sample data for every email, both club and lista versions
  where an email can carry either. `pnpm email:preview` renders them to `.email-previews/`, with a gallery page showing each at phone and desktop width with its plain text, and
  `scripts/email-previews.ts --send <address>` sends them to a real inbox. A test checks there is a sample
  of every email and that each one renders.
- **Manual:** every email sent to real Gmail, Outlook and Apple Mail inboxes, in light and dark mode and on
  a phone, before merge. Results are recorded in `docs/test-plans/email-upgrade.md`.

## 6. Decisions

| # | Question | Decision |
| --- | --- | --- |
| D1 | How templates are written | **React Email.** JSX templates escape user text by default, render a plain-text part from the same template, and come with a preview server. |
| D2 | A club's email color | **The club's secondary color**, matching the dashboard record bar (`clubSecondaryColor`). It falls back to lista blue when the club has none, or its value isn't a valid hex color. |
| D3 | Availability in reminder emails | **Buttons through sign-in.** "✓ Available / ? Maybe / ✗ Unavailable" (the app's labels) open the event page, sign in if needed, and record the answer there. Answering without signing in (signed per-recipient links) may come later, with its own security design. |
| D4 | lista logo image | **lista's mark beside the "lista" wordmark.** The mark is `images/lista_blue_alpha.png`, scaled to 96px tall (13KB) and served from `apps/web/public/email/lista-mark.png`. Emails always use the production URL, `https://www.lista.team/email/lista-mark.png` (the www host: `lista.team` redirects there, and not every mail client follows an image redirect): mail is read long after it's sent, and a preview host may be gone by then. |
| D5 | The chat digest | **A separate feature afterwards,** built on this layout. |
| D6 | Rollout | **Two PRs.** (1) The shared layout, escaping, branding and plain text, with every email moved over and the same wording. (2) The richer event and invite content (§4.3, §4.4), including the availability buttons. |
| D7 | Answering from an email | **Recorded when the page opens**, with a banner saying what was recorded ("Ava is marked Available"). The answer can still be changed on the page. One tap from the email (§4.7). |
| D8 | Which emails carry the answer buttons | **New event, event updated, and the reminder.** Not cancellations or series summaries. |
| D9 | A guardian of several players | **One email with a row of buttons per player** ("For Ava and Zoey"), so a family gets no more emails than today. |
| D10 | Showing the recipient's current answer (asked 2026-09-28) | **On the reminder, updated, back-on and new-event emails,** in the answer rows, one per person the recipient answers for. The row shows that person's current answer, highlighted among the buttons, or "No answer yet". On an updated or back-on email it reads as a re-check ("Still good?"), since a new time may change it. Not shown on cancellations, series summaries or non-event emails. Only the recipient's own people appear, never anyone else's answer. The reminder cron and the worker read the event's responses once per event. |
| D11 | Wording and series details (asked 2026-09-28) | **The availability section is titled "Availability"** on every event email; "Can you make it?" and "Still good?" are dropped. **A series change lists what changed**, in recurring terms: Day ("Tuesdays → Wednesdays"), Time (time of day and length, with the zone), Arrive ("30 min early"), Location, each only when it changed. It follows "12 events in this series changed", with a "View schedule" button. The before values come from the `previous` snapshot the part 2 migration records (§4.3). A notice queued without it shows only the count. |
| D12 | Review of PR #96 (2026-09-29) | **A series edit is one notice.** Moving a series to another day cancels the old occurrences and adds new ones, and inserts don't fire the change trigger, so families were told "Cancelled: … — 3 events" and nothing about the new days. `apply_series_edit` now quiets its own rows and enqueues one 'updated' notice. It carries `series_changes`: the editor's summary as the coach confirmed it (Recurrence, Time, Time zone, fields; `seriesEditSummary`), cleaned in the database. That's the series email's table; `seriesChanges` remains for bulk row updates outside the editor. **Previous values are shown in the zone they were given in**, and labelled "Was …" so plain text keeps old and new apart. **After an email answer for another of the viewer's players**, the page's picker answers for that player and is labelled "Zoey's availability". **The answer notice stays**: the address is cleaned with `history.replaceState`, not a navigation. **Server code imports no values from `"use client"` modules** (a test checks); the answer labels and save function live in `lib/availability/status.ts`. |
| D13 | Re-review of PR #96 (2026-09-29) | **A series edit that moves its last upcoming occurrences into the past still notifies.** When the new pattern has no upcoming events, the notice's count falls back to the upcoming events the edit touched as they were before it (migration `20260929000001`). **An event with no zone of its own shows its previous time in its team's zone**, as it goes by that zone, never the event's new zone, and in UTC when neither has one, as its earlier emails were. Both the single-event and series comparisons do this. |
