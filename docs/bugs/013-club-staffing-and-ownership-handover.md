# BUG-013 — Director invite/remove routes are missing and club ownership cannot be handed over

**Severity:** P1
**Status:** Open — part 1 of 3 (director routes) in review; parts 2 and 3 not started
**Reported:** 2026-09-04 by readiness review (finding 13)
**Area:** club / account
**Evidence class:** Static — code inspection only
**Last verified:** `5acde1074`, code inspection, 2026-09-04

## Scope

This ticket contains **at least three independently releasable areas**. Do not treat it as one
change:

1. **Missing director routes** — already specified, owner-only, and shippable on its own.
2. **Organization succession** — ownership transfer with recipient acceptance, club closure, admin recovery.
3. **Sole-guardian deletion** — the D1 login invariant, which changes an existing product contract.
   **Delivered by [BUG-002](./fixed/002-profile-managers-claim-child.md) (2026-09-16):** the database refuses to
   remove a player's last guardian with a login, including through account deletion, and
   `/api/account/delete` returns `409 sole_guardian`. `docs/test-plans/account-deletion.md` was reconciled in
   the same PR.

Area 1 should not wait on the D7 policy work in areas 2 and 3.

**Delivery plan (2026-09-24):** one PR per remaining area.

| Part | Scope | State |
| --- | --- | --- |
| 1 | Director invite and remove | In review: PR #83 |
| 2 | Ownership transfer with recipient acceptance; block deletion for a sole org owner; written admin-recovery process | In progress: `fix/013-ownership-and-closure` |
| 3 | Club closure by archiving; drop the "Orgs deletable by org owner" policy | In progress, in the same PR as part 2 |

Parts 2 and 3 ship together (user decision, 2026-09-24). An owner cannot be allowed to delete their account
until a club can be closed, since a solo owner has no one to transfer to.

## Symptom

Club settings shows working-looking **Invite director** and **Remove director** controls that cannot
succeed — the API routes they call do not exist. Separately, an organization owner can delete their account
and leave the club with no owner, and a child's sole guardian can delete theirs and leave the child
unmanaged.

## Reproduction

**Code-confirmed.** No end-user reproduction recorded.

Missing routes:
1. Open club settings as an org owner and invite a director.

**Expected:** the director is invited.
**Actual:** the request 404s — `/api/club/directors/invite` and `/api/club/directors/remove` do not exist.

Ownership gap:
1. As an organization owner, transfer all owned **teams** to another user.
2. Delete the account.

**Expected:** deletion is blocked until organization ownership is transferred.
**Actual:** the deletion gate checks team ownership only; the account is deleted and the organization
membership cascades away, leaving the club with no owner.

## Evidence

- Missing-route callers: `apps/web/src/components/club/club-settings-client.tsx:81`
- Deletion gate: `apps/web/src/app/api/account/delete/route.ts:4`
- Organization membership cascade / one-owner index: `supabase/migrations/20260416000001_organization_members.sql:12`
- Guardian link cascade: `supabase/migrations/20260303000002_managed_profiles.sql:39`

## Cause

Two separate gaps. The director routes were never implemented although their callers shipped. The account
deletion gate predates organizations and checks only team ownership; the "one owner" index guarantees *at
most* one owner, not that an owner continues to exist.

## Product decisions

**Accepted under D1 — September 15, 2026:** every player profile must retain a login path. The last
guardian cannot be removed when the player has no independent login. Account deletion must not silently
bypass that invariant. Reconcile the existing account-deletion test plan with the accepted rule.

**D7 direction accepted — September 15, 2026:** provide explicit organization ownership transfer with
recipient acceptance, a club-closure alternative and a documented administrator-recovery process.
Guardian/account deletion must leave an accepted replacement guardian or the player's independent login;
otherwise resolve that dependency before deletion. Club closure must not delete shared player identities
or guardian relationships used by other clubs.

**D7 resolved — closure accepted September 15, 2026:** archive closed clubs. Their roster, event,
availability and chat history remains read-only for remaining authorized members, preserving
private-group/DM boundaries and revocation rules. Club closure does not automatically erase history.

See [D1 and D7 decision record](../reviews/2026-09-15-bug-backlog-review.md).

**Settled 2026-09-24 (user), for part 1.** The multi-tenant spec said only that owners add and remove
directors; how that works had never been decided.

| Question | Decision |
| --- | --- |
| How is a director invited? | An emailed invitation that becomes a directorship when the recipient accepts, signing up first if needed. It uses the same invitations table and accept flow as team invitations. |
| How does a new director reach the club? | Accepting adds them as `director` on every active team in the club. The dashboard and club portal are reached through a team, and creator-directors are already on the teams they made. Teams created later add every director. |
| What happens to a removed director's teams and rosters? | Teams they own pass to the club owner. Their `director` roster rows are removed, and any other role they hold (e.g. coach) is kept. |
| Who can remove a director? | Only the owner. A director cannot leave on their own; that can be added later. |

**Settled 2026-09-24 (user), for parts 2 and 3.**

| Question | Decision |
| --- | --- |
| Who can receive club ownership? | Only an existing director of the club. |
| How is a transfer accepted? | The owner starts it. The recipient gets an email and a banner in the club portal, and accepts or declines. There is one pending transfer at a time, which the owner can cancel. It expires after **14 days**. |
| What happens to the previous owner? | They become a director. They leave only if the new owner removes them; directors cannot leave on their own. |
| Billing on transfer | The subscription carries on untouched. Billing emails switch to the new owner, and the accept screen says billing is now theirs, with a link to update the card. The old card stays on file until the new owner replaces it. |
| Teams the old owner owns | They stay the old owner's. |
| Deleting an owner's account | Blocked while they own any club that has not been closed. |
| Admin recovery (the owner has lost access) | A written support procedure and a server-side script run by support, with no product UI. Before transferring: the request comes from a current director, and the requester confirms Stripe billing details (e.g. card last 4 or an invoice number). **No waiting period.** A notice goes to the old owner's address when the transfer is made. |
| Surfaces | Transfer, acceptance and closure are web-only. |
| Who can close a club? | The owner only, confirming by typing the club's name. |
| Billing at closure | The subscription is cancelled immediately, with no refund. The confirmation says so. |
| Reopening | Not self-serve. Support can reopen a club; its history is intact. |
| Access after closure | Everyone on a roster at closure (players, guardians, coaches, directors) keeps read-only access to its roster, events, availability and chat. Pending invitations are revoked and nobody new can join. Private groups, DMs and removal rules are unchanged (D7). |
| The owner after closure | May delete their account. The closed club keeps its history with no owner. Teams in a closed club no longer block account deletion. |
| Subdomain / custom domain | Released at closure. Members reach the history on the main domain. |
| Telling members | One email to every member at closure: the club is closed and its history remains readable. |

## Proposed fix

Finish director provisioning/removal and organization ownership transfer. Block deletion until club and
guardian responsibilities are transferred or explicitly resolved. Document a recovery path for a lost
administrator account.

**Note:** `docs/test-plans/account-deletion.md` exists and should be extended alongside this fix.

## Regression test

Assert deletion is blocked for a sole org owner and a sole guardian, and that director invite/remove
round-trip successfully.

Also cover accepted ownership transfer and club closure: archived history remains readable only within
existing authorization boundaries, operational writes are blocked, revoked members cannot regain access,
and shared player identities/guardian links remain intact.

## Related finding — direct organization deletion (2026-09-16, found during BUG-005)

The policy `Orgs deletable by org owner` lets an owner delete their organization through the data API. The
delete cascades to `teams` and `organization_members`, and from teams on to memberships, events, availability
and chat. No application code deletes organizations. It contradicts **D7**: club closure archives the club and
keeps its history read-only rather than erasing it. When implementing club closure, drop this policy (or replace
it) so closure goes only through the archive path. BUG-005 dropped the matching UPDATE policy for the same
reason: no app code used it.

---

## Part 1 as implemented — director invite and remove

**Branch:** `fix/013-director-invite-remove`
**PR:** #83
**Migration:** `supabase/migrations/20260924000000_director_invitations.sql`

**Database:**
- `invitations.organization_id`, plus the `director` role on invitations.
  - `invitations_scope_check`: a director invitation names a club and no team or child. Every other
    invitation names no club.
  - A unique index allows one pending director invitation per club and address.
- `create_director_invitation(actor, org, email)` does all of this in one transaction:
  - checks the actor is the owner
  - refuses an existing owner or director
  - returns a pending invitation for the same address (so asking again resends it) or inserts a new one.
- `accept_invitation` accepts a director invitation as `self`. It adds the `organization_members`
  row, adds a `director` row on every active team (keeping any existing role), and sets the active team
  to one of the club's. Recipient checks and single acceptance are unchanged.
- `remove_org_director(actor, org, profile)`:
  - is owner-only, and never removes the owner
  - removes the directorship and the `director` roster rows, keeping other roles
  - hands their teams to the owner
  - clears an active team they can no longer reach.
- `create_club_team` enrolls every owner and director, as `POST /api/club/teams` already did.
- `create_director_invitation` and `remove_org_director` are service-role only, like
  `accept_invitation`. The route passes the authenticated user's id.

**Web:**
- `POST /api/club/directors/invite`: authentication, rate limit, email validation, then the function.
  It then sends a club-flavoured invite email (`buildInviteEmailHtml({ kind: "club" })`) from the club's
  own domain and branding (`orgInviteBaseUrl`, `orgInviteBranding`) and records `email_status`.
  - A non-owner gets 403.
  - An existing member gets 409.
- `POST /api/club/directors/remove`: 403 for a non-owner, 404 for someone who is not a director.
- The invite page and `GET /api/invite/[id]` name the club for a director invitation. The accept screen
  reads "help run a club" and lands on `/dashboard/club`.

**Not in part 1:**
- The club settings page does not list pending director invitations.
- The mobile invite screen asks a director "Are you the player?". Answering yes accepts correctly and
  answering no is refused. The wording should be fixed with the next mobile build. Invite links normally
  open on the web.

### Part 1 verification

**Failing before the fix:**
- `tests/rls/club-directors.test.ts`: all 18 cases.
  - Invite: owner only; refuses existing members; reuses a pending invitation; service-role only; the
    scope constraint.
  - Accept: the club role and every active team (not archived); recipient and mode checks; single
    acceptance; existing roles kept; database access afterwards; later teams include the director.
  - Remove: owner only; not the owner; teams handed over; roster rows removed and other roles kept;
    the active team cleared; access lost at once.
- `apps/web/tests/club-directors-api.test.ts`: 15 cases. The routes did not exist, which is the
  reported 404.
- `apps/web/tests/director-invite-accept.test.tsx`: the accept screen names the club and lands on the
  club portal. The coach invitation case is unchanged and passes both before and after.

**Full runs, 2026-09-24:**

| Suite | Result |
| --- | --- |
| `apps/web` Vitest | 972 passed |
| Root unit | 132 passed |
| `pnpm test:rls` | 488 passed |
| Tenant + billing | 105 passed |

`tsc` is clean, and ESLint reports nothing in changed files.

**After deploy:** as a club owner, invite a director at an address you control. Accept by signing up
through the emailed link. Confirm the new director lands on the club portal and sees every active team.
Then remove them from club settings and confirm they lose access.

