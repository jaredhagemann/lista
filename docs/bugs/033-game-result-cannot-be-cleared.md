# BUG-033 — A game's result can't be cleared once set

**Severity:** P2
**Status:** Open
**Reported:** 2026-10-15 by the product owner, using the web app
**Area:** events, web
**Evidence class:** Mixed — see below
**Last verified:** `127eb84bd` (main), by code inspection

## Symptom

A coach sets a game's result by mistake, for example on a game that hasn't been played yet. When they edit the
game again, the Result field offers Win, Loss and Tie only, so there is no way to take the result off. The game
keeps counting in the team's Record card: overall, in its league and in its tournament.

## Reproduction

1. On the web, open a game's page and click Edit.
2. Set **Result** to Win and save.
3. Edit the game again and try to unset the result.

**Expected:** a way to set the result back to none, as it was before.
**Actual:** the select lists only Win, Loss and Tie. Scores can be emptied, but the result can't.

**Evidence class.**
- **Reproduced:** the symptom, by the product owner in the web UI. The ticket doesn't say which environment.
- **Static:** the cause, by code inspection.

## Evidence

- `apps/web/src/components/calendar/event-detail.tsx:546-557`: the Result `Select` has three items: `win`,
  `loss` and `tie`. It has no empty option. A Radix `Select` can't return to its placeholder once it has a value.
- `event-detail.tsx:269`: the save already writes `gameResult || null`. An empty value would clear the column;
  the UI just can't produce one.
- `supabase/migrations/20260220000001_locations_and_event_changes.sql`: there's no check linking `game_result`
  to the scores. They are independent columns.
- `apps/web/src/lib/events/team-record.ts:37`: the record counts any game with a result whose start has passed.
  So a result set by mistake on a future game starts counting once the game's start passes.

## Product decisions

| Question | Recommendation | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| Should choosing "No result" also clear the scores? | No. The fields stay independent, as in the database, and the score boxes can already be emptied | Open | | |

## Cause

The edit form's Result select has no "no result" option, and a Radix `Select` can't be cleared to its
placeholder.

## Proposed fix

- Add a **No result** item to the Result select. Radix forbids an empty-string item value, so use a sentinel
  such as `none`, and map it to `null` on save.
- An unset result shows "No result" rather than the placeholder.
- Check whether any other web result input has the same gap. As of this filing, `event-detail.tsx` is the only
  place a result is set.

## Regression test

In `apps/web/tests/`, render the game page's edit form for a game with `game_result: "win"`:
- choose **No result** and save: the update writes `game_result: null`, and the scores are left as they were
- the legitimate path: choosing Loss writes `"loss"`

The first test fails against the current code, because there is no "No result" option to choose.

---

<!-- Everything below is filled in only when the bug is actually fixed, in the same PR. -->

## Fix as implemented

**Branch:** `fix/033-game-result-cannot-be-cleared`
**PR:** #NN
**Migration:** none

## Verification

**Test:** `apps/web/tests/…`
