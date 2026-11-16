# Ship Harness Port

## Overview

Bring the ORBIT '26 workshop's engineering harness to lista: `/ship <issue>` takes a GitHub issue to a
pull request on its own, and `/code-review <pr>` and `/qa <pr>` check that pull request independently.
A person still merges.

The harness was written for the workshop's sample app (`EqualExperts/nam-2026-conference`): a single
Node/Express/SQLite app with `npm test` and a Playwright suite. lista is a pnpm/Turbo monorepo with
Next.js, Supabase (Postgres + RLS) and an Expo app, so most of the loop carries over and most of the
scripts underneath it do not. This plan says what is kept, what is rewritten, the decisions that need an
answer before building, and the order to build in.

It builds on the product side already in place: Winnow files work as GitHub Issues with a **Done when**
list, which is what ship reads.

Equal Experts encourage reusing the harness (D1), so its files are copied and adapted rather than rewritten
from scratch.

## How ship works

Each phase is a fresh agent; a workflow script (`.claude/workflows/ship.js`, run by Claude Code's
Workflow tool) holds the state between them and decides what runs next.

1. **Setup** — reads the issue, claims it (`ai-working`), makes a git worktree, and sizes the ticket from
   facts it reports (areas touched, app files, business rules, stored data, API, open questions).
2. **Spec** — writes a spec, committed first on the branch. Full-size tickets get it audited.
3. **Implement** — the test first, committed while it fails; then the change.
4. **Gate** — a script runs the suites and prints one JSON verdict. Red goes straight to a fix.
5. **Red-check** — puts the old app code back and reruns the new tests. Tests that still pass prove
   nothing and become a blocker.
6. **Audit** — independent auditors (criteria, rules, browser); every blocker must survive a skeptic
   before it costs a fix. Loops back to the gate, with a round limit.
7. **Pull request** — the spec, the evidence, every audit round and the run's cost. A ticket that will
   not converge becomes a **draft** labelled `needs-human` with what is still open.

Runs come in four sizes: `--fast` (the default on a laptop: one audit, only the tests the change
reaches), `--sized` (ship picks), `--small` (Sonnet, one combined audit) and `--full` (Opus, plan audits,
three auditors, up to four rounds).

## What carries over

| Piece | Workshop file | For lista |
| --- | --- | --- |
| The loop: phases, sizing, rounds, skeptics, hand-back | `.claude/workflows/ship.js` | **Adapt.** Keep the structure; replace every `npm` command, path and naming rule with lista's |
| Step-by-step instructions the phases read | `context/engineering-context/harness/ship-playbook.md` | **Rewrite** for lista's stack and conventions |
| Cheap agent for mechanical steps | `.claude/agents/ship-rote.md` | **Keep** as is |
| The gate | `scripts/gate.mjs` | **Rewrite.** Same contract (one JSON line, retries, `flaky`, `tampered`), new suites |
| Lanes: worktree, ports, claims | `scripts/lane.mjs` | **Adapt.** Next.js ports per lane, plus a lock for the shared database (D2) |
| Red-check | `scripts/red-check.mjs` | **Adapt** to Vitest and lista's test locations |
| Progress feed and cost | `scripts/ship-progress.mjs`, `ai-cost.mjs`, `agent-summary.mjs` | **Keep**, small path changes |
| Stacked tickets (**Depends on**) | `scripts/depends.mjs` | **Keep** |
| Review/QA sizing | `scripts/qa-facts.mjs` | **Adapt** the risky paths (D4) |
| Code review, QA | `.claude/workflows/code-review.js`, `qa.js` | **Adapt**, stage 4 |
| Doc lookup by section | `scripts/context.mjs` + front-matter on every doc | **Drop for now** (D6) |
| Fork guard | `scripts/fork-guard.mjs` | **Drop.** Workshop-only; lista is not a fork |
| GitHub Actions (`ready-for-ai` label runs ship in the cloud) | `.github/workflows/agent-*.yml` | **Later** (D5) |

## Decisions

All seven were settled on 2026-11-15.

| # | Question | Recommendation | Decision |
| --- | --- | --- | --- |
| D1 | May the harness code be reused in lista? | Ask Equal Experts before copying files | Yes — reuse is encouraged |
| D2 | How do parallel tickets share Supabase? | One local stack, and a machine-wide lock around every step that resets or uses the database (below) | As recommended |
| D3 | What must the gate run? | The layers below, chosen by what the branch changed | As recommended |
| D4 | Which changes count as risky (full loop, stronger review)? | The list below | As recommended |
| D5 | Scope of the first version | The web app and the database, run from a laptop. Mobile, GitHub Actions and the Learn phase later | As recommended |
| D6 | How do agents find lista's docs? | `CLAUDE.md` and the issue's spec only, for now; no front-matter machinery | As recommended |
| D7 | Where do ship's specs go, and what are its branches called? | `docs/specs/<issue>-<slug>.md`; `feature/<issue>-<slug>`, or `fix/<issue>-<slug>` for a `bug` issue | As recommended |

### D2 — Isolation: worktrees, ports and the database

Ship gives every ticket its own git worktree so several can build at once. The web side isolates easily:
each lane gets its own Next.js port, and the Playwright config reads the port from the environment
instead of the fixed `3001`.

The database does not. `pnpm test:rls` starts with `supabase db reset`, which wipes the one local
database and applies **this branch's** migrations — so a branch that adds a migration changes the
schema every other lane is testing against. The options:

- **Shared stack with a lock (recommended).** `lane.mjs` already keeps a registry every worktree can
  see; add a database lock to it. The gate takes the lock, resets the database to the branch's
  migrations, runs every database-backed suite, and releases it. Database work runs one ticket at a
  time; everything else still runs in parallel.
- **One Supabase stack per lane.** Full isolation, but each stack is around ten containers and a few
  GB of memory, with its own ports and keys (the ES256 key setup the env files depend on would multiply
  per lane). Too heavy for a laptop.
- **Hosted test projects.** Moves the cost and the secrets off the laptop; not worth it to start.

Each worktree also needs the gitignored env files (`.env.local`, `.env.test.local`, `.env.local.test`
for Playwright) copied in at setup, with its lane's port.

### D3 — The gate

Fastest first; each layer runs only when the change can affect it.

| Layer | Command | Runs when |
| --- | --- | --- |
| Lint and types | `pnpm lint`, `pnpm --filter @lista/web exec tsc --noEmit` | Always |
| Web unit tests | `pnpm --filter @lista/web exec vitest run` | Always |
| Root unit tests | `pnpm vitest run tests/unit tests/rrule.test.ts` | Always |
| Database suites *(lock)* | `pnpm test:rls`, then `tests/tenant` and `tests/billing` | The branch touches `supabase/`, `tests/rls|tenant|billing`, `apps/web/src/lib/supabase/`, an API route or a server action — and always on `--full` |
| Browser tests *(lock)* | `pnpm --filter @lista/web exec playwright test` | The branch touches the middleware, auth, or a page a spec opens — and always on `--full` |
| Mobile | `pnpm --filter @lista/mobile exec jest --ci` and `tsc --noEmit` | The branch touches `apps/mobile/` or `packages/` |

To start, "touches" is a path rule. The workshop's import-graph tracing (which spec reaches which
changed file) is worth having later, once the path rules show where they are too coarse.

Kept from the workshop gate: a failing browser test is retried once and reported `flaky` if it then
passes; removed assertions or added `.skip`/`.only` in tests are listed as `tampered` for the auditor;
the verdict is one JSON line plus a file with the full output.

Unknown until measured: how long the database suites take. If they are slow, the lock becomes the
bottleneck and `--fast` should run only the RLS files for the tables the branch touched.

### D4 — Risk

These send a ticket to the full loop under `--sized` and give review and QA their strongest setting:

- `supabase/migrations/` — schema and RLS policy changes
- `apps/web/src/middleware.ts` and `apps/web/src/lib/supabase/` — auth and routing
- billing and Stripe code, and the invite and signup routes (BUG-044's area)
- `apps/web/src/app/api/cron/` and the notification worker — they run as the service role
- `.claude/` and `.github/` — the harness and CI themselves
- an issue labelled `ship:full`

### Conventions ship must follow in lista

The workshop's rules are written into its prompts; lista's replace them:

- **Commits:** lista's plain-sentence subjects (`Fix #42: …`), not Conventional Commits.
- **Pull requests:** `Fixes #<n>`; a `bug` issue's PR carries **Fix as implemented** and
  **Verification** (`docs/bugs/README.md`).
- **Tests first:** already lista's rule; red-check enforces it.
- **Migrations:** a new file in `supabase/migrations/` only. Ship never runs `supabase db push`, and
  the gate resets only the local database.
- **Labels** to create once: `ai-working`, `ready-for-human`, `needs-human`, `ship:full`, `ship:fast`.

## Build order

Each stage ends with something usable and checked.

1. **Prerequisites — done 2026-11-16.** The five labels exist on GitHub; `pnpm dev` serves pages and
   `pnpm test:rls` runs end to end from a Claude session, under the conditions in *What the local
   environment needs* below.
2. **Gate and lanes.** `scripts/gate.mjs` and `scripts/lane.mjs` for lista; Playwright's port from the
   environment. The gate runs outside the sandbox (it starts dev servers and resets the database).
   **Done when** the gate prints a green JSON verdict on `main`, and two worktrees running it at once
   both finish correctly, the second waiting for the database lock.
3. **Red-check.** **Done when** it reports a test that passes without the change, on a branch made to
   check exactly that.
4. **Ship.** `ship.js`, the playbook, `ship-rote`, progress and cost, and a *What happens to a ticket*
   section in `CLAUDE.md`. **Done when** `/ship <n> --small` takes a real small issue to a ready pull
   request, and a deliberately unbuildable one ends as a `needs-human` draft.
5. **Code review and QA.** **Done when** both run on stage 4's pull request and post a verdict with a
   confidence. QA needs signed-in test users; it reuses the Playwright auth setup.
6. **Later:** GitHub Actions (needs an `ANTHROPIC_API_KEY` secret and Supabase in the runner), mobile,
   the Learn phase and doc front-matter.

## What the local environment needs

Found while checking stage 1 on a Mac running Docker through Rancher Desktop.

- **The Next.js dev server runs outside Claude's sandbox.** Inside it, file watching fails (`EMFILE`)
  and every page returns 404; outside it, the server is ready in under a second. The same applies to
  anything that starts one: Playwright's `webServer` and the gate.
- **Docker is reachable only outside the sandbox.** Starting, stopping or resetting Supabase
  (`supabase start`, `db reset`, `pnpm test:rls`) runs unsandboxed. Tests that only connect to the
  running stack on `127.0.0.1` work inside it.
- **Supabase starts without its log collector:** `pnpm exec supabase start -x vector,logflare`. The
  `vector` container mounts the Docker socket, which Rancher Desktop cannot provide; CI leaves both
  out too.
- **The RLS suite takes about six minutes** (739 tests). A database-backed gate holds the lock that
  long, so `--fast` runs only the RLS files for the tables a branch touches.
- **The Docker VM's clock drifts.** It ran 1.9 s behind the Mac, and the two expired-transfer tests in
  `tests/rls/club-ownership.test.ts` fail locally as a result: they back-date `expires_at` by one
  second of the Mac's time, which the database still reads as the future. CI passes. Restarting Rancher
  Desktop resyncs the clock; back-dating by a minute instead would make the tests immune.
- **Playwright's env file is missing.** `playwright.config.ts` loads `.env.local.test`, which does not
  exist on this machine (`.env.test.local` does). Stage 2 settles which name the browser tests use.

## Risks

- **Harness files sit in protected folders.** The sandbox blocks commands from writing under
  `.claude/workflows`, `.claude/agents` and `.claude/skills`, so creating and editing the harness needs
  file edits you approve, not scripts.
- **The database lock limits parallelism** to one database-backed gate at a time.
- **Cost is unmeasured for lista.** The workshop's small runs cost about $1–1.50 and full runs about
  $6.50; lista's larger codebase and slower suites will cost more per run.
- **Browser tests are thin** (five specs, not in CI), so QA and the browser auditor carry more weight
  until the suite grows.
