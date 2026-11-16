# Bugs

Bugs are GitHub Issues on `jaredhagemann/lista`, labelled `bug`. **The open `bug` issues are the backlog.**
This folder holds the process below, the issue template (`TEMPLATE.md`), and — as numbered files, with
resolved ones in `fixed/` — the record of bugs handled before tracking moved to GitHub Issues.

## Filing a bug

1. Open an issue labelled `bug` (`gh issue create --label bug`). Its title is the one-line summary; its body
   follows `TEMPLATE.md` above the divider.
2. Fill in **Symptom**, **Reproduction**, **Severity**, **Evidence class**, and whatever **Evidence** you have.
3. Fill in **Cause** if it is genuinely diagnosed, and **Proposed fix** / **Regression test** if you have a
   view. All of it is a **proposal** and may change.
4. Leave out **Fix as implemented** and **Verification** — those record completed work, in the fix's PR.

Filing a bug is not a fix and does not need a spec or a branch of its own.

A bug that cannot be reproduced is still worth filing — record what was tried under **Reproduction**
so the next attempt starts from there.

## Evidence class

Every bug states what is actually established, because "found in the code" and "watched it happen in
production" justify very different responses:

- **Reproduced** — observed against a running system. Always name which: local stack, staging, production.
- **Static** — identified by code inspection; no execution.
- **Unverified in deployment** — deployed behavior has not been checked, whatever local runs showed.

A local reproduction against checked-in migrations does **not** establish production behavior. Do not write
"the policy is the same in all environments" unless a deployed check established it.

## Severity

**P0 is deliberately narrow:** a *reproduced* defect that any authenticated user can trigger with no
prerequisites beyond a guessable identifier; that is actively destroying data in production; or that
leaves a core workflow **confirmed non-functional in production**. The point of the narrow definition is
that P0 means "stop other work," and a P0 list of a dozen items means nothing.

| | Meaning | Response |
| --- | --- | --- |
| **P0** | Reproduced no-prerequisite authorization bypass; active data loss; or a core workflow confirmed dead in production | Fix now, ahead of feature work |
| **P1** | A real workflow is broken or silently wrong, with no reasonable workaround | Fix before the next release |
| **P2** | Wrong or confusing behavior with a workaround | Schedule it |
| **P3** | Cosmetic, or an annoyance with no functional impact | Opportunistic |

An authorization bypass that needs a prerequisite — already holding an admin role, or possessing someone
else's invitation ID — is **P1, not P0**. It is still an authorization bug and still gets a hostile-path
regression test; it just does not stop the line. Record that reasoning in the ticket so the grade is not
re-litigated.

The third clause was added on 2026-09-15 for [BUG-008](./fixed/008-cron-routes-redirected-to-login.md), after a
production probe showed every scheduled job had been dead since deploy. A confirmed outage of a core
workflow is a stop-other-work event even though nothing is bypassed and nothing is being destroyed.

Severity is about response urgency, not blame. Do not regrade to make a backlog look better.

## Fixing a bug

Bug fixes follow the same rules as features — branch, PR, no direct commits to `main`:

1. Branch `fix/<issue number>-<slug>` off `main` — one bug per branch.
2. Settle any open row in the issue's **Product decisions** table first. A fix that changes a product
   contract needs the decision recorded before the code is written, not discovered at review.
3. **Write the failing regression test first** (per the test-driven rule in `CLAUDE.md`), confirm it fails
   against the unfixed code, then fix it. Cover the legitimate path too, not only the hostile one.
4. Write **Fix as implemented** and **Verification** (the sections below the divider in `TEMPLATE.md`) in
   the PR description, with `Fixes #<n>`.
5. Reference the issue in the commit subject: `Fix #42: cron routes redirected to login`.

`Fixes #<n>` closing the issue when the PR merges is what keeps the backlog trustworthy — closing it is
part of the change, not a follow-up someone has to remember.

**Merging is not deploying.** For authorization, storage, cron and delivery fixes, record under
**Verification** what must be confirmed after deploy, and who confirmed it.

**A migration that changes data needs a fixture that has been lived in.** Build the test subject the way the
product builds it — a player who arrived through an invitation, an event with responses against it — not
field by field. BUG-011's merge passed six tests and then failed in production on a foreign key from
`invitations`, the one table no fixture had touched because no fixture had invited anyone. Prefer the same
helpers and routes the app uses; where a fixture is assembled by hand, say in the test what a real record
would also carry.

## Terminal states other than fixed

Close the issue as *not planned* with a comment saying `Won't fix` or `Not reproducible`, what was tried,
and why closure is justified. A closed issue with its reasoning kept is more useful than a deleted one,
especially when the bug resurfaces.

Neither outcome means repaired. Do not close a high-impact risk because one reproduction attempt failed;
`Not reproducible` on a P0 needs more than a single quiet afternoon.
