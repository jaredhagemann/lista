# Email Upgrade

**Status:** Draft. Decisions in §6 are open.
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
| A team on a club plan | The club: `logo_url` (the team's own logo first, as in the app), public name (else internal name), and color (D2) |
| Any other team; billing; signup on lista.team | lista: the lista logo (D4) and lista blue `#01D7F4` |
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
- **Button:** "View event", plus availability answers (D3).

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
- **Manual:** every email sent to real Gmail, Outlook and Apple Mail inboxes, in light and dark mode and on
  a phone, before merge. Results are recorded in `docs/test-plans/`.

## 6. Decisions

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | How templates are written | (a) **React Email**: JSX templates that escape by default, a plain-text render and a preview server; one new dependency. (b) Keep HTML strings, but move them into one layout module with an escape-everything helper. | (a) |
| D2 | A club's email color | (a) Secondary color, matching the dashboard record bar. (b) Primary brand color, matching the in-app buttons and progress bar. | (b) |
| D3 | Availability in reminder emails | (a) "Going / Maybe / Can't go" buttons that answer **without signing in**: a signed link per recipient and event, which is a new token route with its own security design. (b) The same buttons, but they open the event page, sign in if needed, and record the answer there. (c) No answers; just "View event". | (b) now; (a) later |
| D4 | lista logo image | Needs a hosted PNG of the lista logo. SVG doesn't render in Gmail or Outlook. | You provide the file |
| D5 | The chat digest | (a) A separate feature afterwards, on this layout. (b) Part of this work. | (a) |
| D6 | Rollout | (a) Everything in one PR. (b) Layout, escaping and branding first, moving every email over; then the richer event and invite content. | (b) |
