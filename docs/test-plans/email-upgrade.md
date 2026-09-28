# Test plan: email upgrade

Spec: `docs/specs/email-upgrade.md` §5. Every email is checked in real inboxes before each PR merges.

## Sending the samples

From `apps/web`, with `RESEND_API_KEY` in `.env.local`:

```bash
pnpm email:preview                       # writes .email-previews/ — open index.html in a browser
pnpm exec tsx --env-file=.env.local scripts/email-previews.ts --send you@example.com
pnpm exec tsx --env-file=.env.local scripts/email-previews.ts --send you@example.com --only invite
pnpm exec tsx --env-file=.env.local scripts/email-previews.ts --send you@example.com --logo https://<a real club logo>.png
```

These are the 19 samples (subjects start with "[Preview]"):
- **Club and lista versions:** invite, event reminder, event cancelled, series update, confirmation.
- **Club only:** director invite, ownership offer.
- **lista only:** team deleted, and the six billing emails.

## What to check in each email

- **Header:** the club's logo, or its name, on club emails; the "lista" wordmark on lista's.
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
