# BUG-042 — Club pages can show the Lista favicon instead of the club's

**Severity:** P2
**Status:** Fixed
**Reported:** 2026-11-03 by the user, seeing the blue Lista favicon on a branded club account
**Area:** branding / white-label
**Evidence class:** Mixed. The two icon links are reproduced on production (`slofc.lista.team`). Which one a browser
picks is the user's report; it wasn't measured.
**Last verified:** `d686ad915`, production and local stack

## Symptom

On a club's site, the browser tab shows the blue Lista icon, not the club's. The multi-tenant spec says no Lista branding
shows on a club's domain.

## Reproduction

1. `curl -sL https://slofc.lista.team/login`, and read the `<link rel="icon">` tags.

**Expected:** one icon, the club's.
**Actual:** two, with Lista's first and the only one declaring a size:

```html
<link rel="icon" href="/favicon.ico?favicon.bf8657f0.ico" sizes="32x32" type="image/x-icon"/>
<link rel="icon" href="https://…/org-images/2644ee5a-…/favicon?t=1778259945092"/>
```

The club's image itself is fine: it returns 200 as `image/png`, and shows the club's badge.

## Cause

Two gaps:

1. **Next adds `app/favicon.ico` to every page, whatever the metadata says.** `generateMetadata` did name the club's
   favicon, so anything checking the metadata looked right, but the file-based icon was added in front of it.
   `postProcessMetadata` in `next/dist/lib/metadata/resolve-metadata.js` does this.
2. **A club with no active subdomain had no club favicon at all.** Its header takes the logo from the active team, but
   the favicon only came from the tenant, and there's no tenant on `lista.team`.

## Fix as implemented

**Branch:** `fix/042-club-favicon`
**Migration:** none.

- `favicon.ico` and `icon.png` moved from `src/app/` to `public/`, so Next no longer adds them on its own. Only the
  metadata names them now, through `LISTA_ICONS` in `src/lib/favicon.ts`.
- `src/app/layout.tsx`: a club's domain gets its favicon and nothing else, else Lista's.
- `src/app/dashboard/layout.tsx`: new `generateMetadata`, using the active club team's favicon. The layout and its
  metadata share one per-request read of the session and context.
- A club with a logo but no favicon uses the logo. A team's own logo is not used, even in a club.

## Verification

**Tests:** `tests/club-favicon.test.tsx` and `tests/dashboard-layout-branding.test.tsx`. Unit tests alone couldn't catch
the original bug, because it came from Next adding a file, so one test also fails if an icon file returns to `src/app/`.

**Browser, local stack, Chromium, reading the page's icon links:**

| Case | Icon links |
| --- | --- |
| Signed out, `localhost` | Lista's two |
| Club with no icon, coach | Lista's two |
| Club with a favicon and no subdomain, coach and player | The club's only, on the dashboard and on Settings |
| Simulated club domain, by sending `x-tenant-*` headers | The club's only |

**Not tested:** a real club subdomain, which needs Redis and DNS. The simulated row stands in for it. That simulation
no longer works, because BUG-043 clears those headers.

**Deployment verification:**
- **Done, 2026-11-03, by Claude:** repeated the `curl` above on `slofc.lista.team` after deploy. It lists one icon link, the
  club's.
- **Not yet done:** looking at the tab itself in a browser. Browsers cache favicons, so a hard refresh or a new tab may
  be needed.

**Found while fixing:** [BUG-043](./043-client-can-supply-tenant-headers.md).
