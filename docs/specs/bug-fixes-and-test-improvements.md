# Bug Fixes and Test Improvements

**Status:** In Progress
**Started:** 2026-03-20

---

## Findings

### Bug 1 — HIGH: Invite acceptance allows email mismatch
**File:** `apps/web/src/app/api/invite/[id]/accept/route.ts`

After authenticating the Bearer token and loading the invitation, the route immediately proceeds to insert `team_members` or `profile_managers` rows without ever checking `user.email === invitation.email`. Any authenticated user with the invite URL can redeem it and join the team or attach themselves as a manager under the target email's role.

### Bug 2 — HIGH: Middleware redirects mobile API routes to `/login`
**File:** `apps/web/src/lib/supabase/middleware.ts` (line 37)

`publicRoutes` only exempts `/api/auth/`. Three routes that must be reachable without a cookie session are not listed:
- `/api/invite/` — public GET, fetched before sign-in on mobile
- `/api/invite/:id/accept` — bearer-token POST
- `/api/managed-profiles` — bearer-token POST

Unauthenticated or bearer-token requests to these routes are redirected to `/login` before the route handler ever runs.

### Bug 3 — MEDIUM: PWA assets blocked for logged-out users
**Files:** `apps/web/src/middleware.ts` (matcher), `apps/web/src/app/layout.tsx` (line 19)

The middleware matcher does not exclude `.json` or `.js` files in `public/`. A logged-out user requesting `/manifest.json` or `/sw.js` gets redirected to `/login`, breaking PWA install on the landing page.

### Discrepancy — CLAUDE.md `pnpm test` command ✅ Fixed
`CLAUDE.md` documented `pnpm test` as a root-level command, but the root `package.json` has no `test` script — only `apps/web/package.json` does. Updated CLAUDE.md to reflect that test commands must be run from `apps/web/`.

---

## Implementation Plan

### Step 1 — Fix Bug 1: Email validation in invite acceptance

**File:** `apps/web/src/app/api/invite/[id]/accept/route.ts`

After loading the invitation and before any insert, compare the authenticated user's email to the invitation email (case- and whitespace-normalized). Return 403 if they don't match. Apply the same check for both `type === "self"` and `type === "manager"` paths.

```ts
const userEmail = user.email?.trim().toLowerCase() ?? "";
const inviteEmail = invitation.email.trim().toLowerCase();
if (userEmail !== inviteEmail) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

### Step 2 — Fix Bug 2: Widen public routes in middleware

**File:** `apps/web/src/lib/supabase/middleware.ts`

Add `/api/invite/` and `/api/managed-profiles` to the `publicRoutes` list. These routes handle their own authentication (none for the public GET, Bearer token for POSTs), so bypassing the cookie-session redirect is safe.

```ts
const publicRoutes = [
  "/login",
  "/signup",
  "/forgot-password",
  "/invite",
  "/auth/callback",
  "/auth/confirm",
  "/api/auth/",
  "/api/invite/",         // ← add
  "/api/managed-profiles", // ← add
];
```

### Step 3 — Fix Bug 3: Exclude PWA assets from middleware matcher

**File:** `apps/web/src/middleware.ts`

Add `manifest.json` and `sw.js` to the matcher's exclusion list alongside `favicon.ico`.

```ts
"/((?!_next/static|_next/image|favicon.ico|manifest\\.json|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
```

### Step 4 — Write Playwright tests

**Location:** `apps/web/tests/e2e/middleware.spec.ts` (new file)

Playwright is already configured at `apps/web/playwright.config.ts`.

Tests to write:

| Test | Expected |
|------|----------|
| Logged-out `GET /api/invite/:id` | 200 JSON, not redirect |
| Bearer-token `POST /api/invite/:id/accept` — email matches | success |
| Bearer-token `POST /api/invite/:id/accept` — email mismatch | 403 |
| Bearer-token `POST /api/managed-profiles` | route-level response, not redirect |
| Logged-out `GET /manifest.json` | 200 |
| Logged-out `GET /sw.js` | 200 |

### Step 5 — Write lower-level middleware unit tests (optional fast-feedback layer)

**Location:** `apps/web/tests/middleware.test.ts` (new file)

| Test | Expected |
|------|----------|
| Request to known public route (`/login`) | passes through unchanged |
| Request to protected dashboard route with no session | redirects to `/login` |
| Request to `/api/invite/` with no session | passes through unchanged |
| Request to `/api/managed-profiles` with no session | passes through unchanged |
| Request to `/manifest.json` with no session | passes through unchanged |
| Authenticated request to `/login` | redirects to `/dashboard` |

---

## Progress

| Item | Status |
|------|--------|
| CLAUDE.md `pnpm test` correction | ✅ Done |
| Bug 1 fix — email validation | ✅ Done |
| Bug 2 fix — middleware public routes | ✅ Done |
| Bug 3 fix — middleware matcher | ✅ Done |
| Playwright e2e tests | ✅ Done |
| Middleware unit tests (optional) | ✅ Done |

---

## Post-Implementation Review

Three gaps identified after the initial tests were written:

### Gap 1 — HIGH: `type: "manager"` invite path has no test coverage

The spec states the email check must apply to both `type === "self"` and `type === "manager"` paths. Every existing test uses `{ type: "self" }`. The manager branch writes to a different table (`profile_managers` instead of `team_members`), so a regression that moved or removed the email guard for that branch would go undetected.

Tests needed:
- `type: "manager"`, mismatched email → 403 + verify no `profile_managers` row created for user B
- `type: "manager"`, matching email → 200 + verify `profile_managers` row created and `accepted_at` set

Fixtures needed: a managed profile (no auth account) and a manager-type invitation with `managed_profile_id` set.

### Gap 2 — MEDIUM: Success test does not verify DB writes

The `type: "self"` success test only checks `{ success: true }` in the response body. The mismatch test verifies DB state (invitation unaccepted, no membership row), but the success test has no symmetric DB assertions. A route returning a hardcoded success without writing would still pass.

Assertions to add to the existing success test:
- `team_members` row exists for user A in the test team
- `invitations.accepted_at` is non-null

### Gap 3 — LOW: No test for missing `Authorization` header on accept endpoint

We test the wrong-user case (403) and right-user case (200) but not the no-token case. The accept endpoint should return 401 when the `Authorization` header is absent entirely.

---

## Additional Test Plan

### Step 6 — Manager invite path (Gap 1)

**File:** `apps/web/tests/e2e/middleware.spec.ts`
**Setup:** `apps/web/tests/e2e/global-setup.ts` / `global-teardown.ts`

Add a managed profile and manager-type invitation to the global fixtures, then add two tests mirroring the existing self-invite tests.

### Step 7 — Self invite success DB assertions (Gap 2)

**File:** `apps/web/tests/e2e/middleware.spec.ts`

Extend the existing `type: "self"` success test with DB-state assertions.

### Step 8 — No-auth header on accept endpoint (Gap 3)

**File:** `apps/web/tests/e2e/middleware.spec.ts`

Add a single test: POST to accept with no `Authorization` header → 401.

---

## Progress

| Item | Status |
|------|--------|
| CLAUDE.md `pnpm test` correction | ✅ Done |
| Bug 1 fix — email validation | ✅ Done |
| Bug 2 fix — middleware public routes | ✅ Done |
| Bug 3 fix — middleware matcher | ✅ Done |
| Playwright e2e tests | ✅ Done |
| Middleware unit tests (optional) | ✅ Done |
| Gap 1 — manager invite path tests | ✅ Done |
| Gap 2 — self invite success DB assertions | 🔲 Todo |
| Gap 3 — no-auth header test | 🔲 Todo |

---

*This document will be updated as decisions are made and implementation progresses.*
