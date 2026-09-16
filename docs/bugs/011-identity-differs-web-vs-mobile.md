# BUG-011 — Invitation acceptance creates the wrong player identity on mobile

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 11)
**Area:** invites / identity / mobile
**Evidence class:** Static — code inspection only
**Last verified:** `5acde1074`, code inspection, 2026-09-04

## Symptom

A parent accepting a player invitation in the native app is enrolled **as the player themselves** — the
signed-in parent's profile becomes the roster player, and the child's birthday/gender may be written onto
the parent's account. Separately, accepting a second team's invitation for the same child on web creates a
duplicate child identity rather than a second membership.

## Reproduction

**Code-confirmed.** No end-user reproduction recorded.

1. As a parent, open a player invitation in the native app (not an existing-player manager invite).
2. Accept it.

**Expected:** the app asks whether the recipient is the player or a guardian, as the web screen does.
**Actual:** `self` is selected for every such invite; the API inserts the parent's profile as the player.

Duplicate identity:
1. Accept a player invitation for a child on team A as guardian (web).
2. Accept a second invitation for the **same child** on team B.

**Expected:** the existing child gains a second team membership.
**Actual:** a new player UUID is created — two identities for one child.

## Evidence

- Native acceptance: `apps/mobile/app/invite/[id].tsx:49`
- API self acceptance: `apps/web/src/app/api/invite/[id]/accept/route.ts:78`
- Web guardian creation: `apps/web/src/app/actions/invite.ts:117`

## Cause

The native screen has no player-vs-guardian branch. Web guardian acceptance always mints a new player UUID
with no "select an existing child" path. Concurrent acceptance is not protected by an atomic claim of the
invitation, and no merge/reconciliation workflow exists.

## Product decisions

**D6 resolved for historical repair — September 15, 2026:** the user confirms no duplicate identities
exist and that they are the only mobile-app user. No historical cleanup or merge workflow is required.
This is user-provided context; no production-data inspection has been performed.

Retain the prevention work: distinguish player versus guardian acceptance on mobile, offer an explicit
selection among already-managed children, and make concurrent/repeated acceptance safe. Do not match
identities automatically by name or birthday.

See [D6 decision record](../reviews/2026-09-15-bug-backlog-review.md#d6--how-should-existing-duplicate-identities-be-repaired-011).
No application fix has been implemented.

## Proposed fix

Use one identity-aware, transactional acceptance workflow across both clients. Offer selection of an
existing managed child, distinguish the child's identity from the recipient email, and make duplicate and
concurrent acceptance safe.

Related: [BUG-012](./012-invite-server-actions-lack-recipient-check.md) covers the missing recipient check
on the same acceptance paths. The two share acceptance boundaries and should be designed together.

Historical duplicate repair is out of scope per the D6 clarification above.

## Regression test

Cover: parent accepting a player invite on native, the same child invited to a second team, and two
simultaneous acceptances of one invitation.
