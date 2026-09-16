# Can Lista replace TeamSnap ONE?

**Assessment: no, not in its current state.** Lista has a useful foundation for team coordination, but I would not approve it as a club's sole operational system, or as the only schedule and communication channel for a real-team pilot, until the critical issues below are fixed.

**Reviewed September 4, 2026.** Repository revision: `5acde1074`. The local database contains all 48 checked-in migrations, through `20260904000000`. Findings concern this checkout and the local schema; production configuration and deployed behavior were not inspected.

Two separate problems determine the answer:

1. **Dependability and data protection:** verified authorization bypasses, missing notifications, cron routing failures, and destructive recurring-event edits undermine even the features Lista already implements.
2. **Product coverage:** club registration, player fee collection, signed documents, eligibility, and several club-wide workflows are absent. Fixing the bugs alone would produce a more dependable team coordination tool, but would not replace TeamSnap ONE's club administration functions.

The practical distinction is:

| Intended use | Decision today | What would change the decision |
|---|---|---|
| Development/demo with synthetic data | Suitable | Continue development and validation. |
| One team's primary roster, schedule, RSVPs, and chat | **No-go** | Resolve the security, notification, scheduling, identity, and recovery gates below. |
| One team using separate registration and financial systems | Possible after those gates | Explicitly define which records each system owns; this remains a split-system arrangement. |
| Multi-team club replacing TeamSnap ONE entirely | **No-go** | Complete the reliability gates plus registration, financial, document, organizational, and migration workflows. |

## Scope and evidence

I reviewed the Next.js web app, Expo mobile app, database migrations and RLS policies, invitation and account lifecycle, scheduling and availability, messaging and notifications, Stripe subscription handling, club administration, CI, deployment configuration, and existing tests. I compared those implementations with current official TeamSnap ONE product and help material.

**Evidence labels:** *Reproduced* means a local database or code probe demonstrated the behavior. *Code-confirmed* means the executable path or schema establishes it, but I did not exercise the complete UI or deployed service. *Not found* means no implementation was found in the reviewed application, schema, or routes. *Unverified* means operational evidence is needed outside the repository.

Tests used synthetic local records or mocked services. The custom database probes ran inside transactions that ended with `ROLLBACK`. No production data, real notifications, Stripe transactions, deployments, or application source files were changed. This is a readiness assessment, not a complete penetration test, accessibility audit, or legal compliance certification.

## What Lista already does

Implemented capabilities include teams within organizations; roster roles, jersey numbers and positions; parent-managed player profiles; invitations and bulk invitation uploads; schedule list/calendar views; recurring events; venues, arrival times and uniforms; RSVP editing and an availability matrix; team/group/direct messages; club member views, branding and archiving; team ownership transfer; and account deletion.

The newer training feature includes session logging, categories, coach-entered sessions, summaries, and leaderboards. Stripe handles **the club's subscription to Lista**. Native mobile code supports roster and schedule viewing, RSVPs, chat, team creation, invitations, and settings. These are substantial implemented features, although the defects below affect their reliability.

The roadmap is not authoritative about shipped behavior. For example, it says results lack a UI, but the current [event editor](C:/Users/jared/Projects/lista/apps/web/src/components/calendar/event-detail.tsx:129) does edit game results and scores. I have credited the code rather than treating old roadmap entries as gaps.

## TeamSnap ONE comparison

The baseline is **TeamSnap ONE for a club/organization**, rather than assuming all features or pricing of the older single-team TeamSnap product carry over. TeamSnap's official ONE page lists registration, payment plans, eligibility, signatures, rostering, organizational communications, reporting, attendance, training content and media. Its help material separately documents registration and calendar subscriptions. Actual contracted packaging should be confirmed during procurement. [TeamSnap ONE](https://www.teamsnap.com/one), [registration guide](https://help.teamsnap.com/article/2119-registration-guide-for-prospective-members), [schedule subscriptions](https://teams-help.teamsnap.com/article/3009-subscribing-to-team-schedules).

| Workflow | Lista today | Consequence for replacement |
|---|---|---|
| Player registration and enrollment | Account signup and invitations; no program registration records, configurable forms, capacity or waitlists found | **Major gap.** Cannot establish who applied, completed enrollment, or is cleared to participate. |
| Player dues and registration payments | Lista subscription billing only; no player fee ledger, installments, discounts, refunds, scholarships or payment reconciliation found | **Major gap.** A club still needs another financial system. |
| Waivers, signatures and eligibility | No signed-document versions, consent records, document collection, eligibility rules or membership verification found | **Major gap** for clubs requiring these records. |
| Emergency information | Guardian links and phone fields exist; no dedicated emergency-contact designation, medical restriction record or offline emergency roster found | Clubs needing this information at the field must maintain another controlled record. This is a club-readiness requirement, not a claim about a specific TeamSnap ONE module. |
| Rosters and households | Roles, managed profiles, invitations and bulk invitations implemented | Useful foundation; identity and authorization defects block trust. |
| Team schedules and RSVPs | Implemented on web; native viewing and RSVP | Core workflow exists, but destructive edits and missing alerts are blockers. |
| Family calendar and external calendar feeds | Team switching; no combined family calendar or subscribed ICS feed found | Families must check teams separately. TeamSnap ONE documents individual and all-team calendar subscriptions. [Calendar help](https://teams-help.teamsnap.com/article/3009-subscribing-to-team-schedules). |
| Club-wide scheduling | No club schedule workspace, shared facility reservations, cross-team conflict detection or schedule import found | Directors must coordinate fields and coaches elsewhere. This is a Lista operational gap; no claim of exact TeamSnap conflict-engine parity is made. |
| Club-wide communications | Team chat, groups and DMs; no organization broadcast composer or delivery/acknowledgment report found | No dependable single action for a club-wide closure or policy update. |
| Files, photos, polls and attachments | Profile/team images; text messages; no shared document library or message attachments/polls found | Playbooks, forms and supporting material stay elsewhere. |
| Actual attendance | RSVP statuses only | Cannot distinguish an advance intention from who actually attended. |
| Season administration | A text `season` field and team archive/restore | No structured season enrollment, rollover, roster snapshots or player promotion workflow found. |
| Results and development | Game score/result editor and custom training tracking | Some coverage; no aggregate season record/player statistics dashboard or professional drill/practice-plan library found. |
| Livestreaming, highlights and public club website | Not found; branding/subdomains personalize the app | Feature parity gap; usually lower priority than trustworthy administration. |
| Data import/export | Bulk invitation CSV, limited to invitation data | No complete TeamSnap migration, club export, historical reconciliation or self-service exit workflow found. |

The financial, document and enrollment gaps are large domains, not small additions to the existing Stripe integration. A club needs linked records answering: **which athlete, which season/program, which team, what was signed, what is owed, what was paid, and whether participation is approved.** Lista cannot currently supply that complete answer.

## Findings that block dependable use

**Priority meaning:** P0 = close before real-team adoption because unauthorized access or control is possible. P1 = resolve before making Lista the primary system for the affected workflow. P2 = material limitation or hardening work; urgency depends on the club.

### 1. P0 — A user can grant themselves coach access without an invitation

**Reproduced.** The `team_members` INSERT policy accepts `profile_id = auth.uid()` without checking invitation acceptance or restricting the inserted role. Knowing a team UUID, an authenticated outsider can insert themselves as `coach`. The local probe first saw zero teams, then inserted membership and obtained `is_team_admin = true`.

That grants the ability to read team data and alter events and roster membership. Hiding join controls in the UI does not protect direct database API requests. The existing test suite actually asserts that self-insertion succeeds, which explains why passing RLS tests do not establish safety here.

**Required change:** make admission and role assignment an authorized, atomic server/database operation; remove unrestricted self-insertion and test hostile direct API calls across organizations. Preserve legitimate team creation through the existing privileged RPCs.

Evidence: [membership policy](C:/Users/jared/Projects/lista/supabase/migrations/20260303000002_managed_profiles.sql:158), [test permitting self-insertion](C:/Users/jared/Projects/lista/tests/rls/team-members.test.ts:60), [local probe results](C:/Users/jared/Projects/lista/docs/reviews/2026-09-04-local-probe-results.txt).

### 2. P0 — A user can claim another player's profile

**Reproduced.** `profile_managers` permits INSERT when `manager_id` equals the caller, with no proof that the caller is authorized to manage `managed_id`. An outsider claimed the synthetic child, changed the child's name, and gained access to the child's team.

This is both a family-data protection problem and a source-of-truth problem: roster identity and availability can be controlled by an unrelated account. Fixing team self-insertion alone does not close this independent path.

**Required change:** require a verified invitation or an authorized guardian/admin operation to establish management. Protect identity/auth linkage fields separately from editable profile details and test guardian revocation and cross-club access.

Evidence: [manager INSERT policy](C:/Users/jared/Projects/lista/supabase/migrations/20260303000002_managed_profiles.sql:92), [profile UPDATE policy](C:/Users/jared/Projects/lista/supabase/migrations/20260303000002_managed_profiles.sql:108).

### 3. P1 — Private group membership is self-assignable; message history is not immutable

**Reproduced for group access; code-confirmed for message mutation.** The `channel_members` self-insert exception intended for read tracking also applies to private groups. The probe joined a private group without its creator's permission. The messages UPDATE policy also does not limit changes to `deleted_at`, despite its soft-delete comment: permitted writers can alter message content and other columns.

DM policies identify participants without requiring current membership in the owning team. The removal action cleans channel membership but not DM access. Decide explicitly whether former members should retain historical DMs, and separately prevent continued unauthorized team-scoped messaging.

**Required change:** separate read markers from private-group admission, constrain mutable message fields, and define removal/moderation/retention rules. For a youth club, also define adult-to-child communication rules rather than assuming unrestricted DMs fit the club's policy.

Evidence: [group membership policy](C:/Users/jared/Projects/lista/supabase/migrations/20260307000000_team_chat.sql:149), [DM policies](C:/Users/jared/Projects/lista/supabase/migrations/20260307000000_team_chat.sql:176), [message UPDATE policy](C:/Users/jared/Projects/lista/supabase/migrations/20260307000000_team_chat.sql:251), [removal cleanup](C:/Users/jared/Projects/lista/apps/web/src/app/actions/team.ts:212).

### 4. P1 — Privacy promises are enforced in the UI, not at the data boundary

**Reproduced.** An ordinary player account could query the coach's email from `profiles`. Team-visible profile rows expose columns rather than a restricted public profile projection. The privacy page says email is visible to admins and profile managers; UI hiding does not enforce that promise. Birth dates also require an explicit field-access decision.

**Required change:** separate public roster fields from private account/contact fields using appropriately secured views/tables or server responses. Verify direct PostgREST queries, not just rendered screens.

Evidence: [privacy statement](C:/Users/jared/Projects/lista/apps/web/src/app/privacy/page.tsx:48), [profile visibility policy](C:/Users/jared/Projects/lista/supabase/migrations/20260318000001_fix_profiles_select_for_profile_managers.sql:14), [probe results](C:/Users/jared/Projects/lista/docs/reviews/2026-09-04-local-probe-results.txt).

### 5. P1 — Club subscription state can be edited directly by club admins

**Reproduced.** Organization UPDATE access is row-wide for organization admins. There is no corresponding restriction on financial/entitlement columns. The local owner changed `plan` to `club_large` and `subscription_status` to `active` using the authenticated role, bypassing Stripe and the billing routes.

This undermines the claimed authority of subscription state and the separation between director and owner permissions. Other writable organization fields, including provider IDs and domain settings, also need a column-by-column authorization review.

**Required change:** move billing/entitlement fields behind privileged operations or enforce database column/trigger restrictions. Keep ordinary organization settings independently editable.

Evidence: [organization UPDATE policy](C:/Users/jared/Projects/lista/supabase/migrations/20260416000001_organization_members.sql:118), [billing columns](C:/Users/jared/Projects/lista/supabase/migrations/20260519000000_club_tier_monetization.sql:19).

### 6. P1 — Routine schedule changes do not notify families

**Code-confirmed.** Creating an event finishes after its database insert. Individual edits, cancellations, restores and deletions also finish without invoking notification delivery. The only schedule notification call found in the current event UI is the entire-series edit, and its result is ignored.

**Example:** a coach cancels tonight's practice and sees “Event cancelled.” Parents receive no automatic cancellation message from that path. Chat being available does not make this workflow dependable.

**Required change:** commit the schedule change and a durable notification job together. Record delivery attempts, retry failures, and let the coach see whether the intended audience was reached.

Evidence: [event creation](C:/Users/jared/Projects/lista/apps/web/src/components/calendar/event-form-dialog.tsx:228), [single edit](C:/Users/jared/Projects/lista/apps/web/src/components/calendar/event-detail.tsx:381), [cancel/restore/delete](C:/Users/jared/Projects/lista/apps/web/src/components/calendar/event-detail.tsx:785).

### 7. P1 — Existing push delivery cannot reach its intended audience

**Reproduced at the database boundary; code-confirmed in the routes.** Event and chat notification routes use the caller's cookie-authenticated Supabase client. Push subscription RLS permits reading only the caller's subscriptions. The probe confirmed that even a coach sees zero teammate tokens. Chat excludes the caller from recipients, so its ordinary fan-out has no recipient tokens to send to.

Additional gaps compound this:

- Native message senders insert messages but do not invoke the notification route.
- Guardian email resolution exists, but push queries use player roster IDs rather than expanding to guardian account IDs. A parent managing a child without their own roster row is missed even by the service-role reminder job.
- Preference reads on user-scoped notification routes cannot see other users' preferences and default missing rows to enabled. Guardian emails are filtered using the child's preference rather than consistently applying the receiving adult's preferences.
- Mobile token registration deletes **all** prior Expo tokens for the user; registering a second device replaces delivery to the first.
- Sending errors are logged or swallowed, without a durable delivery record or retry queue. Chat notification requests share a 30-per-hour sender limit with event notification requests.

**Required change:** authorize the initiating action first, then resolve actual recipient accounts and their preferences in a trusted worker. Support multiple devices, idempotent jobs, retries and delivery monitoring. Do not make push tokens publicly readable to work around RLS.

Evidence: [event fan-out](C:/Users/jared/Projects/lista/apps/web/src/app/api/notifications/send/route.ts:158), [chat fan-out](C:/Users/jared/Projects/lista/apps/web/src/app/api/chat/notify/route.ts:126), [token RLS](C:/Users/jared/Projects/lista/supabase/migrations/20260101000000_initial_schema.sql:227), [guardian reminder targeting](C:/Users/jared/Projects/lista/apps/web/src/app/api/cron/reminders/route.ts:65), [mobile token replacement](C:/Users/jared/Projects/lista/apps/mobile/lib/notifications.ts:57), [native chat send](C:/Users/jared/Projects/lista/apps/mobile/app/(app)/chat/[channelId].tsx:121).

### 8. P1 — All configured scheduled jobs are redirected to login

**Reproduced against the session middleware.** `vercel.json` schedules reminders, trial expiration and subdomain quarantine. None of their paths is exempted from cookie-based login redirection. A no-cookie request carrying a Bearer header returned **307 to `/login` for all three paths**, before the route's `CRON_SECRET` check.

Vercel documents that cron requests do not follow redirects. Consequently, a deployment matching this code cannot execute these handlers through those ordinary scheduled requests. This affects event reminders and the business processes that maintain club access. [Vercel cron behavior](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

**Required change:** route cron requests to their secret-authenticated handlers without an interactive login requirement; verify invocation, completion and failure alerts through the deployed middleware path.

Evidence: [middleware allowlist](C:/Users/jared/Projects/lista/apps/web/src/lib/supabase/middleware.ts:62), [cron configuration](C:/Users/jared/Projects/lista/apps/web/vercel.json:1), [probe results](C:/Users/jared/Projects/lista/docs/reviews/2026-09-04-routing-time-results.txt).

### 9. P1 — Editing a series destroys occurrence history

**Code-confirmed and cascade reproduced.** The editor updates the parent, deletes every child occurrence, and inserts replacements with new IDs. Availability references events with `ON DELETE CASCADE`; the probe's child RSVP count fell from one to zero after the deletion. The replacement explicitly clears game results/scores and does not preserve individual cancellation state or exceptions. Past children are included.

**Example:** changing the venue for a season-long practice series discards prior child RSVPs, rewrites past events, loses cancellation exceptions, and invalidates links to old child IDs. A failure after deletion leaves a partially rebuilt schedule because these are separate requests.

**Required change:** preserve occurrence IDs and existing response/history records; support “this and future occurrences”; apply the mutation transactionally; retain explicit exceptions and revisions. Make destructive removal a distinct, reviewable operation.

Evidence: [series rewrite](C:/Users/jared/Projects/lista/apps/web/src/components/calendar/event-detail.tsx:319), [availability foreign key](C:/Users/jared/Projects/lista/supabase/migrations/20260101000000_initial_schema.sql:56), [local probe results](C:/Users/jared/Projects/lista/docs/reviews/2026-09-04-local-probe-results.txt).

### 10. P1 — Event time and recurrence boundaries can be wrong

**Reproduced for recurrence and email formatting.** A weekly Monday 6 p.m. series starting September 7 and ending September 14 generated only September 7. `new Date(recurUntil)` makes the end date midnight, excluding the practice later on that date.

On a UTC server, the email builder rendered a Monday 6 p.m. Los Angeles practice as **Tuesday at 1 a.m.** It formats dates using the server's local zone without supplying the team timezone. The event forms use the editor's device timezone, even though a team timezone setting exists. The reminder job labels everything in its next-24-hours window “tomorrow,” including same-day events.

**Required change:** use an explicit event/team timezone for input and communication, inclusive recurrence boundaries, and actual event dates in reminders. Test DST transitions, traveling coaches and recipients in different timezones.

Evidence: [recurrence end date](C:/Users/jared/Projects/lista/apps/web/src/components/calendar/event-form-dialog.tsx:203), [email formatting](C:/Users/jared/Projects/lista/apps/web/src/lib/notifications/email.ts:90), [reminder wording](C:/Users/jared/Projects/lista/apps/web/src/app/api/cron/reminders/route.ts:131), [reproduction](C:/Users/jared/Projects/lista/docs/reviews/2026-09-04-routing-time-probes.test.ts).

### 11. P1 — Parent/player identity differs between web and mobile

**Code-confirmed.** The web player-invitation screen asks whether the recipient is the player or a guardian. The native screen selects `self` for every invite that is not an existing-player manager invitation. The API then inserts the signed-in parent's profile as the player, and may apply the child's birthday/gender to that account.

Separately, web guardian acceptance always creates a new player UUID. Accepting another team's player invitation for the same child can therefore create a second identity rather than another membership for the existing child. Concurrent acceptance is not protected by an atomic claim of the invitation. No merge/reconciliation workflow was found.

**Required change:** use one identity-aware, transactional acceptance workflow across clients. Offer selection of an existing managed child, distinguish the child's identity from the recipient email, and make duplicate/concurrent acceptance safe.

Evidence: [native acceptance](C:/Users/jared/Projects/lista/apps/mobile/app/invite/[id].tsx:49), [API self acceptance](C:/Users/jared/Projects/lista/apps/web/src/app/api/invite/[id]/accept/route.ts:78), [web guardian creation](C:/Users/jared/Projects/lista/apps/web/src/app/actions/invite.ts:117).

### 12. P1 — Web invitation actions lack recipient verification

**Code-confirmed.** The page checks the signed-in email, and the mobile/API acceptance route also checks it. However, the exported server actions `acceptInvitationAsSelf`, `acceptInvitationAsGuardian` and `acceptManagerInvitation` fetch invitations with service-role access and check existence/acceptance, but do not check the caller's email against the target.

The page's check is not an authorization boundary for direct server-action requests. An authenticated account holding another person's pending invitation ID can reach a privileged acceptance path. There is also no invitation expiry timestamp enforced in these paths.

**Required change:** centralize normalized recipient checks, role/type validation, expiry, revocation, and atomic one-time acceptance in the mutation itself.

Evidence: [web actions](C:/Users/jared/Projects/lista/apps/web/src/app/actions/invite.ts:23), [API recipient check](C:/Users/jared/Projects/lista/apps/web/src/app/api/invite/[id]/accept/route.ts:44).

### 13. P1 — Club staffing and ownership handover are incomplete

**Code-confirmed.** Club settings calls `/api/club/directors/invite` and `/api/club/directors/remove`; neither route exists in the checkout. The visible invite/remove controls therefore cannot complete their intended operations.

Team ownership transfer is implemented, but organization ownership is separate. Account deletion checks ownership of **teams**, not organization ownership or sole guardianship. After transferring their teams, an organization owner may pass that check; deleting the auth account cascades through its profile and organization membership. The “one owner” index guarantees at most one owner, not that an owner continues to exist. Deleting a child's sole guardian similarly leaves the managed child profile without that management link.

**Required change:** finish director provisioning/removal and organization ownership transfer; block deletion until club and guardian responsibilities are transferred or explicitly resolved. Include a documented recovery path for a lost administrator account.

Evidence: [missing-route callers](C:/Users/jared/Projects/lista/apps/web/src/components/club/club-settings-client.tsx:81), [deletion gate](C:/Users/jared/Projects/lista/apps/web/src/app/api/account/delete/route.ts:4), [organization membership cascade/index](C:/Users/jared/Projects/lista/supabase/migrations/20260416000001_organization_members.sql:12), [guardian link cascade](C:/Users/jared/Projects/lista/supabase/migrations/20260303000002_managed_profiles.sql:39).

### 14. P1 at season scale — Lists can silently omit authoritative records

**Code-confirmed; production row limit unverified.** The schedule fetches all events ordered oldest first without pagination. Availability fetches all responses for all fetched events in one query. Club members similarly loads all matching memberships before grouping and searching. The checked-in API configuration caps responses at 1,000 rows.

At that configured limit, **20 players × 51 events = 1,020 responses**, already enough to truncate an availability matrix. Missing rows can appear as “no response.” A long-lived team's future events can disappear after the oldest 1,000 events occupy its schedule query. Club membership lists can become incomplete as well.

**Required change:** query bounded date windows, paginate data on the server, fetch RSVPs for the displayed window, and distinguish failed/incomplete queries from genuinely empty results. Do not rely on raising the cap indefinitely.

Evidence: [schedule query](C:/Users/jared/Projects/lista/apps/web/src/app/dashboard/schedule/page.tsx:26), [availability query](C:/Users/jared/Projects/lista/apps/web/src/app/dashboard/availability/page.tsx:62), [club member query](C:/Users/jared/Projects/lista/apps/web/src/app/dashboard/club/members/page.tsx:100), [configured cap](C:/Users/jared/Projects/lista/supabase/config.toml:17).

### 15. P1 — Subscription reconciliation can acknowledge a failed database write

**Code-confirmed.** Several webhook branches await Supabase updates without checking the returned `error`, then return `{ received: true }`. A returned database error can therefore leave Lista stale while Stripe sees a successful acknowledgment. Setting state from event snapshots also lacks a general event ledger/order guard; old payment or subscription events can overwrite newer state, and repeated notifications are not universally deduplicated.

This concerns the club's access to Lista, **not player payment collection**. Signature verification and several lifecycle safeguards are implemented and deserve credit, but they do not close these failure modes. Stripe documents retries, duplicate delivery, and non-guaranteed event ordering. [Stripe webhook guidance](https://docs.stripe.com/webhooks).

**Required change:** durably accept events, check every write, safely retry or reconcile with current provider state, deduplicate side effects and exercise failure/reordering cases.

Evidence: [unchecked update](C:/Users/jared/Projects/lista/apps/web/src/app/api/billing/webhook/route.ts:116), [payment status updates and success return](C:/Users/jared/Projects/lista/apps/web/src/app/api/billing/webhook/route.ts:207).

### 16. P2 — Image access disagrees with the checked-in storage configuration

**Code-confirmed configuration mismatch.** Avatar and team-image buckets are created as private, while upload components store `getPublicUrl()` URLs and display them directly. Private assets require authenticated downloads or signed URLs. This produces broken images on a deployment created from those migrations unless bucket configuration is changed out of band. Making everything public would change the privacy model. [Supabase storage access models](https://supabase.com/docs/guides/storage/buckets/fundamentals).

**Required change:** choose an explicit privacy model for each asset type and implement its corresponding serving path; verify uploads and downloads after a clean database deployment.

Evidence: [private buckets](C:/Users/jared/Projects/lista/supabase/migrations/20260303000000_storage_buckets.sql:1), [public URL generation](C:/Users/jared/Projects/lista/apps/web/src/components/ui/image-upload.tsx:60).

## Infrastructure and operating-model gaps

These are additional acceptance requirements. Lack of repository evidence does **not** establish that a hosted provider feature is disabled.

| Area | Finding | Evidence needed before relying on Lista |
|---|---|---|
| Recovery and backups — P1 | No backup/restore runbook, tested restore evidence, recovery-time target or recovery-point target found. Supabase plan/PITR status was not inspected. | Restore database **and stored files** into an isolated environment; reconcile counts and permissions; demonstrate how one club is recovered without overwriting others. Record owners, retention and recovery targets. |
| Audit and historical records — P1 | No general audit history for roster roles, profile changes, schedule edits or deletions found. Some training records have audit fields, but those are not a system-wide history. | Actor/time/before-after history for critical writes; stable season snapshots; reversible administrative deletion and a retention policy. |
| Deployment ordering — P1 | Production migrations run independently of the Vercel deployment, with a comment assuming migration completion happens first. Shared staging is mutated by PR workflows. | Explicit dependency/health gate or compatible expand/contract releases; serialized migrations; isolated preview schemas; rollback/recovery rehearsal. [Migration workflow](C:/Users/jared/Projects/lista/.github/workflows/migrate.yml:29). |
| Redis dependency — P1/P2 | Tenant resolution awaits Redis before DB lookup without a fallback. A cache outage can prevent club-subdomain requests from resolving. Rate-limit configuration also makes onboarding/invitations depend on Redis. | Bounded timeouts, an explicit degraded-mode policy, monitored service failures and an outage drill. [Tenant lookup](C:/Users/jared/Projects/lista/apps/web/src/lib/supabase/tenant.ts:72), [rate limiting](C:/Users/jared/Projects/lista/apps/web/src/lib/rate-limit.ts:1). |
| Monitoring — P1 | Sentry configuration exists, but production ingestion/alerting was not verified. No demonstrated synthetic login, notification-delivery checks, cron completion alerts or incident response procedure found. | Inject a controlled error; verify its alert reaches an operator; prove an unsuccessful scheduled job or notification batch is detected. Establish an urgent support owner. |
| Realtime — P1 for chat | Messages are added to a realtime publication, but the local Supabase configuration has `[realtime] enabled = false`. Production realtime service/publication settings are unknown. | Two-device messaging and reconnect/resubscription tests against the release environment. Unit/SQL success does not prove realtime delivery. [Local config](C:/Users/jared/Projects/lista/supabase/config.toml:78). |
| Mobile release coverage — P1/P2 | iOS TestFlight automation exists. Native Android release/distribution is not established by the checked-in configuration; public app availability was not verified. Native event creation/editing, club administration and training screens were not found. | Verify the intended iOS/Android distribution, real-device notification delivery, and every required coach/parent workflow. Decide which tasks require the web app. [iOS workflow](C:/Users/jared/Projects/lista/.github/workflows/ios-testflight.yml:1), [mobile configuration](C:/Users/jared/Projects/lista/apps/mobile/app.json:1). |
| Offline operation — P2, possibly P1 at venues | The service worker handles push but does not implement offline data caching. Mobile persists auth/context, not a durable offline roster/schedule dataset or queued writes. | A deliberately designed offline read mode with last-updated indicators, plus safe retry/conflict handling if offline writes are supported. [Service worker](C:/Users/jared/Projects/lista/apps/web/public/sw.js:1). |
| Security/release assurance — P1 | RLS tests exist, but CI does not run the full web feature suite, mobile suite, E2E suite, typecheck and build as one release gate. Some older root E2E tests sit outside the web Playwright test directory. | Required checks for the actual shipped surfaces, hostile role tests, full-route tests, dependency review, representative load tests and cross-device accessibility checks. [CI](C:/Users/jared/Projects/lista/.github/workflows/test.yml:1), [Playwright scope](C:/Users/jared/Projects/lista/apps/web/playwright.config.ts:8). |
| Support and accountability — P1 | The support page offers email with no response commitment. No operational service commitment or succession plan was found. | Named support/on-call responsibility for game-day incidents, escalation instructions and a tested account/admin recovery process. [Support page](C:/Users/jared/Projects/lista/apps/web/src/app/support/page.tsx:28). |

For youth-club adoption, the club should also settle who may view children's birth dates, contact details, photos and any future sensitive information; how guardian authority is established; what communication oversight is required; and how retention/deletion requests are handled. The current managed-profile feature and privacy page do not by themselves establish those operating rules. No jurisdiction-specific legal conclusion is made here.

## Verification results

| Check | Result | Interpretation |
|---|---|---|
| Web feature/unit suite | **679 passed, 42 files** | A strong base of existing tests; many use mocked boundaries. [Log](C:/Users/jared/Projects/lista/docs/reviews/2026-09-04-web-test-results.txt). |
| Local RLS suite | **267 passed, 25 files** | Existing expectations pass against all current migrations; adversarial gaps remain. [Log](C:/Users/jared/Projects/lista/docs/reviews/2026-09-04-rls-test-results.txt). |
| Broader root selection: unit, recurrence, tenant and billing | **218 passed, 3 failed, 18 files total** | Failures appear to be stale expectations/fixtures: obsolete `club` plan, missing club-plan fixture for subdomain change, and old team-member billing access expectation. They are maintenance gaps, not three independently proven production bugs. |
| Web TypeScript | **Passed, exit 0** | `tsc --noEmit --incremental false -p apps/web/tsconfig.json`. Does not establish a successful production build. |
| Mobile Jest | **Four suites failed to start; zero tests executed** | Installed dependency resolution lacks `@babel/runtime/helpers/interopRequireDefault`. This blocks verification in this checkout; it does not establish that distributed mobile builds crash. [Log](C:/Users/jared/Projects/lista/docs/reviews/2026-09-04-mobile-test-results.txt). |
| Custom SQL probes | **Confirmed all tested behaviors; transaction rolled back** | Self-granted coach role, unauthorized guardian claim, private-group admission, unrestricted billing-state update, teammate email visibility, hidden recipient tokens and RSVP cascade loss. [SQL](C:/Users/jared/Projects/lista/docs/reviews/2026-09-04-local-readiness-probes.sql), [results](C:/Users/jared/Projects/lista/docs/reviews/2026-09-04-local-probe-results.txt). |
| Custom routing/time probes | **5/5 confirmed observed defects** | All three cron routes redirect; recurrence end-date omission; UTC email-time error. These probes assert current defects, not correct product behavior. [Probe code](C:/Users/jared/Projects/lista/docs/reviews/2026-09-04-routing-time-probes.test.ts), [results](C:/Users/jared/Projects/lista/docs/reviews/2026-09-04-routing-time-results.txt). |

I did not run a full production build, production browser E2E, load tests, physical-device tests or a hosted restore. The initial pnpm wrapper attempted dependency reconciliation and stopped; subsequent checks used the already-installed Node test binaries. Dependencies were not reinstalled. A first routing probe harness failed dependency mocking; the final saved run uses the actual no-session client path with outbound fetch blocked and passes all five probes.

## Recommended path to replacement

**Gate 1 — Protect identities and permissions.** Close findings 1–5 and 12. Add direct API tests for every role, unrelated organizations, uninvited users, guardians, removed members and modified request payloads. Verify that a user cannot grant their own role, claim a child, join a private group or alter provider-controlled billing state.

**Gate 2 — Make the daily team workflow dependable.** Close findings 6–11 and the relevant pagination issues. A coach must be able to create, reschedule and cancel events, with correct local times and observable delivery to both guardians on multiple devices. Editing a series must preserve responses, results, cancellations and history. Finish director onboarding and account/club handover.

**Gate 3 — Prove recovery and operation.** Complete a restore drill, deployed cron and webhook failure tests, a two-device realtime test, and a representative season-volume test. Establish support responsibility. Require the release checks that exercise the actual web and mobile workflows.

Passing these gates would justify a **bounded team-coordination pilot**. Its acceptance scenarios should include a parent with two children on different teams, two guardians for one child, a coach traveling across timezones, a practice canceled shortly before start, removal of a staff member, a midseason series change, and loss of the club administrator's account.

**Gate 4 — Cover the complete club record.** Implement or explicitly integrate registration/enrollment, player financial records, forms/signatures/eligibility, club-wide communications, season lifecycle, facility scheduling, actual attendance and documents. Prioritize features the target club actually uses; livestreaming and advanced statistics need not delay adoption if that club does not require them.

**Gate 5 — Rehearse migration and exit.** Build a repeatable import with stable external IDs and duplicate/guardian reconciliation. Validate athlete, household, roster and event counts, outstanding balances and signed-document associations. Test a complete export, appoint a cutover owner, and choose a clear date when Lista becomes authoritative for each data domain. If finances or waivers remain elsewhere, document that split rather than describing Lista as the sole source of truth.

**Recommendation:** retain TeamSnap ONE as the operational system while the P0/P1 gates are addressed. Lista is worth continuing as a product, but current feature breadth and green tests do not yet support a club entrusting it with its only roster, schedule, communications and administrative record.
