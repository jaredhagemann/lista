# BUG-002 merged-fix review — September 16, 2026

**Conclusion: BUG-002 is not fully closed. Two reproducible authorization bypasses remain, plus a player self-service defect.** The original direct `profile_managers` insertion is blocked, and the new identity/deletion safeguards pass the focused tests, but the invitation paths can still grant unauthorized access.

Reviewed [PR #56](https://github.com/jaredhagemann/lista/pull/56), head `d8ac768dc64085945fb1e9637e1a9f4950864ad7`, merged as `e664131b734e9881a27bfb17b58205a0f175a612`. The checkout matched the PR head at review start and advanced to the merge commit during review. Local Supabase had migration `20260917000000` applied for the probes. These findings describe the merged fix, excluding concurrent uncommitted invitation-acceptance work; they are not claims about observed production exploitation. No production data or deployed policy state was inspected.

## 1. P0 — A coach can manufacture the membership used to authorize a global guardian invitation

**Location:** [can_invite_guardian_for, lines 119–124](C:/Users/jared/Projects/lista/supabase/migrations/20260917000000_protect_guardian_links.sql:119). The same assumption appears in the [server invitation check](C:/Users/jared/Projects/lista/apps/web/src/app/api/invitations/send/route.ts:54).

The new check trusts the existence of a `team_members` row for the target child on the inviter's team. However, a team admin can insert that row themselves for any known profile UUID: BUG-001 deliberately retained `is_team_admin(team_id)` as sufficient admission authorization.

**Reproduced sequence:**

1. A child belongs to club A; the attacker initially has no access to that club.
2. The attacker owns an unrelated team B, which any signed-in user can legitimately create.
3. Using their ordinary authenticated client, the attacker inserts the child's UUID into team B as a player.
4. The attacker creates a guardian invitation for that child, addressed to their own email.
5. The actual invitation-acceptance API handler accepts it as a guardian invitation.
6. The attacker now has global guardianship: `is_team_member(club_A_team)` changes from false to true, and an update to the child's name succeeds.

No pre-existing relationship, stolen invitation, recipient-email mismatch, or attacker-held service-role key is required. The probe uses the service role only to set up legitimate test fixtures and verify/clean up results; attack writes use an authenticated client and the application's acceptance handler.

**Required correction:** distinguish authorized admission of an existing shared identity from a roster row that a coach can create unilaterally. An attacker-created roster association must not establish global family authority. Closing only the guardian invitation query cannot solve this while the prerequisite membership remains freely manufacturable. Preserve legitimate staff invitations through a verified player/guardian admission path and test the complete admission → invitation → acceptance sequence.

**Missing regression:** a coach first adds someone else's existing child to their own team, then attempts global guardianship. The current unrelated-coach test starts without that membership and therefore misses the bypass.

## 2. P0 — Guardian invitations can be redeemed as team-role invitations

**Locations:** [new invitation INSERT policy](C:/Users/jared/Projects/lista/supabase/migrations/20260917000000_protect_guardian_links.sql:132), [guardian authorization branch](C:/Users/jared/Projects/lista/supabase/migrations/20260917000000_protect_guardian_links.sql:116), and [acceptance handler's self branch](C:/Users/jared/Projects/lista/apps/web/src/app/api/invite/[id]/accept/route.ts:71).

For a non-null `managed_profile_id`, insertion requires guardianship of that profile but does not restrict the invitation's role or require authority over its `team_id`. Separately, the acceptance API trusts the caller's `type`; `type: "self"` creates a team membership even when the stored invitation is for managing an existing player.

**Reproduced sequence:**

1. An ordinary user has a managed child and no role on target team A.
2. They insert an invitation addressed to their own email, with their own child's `managed_profile_id`, target team A's UUID, and `role: "coach"`.
3. They call the actual acceptance handler with `type: "self"`.
4. The handler returns 200 and `is_team_admin(team_A)` changes from false to true.

The recipient email matches. Fixing BUG-012's missing web-action email check alone will not fix this attack. This is a pre-existing invitation-type weakness that survives the revised policies; it overlaps BUG-012's type/role-validation scope and defeats the combined BUG-001/002 access boundary.

**Required correction:** derive the invitation purpose from validated stored data, reject incompatible acceptance modes, and ensure guardian invitations can create guardian links only. Validate purpose/role combinations at creation and acceptance, including direct database insertion and every web/native acceptance entry point. A guardian's permission to invite another guardian must never imply permission to assign a team role.

**Missing regression:** a self-addressed, correctly authenticated guardian invitation redeemed as a coach/team-member invitation. Testing only non-recipient acceptance is insufficient.

## 3. P2 — Removing the player's Self link disables their own guardian controls

**Locations:** [Self-link deletion allowance](C:/Users/jared/Projects/lista/apps/web/src/app/actions/managers.ts:46), [player authority inferred from Self link](C:/Users/jared/Projects/lista/supabase/migrations/20260917000000_protect_guardian_links.sql:115), and [UI removal permission](C:/Users/jared/Projects/lista/apps/web/src/app/dashboard/team/[memberId]/page.tsx:104).

The action expressly permits a player to delete their own Self link, and the managers UI exposes removal for that row. The new invitation helper identifies the player only via `is_managed_by_me`, which depends on that same link. The page likewise determines guardian-removal access from the link list.

**Reproduced:** an ordinary player initially has `can_invite_guardian_for(...)` = true. Deleting their own Self link succeeds. The helper then returns false, and trying to recreate that link fails under the newly removed INSERT policy. The player's independent login is still valid, so the last-guardian trigger does not prevent the operation.

This is a Self-link lifecycle gap: deletion was already possible, but the fix removes the previous direct restoration path and adds a helper that depends on the removable row. A player should retain D1's authority over their own profile independently of an optional contact/link record.

**Required correction:** either make Self links immutable and hide their removal action, or derive player authority directly from authenticated ownership in the invitation checks and UI. Cover the service action, direct deletion policy, and existing missing-Self records consistently.

## Validation and limits

- **49 existing database tests passed:** `profile-managers.test.ts` (31) and `invitations.test.ts` (18).
- **32 focused web tests passed:** guardian removal, profile actions, account deletion, and invitation sending.
- **3 new audit probes reproduced the findings above.** These tests assert observed bad behavior; a passing probe is evidence of a defect, not a successful fix.
- Local schema inspection confirmed the new guardian policies/triggers migration was installed.
- The audit uses real local authenticated Supabase clients and the real invitation-acceptance handler. Only the Next.js server-session factory is substituted to supply those authenticated clients. This is not a full browser/deployed-HTTP test.
- No emails were sent. Fixtures were created and cleaned up through the existing local-only test helpers; the database was not reset.

[Reproduction probes](C:/Users/jared/Projects/lista/docs/reviews/2026-09-16-bug002-gap-probes.test.ts).

Run from the repository root against the local Supabase stack:

```text
node node_modules/vitest/vitest.mjs run docs/reviews/2026-09-16-bug002-gap-probes.test.ts tests/rls/profile-managers.test.ts tests/rls/invitations.test.ts --config vitest.config.rls.mts
```

The separately acknowledged BUG-012 non-recipient web acceptance issue also remains. It is not counted as a newly discovered finding here. The initial suspicion that guardians could not see other guardian rows was ruled out for the web roster page: it obtains that list through an authorized page's service-role query.

**Recommended next step:** reopen BUG-002 for finding 1 and track finding 2 explicitly with BUG-012 as an urgent access-control repair. Keep the proven protections already merged; add end-to-end authorization-sequence tests before considering the guardian boundary closed. Address the Self-link defect alongside those changes. No application fixes, migrations, or GitHub comments were made during this review.
