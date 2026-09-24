# BUG-013 — Director invite/remove routes are missing and club ownership cannot be handed over

**Severity:** P1
**Status:** Fixed — part 1 in PR #83, parts 2 and 3 in PR #NN
**Reported:** 2026-09-04 by readiness review (finding 13)
**Area:** club / account
**Evidence class:** Static — code inspection only
**Last verified:** `fix/013-ownership-and-closure`, local stack, 2026-09-24 — see Verification

## Scope

This ticket contains **at least three independently releasable areas**. Do not treat it as one
change:

1. **Missing director routes** — already specified, owner-only, and shippable on its own.
2. **Organization succession** — ownership transfer with recipient acceptance, club closure, admin recovery.
3. **Sole-guardian deletion** — the D1 login invariant, which changes an existing product contract.
   **Delivered by [BUG-002](./002-profile-managers-claim-child.md) (2026-09-16):** the database refuses to
   remove a player's last guardian with a login, including through account deletion, and
   `/api/account/delete` returns `409 sole_guardian`. `docs/test-plans/account-deletion.md` was reconciled in
   the same PR.

Area 1 should not wait on the D7 policy work in areas 2 and 3.

**Delivery plan (2026-09-24):** one PR per remaining area.

| Part | Scope | State |
| --- | --- | --- |
| 1 | Director invite and remove | In review: PR #83 |
| 2 | Ownership transfer with recipient acceptance; block deletion for a sole org owner; written admin-recovery process | PR #NN (`fix/013-ownership-and-closure`) |
| 3 | Club closure by archiving; drop the "Orgs deletable by org owner" policy | Same PR as part 2 |

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

See [D1 and D7 decision record](../../reviews/2026-09-15-bug-backlog-review.md).

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
| Which organizations must keep an owner? (settled during the build) | Only those with **club access**: a club plan with a trialing, active or past-due subscription. That is exactly where transfer and closure can be reached. Every team created since April has an organization with its creator as owner, including free teams; applying the rule to them would trap their owners with no way to transfer or close. Free teams and lapsed clubs keep the earlier rule. |
| Releasing the subdomain (settled during the build) | Through the existing 180-day quarantine, which is how every subdomain is released, so old links cannot be taken over at once. The custom domain is removed immediately. |

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

---

## Parts 2 and 3 as implemented — ownership transfer, recovery and closure

**Branch:** `fix/013-ownership-and-closure` (branched from part 1)
**PR:** #NN
**Migration:** `supabase/migrations/20260924000001_club_ownership_and_closure.sql`

**Ownership (part 2):**
- `organization_ownership_transfers` records each offer. `start_ownership_transfer`,
  `cancel_ownership_transfer` and `respond_ownership_transfer` are service-role only, and take the
  acting user's id from the route.
  - Offers go only to a director of the club.
  - One is pending at a time, and it expires after 14 days.
  - Acceptance swaps owner and director in one transaction, if both still hold those roles.
  - Removing the recipient as a director cancels the offer.
- `recover_club_ownership` is support's path. It is recorded as a `recovered` transfer with its reason.
- **An open club with club access always has an owner.** A deferred constraint trigger refuses, at commit,
  any change that leaves one ownerless. That includes an owner deleting their own row, demoting
  themselves, or deleting their account.
- Routes: `POST /api/club/ownership/transfer`, `/cancel` and `/respond`.
  - Accepting moves Stripe's billing email to the new owner. The card on file is untouched, and a Stripe
    failure never undoes the transfer.
  - The recipient, and then the previous owner, are emailed.
- `/api/account/delete` refuses an open club's owner (`owns_club`, from `owned_open_clubs`). Teams in a
  closed club no longer block deletion. Account settings names the club and links to club settings.
- Support: `apps/web/scripts/recover-club-ownership.ts` (a dry run unless `--yes`), following
  [docs/runbooks/club-owner-recovery.md](../../runbooks/club-owner-recovery.md). It reports whether the
  notice email and the Stripe update actually happened. `tsx` is added as a web dev dependency to run it.
- UI: club settings shows the owner an **Ownership** section (offer to a director, see or withdraw the
  pending offer). The club portal shows the recipient an accept/decline banner.

**Closure (part 3):**
- `organizations.closed_at` and `closed_by`. `close_club` (owner only, name confirmed):
  - revokes pending invitations and transfers
  - quarantines the subdomain and removes the custom domain.
- `reopen_club` is for support, and refuses a club with no owner.
- **Read-only:** `refuse_closed_club_write` is a trigger on every club table: teams, club and team
  membership, events, availability, channels, channel members, DMs, messages, locations, invitations and
  training.
  - It refuses **every** write that arrives through the API (`CLUB_CLOSED`), including the service
    role's, since routes write with it on users' behalf.
  - It lets through only direct database sessions, cascades (so account deletion still works) and the
    closure functions.
  - Reads are unchanged, so members keep their history and existing privacy rules still apply.
- The policy **"Orgs deletable by org owner"** is dropped. A club can no longer be erased through the API.
- `POST /api/club/close`:
  - checks the owner and the typed name before touching Stripe
  - cancels the subscription immediately (`prorate: false`, `invoice_now: false`)
  - closes the club
  - drops the released domains from the tenant cache
  - emails every member, via `club_member_emails`: members with a login, and guardians of those without.
- If Stripe fails, the club stays open (502).
- `POST /api/club/teams` refuses a closed club. The dashboard shows a "this club has closed" banner.
- UI: club settings gives the owner a **Close the club** section. It explains the effects (read-only
  history, no refund, the address released, members emailed, support-only reopen) and requires typing
  the club's name.

**Not in this fix:**
- The mobile delete-account flow has no `owns_club` case. It shows its generic error, and deletion is
  still refused (test plan 5.16).
- Write controls in a closed club are not all hidden. The banner explains, and any attempt is refused
  with "this club is closed".
- Reopening does not restore the subdomain or custom domain.

### Verification (parts 2 and 3)

**Failing before the fix:**
- `tests/rls/club-ownership.test.ts`: 24 cases. Among them: an open club's owner could delete their
  account, their owner row, or demote themselves. Covered: transfer start, cancel, accept, decline and
  expiry; stale recipients; recovery; visibility; free and lapsed organizations not trapped.
- `tests/rls/club-closure.test.ts`: 18 cases.
  - Before the fix, an owner could delete their club outright, and no closed state existed.
  - The closure itself: owner only, name confirmed, domains released, invitations and transfers
    revoked.
  - The history stays readable.
  - Every write is refused, for players, staff and the API's service role.
  - No new teams can be created.
  - Owner and member accounts can still be deleted afterwards, and support can reopen.
  - The member email list is right.
- `apps/web/tests/club-ownership-routes.test.ts` (23), `club-recovery.test.ts` (4),
  `club-ownership-ui.test.tsx` (10), `account-deletion-club-owner.test.tsx` (1), and new cases in
  `account-delete-route.test.ts` and `club-api.test.ts`.
- The recovery script was run end to end against the local stack, first as a dry run and then with
  `--yes`. Ownership moved, and the transfer was recorded with its reason. It correctly reported that the
  notice was **not** sent (no email key locally).

**Full runs, 2026-09-24:**

| Suite | Result |
| --- | --- |
| `apps/web` Vitest | 1016 passed |
| Root unit | 132 passed |
| `pnpm test:rls` | 530 passed |
| Tenant + billing | 105 passed |

`tsc` is clean, and ESLint reports nothing new in changed files.

**After deploy — required:**
1. **Staging, when the PR's migration run finishes:** confirm that the `Orgs deletable by org owner` policy
   is gone (`select policyname from pg_policies where tablename = 'organizations'`). Confirm that
   `select count(*) from organizations where closed_at is not null` is 0.
2. **Production, after merge:**
   - As a test club's owner, offer ownership to a director. Accept as the director, and check Stripe's
     customer email changed.
   - Offer it back, and withdraw the offer.
   - On a throwaway club with a Stripe **test-mode** subscription only, close it. Check the subscription
     is cancelled, the member email arrived, and the history is readable but refuses a new message.
3. **Recovery:** do not run the script against production until a real request comes in. The runbook is
   the procedure.

