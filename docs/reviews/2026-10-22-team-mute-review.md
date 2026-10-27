# Team mute — review log

**Purpose:** the ongoing review record for the team-mute implementation and follow-up fixes.
**Spec:** [Team notification controls, section 3](../specs/team-notification-controls.md#3-member-team-mute).
**Last reviewed:** 2026-10-22, [PR #141](https://github.com/jaredhagemann/lista/pull/141) at `b52c59ef4cb3e66baf228372b96014aaa760b75f`, against base `8e08456a93b121a43f9c52fbfed89417944b72f5`.
**Current outcome:** request changes. Fixes for TM-001 and TM-002 are implemented at `fec7fa9eb` and await review.

## Using this document as the feature changes

- Keep finding IDs stable. Add new findings with the next `TM-NNN` number; do not renumber or remove old findings.
- Append a dated entry to **Review history** with the PR, exact commit, scope, verification, and finding status changes.
- Update the status table and each finding's **Resolution and verification** entry. Record the fixing commit and independent verification before marking a finding resolved.
- Use **Open**, **Implemented — awaiting review**, **Resolved**, or **Accepted risk**. Record the decision and scope for accepted risks.
- Source links are pinned to the reviewed commit. Line numbers describe that revision.

## Finding status

| ID | Priority | Finding | Status | Fix / verification |
| --- | --- | --- | --- | --- |
| [TM-001](#tm-001--track-pending-saves-separately-for-each-team) | P2 | Overlapping saves can leave a team switch disagreeing with the database | Implemented — awaiting review | Fixed in `fec7fa9eb`; regression test fails at `b52c59ef4`, passes at the fix |
| [TM-002](#tm-002--align-mute-eligibility-with-archived-team-recipients) | P2 | Archived-team members can receive reminders but cannot mute that team | Implemented — awaiting review | Fixed in `fec7fa9eb`; regression test fails at `b52c59ef4`, passes at the fix |

## Findings

### TM-001 — Track pending saves separately for each team

**Priority / status:** P2 / Implemented — awaiting review.
**Source:** [`setTeamOn`, lines 54–65](https://github.com/jaredhagemann/lista/blob/b52c59ef4cb3e66baf228372b96014aaa760b75f/apps/web/src/components/settings/team-mutes-section.tsx#L54-L65), together with the [switch's disabled condition, line 109](https://github.com/jaredhagemann/lista/blob/b52c59ef4cb3e66baf228372b96014aaa760b75f/apps/web/src/components/settings/team-mutes-section.tsx#L109).

The component uses one `saving` team ID for all switches. Starting a save for a second team replaces the first team's ID, enabling the first switch while its write is still pending. The user can then submit conflicting writes to the same team. Completion of any request also clears `saving`, regardless of other pending requests.

**Reproduction:**

1. Render the real `TeamMutesSection` with teams A and B, both unmuted, and hold database requests pending.
2. Turn A off. Its mute upsert is pending and A is disabled.
3. Turn B off. `saving` becomes B, enabling A before A's upsert finishes.
4. Turn A on again. This starts a delete for A while its earlier upsert remains pending.
5. Complete A's delete successfully, then complete A's earlier upsert successfully. Complete B's save successfully.

**Observed:** the final database state contains A's mute, but A's switch shows notifications enabled. The controlled component probe modeled persistence when each write completed; the assertion that the rendered switch matched persistence failed (`true` displayed, `false` expected). All three writes succeeded, so no save-error message explains the mismatch.

**Requested change:** track pending saves per team and keep each team's switch disabled until its own save completes, or serialize writes so an older operation cannot replace the user's latest choice. Completion of an unrelated request must not enable another team's pending switch.

**Regression coverage:** hold saves for two teams independently, complete them in either order, and verify each pending team remains disabled. Verify successful and failed saves leave each switch consistent with the persisted result. If repeated same-team changes are allowed, exercise out-of-order completions explicitly.

**Resolution and verification:** Implemented in `fec7fa9eb`, awaiting review. `saving` is now a set of team IDs: each switch stays disabled until its own save settles, and another team settling never re-enables it. Because a pending team cannot be clicked, same-team writes cannot overlap, so out-of-order completion for one team cannot occur. Regression test `keeps each team's switch disabled until its own save finishes, in either order` (`apps/web/tests/team-mutes-section.test.tsx`) holds both saves, checks a second click on a pending team starts no write, settles B first (A stays disabled, B shows muted), then fails A (A re-enabled and reverted). It failed at `b52c59ef4` (A enabled once B started) and passes at the fix.

### TM-002 — Align mute eligibility with archived-team recipients

**Priority / status:** P2 / Implemented — awaiting review.
**Source:** [mute policy, lines 30–33](https://github.com/jaredhagemann/lista/blob/b52c59ef4cb3e66baf228372b96014aaa760b75f/supabase/migrations/20261022000000_team_notification_mutes.sql#L30-L33), together with the [Settings team filter, lines 130–135](https://github.com/jaredhagemann/lista/blob/b52c59ef4cb3e66baf228372b96014aaa760b75f/apps/web/src/app/dashboard/settings/page.tsx#L130-L135).

The mute policy requires `is_team_member(team_id)`, which returns false for regular members once their team is archived. Settings also excludes archived teams. However, the reminder cron queries events using the service role, without excluding archived teams, and the recipient resolver still expands their roster. A previously unmuted member can therefore keep receiving reminders from an archived team with no available team-mute control. This contradicts section 3.1's requirement that Settings cover the same teams through which the resolver reaches the adult.

**Reproduction:**

1. Create a team and an authenticated player membership against local Supabase.
2. Archive the team without removing its roster.
3. Call the real `resolveRecipients` as the service role with `category: "event"` and that team ID, as the reminder cron does.
4. Use the player's authenticated client to insert their own `team_notification_mutes` row for the team.

**Observed:** the resolver returned the player with `emailEnabled: true`, but inserting their own mute failed with SQLSTATE `42501`: `new row violates row-level security policy for table "team_notification_mutes"`. Source inspection confirmed the reminder query has no archived-team exclusion and Settings hides the team. The probe verified recipient eligibility and the RLS rejection; it did not send a real reminder email.

**Requested change:** make the notification audience and mute eligibility consistent. Either suppress notifications from archived teams or allow their actual recipients to find and manage a team mute. Changing only the Settings filter does not fix the RLS rejection for regular members.

**Regression coverage:** archive a team with an upcoming event and verify the chosen behavior through the reminder handler, Settings, and mute RLS. Include a guardian who receives through a managed player, and verify existing mutes remain effective after archiving.

**Resolution and verification:** Implemented in `fec7fa9eb`, awaiting review. Chosen behavior: **suppress notifications from archived teams.** Archiving hides a team from its whole roster, coaches and managers included (`is_team_member` and `is_team_admin` admit only org admins), so no recipient could see what it sent; letting them mute a team they cannot see would not help. `resolveRecipients` reads the team (`teamId`, or `muteScopeTeamId` for chat) and returns no one when it is archived; a failed read throws, like a failed mutes read, so the worker retries and the reminder cron reports the event. This covers reminders, event notices and chat push through the one resolver. Team deletion notices bypass the resolver and still go out (D3). The mute RLS and the Settings filter are unchanged: existing mutes survive archiving, apply again on restore, and the member can still delete theirs (the delete policy checks only ownership). Spec §3.1 records the rule.

Regression coverage: `tests/rls/notification-recipients.test.ts` — archived teams reach nobody (a member, a guardian through a managed player, and the coach; event and chat by team; chat by named members with `muteScopeTeamId`), failing at `b52c59ef4` and passing at the fix; and keep their mutes once restored. `tests/rls/team-notification-mutes.test.ts` — an archived team's mute stays and its member can still remove it. Not covered: the reminder handler end to end, whose only test file mocks the events read to fail; it calls the same resolver with the event's `team_id`.

## Review history

### 2026-10-22 — Initial implementation, PR #141

- **Revision:** `b52c59ef4cb3e66baf228372b96014aaa760b75f`, against base `8e08456a93b121a43f9c52fbfed89417944b72f5`. The remote PR head was checked again after verification and remained unchanged.
- **Scope:** team-mute schema and RLS, event/reminder/chat recipient resolution, delivery skip reasons, Settings controls, and email footer links. Coach reminder controls and mobile UI are separate delivery stages in the spec.
- **Product decisions:** used the revised D4, which explicitly permits team admins to read mute status. The earlier spec-review privacy finding is therefore not treated as an implementation defect in this review.
- **Status changes:** opened TM-001 and TM-002, both P2. Request changes.
- **Existing unit/component tests:** **47 passed in six files**: `team-mute-delivery`, `team-mute-email-footer`, `team-mutes-section`, `notification-dispatch`, `notifications-cron`, and `notification-times`.
- **Existing local integration tests:** **24 passed in two files**: `tests/rls/team-notification-mutes.test.ts` and `tests/rls/notification-recipients.test.ts`. Used the running local Supabase stack without a database reset or migration.
- **Additional review probes:** two expected-behavior assertions failed, reproducing TM-001 and TM-002. Temporary probe files were removed after verification; the reproduction steps and observed results are preserved above.
- **Other checks:** `git diff --check` passed for the reviewed PR diff. No full-suite rerun, browser end-to-end run, native-device verification, staging/production verification, or independent CI validation was performed. No application or permanent test source was changed during the review.

### 2026-10-22 — Fixes for TM-001 and TM-002

- **Revision:** `fec7fa9ebcfb3115239b2664b33fc9e86b9b2a3a` on `feature/team-mute` (PR #141), on top of `b52c59ef4`.
- **Scope:** `team-mutes-section.tsx` (per-team saving state), `recipients.ts` (archived teams resolve to no one), spec §3.1, and regression tests.
- **Status changes:** TM-001 and TM-002 moved to Implemented — awaiting review. Both regression tests were written first and failed against `b52c59ef4`.
- **Unit/component tests:** **1,613 passed in 121 files**.
- **Local integration tests:** **670 of 671 passed** in a full RLS run on a freshly restarted local stack. The one failure, `chat-access` › "a participant cannot re-point the conversation at someone else", is outside this change and passed on rerun (20/20 in that file).
- **Other checks:** `tsc --noEmit` and ESLint clean. No browser, device, staging or CI verification.
