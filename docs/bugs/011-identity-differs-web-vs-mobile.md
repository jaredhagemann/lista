# BUG-011 — Invitation acceptance creates the wrong player identity on mobile

**Severity:** P1
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 11)
**Area:** invites / identity / mobile

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

## Fix

Use one identity-aware, transactional acceptance workflow across both clients. Offer selection of an
existing managed child, distinguish the child's identity from the recipient email, and make duplicate and
concurrent acceptance safe.

Related: [[012]] covers the missing recipient check on the same acceptance paths.

**Open question:** what should happen to child identities already duplicated in production? See "Questions".

## Regression test

Cover: parent accepting a player invite on native, the same child invited to a second team, and two
simultaneous acceptances of one invitation.
