# Device-local active context — review log

**Purpose:** the ongoing review record for this feature, covering the web and mobile implementation and follow-up fixes.
**Spec:** [Device-local active context](../specs/device-local-active-context.md).
**Implementation inventory:** [Original audit](device-local-active-context-audit.md).
**Last reviewed:** 2026-10-16, [PR #139](https://github.com/jaredhagemann/lista/pull/139) at `ab4e1a1f5ef5a3877483a3b89adbd3c8b5b83406`.
**Current outcome:** request changes to PR #139. DC-003 through DC-005 are open, all P2. The merged web fixes DC-001 and DC-002 are independently verified and resolved. Native-device/TestFlight verification remains outstanding.

## Using this document as the feature changes

- Keep finding IDs stable. Add new findings with the next `DC-NNN` number; do not renumber or remove old findings.
- For each iteration, append a dated entry to **Review history** with the PR, exact commit, scope, verification, and finding status changes.
- Update both the status table and the finding's **Resolution and verification** entry. Record the fixing commit and independent verification before marking a finding resolved.
- Use **Open**, **Implemented — awaiting review**, **Resolved**, or **Accepted risk**. For accepted risks, record the decision and its scope; acceptance does not mean the defect was repaired.
- Keep product decisions in the spec and link them here. Preserve the original reproduction and evidence for follow-up checks.
- Source links below are pinned to the reviewed commit. Line numbers describe that revision, not necessarily the latest file.

## Finding status

| ID | Priority | Finding | Status | Fix / verification |
| --- | --- | --- | --- | --- |
| [DC-001](#dc-001--persist-initialization-before-another-device-can-change-it) | P2 | A shared-default change between render and save leaves the browser uninitialized | Resolved | Fix `603ea0dae`, merged in #138; independently verified at `ab4e1a1f5` |
| [DC-002](#dc-002--stop-consulting-the-legacy-cookie-after-migration) | P2 | A stale legacy profile cookie overrides the expected repair fallback | Resolved | Fix `603ea0dae`, merged in #138; independently verified at `ab4e1a1f5` |
| [DC-003](#dc-003--keep-obsolete-repairs-from-overwriting-newer-local-selections) | P2 | An older automatic repair can overwrite a newer invitation/context save | Open | Two controlled provider probes reproduced the lost selection at `ab4e1a1f5` |
| [DC-004](#dc-004--surface-local-storage-failures-in-switching-and-landing) | P2 | Failed local writes silently report a successful switch or landing | Open | Reproduced a failed switch write with the real provider at `ab4e1a1f5` |
| [DC-005](#dc-005--bind-team-creation-landing-to-the-requesting-account) | P2 | A delayed creation response can overwrite another account's saved context | Open | Reproduced with the real creation screen/helper and storage at `ab4e1a1f5` |

## Web findings

### DC-001 — Persist initialization before another device can change it

**Priority / status:** P2 / Resolved.
**Source:** [`saveActiveContext`, lines 23–24](https://github.com/jaredhagemann/lista/blob/2a27672f6628c6e23c7b6704c9bb810f5d50edce/apps/web/src/app/actions/context.ts#L23-L24), together with the [client effect, lines 11–16](https://github.com/jaredhagemann/lista/blob/2a27672f6628c6e23c7b6704c9bb810f5d50edce/apps/web/src/components/layout/save-active-context.tsx#L11-L16).

The dashboard chooses a team while rendering, but saves that choice later through a client effect. The save action independently recomputes the default and refuses the originally rendered tuple if another device has changed the shared preference in the meantime. The client does not handle the returned `saved: false`, so the browser remains without a valid saved context. Its next load can follow the other device's selection. This defeats the first-load persistence required by spec D2 and section 5; the same structure applies to repairs under D3.

**Reproduction:**

1. Use an account with no direct team membership that manages one child on Club and Rec. Start this browser without `lista_context`; set the child's shared `active_team_id` to Club.
2. Call the real `loadActiveContext`. It renders Club and returns a tuple to save for that child and Club.
3. Before the save request, simulate another device selecting Rec by changing the child's shared `active_team_id` to Rec.
4. Call the real `saveActiveContext` with the profile/team returned in step 2.
5. Reload the context through the real resolver.

**Observed:** the save action returned `{ saved: false }`, no `lista_context` cookie was written, and the next load selected Rec instead of the rendered Club. A controlled probe used the real resolver, save action and cookie writer, with filter-aware database and cookie mocks. An assertion that the next load retained Club failed.

**Requested change:** establish and persist initialization/repair at a writable server boundary before rendering, as described in spec section 5, or safely persist the originally rendered tuple after revalidating ownership and membership without making it depend on an unchanged shared default. Preserve protection against overwriting a newer local selection and against saving after a failed read.

**Regression coverage:** change the shared default between the render-time read and initialization save; the browser must retain a valid local selection consistent with what was rendered. Also exercise a repair, an intervening explicit switch on this browser, and a failed authorization/data read. Test the actual persistence path rather than directly inserting `context.save` into a simulated cookie jar.

**Resolution and verification:** Resolved. Fix `603ea0dae`, merged in PR #138 as `2dbd693e0aa384fd285fba1e0ddb0d1d78277dac`, independently checked at `ab4e1a1f5ef5a3877483a3b89adbd3c8b5b83406` on 2026-10-16. The action now validates the rendered tuple using `failed`, `keptSaved` and `allows` instead of requiring an unchanged shared default. All 46 focused web context tests passed, including the real save path for seed/repair default changes, preservation of an intervening valid local switch, failed reads, removed memberships and forged profiles. No real-stack browser run was performed.

Implementation recorded in `603ea0dae` (2026-10-16), following the second option in the requested change:
- **Saves what was rendered:** `saveActiveContext` saves the rendered tuple, not a fresh choice. Another
  device's default change in between no longer refuses it.
- **Still checked first.** It saves only when:
  - every read succeeded (`failed`)
  - this device has no valid saved context, so a switch here since is kept (`keptSaved`)
  - the person is the account's own or managed, and on that team, not archived while another exists
    (`allows`, from the new `usableMembership`)
- **The test path is real:** `active-context-load.test.tsx` now renders with the real `loadActiveContext`, and
  saves through the real `saveActiveContext` and `saveContextCookie` into a per-device cookie jar.

### DC-002 — Stop consulting the legacy cookie after migration

**Priority / status:** P2 / Resolved.
**Source:** [`chooseContext`, lines 88–89](https://github.com/jaredhagemann/lista/blob/2a27672f6628c6e23c7b6704c9bb810f5d50edce/apps/web/src/lib/active-context.ts#L88-L89), together with the [cookie writer, lines 13–16](https://github.com/jaredhagemann/lista/blob/2a27672f6628c6e23c7b6704c9bb810f5d50edce/apps/web/src/lib/active-context-save.ts#L13-L16).

The chooser puts `legacyProfileId` ahead of the account's own profile whenever the canonical context cannot be retained. Ordinary context writes do not retire the old cookie. Consequently, a profile selection superseded during migration can affect a later repair, contrary to spec section 5's rule that `active_profile_id` is read once and then ignored. This changes which person and team the browser opens after membership loss; it does not bypass the own/managed authorization check.

**Reproduction:**

1. The account has its own coaching-team membership, a daughter on Club, and a son whose Rec membership has just been removed. Both children remain managed profiles.
2. The browser's canonical tuple selects the son on Rec. A leftover legacy `active_profile_id` still selects the daughter from before migration.
3. Resolve the context with the real `chooseContext`.

**Observed:** the chooser selected the daughter on Club. With the son's membership unavailable, the expected fallback is the account's own valid team; the obsolete legacy cookie took precedence. A controlled assertion expecting the account's own profile failed.

**Requested change:** consult the legacy profile cookie only during initial migration, not while repairing a canonical context. Retire the legacy cookie when saving the new context, accounting for the existing host-only and `.lista.team` cookie scopes. Ignoring legacy selection after migration is still necessary where an old cookie on another host cannot be cleared immediately.

**Regression coverage:** migrate with a legacy child cookie, select another child or the account's own profile, then remove the selected child's final membership or guardian link. The old selection must not reappear during repair. Include host/domain legacy-cookie variants and retain the existing initial-migration test.

**Resolution and verification:** Resolved. Fix `603ea0dae`, merged in PR #138 as `2dbd693e0aa384fd285fba1e0ddb0d1d78277dac`, independently checked at `ab4e1a1f5ef5a3877483a3b89adbd3c8b5b83406` on 2026-10-16. All 46 focused web context tests passed, including repair past a stale legacy child, removal of the saved guardian link, first migration with another account's tuple, and legacy-cookie retirement. Source inspection confirms a surviving legacy cookie is ignored once this account has a canonical tuple. Actual host/domain duplicate cookies were not exercised in a browser.

Implementation recorded in `603ea0dae` (2026-10-16):
- **Initial migration only:** `chooseContext` consults `legacyProfileId` only while this account has no saved
  tuple. Another account's tuple counts as none.
- **Retired on save:** every `saveContextCookie` also clears `active_profile_id`, in the context cookie's scope:
  `.lista.team` in production with routing, else host-only. One response can clear only one scope of a cookie
  name, so a copy left in the other scope may survive. The chooser ignores it once a tuple exists.

## Mobile findings

### DC-003 — Keep obsolete repairs from overwriting newer local selections

**Priority / status:** P2 / Open.
**Source:** [automatic persistence in `AppContext.tsx`, lines 173–175](https://github.com/jaredhagemann/lista/blob/ab4e1a1f5ef5a3877483a3b89adbd3c8b5b83406/apps/mobile/contexts/AppContext.tsx#L173-L175), together with [the load effect without cancellation, lines 187–189](https://github.com/jaredhagemann/lista/blob/ab4e1a1f5ef5a3877483a3b89adbd3c8b5b83406/apps/mobile/contexts/AppContext.tsx#L187-L189) and [the storage writer, lines 174–181](https://github.com/jaredhagemann/lista/blob/ab4e1a1f5ef5a3877483a3b89adbd3c8b5b83406/apps/mobile/lib/active-context.ts#L174-L181).

The load counter prevents some stale database results from reaching React state, but does not consistently protect persisted context. Unmounting the provider does not invalidate its pending load. That load can later write a repair chosen from an old storage snapshot, replacing a context saved by the invitation screen after navigation. The guard after `await saveContext` also runs too late to stop an already-started storage write from replacing a newer selection.

**Reproduction A — pending read after unmount:**

1. Mount the real provider with the daughter selected on Rec. Keep the son on Rec and the daughter on Club as other valid memberships.
2. Remove the daughter's Rec membership and start a refresh, holding its membership query after it has read the old stored tuple.
3. Unmount the provider, as when leaving the app route group for an invitation screen.
4. Save the invitation's landing tuple, son/Rec, through the real `saveContext`; confirm it is stored.
5. Release and await the older refresh.

**Observed:** the unmounted provider overwrote son/Rec with daughter/Club. No load-generation cleanup cancelled that old work.

**Reproduction B — pending write while mounted:** hold the repair's `SecureStore.setItemAsync`, save son/Rec explicitly, then release the older repair write. **Observed:** storage and the displayed context reverted to daughter/Club. Both expected-behavior probes failed using the real provider, chooser, notifier and storage wrapper, with controlled database/storage promises.

**Requested change:** invalidate pending work when the provider unmounts and coordinate automatic initialization/repair writes with newer explicit context saves. Use cancellation/revision checks at the persistence boundary or ordered writes so a stale automatic choice cannot replace a newer local selection. A React-state guard after the write is insufficient.

**Regression coverage:** preserve a later invitation landing after an old provider unmounts, after a pending automatic write, and after a newer explicit switch. Check both stored and displayed context; retain the existing stale-read/account-change controls.

**Resolution and verification:** Open. No fix reviewed.

### DC-004 — Surface local storage failures in switching and landing

**Priority / status:** P2 / Open.
**Source:** [`switchTo`, lines 215–218](https://github.com/jaredhagemann/lista/blob/ab4e1a1f5ef5a3877483a3b89adbd3c8b5b83406/apps/mobile/contexts/AppContext.tsx#L215-L218). The same unchecked result appears in [team creation, lines 46–49](https://github.com/jaredhagemann/lista/blob/ab4e1a1f5ef5a3877483a3b89adbd3c8b5b83406/apps/mobile/app/%28app%29/create-team.tsx#L46-L49) and [invitation landing, lines 118–121](https://github.com/jaredhagemann/lista/blob/ab4e1a1f5ef5a3877483a3b89adbd3c8b5b83406/apps/mobile/app/invite/%5Bid%5D.tsx#L118-L121).

`saveContext` catches SecureStore errors and returns `false`, but these callers discard that result and finish their normal success paths. With a previously valid local tuple, a failed switch write reloads the old tuple; the switch promise resolves normally, the sheet closes, and the chosen team is never selected. Creation and invitation screens likewise continue without establishing their promised landing context.

**Reproduction:** mount the real provider with daughter/Rec saved, reject the next `SecureStore.setItemAsync`, and call `switchTeam(Club)`.

**Observed:** the promise resolved without an error, stored/displayed context remained daughter/Rec, and the shared database default was changed to Club. A controlled assertion that the failed local switch is reported failed. The existing storage-failure test only rejects reads, not writes.

**Requested change:** handle the write result explicitly and surface a recoverable failure rather than reporting a completed switch/landing. Keep storage failure distinct from a team creation or invitation acceptance that already succeeded on the server, so retrying context persistence does not repeat the server mutation. Keep switching/loading state cleanup reliable.

**Regression coverage:** reject context writes for a switch, team creation and invitation acceptance. Verify the user receives failure/retry feedback, no successful local landing is claimed, and an accepted invitation or created team is not submitted again merely to retry the local save.

**Resolution and verification:** Open. No fix reviewed.

### DC-005 — Bind team creation landing to the requesting account

**Priority / status:** P2 / Open.
**Source:** [the `landOnTeam` callback, lines 46–49](https://github.com/jaredhagemann/lista/blob/ab4e1a1f5ef5a3877483a3b89adbd3c8b5b83406/apps/mobile/app/%28app%29/create-team.tsx#L46-L49), together with [request authentication, lines 42–44](https://github.com/jaredhagemann/lista/blob/ab4e1a1f5ef5a3877483a3b89adbd3c8b5b83406/apps/mobile/app/%28app%29/create-team.tsx#L42-L44).

The request obtains its access token before the POST, but the landing callback obtains the account ID from a second `getSession` after the response. If account A signs out and B signs in while the POST is pending, A's new team is written into B's account-specific key, replacing B's valid saved selection. Validating membership later does not restore B's overwritten preference.

**Reproduction:**

1. Give B a valid stored context on team B.
2. Render the real creation screen as A and submit a new team; hold the API response. Confirm the request carries A's Bearer token.
3. Change the current session to B, then return A's successful creation response with team A's ID.
4. Let the real screen callback and storage helper complete.

**Observed:** `lista_context.B` became `{ accountId: B, profileId: B, teamId: teamA }`, replacing B/teamB. A's context key was not updated, and navigation still ran. The expected-behavior assertion that B's stored selection remained unchanged failed. The probe used the real creation screen, creation helper and storage wrapper, with mocked session/router/network/native storage boundaries.

**Requested change:** capture the initiating account together with the access token before submission. Bind the response to that account; if the active account changes or the operation becomes obsolete, skip effects on the new account and its navigation/provider. Never combine a team's response for one account with the current identity from another session.

**Regression coverage:** hold creation across A-to-B sign-in and sign-out-only transitions. Assert B's saved context is unchanged, no obsolete refresh/navigation occurs, and the normal same-account landing still succeeds.

**Resolution and verification:** Open. No fix reviewed.

## Review history

### 2026-10-16 — Web implementation, PR #138

- **Revision:** `2a27672f6628c6e23c7b6704c9bb810f5d50edce`, against merge base `b1de03b13841106026640ef8d02633e36100d720`. The PR head was checked again at the end of the review and was unchanged.
- **Scope:** all 33 PR files, including the shared resolver, canonical cookie, initialization action/effect, profile/team switches, dashboard and club readers, training/settings, team creation, invitation landing, additive API fields, and test/spec changes. Traced legacy consumers, authentication, deep links and browser-test setup.
- **Outcome:** opened DC-001 and DC-002, both P2. Request changes before merge.
- **Product rules:** reviewed against the accepted spec D1–D7. Continuing to write `profiles.active_team_id` as the last-picked default is intentional under D2, superseding the original audit's recommendation to stop switch writes. The database-based billing API default and the separate mobile release are also intentional.
- **Independent verification:** 214 focused web tests passed across 18 files. `pnpm --filter @lista/web exec tsc --noEmit` passed. `git diff --check` passed.
- **Focused test files:** `active-context`, `active-context-load`, `active-context-actions`, `active-context-landing`, `set-active-team`, `create-team-form`, `create-team-form-component`, `event-link-other-team`, `dashboard-layout-branding`, `subdomain-redirect-keeps-page`, `status-api`, `profile-actions`, `invite-accept-api`, `director-invite-accept`, `api-teams`, `club-api`, `middleware`, and `api-auth`.
- **Additional probes:** two expected-behavior assertions failed, reproducing DC-001 and DC-002 with real implementation functions and mocked persistence/data boundaries. The temporary `apps/web/tests/pr138-review-probe.test.ts` was removed afterward. The failure sequences and observations are preserved above.
- **Coverage gap:** the existing load tests directly copy `context.save` into the simulated device cookie jar, bypassing the real save action. The layout test replaces `SaveActiveContext` with a marker, and the save-action tests mock the resolver. Those tests pass without exercising the DC-001 render/save interleaving.
- **CI:** GitHub reported Unit tests, Web app tests, Mobile tests, RLS integration tests, staging migration, and Vercel successful; production migration was skipped. [Tests run](https://github.com/jaredhagemann/lista/actions/runs/38980217212). These reported checks do not cover the reproduced cases.
- **Limits:** no full local suite rerun, real-stack browser run, local database/RLS integration, native-device check, or production/staging data inspection was performed. No database reset or remote mutation was performed.
- **Review record:** findings were initially delivered as inline comments in the Codex chat. This document records that review afterward at the user's request. This log and its spec backlink are the only retained edits; no application edits, commits, pushes, or published GitHub comments. The existing untracked screenshot was preserved.

### 2026-10-16 — DC-001 and DC-002 fixes, PR #138

- **Revision:** `603ea0dae`, on `ddde812b4`. The review round above was committed as written in `ddde812b4`.
- **Scope:** `lib/active-context.ts`, `lib/active-context-save.ts` and `app/actions/context.ts`, with tests in
  `active-context`, `active-context-load` and `active-context-actions`.
- **Status changes:** DC-001 and DC-002, Open → Implemented — awaiting review.
- **Regression coverage:**
  - DC-001, 6 tests in `active-context-load`, through the real save path:
    - the default changes between render and save, for a seed and for a repair: the rendered team is kept
    - a switch on this browser in between is kept
    - a read fails at save time
    - the team is gone by save time
    - a teammate's profile is passed in
  - DC-002, 3 chooser tests:
    - a repair falls back to the account's own team, past a stale legacy child
    - the same when the saved child is no longer managed
    - another account's tuple still lets the legacy cookie seed
  - DC-002, 1 load test: a save retires the legacy cookie, with `maxAge: 0`.
  - The 4 save-action unit tests are rewritten for the new rules.
- **Local verification:**
  - Against `2a27672f6`'s source, 5 of the new tests fail: both DC-001 interleavings, the cookie retirement,
    and both repair fallbacks. The others pass on both, as controls.
  - Web passes 1,595 of 1,595 in 118 files. `tsc --noEmit` and eslint are clean on the changed files.
- **Not covered:** the host-only legacy copy can't be cleared in the same response as the domain one. It's
  ignored instead, and there's no test of a browser holding both copies.

### 2026-10-16 — Independent web-fix verification and mobile implementation, PR #139

- **Revision:** `ab4e1a1f5ef5a3877483a3b89adbd3c8b5b83406`, against main/merge base `2dbd693e0aa384fd285fba1e0ddb0d1d78277dac`. PR #138 is merged at that base. The PR #139 head was checked again after the probes and remained unchanged.
- **Scope:** all 15 PR files: mobile storage/chooser, `AppProvider`, creation and invitation paths, removed hook, new/changed tests, development/release/spec documentation, and the comment-only web chooser change. Also traced the provider's route placement, session routing, switcher completion, and merged web fixes.
- **Status changes:** DC-001 and DC-002, Implemented — awaiting review → Resolved. Opened DC-003, DC-004 and DC-005, all P2. Request changes to PR #139.
- **Independent mobile verification:** `pnpm --filter @lista/mobile exec jest --runInBand` passed all **256 tests in 27 suites**. Mobile `tsc --noEmit` passed. The suite emitted React key/act warnings and an Expo Go push warning, without test failures; these warnings are outside this PR's findings.
- **Independent web verification:** **46 tests in three files** passed: `active-context`, `active-context-load` and `active-context-actions`. Inspected the real save action and cookie writer before closing DC-001/DC-002. No full web-suite rerun was needed for PR #139's comment-only web change.
- **Additional probes:** four expected-behavior assertions failed across the three new findings: two obsolete-repair/landing interleavings, a failed local switch write, and a creation response crossing accounts. The provider probe reused the PR's filter-aware database/session/native-storage harness and exercised the real implementation; its 13 original control tests passed. The creation probe used the real screen and helper. Temporary probe sources were removed afterward; reproduction steps and observations are preserved above.
- **Coverage gaps:** existing account tests hold a database read until a newer account load starts; they do not cover writes already started or provider unmount. The storage-failure tests fail reads, while writes always succeed. Creation-helper tests mock `landOnTeam`, bypassing the screen's second session lookup.
- **CI:** GitHub reported Unit tests, Web app tests, Mobile tests, RLS integration tests, staging migration and Vercel successful; production migration was skipped. [Tests run](https://github.com/jaredhagemann/lista/actions/runs/39000068428). These reported checks do not cover the four failing probes.
- **Limits:** no simulator/native-device/TestFlight run, real-stack browser run, local database reset/integration run, production data inspection, or deployment. Release smoke checks remain outstanding.
- **Review changes:** this log is the only retained edit. No application edits, commits, pushes or published GitHub comments. The existing untracked screenshot was preserved.

Append subsequent review rounds here, including the exact revision and verification for every status change.
