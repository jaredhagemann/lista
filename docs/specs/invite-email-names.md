# Invite emails: the invitee's name and role, and bigger logos

**Status:** Built on `feature/invite-email-names`
**Requested:** 2026-11-06 by the product owner
**Builds on:** `docs/specs/email-upgrade.md` §4.4 (invitations) and D4 (the lista mark)

## Problem

Invitation emails don't say who they're for or what role they offer.

- The invitee's name is never shown, though team invitations store it (`invitations.first_name`,
  `last_name`). Names are required on the web and mobile invite forms and in bulk upload.
- The role appears only as a badge. The sentence names it for guardian and director invitations,
  but a player or coach reads "Sam Okafor has invited you to join 12U Girls."
- Every subject is "You've been invited to join [team] on [brand]". A director's reads "help run SLOFC
  on SLOFC", and its heading "Help run SLOFC on SLOFC".

Separately, club logos are shown at most 48px tall and 200px wide, which undersells a club's branding.

## Decisions (2026-11-06, from a before/after comparison of rendered samples)

| Question | Decision |
| --- | --- |
| How the name is shown | In the third person, "Sam Okafor has invited **Maya Lopez** to join **12U Girls** as a player." A player's invitation may reach a parent, and the invite page already asks "Are you Maya Lopez?" |
| A details table | Keep it: Invitation for (when there's a name), Player (guardian invitations), Role, Team or Club, Invited by |
| Subject line | The name, not the role: "Invitation for Maya Lopez: join 12U Girls". Without a name: "You're invited to join 12U Girls" |
| Director invitations | Headed "Join SLOFC"; subject "You're invited to join SLOFC". The sentence still says "help run SLOFC as a director" |
| A parent receiving a player's invitation | A line under the button: "Not Maya? If you're Maya's parent or guardian, use the same button to accept for them." |
| No name | Guardian and director invitations collect only an email, and older team invitations may have none. They say "you", with the role in the sentence |
| Logo size | Every email, club or free team: club logos up to 96px tall and 400px wide (from 48 and 200); lista's mark 96px tall (from 36), with the wordmark scaled to match. Clubs are responsible for image quality |

Not changed: a guardian invitation still says "guardian", not the relationship chosen ("Mom", "Dad").

## Changes

- `apps/web/src/emails/invite-email.tsx`: an `inviteeName` prop, the sentence, the table, the parent
  line, the director heading, and an exported `inviteSubject()` used by every sender.
- The senders pass the name and use `inviteSubject()`: `api/invitations/send`, `bulk-send`,
  `[id]/resend`, and `api/club/directors/invite`.
- `apps/web/src/emails/layout.tsx` `BrandMark`: the logo sizes above.
- `apps/web/public/email/lista-mark.png`: re-exported at 192px tall, so the mark stays sharp at 96px on
  high-density screens. Emails already sent give its size in the markup, so they look the same.
- Samples and the gallery (`pnpm email:preview`).

## Tests

- The invite email: the name and role in the sentence and table; the subject with and without a name;
  the director heading and subject; the parent line on player invitations only; no name for guardian
  and director invitations.
- The senders: the subject and the name passed from the invitation.
- The layout: a club logo's height and width limits, and the lista mark's size.
