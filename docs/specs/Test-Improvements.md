# Test Improvements

## Current Coverage Snapshot

The `apps/web/tests/` suite now covers the core regressions that prompted the recent middleware and invite-flow fixes:

- Unit coverage for `updateSession` route gating in `apps/web/tests/middleware.test.ts`
- Unit coverage for the middleware matcher behavior around `manifest.json` and `sw.js`
- End-to-end coverage for public invite lookup
- End-to-end coverage for self invite acceptance on both matching and mismatched email paths
- End-to-end coverage for manager invite acceptance on both matching and mismatched email paths
- End-to-end coverage for missing auth on `/api/invite/:id/accept`
- End-to-end coverage for missing auth on `/api/managed-profiles`
- End-to-end coverage for public access to `manifest.json` and `sw.js`

This is a strong baseline. The next test additions should focus on state integrity, idempotency, and ensuring the widened middleware exceptions do not accidentally open unrelated routes.

## Work Items

### 1. Duplicate Acceptance Protection

Add e2e coverage for accepting the same invite twice.

Why this matters:

- Invite redemption is a classic idempotency edge case
- The current suite proves first acceptance works, but does not prove second acceptance fails cleanly
- This is especially important for mobile flows where retries can happen after flaky network responses

No new fixtures needed — both invite IDs are already in the accepted state after the existing success tests run.

Tests:

- `POST /api/invite/:id/accept type=self` a second time returns `410`
- `POST /api/invite/:id/accept type=manager` a second time returns `410`

Assertions:

- Response status is `410`
- `team_members` count does not increase after the second self acceptance attempt
- `profile_managers` count does not increase after the second manager acceptance attempt
- `accepted_at` remains set to the original acceptance timestamp, not rewritten

### 2. Invalid Bearer Token Coverage

Add e2e tests for a syntactically valid but unrecognisable token on bearer-token routes.

Why this matters:

- Current coverage checks missing auth headers, but not invalid tokens
- Middleware exemptions now intentionally allow these routes through, so route-level auth needs to be locked down against stale or corrupted tokens — a realistic mobile scenario

Tests:

- `/api/invite/:id/accept` with `Authorization: Bearer not-a-real-token` returns `401`
- `/api/managed-profiles` with `Authorization: Bearer not-a-real-token` returns `401`

Assertions:

- Response status is `401`
- Response body is JSON-shaped
- No `team_members`, `profile_managers`, or `profiles` rows are created

### 3. Unauthenticated Browser Redirect Guardrails

Add e2e checks that the middleware exemptions did not weaken protection of standard app pages.

Why this matters:

- The recent fixes intentionally opened a small set of API routes
- The highest risk is an over-broad exemption accidentally letting protected pages through
- The authenticated `/login` → `/dashboard` redirect is already covered by the existing Vitest unit tests, so only the unauthenticated direction needs e2e coverage

Tests:

- Logged-out request to `/dashboard` redirects to `/login`
- Logged-out request to `/dashboard/team` redirects to `/login`

Assertions:

- Response status is `302` or `307`
- `location` header contains `/login`

### 4. Protected API Boundary Test

Add one negative test proving that a route outside the public allowlist is still protected.

Why this matters:

- Current tests prove that specific routes are public or bearer-authenticated
- They do not prove that unrelated API routes are still protected
- This is the best protection against someone broadening the allowlist from a narrow namespace to all `/api/*`

Test:

- Logged-out `POST /api/notifications/send` with redirect-following disabled returns a raw middleware redirect

Implementation note: disable Playwright's automatic redirect-following for this request so the test asserts the raw middleware response directly rather than the eventual destination.

Assertions:

- Response status is `302` or `307`
- `location` header contains `/login`

### 5. Invite Lookup Edge Cases

Add coverage for invalid or terminal invite states on the public GET endpoint.

Why this matters:

- The current tests prove valid invite lookup works
- They do not yet prove error handling for bad IDs or already-accepted invites
- The "no redirect" assertion is an additional Bug 2 regression guard

Tests:

- `GET /api/invite/:id` with a non-existent ID returns `404`
- `GET /api/invite/:id` for an already-accepted invite returns `410`
- `POST /api/invite/:id/accept` for a non-existent ID returns `404`

Assertions:

- Response body is JSON with a stable error message
- Response is not a redirect to `/login`

### 6. Manager Success Path: No `team_members` Side Effect ✅ Done

The current manager success test verifies that the expected `profile_managers` row is created and the invitation is marked accepted. Add one assertion to make it tighter.

Test addition (to existing manager success test):

- Assert that no `team_members` row was created for user A in the test team

Why this matters:

- Protects against a future regression where the route accidentally runs both the self and manager branches
- Explicitly documents the behavioural distinction between the two invite modes

---

## Recommended Order Of Work

1. Item 6 — one assertion added to an existing test, near-zero effort
2. Item 1 — duplicate acceptance for both invite paths, no new fixtures needed
3. Item 5 — invite lookup edge cases, cheap given fixture state after item 1
4. Item 4 — one protected API boundary test
5. Item 3 — unauthenticated redirect guardrails
6. Item 2 — invalid bearer token coverage

## Suggested File Placement

To keep the suite organised as it grows:

- Keep middleware behaviour unit tests in `apps/web/tests/middleware.test.ts`
- Keep invite and public-route integration tests in `apps/web/tests/e2e/middleware.spec.ts` until the file becomes too broad
- Once the file grows past a comfortable size, split into:
  - `apps/web/tests/e2e/invite-acceptance.spec.ts`
  - `apps/web/tests/e2e/middleware-routing.spec.ts`
