# Device-local active context — review log

**Purpose:** the ongoing review record for this feature, covering the web and mobile implementation and follow-up fixes.
**Spec:** [Device-local active context](../specs/device-local-active-context.md).
**Implementation inventory:** [Original audit](device-local-active-context-audit.md).
**Last reviewed:** 2026-10-16, [PR #138](https://github.com/jaredhagemann/lista/pull/138) at `2a27672f6628c6e23c7b6704c9bb810f5d50edce`.
**Current outcome:** request changes. DC-001 and DC-002 are open, both P2. Mobile remains the next implementation part; its absence is not a finding against this web PR.

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
| [DC-001](#dc-001--persist-initialization-before-another-device-can-change-it) | P2 | A shared-default change between render and save leaves the browser uninitialized | Open | Reproduced with the real resolver and save action at `2a27672f6` |
| [DC-002](#dc-002--stop-consulting-the-legacy-cookie-after-migration) | P2 | A stale legacy profile cookie overrides the expected repair fallback | Open | Reproduced with the real chooser at `2a27672f6` |

## Web findings

### DC-001 — Persist initialization before another device can change it

**Priority / status:** P2 / Open.
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

**Resolution and verification:** Open. No fix reviewed.

### DC-002 — Stop consulting the legacy cookie after migration

**Priority / status:** P2 / Open.
**Source:** [`chooseContext`, lines 88–89](https://github.com/jaredhagemann/lista/blob/2a27672f6628c6e23c7b6704c9bb810f5d50edce/apps/web/src/lib/active-context.ts#L88-L89), together with the [cookie writer, lines 13–16](https://github.com/jaredhagemann/lista/blob/2a27672f6628c6e23c7b6704c9bb810f5d50edce/apps/web/src/lib/active-context-save.ts#L13-L16).

The chooser puts `legacyProfileId` ahead of the account's own profile whenever the canonical context cannot be retained. Ordinary context writes do not retire the old cookie. Consequently, a profile selection superseded during migration can affect a later repair, contrary to spec section 5's rule that `active_profile_id` is read once and then ignored. This changes which person and team the browser opens after membership loss; it does not bypass the own/managed authorization check.

**Reproduction:**

1. The account has its own coaching-team membership, a daughter on Club, and a son whose Rec membership has just been removed. Both children remain managed profiles.
2. The browser's canonical tuple selects the son on Rec. A leftover legacy `active_profile_id` still selects the daughter from before migration.
3. Resolve the context with the real `chooseContext`.

**Observed:** the chooser selected the daughter on Club. With the son's membership unavailable, the expected fallback is the account's own valid team; the obsolete legacy cookie took precedence. A controlled assertion expecting the account's own profile failed.

**Requested change:** consult the legacy profile cookie only during initial migration, not while repairing a canonical context. Retire the legacy cookie when saving the new context, accounting for the existing host-only and `.lista.team` cookie scopes. Ignoring legacy selection after migration is still necessary where an old cookie on another host cannot be cleared immediately.

**Regression coverage:** migrate with a legacy child cookie, select another child or the account's own profile, then remove the selected child's final membership or guardian link. The old selection must not reappear during repair. Include host/domain legacy-cookie variants and retain the existing initial-migration test.

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

Append subsequent review rounds here, including the exact revision and verification for every status change.
