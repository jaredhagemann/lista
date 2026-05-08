# Club Subdomain Routing

## Problem

Club-tier orgs have a dedicated subdomain (`{slug}.lista.team`) that delivers white-label branding. When a user switches to a club team, or navigates directly to `/dashboard` while a club team is active, they must always land on the org's subdomain — never on `lista.team`. The reverse also applies: switching to a free team from a subdomain must return the user to `lista.team`.

This requires changes in three layers:
1. Session cookies must be readable across `lista.team ↔ *.lista.team`.
2. The team-switcher action must return a redirect URL when a domain hop is needed.
3. The dashboard layout must passively enforce the correct domain on every load.

---

## Changes

### 1. `setActiveTeam` returns a `redirectUrl`

**File:** `src/app/actions/team.ts`

After updating `active_team_id`, query the target team's organization for subdomain info:

```ts
const { data: teamRow } = await supabase
  .from("teams")
  .select("organizations(subdomain, subdomain_status, plan)")
  .eq("id", teamId)
  .single();
```

Read the current hostname via `headers()` from `next/headers`, then set `redirectUrl`:

- Org has `plan = 'club'`, `subdomain_status = 'active'`, non-null `subdomain`, and the current host is not already `{subdomain}.lista.team` → `redirectUrl = https://{subdomain}.lista.team/dashboard`
- Org has no active club subdomain AND the current host is a `*.lista.team` subdomain → `redirectUrl = https://lista.team/dashboard`
- Otherwise → no `redirectUrl`

Return type: `{ success: true; redirectUrl?: string } | { error: string }`.

### 2. Team switcher navigates cross-origin when needed

**File:** `src/components/team/team-switcher.tsx`

```ts
const result = await setActiveTeam(teamId);
if (result && "redirectUrl" in result) {
  window.location.href = result.redirectUrl;  // full cross-origin navigation
} else {
  router.push("/dashboard");                  // same-domain, current behavior
}
```

`router.push` is same-origin only; `window.location.href` is required for subdomain hops.

### 3. Domain-scope all auth/session cookies

All cookies that must survive a `lista.team ↔ *.lista.team` redirect need `domain: ".lista.team"` in production. Without this, a user redirected to a subdomain loses their session and is sent to `/login`.

**A. Supabase auth tokens** — `src/lib/supabase/middleware.ts` and `src/lib/supabase/server.ts`

Inject `domain` in the `setAll` handler in both files:

```ts
cookiesToSet.forEach(({ name, value, options }) =>
  target.cookies.set(name, value, {
    ...options,
    domain: process.env.NODE_ENV === "production" ? ".lista.team" : undefined,
  })
);
```

`@supabase/ssr` calls `setAll` with `{ maxAge: 0 }` to delete cookies, so deletions are automatically domain-scoped through the same handler.

**B. `active_profile_id`** — `src/app/actions/team.ts`

Add `domain` to the `cookieStore.set` call. For deletion in both `clearActiveProfile` and the delete-branch of `setActiveTeam`, use the explicit expiry form (more compatible across Next.js versions than `delete(name)`):

```ts
cookieStore.set(ACTIVE_PROFILE_COOKIE, "", {
  maxAge: 0,
  path: "/",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  domain: process.env.NODE_ENV === "production" ? ".lista.team" : undefined,
});
```

**One-time migration:** Existing cookies set without `domain` are treated as different cookies by browsers. On first deploy, logged-in users redirected to a subdomain will lose their session and need to re-authenticate once. After that, all new cookies carry `.lista.team` scope and are stable.

### 4. Passive enforcement in the dashboard layout

**File:** `src/app/dashboard/layout.tsx`

After `activeOrgId` is already computed, add one query and a redirect guard before rendering:

```ts
// Resolve the active team's org subdomain (for subdomain enforcement below)
let activeOrgSubdomain: string | null = null;
if (activeOrgId) {
  const { data: orgData } = await supabase
    .from("organizations")
    .select("subdomain, subdomain_status, plan")
    .eq("id", activeOrgId)
    .maybeSingle();
  if (orgData?.plan === "club" && orgData?.subdomain_status === "active") {
    activeOrgSubdomain = orgData.subdomain ?? null;
  }
}

// Enforce correct domain — covers direct navigation, bookmarks, and fresh logins.
// tenant?.subdomain is null on lista.team, non-null on a *.lista.team subdomain.
const currentSubdomain = tenant?.subdomain ?? null;
if (activeOrgSubdomain && currentSubdomain !== activeOrgSubdomain) {
  redirect(`https://${activeOrgSubdomain}.lista.team/dashboard`);
}
if (!activeOrgSubdomain && currentSubdomain) {
  redirect(`https://lista.team/dashboard`);
}
```

This runs on every `/dashboard` load, catching any path that bypasses the team switcher (bookmarks, login redirect, etc.).

---

## No new migrations

All reads are against existing columns: `organizations.subdomain`, `organizations.subdomain_status`, `organizations.plan`.

---

## Tests

1. `setActiveTeam` for a club team with an active subdomain returns `{ redirectUrl: "https://slug.lista.team/dashboard" }`.
2. `setActiveTeam` for a free team while on a subdomain returns `{ redirectUrl: "https://lista.team/dashboard" }`.
3. `setActiveTeam` for a free team on the main domain returns `{ success: true }` with no `redirectUrl`.
4. `setActiveTeam` for a club team while already on the correct subdomain returns `{ success: true }` with no `redirectUrl` (no redirect loop).
