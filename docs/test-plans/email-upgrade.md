# Test plan: email upgrade

Spec: `docs/specs/email-upgrade.md` §5. Every email is checked in real inboxes before each PR merges.

## Sending the samples

From `apps/web`, with `RESEND_API_KEY` in `.env.local`:

```bash
pnpm email:preview                       # writes .email-previews/: open index.html, the gallery (nothing is sent)
pnpm exec tsx --env-file=.env.local scripts/email-previews.ts --send you@example.com
pnpm exec tsx --env-file=.env.local scripts/email-previews.ts --send you@example.com --only invite
pnpm exec tsx --env-file=.env.local scripts/email-previews.ts --send you@example.com --logo https://<a real club logo>.png
```

Until PR 1 is deployed, the lista mark at `https://www.lista.team/email/lista-mark.png` doesn't exist yet. Either
pass `--lista-logo https://<vercel preview host>/email/lista-mark.png` (the preview must be publicly reachable),
or check the lista header again after deploy. The local files from `pnpm email:preview` always show the mark.

The gallery shows every email and its variants, 30 in all, grouped:
- invitations
- schedule changes
- reminders
- account
- club
- team
- billing

Each is shown at phone and desktop width, with its plain text. Sending all of them uses 30 of Resend's daily
limit, so for real inboxes send a few with `--only`.

## What to check in each email

- **Header:** the club's logo, or its name, on club emails; the lista mark beside the "lista" wordmark on lista's.
- **Button:**
  - club emails: the club's secondary color, with readable text
  - lista's: lista blue with dark text
  - payment failed: red
- **Sender:** "SLOFC" on club emails, "lista" on lista's.
- **Text:**
  - names and times read correctly
  - no stray `<`, `&amp;` or `&#x27;`
- **Links:** the button and the fallback link go to the same place.
- **Plain text:** the "show original" / plain-text view reads sensibly, with links written out.
- **Dark mode:** the email stays readable. Clients may invert the colors, but text must not vanish.
- **Phone:** the card fits the screen width without scrolling sideways.

## Results — PR 1 (layout, escaping, branding, plain text)

Mark each ✅, or note what's wrong.

| Client | Light | Dark | Notes |
| --- | --- | --- | --- |
| Gmail, web | | | |
| Gmail, iOS or Android app | | | |
| Outlook, web | | | |
| Outlook, desktop (Windows) | | | |
| Apple Mail, macOS | | | |
| Apple Mail, iOS | | | |

## Part 2: event content, answering from an email

**Previews first.** `pnpm email:preview` includes:
- a guardian's copy with two players (Ava answered, Zoey not)
- a coach's own row
- a game moved an hour later
- a series moved to Wednesdays
- a practice back on
- a cancelled game
- the guardian invitation

**On staging, after deploy** (the migration runs there automatically), with a test team that has a guardian of
two players and a coach:

1. **Create a game** with an opponent, uniform and notes. The guardian's email:
   - is headed "[team] @/vs [opponent]"
   - shows home/away, uniform and notes
   - has a row each for both players
2. **Move the game an hour.** The old time is struck through under the new one, and the answer rows are still
   there.
3. **Tap "Available" for one player while signed out.** You sign in, land on the event, and see
   "[Player] is marked Available". The address no longer carries `?answer=`.
4. **Tap an answer for a team that isn't your active one.** The app switches to that team and records it.
5. **Tap an answer after the event has started.** Nothing is recorded, and the page says why.
6. **Edit a whole series** to another day and time. One email arrives, not a cancellation, and it lists Recurrence and Time, before and after.
7. **Cancel the game.** The details are struck through, and there are no answer buttons.
8. **Send a guardian invitation.** It says "Guardian" and "as [player]'s guardian".

| Check | Result | Notes |
| --- | --- | --- |
| 1. New game | | |
| 2. Moved game | | |
| 3. Answer, signed out | | |
| 4. Answer, other team | | |
| 5. Answer, started event | | |
| 6. Series change | | |
| 7. Cancelled | | |
| 8. Guardian invitation | | |
