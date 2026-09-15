# Bug log

One markdown file per bug, mirroring the `docs/specs/` convention: **open bugs live here, fixed ones move
to `fixed/`.** The folder listing is the backlog — there is no separate index to keep in sync.

## Filing a bug

1. Copy `TEMPLATE.md` to `NNN-short-slug.md`, taking the next free number (`ls docs/bugs docs/bugs/fixed`).
2. Fill in **Symptom**, **Reproduction**, **Severity**, and whatever **Evidence** you have.
   Leave **Cause**, **Fix**, and **Regression test** empty — those come with the fix.
3. Commit it. Filing a bug is not a fix and does not need a spec or a feature branch of its own.

A bug that cannot be reproduced is still worth filing — record what was tried under **Reproduction**
so the next attempt starts from there.

## Severity

Matches the vocabulary already used in `docs/reviews/`:

| | Meaning | Response |
| --- | --- | --- |
| **P0** | Data loss, authorization bypass, or a core workflow is unusable in production | Fix now, ahead of feature work |
| **P1** | A real workflow is broken or silently wrong, with no reasonable workaround | Fix before the next release |
| **P2** | Wrong or confusing behavior with a workaround | Schedule it |
| **P3** | Cosmetic, or an annoyance with no functional impact | Opportunistic |

Authorization and data-integrity bugs start at P1 even when the path to trigger them is obscure.

## Fixing a bug

Bug fixes follow the same rules as features — branch, PR, no direct commits to `main`:

1. Branch `fix/<slug>` off `main`.
2. **Write the failing regression test first** (per the test-driven rule in `CLAUDE.md`), confirm it fails
   against the unfixed code, then fix it.
3. Fill in **Cause**, **Fix**, and **Regression test** in the bug file, and set **Status: Fixed**.
4. `git mv docs/bugs/NNN-slug.md docs/bugs/fixed/` in the same PR as the fix.
5. Reference the ID in the commit subject: `Fix BUG-007: cron routes redirected to login`.

The bug file moving to `fixed/` in the same PR is what makes the log trustworthy — the backlog is
accurate because closing it is part of the change, not a follow-up someone has to remember.

## Terminal states other than fixed

Set **Status** to `Won't fix` or `Not reproducible`, add a sentence saying why, and move the file to
`fixed/` anyway. The folder is "resolved", not strictly "repaired" — a closed bug with reasoning kept is
more useful than a deleted one, especially when it resurfaces.
