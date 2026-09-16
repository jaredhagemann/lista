# Bug log

One markdown file per bug, mirroring the `docs/specs/` convention: **open bugs live here, fixed ones move
to `fixed/`.** The folder listing is the backlog — there is no separate index to keep in sync.

## Filing a bug

1. Copy `TEMPLATE.md` to `NNN-short-slug.md`, taking the next free number (`ls docs/bugs docs/bugs/fixed`).
2. Fill in **Symptom**, **Reproduction**, **Severity**, **Evidence class**, and whatever **Evidence** you have.
3. Fill in **Cause** if it is genuinely diagnosed, and **Proposed fix** / **Regression test** if you have a
   view. Everything above the divider is a **proposal** and may change.
4. Leave **Fix as implemented** and **Verification** empty — those record completed work only.
5. Commit it. Filing a bug is not a fix and does not need a spec or a feature branch of its own.

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

The third clause was added on 2026-09-15 for [BUG-008](./008-cron-routes-redirected-to-login.md), after a
production probe showed every scheduled job had been dead since deploy. A confirmed outage of a core
workflow is a stop-other-work event even though nothing is bypassed and nothing is being destroyed.

Severity is about response urgency, not blame. Do not regrade to make a backlog look better.

## Fixing a bug

Bug fixes follow the same rules as features — branch, PR, no direct commits to `main`:

1. Branch `fix/<NNN>-<slug>` off `main` — one bug per branch.
2. Settle any open row in the ticket's **Product decisions** table first. A fix that changes a product
   contract needs the decision recorded before the code is written, not discovered at review.
3. **Write the failing regression test first** (per the test-driven rule in `CLAUDE.md`), confirm it fails
   against the unfixed code, then fix it. Cover the legitimate path too, not only the hostile one.
4. Fill in **Fix as implemented** and **Verification**, and set **Status: Fixed**.
5. `git mv docs/bugs/NNN-slug.md docs/bugs/fixed/` in the same PR as the fix.
6. Reference the ID in the commit subject: `Fix BUG-008: cron routes redirected to login`.

The bug file moving to `fixed/` in the same PR is what makes the log trustworthy — the backlog is
accurate because closing it is part of the change, not a follow-up someone has to remember.

**Merging is not deploying.** For authorization, storage, cron and delivery fixes, record under
**Verification** what must be confirmed after deploy, and who confirmed it.

## Terminal states other than fixed

Set **Status** to `Won't fix` or `Not reproducible`, record what was tried and why closure is justified,
and move the file to `fixed/` anyway. The folder is "resolved", not strictly "repaired" — a closed bug with
reasoning kept is more useful than a deleted one, especially when it resurfaces.

Neither status means repaired. Do not close a high-impact risk because one reproduction attempt failed;
`Not reproducible` on a P0 needs more than a single quiet afternoon.
