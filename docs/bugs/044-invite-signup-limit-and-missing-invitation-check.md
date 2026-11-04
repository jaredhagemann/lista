# BUG-044 — Invite signups hit a low shared limit, and the route never checked the invitation

**Severity:** P1
**Status:** Partially fixed in PR #155; P1 account security issue remains open
**Reported:** 2026-11-03 by the user, seeing "Too many requests" partway through accepting a test roster's invitations
**Area:** invites / auth
**Evidence class:** Mixed. Both the original missing invitation check and the remaining inviter attack are reproduced on
the local stack. The new limit is verified as configuration and route wiring; the actual Redis cutoff wasn't exercised.
Production hasn't been checked for either.
**Last verified:** `4b9cddb38767fe9535861f767115efc314e1ee10` (PR #155), local stack, 2026-11-03

## Symptom

Accepting invitations from one network, new accounts fail after a few with "Too many requests. Please try again later."
A coach handing out invites at a parent meeting would see the same thing on the club's Wi-Fi.

Looking into it found a more serious problem: anyone could create an account for any email address, already marked
confirmed, without an invitation.

PR #155 blocks requests without a pending invitation and fixes the shared signup limit. However, an inviter can still
create a confirmed account for someone else's email by creating an invitation themselves. The account security issue
therefore remains open.

## Reproduction

**The limit:**

1. Accept more than 5 invitations from one IP address within 10 minutes, creating a new account for each.

**Expected:** every family can sign up.
**Actual:** the sixth signup within the window gets the error.

**The missing check:**

1. `POST /api/auth/invite-signup` with `{ "email": "<any address>", "password": "…" }` and no invitation.

**Expected:** refused.
**Actual:** 200, and an account for that address exists with its email confirmed. Reproduced on the local stack by
`tests/rls/invite-signup-route.test.ts`, against the unfixed route. This wasn't tried on production, since it would have
created an account there.

## PR #155 review: inviter can still create a confirmed victim account

**Finding:** P1. Requiring an invitation ID does not establish ownership of the invitation's email address. The inviter
knows the ID too, and can create an invitation addressed to a victim who has no account yet.

**Reproduction on the PR head:**

1. Sign in as an ordinary user and create a team. `POST /api/teams` permits authenticated users to create their own team.
2. Using that user's ordinary authenticated Supabase client, insert a pending `player` invitation for a fresh victim
   email on the user's own team. Supply a UUID as its `id`. The existing invitations INSERT policy permits this because
   the user is a team admin. No email needs to be sent, and the attacker already knows the ID.
3. Call `POST /api/auth/invite-signup` with `{ "inviteId": "<that UUID>", "password": "<attacker-chosen password>" }`.
4. Sign in with the victim email and the attacker-chosen password.

**Expected:** the inviter cannot obtain a confirmed, usable account for the victim's email without the recipient proving
access to that inbox.

**Actual:** the route returns 200, creates an account with `email_confirmed_at` set, and password sign-in succeeds. The
victim has not opened an invitation or verified their email. No existing victim account is needed; this reproduces
account creation before the real owner joins, rather than takeover of an already registered account.

**Evidence:** [review probe](../reviews/2026-11-03-pr155-inviter-probe.test.ts), run against local Supabase at
`4b9cddb38767fe9535861f767115efc314e1ee10`. The probe seeds an attacker-owned team with test helpers, then inserts the
invitation using the attacker's ordinary authenticated session. It invokes the real signup route, checks the confirmed
auth account, and verifies real password sign-in. Only the route's Redis rate limiter is mocked. Team creation through
`POST /api/teams` was checked in code, not exercised by this probe. Test accounts and the test team are cleaned up.

The normal invitation API also exposes the ID to the inviter: `POST /api/invitations/send` returns `inviteUrl`. Merely
requiring that an invitation email was sent would therefore leave the same trust problem.

**Cause:** `apps/web/src/app/api/auth/invite-signup/route.ts` checks that the invitation exists and is unaccepted, then
uses `email_confirm: true` with the supplied password. This proves possession of an invitation ID, which an inviter can
create and know, rather than access to the recipient's inbox. Taking the email from the database prevents substituting
an address on an existing invitation, but the attacker can choose the address when creating their own invitation.

**Required follow-up:** require recipient email verification before granting a confirmed account with the chosen
password. An invitation ID available to the inviter cannot serve as the sole email verification credential. Preserve
the separate invite signup limit and invitation validation already added by PR #155.

**Acceptance criteria:**

- An inviter who creates an invitation for a fresh email cannot sign in as that address without recipient verification.
- Replaying the probe no longer yields an immediately confirmed account usable with the attacker's password.
- A real recipient can complete verification and accept the invitation end to end.
- Missing, invalid, and accepted invitations remain rejected; invite and regular signup limits remain separate.

Production exploitation and the later Google-linking consequence have not been checked. The local reproduction is
enough to show that PR #155 does not fully resolve the account security issue.

### Follow-up findings, 2026-11-03

**The probe replays:** run again from a temporary copy on the local stack at `4b9cddb38`, it passes, so the attack works.

**A plain confirmation step isn't enough, because the password has to come after the inbox proof.** On the local stack,
using the same `generateLink` call as `/api/auth/signup`:

| Step | Result |
| --- | --- |
| Attacker signs up with the victim's email and their own password | Unconfirmed account; the attacker can't sign in yet |
| Victim signs up later with their own password | No error, and the same account |
| Victim clicks the confirmation link | Account confirmed |
| Sign in with the attacker's password | **Works** |
| Sign in with the victim's password | **Fails** |

**So regular signup has a related problem**, with no invitation involved. It needs the victim to click a confirmation
link, and it isn't changed by this ticket's fix. It should get its own ticket. Calling Supabase's public signup directly
wasn't tried, and may offer the same path around any fix in our route. The local stack's auth version may differ from
production's, so the table above isn't established for production.

**Production:** its public `/auth/v1/settings` reports `mailer_autoconfirm: false`, so an account from regular signup
can't sign in until its email is confirmed.

**Copied links:** `send` and the directors' route return `inviteUrl` to the inviter. Web's `new-member-form` and
`managers-card`, and mobile's `invite-member`, show or share it, so anything in that URL is known to the inviter.

## Severity

P1. An attacker can establish a usable, confirmed account for a fresh victim email, including through a self-created
invitation on PR #155. The reproduction does not establish access to the victim's other teams or takeover of an existing
account. Additional harm can arise when the real owner of that address joins, because the attacker knows a password to
the account:

- Automatic linking attaches a Google sign-in to the existing account (`docs/specs/archive/google-auth.md`, R5). That the
  password keeps working afterward is inferred from how linking works, and wasn't tested.
- That person can also see "already exists" when signing up, with no way to know why.

Whether any production account was created this way hasn't been checked.

## Product decisions

| Question | Recommendation | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| Limit for invite signups | Its own limit, 30 per 10 minutes per IP; regular signups stay at 5 | As recommended | 2026-11-03 | User, this ticket |
| Should the route need an invitation? | Yes, a real pending one for that email | As recommended | 2026-11-03 | User, this ticket |
| How does a recipient prove their inbox before choosing a password? | A secret in the emailed link only, never shown to the inviter. A link without it offers Google, or emails the invited address a link to finish | Deferred to a redesign of invites and account creation; spec not yet written | 2026-11-04 | User, this ticket |
| Add a stopgap confirmation email to invite signup until then? | Yes, if the redesign will take more than a few days | No. The remaining exposure is accepted until the redesign ships | 2026-11-04 | User, this ticket |

## Cause

- `/api/auth/invite-signup` shared `signupLimiter`, 5 per 10 minutes per IP, with regular signup.
- The route took the email from the request and created a confirmed account for it. Its comment said the invite link
  served as verification, but it never looked at an invitation. The form only looked as if it enforced this, with a
  read-only email field.

## Partial fix as implemented in PR #155

**Branch:** `fix/044-invite-signup-limit`
**Migration:** none.

- `src/lib/rate-limit.ts`: new `inviteSignupLimiter`, 30 per 10 minutes per IP, counted apart from regular signups.
- `src/app/api/auth/invite-signup/route.ts`: takes an `inviteId`, and refuses with 403 unless that invitation exists and
  is unaccepted. The account's email now comes from the invitation, so a request can't name another address. Every
  refusal gets the same message, so the route doesn't reveal which IDs are real.
- `src/components/invite/invite-signup-form.tsx`: sends `inviteId` instead of the email.

Only the web form calls this route; the mobile app doesn't. A form left open across the deploy gets the refusal message,
and reloading fixes it.

**Limits that follow:**

- Someone holding an invite link can still set the password for that invitation's address. The implementation treats
  the link as email verification, but the review above demonstrates that the inviter can obtain it without inbox access.
  This is the unresolved P1 issue, not sufficient proof of email ownership.
- Invitations don't expire yet. [BUG-019](./019-invitations-never-expire.md) covers that separate limitation; adding
  expiry alone would not prevent the inviter attack.
- Regular signup isn't changed. It requires confirming the email.

**Noticed, not changed:** `bulk-send` counts each upload as one against its limit, while `docs/specs/bulk-invite.md` says
200 invitations per hour. Each upload is capped at 100 rows.

## Verification

**Independent PR #155 review, 2026-11-03:**

- Both focused web files passed: `invite-signup-limit.test.ts` (4 tests) and `invite-signup-form-google.test.tsx` (9 tests).
- `tests/rls/invite-signup-route.test.ts` passed all 10 tests against local Supabase.
- The additional inviter probe passed its exploit assertions: authenticated invitation insert, signup 200, confirmed
  victim email, and successful sign-in with the attacker-chosen password. This result demonstrates the remaining bug.
- PR CI checks were green at the reviewed head. Green checks do not cover the missing recipient-verification guarantee.
- Production, a real club subdomain, and the actual Redis cutoff were not exercised by this review.

**Original implementation verification (reported in PR #155):**

- `tests/rls/invite-signup-route.test.ts` runs the real route against the local stack, with only the rate limit mocked.
  Eight of its ten tests failed before the fix. The other two pass either way: one requires a password, and one checks
  that refusals read the same, which only means something once there are refusals.
- `apps/web/tests/invite-signup-limit.test.ts` covers the limits. Three of its four tests failed before the fix.
- Web suite passes (1,706), `tsc` is clean, and lint reports no errors.

**Browser, local stack, Chromium:**

| Case | Result |
| --- | --- |
| Open a new invitation's link, set a password, create the account | Back on the invitation, asking "Are you Test browser?" |
| 7 more invite signups in a row from one IP, by calling the route from that page | All 200 |
| The route with an email and no invitation | 403, and no account created |

**Not tested:** reaching the new limit of 30, which the test checks only as configuration, and a real club subdomain.

**Deployment verification required, not yet done:** after deploy, on production:

1. `POST /api/auth/invite-signup` with no invitation and an address you control: expect 403, and no account for it.
   **Don't run this before the deploy**, since it would create the account.
2. Accept a real invitation as a new user, end to end.
