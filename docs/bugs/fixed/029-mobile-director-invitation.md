# BUG-029 — The app treats a club director invitation as a team invitation

**Severity:** P3
**Status:** Fixed in code; reaches phones with the next mobile build
**Reported:** 2026-09-29 by Claude. Noted as a follow-up while fixing BUG-013, filed when reviewing the mobile
release.
**Area:** ios, invitations
**Evidence class:** Static — see below
**Last verified:** `63c0fcb7a`, code inspection

## Symptom

Someone opens a club director invitation in the app. It reads "You've been invited as director" and
"Role: director", then asks "Who is joining?" with "I am the player" and "No, I am a parent / guardian". The
button says "Accept & join team", and afterwards "You've joined SLOFC." None of that fits joining a club to
help run it.

## Reproduction

1. From the club portal on the web, invite a director (BUG-013).
2. Open the invitation link on a phone with the app.

**Expected:** "Help run SLOFC as a director", with no player or guardian question, and an accept button.
**Actual:** the team-invitation screen, including the identity question.

## Evidence

- **The server:** `/api/invite/[id]` returns `role: "director"` and the club's name as `teamName` for a
  director invitation (`apps/web/src/app/api/invite/[id]/route.ts:33-37`). The web shows these without an
  identity question (`src/app/(auth)/invite/[id]/page.tsx:80`), and accepts as `self`
  (`acceptInvitationAsSelf`).
- **The app** (`apps/mobile/app/invite/[id].tsx`) branches only on `isManagerInvite`. Every other invitation,
  a director's included, gets the player/guardian choice and the team wording.
- **Unverified:** accepting as "I am the player" sends `self`, which likely works for a director. The guardian
  choice would send a guardian acceptance for a club invitation, which isn't tested.

## Cause

The app's invitation screen predates director invitations (BUG-013), so it knows only team roles.

## Proposed fix

The screen's wording and whether it asks who you are come from `lib/invite-accept.ts`, per kind of invitation:
- **Director:** "Help run SLOFC as a director", no identity question, accepts as `self`, and "Accept & join
  club".
- **Guardian:** as now.
- **Team role:** as now, with the role capitalized ("Role: Player").

## Regression test

`apps/mobile/__tests__/invite-accept.test.ts`:
- **A director invitation:** accepts as `self` without an identity answer, and its copy names the club and
  "director", with no team wording.
- **Team and guardian invitations:** keep their copy and their questions.

---

## Fix as implemented

**Branch:** `fix/029-mobile-director-invitation`
**PR:** #PR
**Migration:** none

- **`apps/mobile/lib/invite-accept.ts`:**
  - `inviteCopy` gives the screen its words, and whether to ask who you are, per kind of invitation. A
    director gets "Help run SLOFC as a director", "Accept & join club", "You're now a director of SLOFC.", and
    no identity question. A team role reads capitalized ("Role: Player"). A guardian invitation is unchanged.
  - `buildAcceptBody` accepts a director invitation as `self`, as the web does.
- **The invitation screen** (`app/invite/[id].tsx`) uses both.

**Reaches phones with the next mobile build:** see `docs/releases/mobile-next.md`.

## Verification

**Test:** `apps/mobile/__tests__/invite-accept.test.ts`: a director invitation (accept body and copy), plus
team and guardian copy. `inviteCopy` didn't exist before, and `buildAcceptBody` refused a director who hadn't
answered the identity question.

**After the next mobile build ships:** open a director invitation link in the app, signed out and then signed
in. It reads as helping run the club, asks nothing about players, and accepting makes you a director.
