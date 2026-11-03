# BUG-044 — Invite signups hit a low shared limit, and the route never checked the invitation

**Severity:** P1
**Status:** Fixed
**Reported:** 2026-11-03 by the user, seeing "Too many requests" partway through accepting a test roster's invitations
**Area:** invites / auth
**Evidence class:** Mixed. The missing invitation check is reproduced on the local stack. The limit is Static: the message
and the code match the report, but it wasn't triggered, because that needs Redis. Production hasn't been checked for either.
**Last verified:** `32b1a04a1`, local stack

## Symptom

Accepting invitations from one network, new accounts fail after a few with "Too many requests. Please try again later."
A coach handing out invites at a parent meeting would see the same thing on the club's Wi-Fi.

Looking into it found a more serious problem: anyone could create an account for any email address, already marked
confirmed, without an invitation.

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

## Severity

P1, not P0. An attacker gains nothing on the day: the account holds no team access, and accepting an invitation needs its
ID. The harm comes later, when the real owner of that address joins, because the attacker still holds a password to the
account:

- Automatic linking attaches a Google sign-in to the existing account (`docs/specs/archive/google-auth.md`, R5). That the
  password keeps working afterward is inferred from how linking works, and wasn't tested.
- That person can also see "already exists" when signing up, with no way to know why.

Whether any production account was created this way hasn't been checked.

## Product decisions

| Question | Recommendation | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| Limit for invite signups | Its own limit, 30 per 10 minutes per IP; regular signups stay at 5 | As recommended | 2026-11-03 | User, this ticket |
| Should the route need an invitation? | Yes, a real pending one for that email | As recommended | 2026-11-03 | User, this ticket |

## Cause

- `/api/auth/invite-signup` shared `signupLimiter`, 5 per 10 minutes per IP, with regular signup.
- The route took the email from the request and created a confirmed account for it. Its comment said the invite link
  served as verification, but it never looked at an invitation. The form only looked as if it enforced this, with a
  read-only email field.

## Fix as implemented

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

- Someone holding an invite link can still set the password for that invitation's address. That's the design: the link is
  the proof.
- Invitations don't expire yet, so neither does that proof. [BUG-019](../019-invitations-never-expire.md) covers it.
- Regular signup isn't changed. It requires confirming the email.

**Noticed, not changed:** `bulk-send` counts each upload as one against its limit, while `docs/specs/bulk-invite.md` says
200 invitations per hour. Each upload is capped at 100 rows.

## Verification

**Tests:**

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
