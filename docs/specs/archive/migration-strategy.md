# Migration Strategy & Staging Environment

## Overview

Migrations in `supabase/migrations/` are applied automatically via GitHub Actions:

- **Pull requests** → migrations pushed to **staging** (validates they apply cleanly; Vercel preview deployments use staging credentials)
- **Merge to main** → migrations pushed to **production** (runs alongside the Vercel deployment; staging pre-validates every migration before it reaches this step)

The workflow is in `.github/workflows/migrate.yml`.

---

## One-time Setup (Manual Steps)

### 1. Create a staging Supabase project

Go to [supabase.com/dashboard](https://supabase.com/dashboard) → New project. Name it something like `lista-staging`. Once created, note the **Project Reference ID** (found in Project Settings → General — a string like `abcdefghijklmnop`).

Apply the current schema to staging by running this once locally:

```bash
supabase link --project-ref <STAGING_PROJECT_REF>
supabase db push
```

This seeds staging with all current migrations so it starts in sync with production.

### 2. Generate a Supabase access token

Go to [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → Generate new token. This is a personal access token that lets the CLI authenticate as you. Store it securely — you won't be able to see it again.

### 3. Find your production project ref and DB password

- **Project ref**: Supabase Dashboard → your production project → Settings → General → Reference ID
- **DB password**: Settings → Database → Database password (or reset it if you don't have it)

Do the same for staging.

### 4. Add GitHub Secrets

In your GitHub repo: Settings → Secrets and variables → Actions → New repository secret.

Add all five:

| Secret name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Personal access token from step 2 |
| `SUPABASE_PROJECT_REF` | Production project reference ID |
| `SUPABASE_DB_PASSWORD` | Production database password |
| `SUPABASE_STAGING_PROJECT_REF` | Staging project reference ID |
| `SUPABASE_STAGING_DB_PASSWORD` | Staging database password |

### 5. Configure Vercel environment variables

Vercel supports per-environment variables (Production / Preview / Development). You want:

- **Production** env vars → point at the production Supabase project (already set)
- **Preview** env vars → point at the staging Supabase project

In the Vercel dashboard → your project → Settings → Environment Variables:

For each of these three variables, add a **Preview**-scoped entry with staging values:

| Variable | Production value | Preview value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<prod-ref>.supabase.co` | `https://<staging-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod anon key | staging anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | prod service role key | staging service role key |

The anon and service role keys for staging can be found in the Supabase dashboard under staging project → Settings → API.

---

## Day-to-day workflow

Once set up, the flow is fully automatic:

1. Create a branch and open a PR
2. GitHub Actions applies your migrations to staging → Vercel preview deployment uses staging → you can test the full feature end-to-end in the preview URL
3. Merge the PR → GitHub Actions applies the same migrations to production → Vercel deploys the new code

**No manual migration steps.** Adding a new migration file to `supabase/migrations/` is all that's needed.

---

## Timing note

The production migration job runs in parallel with the Vercel deployment. Migrations typically complete in under 30 seconds; Vercel builds take 1–3 minutes. In practice the schema is updated before the new app code goes live. The staging pre-validation step on every PR means a migration that applies cleanly to staging will almost always apply cleanly to production.

If you ever need to guarantee sequencing (e.g., for a particularly risky migration), you can manually run `supabase db push --project-ref <prod-ref>` before merging, and the workflow will simply find no pending migrations and exit cleanly.

---

## Implementation status

- [x] `.github/workflows/migrate.yml` — workflow created
- [ ] Staging Supabase project created
- [ ] GitHub secrets added (all 5)
- [ ] Vercel Preview env vars configured to point at staging
