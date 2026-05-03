# Rant-to-Launch — Post-Audit Follow-Up Tasks

This document captures the audit work that has been completed and provides ready-to-paste prompts for the work that was deferred. Each prompt is self-contained: paste it as a Plan-mode message and the planning agent will scope it into a project task. The prompts include explicit rules, scope boundaries, and a "do not" list to keep each task isolated and reviewable.

---

## 1. What was already fixed (audit pass, May 2026)

Tracker: `.local/audit-implementation-progress.md`. Source: `.local/tasks/audit/`.

### Server (`artifacts/api-server`)
- `helmet` with CSP off (Vite-friendly) and `crossOriginResourcePolicy: cross-origin` for storage assets.
- Env-driven CORS via `CORS_ORIGINS` (csv); permissive fallback in dev only.
- 200kb body limit on `express.json` and `express.urlencoded`.
- `app.set("trust proxy", 1)` for the Replit edge proxy.
- IP-keyed rate limits via `express-rate-limit` (default IPv6-safe key generator):
  - POST `/api/projects` — 5/hour
  - PATCH/DELETE — 30/hour
  - GET — 60/minute
- `OPENAI_MODEL` and `PROMPT_VERSION` env vars (defaults preserve `gpt-5.4` / `v4-visuals`).
- `clampErrorMessage(4096)` wrapping all 4 `generation_runs.errorMessage` write paths.
- Weak ETag + 304 + `Cache-Control: private, no-cache, must-revalidate` on `GET /api/projects/:slug`.
- Pino body-redaction noted in code (no secret-bearing fields exist yet).

### Frontend (`artifacts/rant-to-launch`)
- `ErrorBoundary` class component wrapping the Router in `App.tsx`.
- Skip-to-main-content link, `<main id="main-content">` landmark.
- `aria-hidden` on every decorative icon.
- Non-color affordance (Check icon) on channel toggles.
- `aria-describedby` from rant textarea to live charcount id.
- `role="status" aria-live="polite"` region during generation.
- `motion-safe:` gates on hover-translate and `animate-spin`.
- Anchor scroll on cold load in `project-workspace.tsx` (deep-link fix).
- Empty-state helper text under the submit button.
- Recent launches now show 20 inside a scroll container.
- Headline copy: "7-day plan" → "launch-day posting plan that hits at the right hour".

### Verified
- API typecheck clean; helmet headers, ETag, 304, and rate-limit headers confirmed via curl.
- Frontend HMR clean; only the 3 pre-existing `card-sections.tsx` TS errors remain (unrelated).
- Architect code review: no severe issues.

---

## 2. Universal task rules (apply to every prompt below)

Every follow-up prompt should be executed under these rules. Copy this block into the task description if the planning agent doesn't carry it forward.

**Voice and communication**
- Founder-direct. No fluff, no hedging, no emojis.
- No marketing copy in commits or PR descriptions.

**Scope discipline**
- Do exactly what the prompt says. Nothing more.
- If you discover a second issue, write it in `.local/followup-notes.md` and keep going. Do not expand scope mid-task.
- If a prompt conflicts with reality (file moved, dep already removed, etc.), stop and ask — do not improvise.

**Code hygiene**
- Maintain the existing file structure unless the prompt asks you to refactor.
- Keep changes minimal and reviewable. Prefer additive edits over rewrites.
- No dead code. No `// TODO` notes without a tracker line.

**Validation**
- Run `pnpm --filter @workspace/<pkg> run typecheck` after every meaningful change.
- For backend changes, restart `artifacts/api-server: API Server` and confirm `Server listening` plus a smoke `curl` against the affected route.
- For frontend changes, screenshot the affected page and confirm no console errors.
- Use the `code_review` skill (architect) for non-trivial work before marking complete.

**Out of bounds (default — override only if the prompt explicitly opts in)**
- Do not change the database schema (no `drizzle-kit generate`, no new tables/columns).
- Do not add or remove dependencies.
- Do not introduce a test framework if none exists in the workspace.
- Do not touch `artifacts/demo-video` or `artifacts/mockup-sandbox`.
- Do not add i18n plumbing.
- Do not refactor unrelated files "while you're in there."

**When done**
- Update `.local/audit-implementation-progress.md` (or the task's own tracker file) with what shipped.
- Write a 1-paragraph summary in the final user message: what changed, what you verified, what you intentionally did not do.

---

## 3. Task prompts (ordered by suggested execution order)

The order matters for two reasons: (a) tests should land before refactors so refactors are safe, (b) async generation should land before its UI work, (c) auth should land before owner-scoping share links. Dependencies are called out in each prompt.

---

### TASK A — Wire up a test runner and write a smoke suite

**Why first**: every later refactor task is dramatically safer with even a thin test suite. This task is a prerequisite for AR1, AR2, AR3.

**Prompt to paste in Plan mode**:

> Add a test runner to the monorepo and write a smoke test suite. No production code changes.
>
> Scope:
> 1. Add `vitest` + `@testing-library/react` + `@testing-library/jest-dom` + `jsdom` as devDependencies in `artifacts/rant-to-launch`. Add `vitest` + `supertest` in `artifacts/api-server`.
> 2. Create `vitest.config.ts` in each artifact. Add a `test` script to each `package.json`.
> 3. Frontend smoke tests (`artifacts/rant-to-launch/src/**/*.test.tsx`):
>    - `home.test.tsx`: renders, submit button is disabled with empty rant, becomes enabled with text, channel toggles flip `aria-checked`.
>    - `error-boundary.test.tsx`: catches a thrown render error and shows the fallback.
> 4. Backend smoke tests (`artifacts/api-server/src/**/*.test.ts`):
>    - `app.test.ts` via supertest: GET `/api/projects/demo` returns 200 with ETag; same request with `If-None-Match` returns 304; POST `/api/projects` rejects bodies over 200kb with 413.
>    - Mock the OpenAI client. Do NOT call the real OpenAI API in any test.
> 5. Add a root-level `pnpm test` script that runs both via `pnpm -r run test`.
>
> Rules: follow the universal rules in `.local/audit-followup-tasks.md` §2. Override on dependencies — you ARE allowed to add the test deps listed above (and only those). No schema changes. No source code changes outside test files and config. Do not wire CI.
>
> Acceptance: `pnpm test` runs both suites and passes locally. Document any flaky tests instead of skipping them.

---

### TASK B — Drop unused top-level dependencies

**Why second**: small, mechanical, high-confidence. Easier to reason about with tests in place.

**Prompt**:

> Audit and remove genuinely unused top-level dependencies from `artifacts/rant-to-launch`. Conservative pass only.
>
> Scope:
> 1. For each of `next-themes`, `recharts`, `react-day-picker`, `vaul`: search the codebase for every import. If the only importers are unused shadcn wrappers in `src/components/ui/{sonner,chart,calendar,drawer}.tsx`, also delete those wrapper files. If any other file imports them, leave the dep alone and document why in `.local/followup-notes.md`.
> 2. Run `pnpm --filter @workspace/rant-to-launch run typecheck` and the test suite (Task A) after each removal.
> 3. Update `replit.md` if it references any removed package.
>
> Rules: follow universal rules §2. Override on deps — you ARE allowed to remove the four packages listed if and only if the wrapper files are also deleted and nothing else imports them. Do not remove anything not in the list. Do not "tidy up" other unused exports.
>
> Acceptance: typecheck and test suite pass; bundle size reduction noted in the task summary; `pnpm install` produces no warnings.

---

### TASK C — Database schema cleanup and indexes

**Why third**: standalone, low-risk read-side perf win. Independent of the refactor stack.

**Prompt**:

> Add missing indexes and drop dead columns/tables in the `artifacts/api-server` Drizzle schema. Migration only — no API behavior change.
>
> Scope:
> 1. Inventory current indexes vs the queries actually issued. At minimum add: index on `projects.slug` (unique if not already), `asset_cards(project_id, kind)`, `generation_runs(project_id, created_at desc)`, `share_links.token` (unique).
> 2. Identify columns/tables that no code reads or writes. List them in the task plan first; do not drop until the user approves the list.
> 3. Use `drizzle-kit generate` to produce a migration file under the existing migrations folder. Do not hand-write SQL.
> 4. Apply the migration to the dev DB. Confirm `\d+ <table>` shows the new indexes. Run the test suite from Task A.
>
> Rules: follow universal rules §2. Override on schema — you ARE allowed to add indexes and drop already-dead columns approved by the user. Do not rename columns. Do not change column types. Do not touch production — write a separate `production-migration.md` note describing the prod apply steps for the user to run manually via the database skill.
>
> Acceptance: dev migration applies cleanly and is reversible; tests pass; `EXPLAIN ANALYZE` on the GET project query shows index use; prod runbook written.

---

### TASK D — Async generation pipeline (P1)

**Why fourth**: the biggest change. Lands the foundation that Task E (UX) builds on.

**Prompt**:

> Convert POST `/api/projects` from a synchronous 60–120s request into an async job-backed flow. The current request blocks the HTTP connection through OpenAI text + 11 image generations; this task fixes that.
>
> Scope:
> 1. Add a `generation_jobs` table (Drizzle migration) with: `id`, `project_id`, `status` enum (`queued|running|succeeded|failed`), `progress_total`, `progress_done`, `current_step` text, `error_message` text (clamped, reuse `clampErrorMessage`), timestamps.
> 2. POST `/api/projects` now: creates the project row in `pending` status, enqueues a job, returns `202 Accepted` with `{ projectId, slug, jobId }` in <500ms.
> 3. Add a worker: an in-process `setImmediate`-driven queue is acceptable for v1 (single-instance Replit). Document the path to BullMQ/Redis in code comments. The worker calls the existing generation code, updating `progress_done` and `current_step` after each card.
> 4. Add GET `/api/jobs/:jobId` returning the current status snapshot. Apply the existing read rate limiter.
> 5. Reuse `clampErrorMessage` everywhere a job error is persisted.
> 6. Update OpenAPI spec and regenerate the client (`pnpm --filter @workspace/api-spec run codegen`).
>
> Rules: follow universal rules §2. Override on schema — you ARE allowed to add the `generation_jobs` table via a migration. Do NOT change auth (Task F). Do NOT change the frontend UX yet (Task E). Existing GET endpoints must remain unchanged. The synchronous code path may be deleted only after the worker path is proven; if in doubt, keep both behind a feature flag and remove the old one in a follow-up.
>
> Acceptance: POST returns 202 in under 500ms; the job runs to completion in the background; GET `/api/jobs/:jobId` reports progress; tests cover success, failure, and the 202 happy path with a mocked OpenAI client.

---

### TASK E — Frontend UX for async generation (U1)

**Why fifth**: depends on Task D. Without it, there is nothing to poll.

**Prompt**:

> Update the rant-to-launch frontend to consume the async generation job from Task D. Replace the existing blocking spinner with a live progress UI.
>
> Scope:
> 1. After POST returns `{ projectId, slug, jobId }`, route the user to `/projects/:slug` immediately (do not wait for completion).
> 2. On the project workspace page, if the project's job is not yet `succeeded`, render a progress view: current step text, a determinate bar (`progress_done / progress_total`), and a "this can take a couple of minutes" line. Poll GET `/api/jobs/:jobId` every 2 seconds via `react-query`. Stop polling when status is `succeeded` or `failed`.
> 3. On `failed`, render the existing error UI with the (clamped) `error_message`.
> 4. On `succeeded`, transition to the existing card layout — no full reload.
> 5. Persist the in-flight job in `localStorage` keyed by slug so a refresh resumes polling.
> 6. Keep the existing `aria-live="polite"` status pattern; announce step transitions.
>
> Rules: follow universal rules §2. Do NOT change the API contract — Task D owns it. Do NOT introduce a new state library; use react-query that already exists. Cancel button is out of scope (a later task). Do not touch `home.tsx` beyond the redirect change.
>
> Acceptance: a fresh launch renders the workspace within 1 second of submit; progress bar advances; refresh mid-generation resumes polling; failure state matches the existing alert design.

---

### TASK F — Authentication and owner-scoped projects (S1)

**Why sixth**: largest product decision. Lands after async because it touches every route.

**Prompt**:

> Add user authentication and scope projects to their owner. Anonymous users keep working via local-only state; authed users get persistent, owner-scoped projects and proper share-link semantics.
>
> Scope:
> 1. Read both the `clerk-auth` and `replit-auth` skills. Default choice is Clerk unless the user explicitly says Replit Auth — confirm with the user before installing anything.
> 2. Schema: add `users` table; add nullable `owner_id` foreign key on `projects`; backfill existing rows with `null` (treated as anonymous demo content).
> 3. Middleware: add an auth-required middleware. Apply it to PATCH/DELETE `/api/projects/:slug` and to POST `/api/projects` only if the request asserts ownership (i.e. logged-in users get owned projects; anonymous POSTs continue to create unowned projects for the demo flow). GET remains open for now (share-link rework is a follow-up).
> 4. Frontend: add sign-in / sign-out UI in the header. Authed users see "My launches" (filtered by owner_id) instead of localStorage `recent`. Anonymous users see the existing localStorage list.
> 5. Update the OpenAPI spec and regenerate the client.
>
> Rules: follow universal rules §2. Override on schema and deps — you ARE allowed to add the auth provider's deps and the `users` + `owner_id` migration. Do NOT lock down GET routes in this task — share-link semantics are a separate task. Do NOT migrate existing anonymous projects into any user account; they stay unowned. Do NOT change the generation pipeline (Tasks D and E own that).
>
> Acceptance: signed-out flow is unchanged; signed-in flow lists only that user's projects; PATCH/DELETE on someone else's project returns 403; tests cover both code paths with a mocked auth provider.

---

### TASK G — Refactor `routes/projects.ts` (AR1)

**Why now**: tests exist (Task A), schema is stable (Task C), async pipeline lives in its own worker (Task D), so the route file is finally small enough to safely split.

**Prompt**:

> Split `artifacts/api-server/src/routes/projects.ts` into focused modules. Pure refactor — no behavior change.
>
> Scope:
> 1. Extract into new files under `artifacts/api-server/src/`:
>    - `prompts/` — the prompt builders and `PROMPT_VERSION` plumbing.
>    - `generation/` — the OpenAI calls (text + images).
>    - `persistence/projects.ts` — the DB read/write helpers (including `clampErrorMessage` usage).
>    - `routes/projects.ts` — only request parsing, response shaping, and orchestration calls into the modules above.
> 2. Each module exports a small, named API. No file ends up over 400 lines.
> 3. The OpenAPI spec and generated client must remain byte-identical (run `pnpm --filter @workspace/api-spec run codegen` and confirm no diff).
> 4. All existing tests (Task A) must pass without modification. Add new module-level tests where the split exposes a natural seam.
>
> Rules: follow universal rules §2. Pure mechanical refactor — no behavior changes, no new features, no removed features. Keep `clampErrorMessage` usage intact on every error write path. Do not touch the worker from Task D except to update its imports.
>
> Acceptance: typecheck clean; full test suite green; OpenAPI client unchanged; `git log -p` of the diff reads as moves + import updates.

---

### TASK H — Refactor `pages/project-workspace.tsx` (AR2)

**Prompt**:

> Split `artifacts/rant-to-launch/src/pages/project-workspace.tsx` into focused components. Pure refactor — no visual or behavioral change.
>
> Scope:
> 1. Extract into new files under `artifacts/rant-to-launch/src/components/workspace/`:
>    - `workspace-header.tsx`, `workspace-nav.tsx`, `workspace-body.tsx`, plus per-card-kind orchestrators.
> 2. The page file becomes a thin shell: data fetching, anchor-scroll effect (preserve verbatim), error/loading states, and composition.
> 3. No file over 400 lines after the split. Move helpers (`scrollToAnchor`, `buildNav`, etc.) into `src/lib/workspace-utils.ts`.
> 4. Take screenshots before and after; diff manually. The page must be pixel-identical at desktop and mobile widths.
>
> Rules: follow universal rules §2. Pure refactor. Preserve the `useEffect` anchor-scroll logic exactly — that was a deliberate fix in the audit pass. Preserve all `aria-*` attributes. Do not change card-kind components from Task I.
>
> Acceptance: typecheck clean; tests green; visual diff is null at 1280px and 402px viewports; HMR remains fast.

---

### TASK I — Refactor `pages/card-sections.tsx` (AR3)

**Prompt**:

> Split `artifacts/rant-to-launch/src/pages/card-sections.tsx` into one file per card kind. Pure refactor — no behavior change.
>
> Scope:
> 1. Resolve the 3 pre-existing TypeScript errors first (`useRefreshStoryboardImages` is missing from the generated client; the two implicit-any parameters need explicit types). If the missing client export requires a spec change, scope that as a sub-step and regenerate the client.
> 2. Extract one file per card kind under `artifacts/rant-to-launch/src/components/cards/`. Each card kind owns its viewer + editor + any local helpers.
> 3. Shared primitives (markdown editor, image viewer, etc.) live under `src/components/cards/shared/`.
> 4. The original file becomes either a thin re-export shim or is deleted, whichever is cleaner for the importer in `project-workspace.tsx`.
>
> Rules: follow universal rules §2. Pure refactor. The TS-error fix in step 1 is the only behavior-touching change allowed and must be the first commit. No new card kinds. No design changes.
>
> Acceptance: typecheck clean (zero errors, including the previously pre-existing three); tests green; each card kind file under 400 lines; visual diff null per card kind.

---

### TASK J — Internationalization scaffolding (i18n)

**Why last**: the lowest-priority quality-of-life change. Sequenced last so it doesn't churn files mid-refactor.

**Prompt**:

> Wire up `react-i18next` in `artifacts/rant-to-launch` and migrate the home page's hard-coded copy into a translation catalog. English only — no second language yet.
>
> Scope:
> 1. Add `react-i18next` + `i18next` + `i18next-browser-languagedetector` as deps. Configure under `src/i18n/`.
> 2. Create `src/i18n/locales/en.json` with the home page strings. Replace inline copy with `t("home.hero.kicker")` style keys.
> 3. Wrap the app root with `I18nextProvider`.
> 4. Do not migrate `project-workspace.tsx`, `card-sections.tsx`, or any backend-generated copy in this task — those land in follow-ups, one page at a time.
>
> Rules: follow universal rules §2. Override on deps — you ARE allowed to add the three i18n packages. Do not introduce a translation pipeline (Crowdin etc.). Do not change visible text — every string must round-trip identically. Do not migrate any page beyond `home.tsx`.
>
> Acceptance: home page renders identically; the translation catalog covers every visible string on home; typecheck and tests pass; opening `?lang=en` (or default) routes through i18next.

---

## 4. Suggested execution order recap

```
A (tests)
  ├─ B (deps)        — independent, can run in parallel with A once A merges
  ├─ C (schema)      — independent, can run in parallel with B
  ├─ D (async P1) ──► E (async UX U1)
  └─ F (auth S1)     — can run in parallel with D once A is in
A + D + F all merged
  └─ G (refactor routes)
A merged
  ├─ H (refactor workspace)
  └─ I (refactor card-sections)
H + I merged
  └─ J (i18n)
```

A, B, C, D, F can mostly fan out in parallel after A lands. The refactors (G, H, I) need their dependencies above them green. J is sequenced last on purpose.

## 5. How to use this doc in Plan mode

For each task:
1. Open Plan mode.
2. Paste the full prompt from §3, including the "Rules" and "Acceptance" lines.
3. Let the planning agent scope it into a project task; confirm dependencies are wired (e.g. G blocks on A and D).
4. Decide whether to execute it yourself (Build mode) or hand it to an isolated task agent.

If a prompt needs to be re-run after merge, the universal rules in §2 still apply — paste them at the top if the task agent's context window doesn't carry them forward.
