# Bug backlog review — September 15, 2026

The 18 entries capture the numbered readiness findings and two test-verification gaps well enough to retain as the backlog. Several proposed fixes need tighter boundaries before implementation: some change existing product decisions, some combine independent defects, and a few reproduction/evidence statements are inaccurate.

**Review and decision record only. No application fixes or ticket status changes were made. Recommendations remain proposals unless explicitly marked as accepted below.**

Reviewed all 18 entries, the workflow/template, the September 4 report and saved probes, relevant implementation paths, and existing specifications/test plans. Application code has not changed between the reviewed application revision `5acde1074` and current `bd0d68894`; the intervening changes are documentation. Tests were not rerun for this documentation review. No production database, deployed routing, delivery, or device behavior was inspected.

## Product decisions to record before implementing the affected behavior

### D1 — Who controls a child's global guardian relationships? (002, 011, 013)

The wording “authorized guardian/admin action” is too broad. A managed child is a shared identity across teams; a coach's authority comes from a particular team.

A related implementation deserves explicit coverage: [removeProfileManager](C:/Users/jared/Projects/lista/apps/web/src/app/actions/managers.ts:20) allows a coach/manager/director sharing **any** team with the child to delete the global guardian link. For a child on two clubs, a coach at club A can therefore remove the parent's relationship used to access club B. This is a static code finding, not a new live reproduction.

**Accepted permissions — user decision, September 15, 2026:**

- The player, their coach/director/manager, or an existing guardian may invite another guardian.
- The player or an existing guardian may remove a guardian. A coach/director/manager role alone does not grant removal permission.

These permissions supersede the original recommendation to exclude ordinary team administrators from global guardian invitations. Preserve a parent's ability to create a fresh child profile; arbitrary self-claims of existing profiles remain forbidden.

**D1 resolved — additional user decisions, September 15, 2026:**

1. **Cross-club effect of an invitation:** recipient acceptance is sufficient to establish the global guardian relationship across the child's teams/clubs, including for staff-initiated invitations. No additional approval from an existing guardian/player is required.
2. **Last-guardian removal:** every player profile must retain a login path. The last guardian cannot be removed when the player has no independent login. A pending invitation does not supply a replacement login path; the replacement must have accepted and be linked before removal.

Enforce the last-login invariant atomically, including concurrent removal attempts by different guardians. Account deletion must not silently bypass it; the deletion/transfer/recovery workflow remains to be resolved under D7.

Player-initiated operations must be authenticated as that player; a staff member viewing a child's profile does not acquire the player's removal permission. Denying arbitrary claims and enforcing the accepted role distinction can proceed without resolving unrelated product decisions.

### D2 — Whose notification preferences apply? (007)

The archived managed-profile specification explicitly says the **child's preferences control notification fan-out to all managers**. Treating that behavior itself as a defect would reverse an existing decision. My original report's preference recommendation should have been distinguished more clearly from the proven delivery bugs. [Existing notification contract](C:/Users/jared/Projects/lista/docs/specs/archive/managed-profiles.md:189).

**Accepted — user decision, September 15, 2026:** each receiving adult controls their own event and chat preferences; all authorized guardians are eligible; duplicate membership/child paths do not send the same generic event alert repeatedly to one adult. Preserve child-specific content where separate notifications convey different information. This supersedes the archived rule that a child's preferences control delivery to all guardians.

**D2 resolved — migration rule accepted by the user, September 15, 2026:** for each notification category, preserve an opt-out on either the adult's own profile or any child they currently manage by starting that category disabled for that adult; otherwise retain the existing enabled default. Each adult can subsequently change their own settings independently. The user accepted that, with the current profile-wide preferences, this conservative rule can also silence that category for another child whose old setting was enabled. Inventory the affected records before applying a migration.

Separate chat push, chat digest and event preferences are already specified; chat has no per-message email, and mobile push has a per-device opt-out requirement. Organization directors should not all become subscribers merely because they have implicit administrative access. [Chat decisions](C:/Users/jared/Projects/lista/docs/specs/archive/team-chat.md:237); [Director notification default](C:/Users/jared/Projects/lista/docs/specs/multi-tenant-architecture.md:379).

The caller-scoped token lookup, missing guardian expansion for push, native dispatch omission and deletion of other devices' tokens can be fixed without waiting for a preference redesign.

### D3 — Which schedule mutations notify families, and what does “sent” mean? (006, 007)

“Every create/edit/cancel/restore/delete enqueues” makes every typo correction, historical edit and imported occurrence potentially generate an alert. The ticket does not define cancellation versus deletion, series batching, or notification suppression.

**D3 resolved — defaults accepted by the user, September 15, 2026.** Preserve a snapshot for notices about deleted events. The durable job/retry architecture remains an engineering decision.

| Action | Accepted notification behavior |
|---|---|
| Create an upcoming event | Notify by default; coach may switch notification off during creation. |
| Create/import a series or bulk schedule | One summary per team for the operation, not one alert per occurrence; coach may switch notification off. This does not add an import feature to the bug's scope. |
| Change date, start/end/arrival time, or location of an upcoming/in-progress event | Notify automatically; coach cannot suppress the alert. Recipient opt-outs under D2 still apply. |
| Cancel, restore, or delete an upcoming/in-progress event | Notify automatically; coach cannot suppress the alert. Deleting an already canceled event should not send a second cancellation notice. This specifies notification behavior, not permission to erase history. |
| Change only title/description/notes | Notification optional and off by default. |
| Edit historical events or save with no actual change | No notification. |

Batch changes to multiple occurrences from one operation into one understandable notice per team, without delaying an urgent cancellation for later batching. Show queued, sent, partially failed and failed states; “sent” means accepted by the delivery service, not read by the recipient. Report skipped/opted-out recipients separately from failures.

### D4 — What happens to availability responses and exceptions when a series changes? (009, 010)

**D4 resolved — accepted with the user's availability amendment, September 15, 2026.** Use “availability” for the player's event response, including responses entered by a guardian. The earlier “RSVP” wording referred to this same data, not a separate registration or confirmation model.

Preserve existing availability responses unchanged when date, time or venue changes. D3 notifications give the player or guardian an opportunity to update availability themselves. Do not add a reconfirmation state, mark responses stale, or exclude an existing Available response from the normal availability totals merely because the event changed. This supersedes the original reconfirmation recommendation.

| Situation | Accepted behavior |
|---|---|
| Choose edit scope | Offer this occurrence, this and following occurrences, or all upcoming occurrences. Bulk series edits do not rewrite past events. Historical corrections are explicit single-event edits that retain an audit history. |
| Retained occurrence | Keep its identity, links, results and availability responses/history. Changing its schedule does not erase or invalidate a response. |
| Change date, start/end/arrival time, or venue; restore a canceled occurrence | Leave existing availability responses unchanged. Send the applicable D3 notification; players/guardians decide whether to change their availability. No additional confirmation data or workflow. |
| Change only title/description/notes | Keep existing availability responses. D3 determines whether an optional notification is sent. |
| Individually canceled or rescheduled exception | Preserve it during a bulk series edit; do not silently restore or overwrite it. |
| Shorten a series or remove dates from its recurrence pattern | Cancel/archive the removed occurrences and retain their results, responses and links. Show affected dates before applying the operation. |
| Extend a series or add dates | Create genuinely new occurrences with no availability responses. Never copy another occurrence's availability onto a new event. |

For recurrence-pattern changes, preview which occurrences are updated, retained as exceptions, removed or added. Preserve IDs where an occurrence is retained/rescheduled; do not guess an ambiguous old-to-new correspondence and silently transfer availability to a different occurrence. Apply the operation atomically and send the applicable D3 summary.

### D5 — What timezone defines an event? (010)

**D5 resolved — accepted by the user, September 15, 2026.** Events must have their own timezone field so events outside the team's timezone are represented correctly in the UI.

- Default a new event's timezone to the team's timezone, with an explicit event-level override for the venue's timezone.
- Store the event timezone alongside its timestamps. Use a named timezone such as `America/Denver`, not merely a fixed UTC offset, so DST rules can be applied.
- Interpret event date/time inputs in the selected event timezone. Display the event's local time with a clear timezone label in the UI and communications, independently of the editing device's or server's timezone.
- Changing the team's default timezone must not reinterpret or shift already scheduled events.
- Recurring events retain their intended local clock time across DST in the event's timezone. The recurrence end date is inclusive in that timezone, and reminder dates/wording use that timezone.
- Apply D3 notification rules if an event's scheduled time changes; availability remains unchanged under D4.

Implementation must preserve existing stored event instants during the timezone-field backfill; do not silently shift old timestamps by reinterpreting them as local input. Formatting additionally in each recipient's personal timezone remains a separate enhancement, not part of this decision. No application or schema changes have been implemented.

### D6 — How should existing duplicate identities be repaired? (011)

**D6 resolved for existing-data repair — user clarification, September 15, 2026:** the user confirms that no duplicate identities exist and that they are the only mobile-app user. This is user-provided operating context, not a production-data inspection. No historical duplicate cleanup, merge tooling or merge-conflict policy is needed for this fix.

Keep the prevention work in BUG-011: offer an explicit choice among children the adult already manages and make invitation acceptance atomic. Do not silently match by name/birthday or select another person's child. The lack of existing duplicates does not remove the native player/guardian identity defect or the web duplicate-creation path.

An eventual child-to-independent-account transition is separate scope; do not add it to this fix by default.

### D7 — How do account deletion and club succession work? (013)

The proposed regression test says a sole guardian must be blocked from deleting their account. The existing account-deletion test plan explicitly allows deletion while preserving the managed child's profile and roster record. This is a changed product contract, not merely extending coverage. [Deletion cascade expectations](C:/Users/jared/Projects/lista/docs/test-plans/account-deletion.md:35).

**Constraint accepted under D1:** every player profile must retain a login path; the last guardian cannot be removed from a player who has no independent login. The original suggestion to retain an unclaimed player profile without any login is superseded by that decision.

**D7 direction accepted — user decision, September 15, 2026:** prevent silent ownerless active clubs through an explicit ownership-transfer or club-closure path. Transfer requires recipient acceptance; document an administrator-recovery process. Guardian/account deletion must preserve the D1 login invariant through an accepted replacement guardian or the player's independent login. If neither exists, deletion cannot leave the player behind without access; recovery/transfer must resolve that dependency first. Club closure does not authorize deletion of shared player profiles or guardian links used by other clubs.

**D7 resolved — closure behavior accepted by the user, September 15, 2026:** archive the club and make its roster, event, availability and chat history read-only for remaining authorized members, preserving private-group/DM boundaries and revocation rules. Do not automatically erase history on club closure. This decision does not introduce an automatic retention expiry or bulk-erasure policy.

Finish the already-specified owner-only director invite/remove routes separately from this larger policy.

### D8 — Which fields and assets are private? (004, 016)

Email protection is already promised by the privacy page; enforcing it does not need a new decision. Full DOB, birth year, contact details and children's photos need a field/asset access matrix.

**Recommendation:** distinguish self, authorized guardian, team player, team coach/manager, org director and unrelated user. Give teammates only required roster fields; restrict full DOB/contact details to justified roles; serve children's avatars through authorized access. A club logo may be public if it is intended for the public club identity. Avoid making all buckets public merely to repair broken images.

Decide any broader visibility changes explicitly. Preserve users' access to their own private data, and test the data/storage boundary rather than only hiding controls.

### D9 — Should invitations expire, and what happens to existing invitations? (012)

The missing recipient check is a definite authorization bug. A new expiry policy is additional product behavior: the ticket gives no lifetime, resend semantics, or transition for existing pending links.

**Recommendation:** fix normalized recipient checks immediately. Separately choose a lifetime (14 days is a reasonable proposed starting point), have resend revoke/replace the old invitation, and show a clear request-new-invite state. Choose a grace/reissue policy for existing invitations before enforcing expiry. The proposed duration is not an existing requirement.

## Ticket corrections and implementation boundaries

| Entry | Flag before implementation |
|---|---|
| [BUG-001](C:/Users/jared/Projects/lista/docs/bugs/001-team-members-self-insert-coach.md) | Expected behavior is too narrow: membership can also arise from authorized creation/admin operations, not only accepted invitations. Preserve privileged team creation and valid admissions while denying direct self-assigned roles. Replace “same in all environments” with “reproduced locally against checked-in migrations; production unverified.” |
| [BUG-002](C:/Users/jared/Projects/lista/docs/bugs/002-profile-managers-claim-child.md) | Reproduction uses nonexistent `full_name`; the saved probe updates `first_name`. Remove the unverified all-environments claim. Resolve global guardian authority under D1 and cover both unauthorized grants and revocations. |
| [BUG-003](C:/Users/jared/Projects/lista/docs/bugs/003-private-group-self-join-message-mutation.md) | The message column is `body`, not `content`. Admission by any existing member is broader than the spec's creator/admin rule. The regression must test a sender editing **their own** body and protected sender/channel/timestamp fields; testing only another sender's message can miss the flaw. Preserve legitimate soft-deletion without opening arbitrary updates. Separate admission, message mutation and offboarding checks. |
| [BUG-004](C:/Users/jared/Projects/lista/docs/bugs/004-profile-email-exposed-to-teammates.md) | Evidence supports local email exposure; not identical deployed policy. Protect email under the existing promise now; record the broader field-access decision under D8. A server response/view alone is insufficient if unrestricted direct base-table access remains. |
| [BUG-005](C:/Users/jared/Projects/lista/docs/bugs/005-org-billing-columns-self-editable.md) | “Admin can still change name/branding” collapses owner and director permissions. Existing settings permit directors to change the name, while branding/subdomain/logo are owner-only. Test both roles and distinguish a permitted guarded settings operation from a raw billing-column write. Remove the unverified all-environments claim. |
| [BUG-006](C:/Users/jared/Projects/lista/docs/bugs/006-schedule-changes-do-not-notify.md) | Replace unconditional notification acceptance tests with the agreed trigger matrix (D3). Separate database success from notification queue/provider status. A canceled practice is an essential case; historical edits and no-ops are not automatically the same case. |
| [BUG-007](C:/Users/jared/Projects/lista/docs/bugs/007-push-delivery-cannot-reach-audience.md) | “Zero recipients” overstates event behavior: the caller's own tokens can still be visible. Say **other intended recipients are hidden**; chat excludes the caller and can end with none. Retain database-boundary versus end-to-end evidence distinction. Child preference behavior is specified, not independently a bug (D2). Track each of the five compounding gaps separately or with independently verifiable acceptance checkboxes. |
| [BUG-008](C:/Users/jared/Projects/lista/docs/bugs/008-cron-routes-redirected-to-login.md) | It was **3 cron probes**, plus recurrence and email probes, totaling 5. Tests directly invoked `updateSession`, not a complete deployed HTTP/middleware-matcher flow. Keep production failure unverified. Regression tests must prove valid-secret access, rejection of missing/invalid secrets and missing configuration, and continued protection of unrelated routes. Existing comparisons interpolate `CRON_SECRET`; an unset secret must not accept literal `Bearer undefined`. |
| [BUG-009](C:/Users/jared/Projects/lista/docs/bugs/009-series-edit-destroys-occurrence-history.md) | Accurate destructive-write finding. D4 is now resolved: preserve availability unchanged on schedule edits, with no reconfirmation model. Distinguish the reproduced FK cascade from the statically traced full editor workflow. Add failed-write rollback and stable-link coverage. |
| [BUG-010](C:/Users/jared/Projects/lista/docs/bugs/010-event-time-and-recurrence-boundaries.md) | The boundary/time findings are supported. D5 now requires an event timezone field, defaulting to the team timezone, used consistently for input, display, communications and recurrence. Preserve stored instants during backfill and existing events when the team default changes. |
| [BUG-011](C:/Users/jared/Projects/lista/docs/bugs/011-identity-differs-web-vs-mobile.md) | Accurate native identity defect. “Existing child gains membership” must require explicit authorized selection rather than automatic identity matching. D6 confirms there are no existing duplicates to repair; keep prevention in scope without adding merge tooling. Share acceptance boundaries with 012. |
| [BUG-012](C:/Users/jared/Projects/lista/docs/bugs/012-invite-server-actions-lack-recipient-check.md) | Recipient verification is ready to fix. Expiry is not fully specified; split it from the authorization repair (D9). Test all three server actions directly, preserve legitimate retries without duplicate records, and validate invitation type/role as well as recipient. |
| [BUG-013](C:/Users/jared/Projects/lista/docs/bugs/013-club-staffing-and-ownership-handover.md) | Contains at least three independently releasable areas: missing director routes, org succession, sole-guardian deletion. The last proposed regression contradicts the existing deletion contract (D7). “At most one owner” versus “must have an owner” is correctly identified. |
| [BUG-014](C:/Users/jared/Projects/lista/docs/bugs/014-unpaginated-queries-truncate-records.md) | Seed **1,020 actual availability records**, not merely 20 profiles and 51 events; those do not automatically create responses. Production cap verification is an operator/engineering evidence task, not a product decision. A failed-load state protects against false “no response,” but normal season-sized data must still load completely. |
| [BUG-015](C:/Users/jared/Projects/lista/docs/bugs/015-stripe-webhook-acknowledges-failed-write.md) | “Failing write must not 2xx” is correct for the current synchronous design, but too absolute for the proposed durable-ingestion design. The invariant is **commit processing or durably accept responsibility for retry before acknowledging**. A durable inbox can legitimately return success before downstream work completes. Mock Supabase's returned error locally; do not change live permissions to reproduce. Preserve signature verification without claiming the entire lifecycle has been proven correct. |
| [BUG-016](C:/Users/jared/Projects/lista/docs/bugs/016-storage-buckets-private-vs-public-url.md) | Remove “production currently renders images”: that was not established in the review, nor was out-of-band bucket modification. Exact HTTP 400 is not supported by the recorded probe; describe an inaccessible public URL pending a real clean-deployment check. “Privacy model was never decided” is also stronger than the evidence; the proven issue is configuration/URL mismatch. D8 supplies the serving-policy decision. |
| [BUG-017](C:/Users/jared/Projects/lista/docs/bugs/017-stale-test-fixtures-three-failures.md) | Wrong evidence file: the linked web log contains **679 passing tests**, not the 218-pass/3-fail root run. The three cases are localized below. Change “are stale expectations, not production defects” to “appear to be stale fixtures/expectations”; verify each against the current contract. One failure concerns authorization, not merely renamed plans. |
| [BUG-018](C:/Users/jared/Projects/lista/docs/bugs/018-mobile-jest-suites-fail-to-start.md) | Keep the limitation to the September 4 installed checkout. Clean-install reproduction is the right next step; do not prescribe adding a dependency before determining why resolution failed. Jest already reported failure, so remove the suggestion it silently passed with zero tests. The separate gap is absent mobile CI coverage. |

### Existing decisions that should be referenced, not reopened accidentally

- **No message editing in v1; group admission by creator/admin; group existence private to members.** [Chat policy](C:/Users/jared/Projects/lista/docs/specs/archive/team-chat.md:132) and [Visibility decision](C:/Users/jared/Projects/lista/docs/specs/archive/team-chat.md:240).
- **Directors do not automatically gain access to private groups or others' DMs.** A future moderation/child-communication policy must not silently broaden this while fixing group admission. [Director chat scope](C:/Users/jared/Projects/lista/docs/specs/multi-tenant-architecture.md:353).
- **Removal revokes all team data access, subject to another legitimate source of access**, such as another active managed child. Combined with team-scoped DMs, this supports denying DM access once all team entitlement is lost. Allowing former members a historical DM view would be a deliberate exception requiring a recorded decision; preserving records internally is distinct from granting former members access. [Removal contract](C:/Users/jared/Projects/lista/docs/specs/archive/remove-team-member.md:25); [DM scope](C:/Users/jared/Projects/lista/docs/specs/archive/team-chat.md:234).
- **Directors can change operational name; branding/subdomain/logo stay owner-only.** [Current settings authorization](C:/Users/jared/Projects/lista/apps/web/src/app/api/club/settings/route.ts:55). Billing read access is owner/director; billing mutation access remains more restricted.

### BUG-017: concrete test locations

1. [Tenant resolution fixture](C:/Users/jared/Projects/lista/tests/tenant/tenant.test.ts:170) still writes obsolete `plan: "club"`. Check the setup write's error and satisfy current active-subdomain conditions; changing only an assertion would mask invalid setup.
2. [Club-settings cache invalidation fixture](C:/Users/jared/Projects/lista/tests/billing/club-settings.test.ts:234) supplies `subdomain: "oldslug"` without a club plan. The current plan gate can reject the request before cache invalidation.
3. [Billing status expectation](C:/Users/jared/Projects/lista/tests/billing/status.test.ts:65) relies on team membership rather than the current organization owner/director requirement. Correct the fixture/expected contract; do not loosen production billing authorization to make it green. [Route role gate](C:/Users/jared/Projects/lista/apps/web/src/app/api/billing/status/route.ts:79).

The original root selection was:

```text
node node_modules/vitest/vitest.mjs run tests/unit tests/rrule.test.ts tests/tenant tests/billing --config vitest.config.rls.mts
```

Capture a fresh log under the correct ticket when repairing it; the original root output was not saved in the linked web log.

## Workflow refinements

The file-per-bug workflow is workable. Keep it light, but fix these gaps before treating tickets as implementation contracts:

1. **Make severity consistent.** [README](C:/Users/jared/Projects/lista/docs/bugs/README.md:18) defines any authorization bypass/data loss as P0, but 003/005/009/012 remain P1; it also says authorization/data-integrity starts at P1. Either adopt that broader P0 definition and regrade consistently, or narrow P0 to the intended critical scope and document P1 cases. Do not claim the definitions exactly reproduce the previous report's prioritization.
2. **Separate known cause, proposed fix and implemented fix.** The README says to leave Cause/Fix/Regression empty, while the template allows diagnosed causes and every new ticket contains proposed fixes. Preserve useful known diagnoses and planned tests; label them as proposals. Reserve implemented fix, PR, migration and verification fields for actual completed work.
3. **Record decisions in the ticket.** Several entries say “See Questions” or refer to a PR description that is not linked. Add a small “Product decisions” section with the question, recommendation, chosen answer/date, and relevant spec. A PR is too late to discover that a central acceptance criterion is unsettled.
4. **Add evidence scope and closure evidence.** Record last verified revision/environment and distinguish reproduced, statically identified, and deployment-unverified. A merged repair is not evidence that production has received its migration/configuration. Before release, record required deployment verification for authorization, storage, cron and delivery changes.
5. **Keep resolution dispositions explicit.** Moving a `Won't fix` or `Not reproducible` item to `fixed/` can work if the status is respected. Do not equate these with repaired, or close a high-impact risk merely because one reproduction attempt failed. Record what was tried and why closure is justified.
6. **Repair navigation/examples.** Replace `[[001]]`-style references with normal Markdown links unless the chosen viewer resolves numeric wiki aliases. The README's cron commit example is BUG-008, not BUG-007. This does not require adding an index.

The original SQL/routing probes deliberately assert the vulnerable behavior. They are historical evidence, **not passing regression tests for the repaired product**. New tests must assert rejection/preservation/correct times as appropriate.

## Readiness coverage still outside these 18 tickets

All 16 numbered defects plus both test-verification gaps are represented. That does **not** capture every gate from the original report. The separate infrastructure and feature-gap sections still need their own tracked work or explicit deferral.

In particular: backup/restore evidence and recovery ownership; critical-change audit history; migration/deployment ordering; Redis outage behavior; production monitoring and cron completion alerts; realtime reconnect verification; actual mobile release/device coverage; complete release checks; offline behavior; support and administrative recovery.

Registration, player dues/payment records, forms/waivers, season lifecycle, club-wide communications, migration/export and other feature gaps also remain separate. They need not all become “bugs,” but closing 001–018 must not be used as the acceptance criterion for replacing TeamSnap ONE. [Original readiness report](C:/Users/jared/Projects/lista/docs/reviews/2026-09-04-teamsnap-one-readiness-report.md:229).

## Suggested implementation order after this review

- **Start with well-defined security/reliability repairs:** arbitrary membership/guardian claims, private-group admission and forbidden message mutation, promised email privacy, protected billing columns, recipient checks, secret-authenticated cron routing, pagination and webhook write handling. Preserve legitimate flows with positive tests as well as hostile requests.
- **Follow the recorded product decisions while those repairs proceed:** D1–D5 settle guardian authority, notification rules/preferences, recurrence/availability behavior and event timezones. D6 confirms no historical duplicate repair is needed. D7 settles transfer/recovery and read-only closed-club history for authorized members. D8 asset/field privacy and D9 invitation expiry remain open. Do not block unrelated repairs waiting for every decision.
- **Coordinate shared work:** 001/002/011/012 share admission/identity boundaries; 003/004/013 share offboarding and access; 006/007/008 share dispatch and delivery; 009/010 share recurrence; 005/015 protect opposite sides of billing integrity. Each ticket still needs its own acceptance evidence.
- **Validate in controlled environments before real rollout:** deployed routing/cron checks should use staging/test data, especially jobs that expire trials or release subdomains. Notification repairs should not replay old changes to real families without a deliberate rollout rule. Complete release/recovery gates independently of the count of closed bugs.
