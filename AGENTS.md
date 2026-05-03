# AGENTS.md

Operations manual for AI coding agents working in this repo.

`replit.md` is the product spec — read it first to understand *what*
Rant-to-Launch is and what counts as on-spec. This file covers *how* to
work in the codebase: the commands, layout, conventions, and the things
that will silently break if you ignore them.

> Keep this file under ~400 lines. If a section grows, move the long-form
> content into the package it describes (e.g. a comment block at the top
> of the file in question) and leave a one-line pointer here.

---

## Stack at a glance

- **Monorepo**: pnpm workspaces (`pnpm-workspace.yaml`). Node 22, pnpm only.
  Yarn and npm are blocked by the `preinstall` hook.
- **Frontend** (`artifacts/rant-to-launch/`): React 19 + Vite 7 + TypeScript,
  Tailwind v4, shadcn/ui, wouter (router), TanStack Query, Framer Motion.
- **Backend** (`artifacts/api-server/`): Express on Node, Pino logging, esbuild
  bundle (`build.mjs`), Drizzle ORM against Replit Postgres,
  `@google-cloud/storage` for App Storage uploads.
- **AI**: OpenAI `gpt-5.4` for text, `gpt-image-1` for visuals, and
  `gpt-audio` for storyboard voiceover previews, all via
  the Replit AI Integrations proxy (`@workspace/integrations-openai-ai-server`,
  exporting `openai`, `generateImage()`, and `textToSpeech()`). No founder
  API key.
- **Object storage**: Replit App Storage (Google Cloud Storage under the
  hood). Generated PNGs live under `PRIVATE_OBJECT_DIR/launches/<slug>/...`
  and are served back through `GET /api/storage/objects/*`.
- **API contract**: OpenAPI (`lib/api-spec/openapi.yaml`) → orval generates
  React Query hooks (`lib/api-client-react/`) and Zod schemas (`lib/api-zod/`).
- **DB**: Drizzle schema in `lib/db/src/schema/`. Push with
  `pnpm --filter @workspace/db run push`.
- **Sandbox** (`artifacts/mockup-sandbox/`): isolated component-preview
  server for canvas iframes. Not part of the product surface.

---

## Commands you will actually run

All commands run from the repo root. Do not `cd`.

```bash
# Typecheck everything (libs + artifacts). Run before declaring work done.
pnpm run typecheck

# Build every package (runs typecheck first)
pnpm run build

# Per-package work (replace <pkg> with one of the names below)
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/rant-to-launch run typecheck
pnpm --filter @workspace/rant-to-launch run build

# Regenerate API client + Zod schemas after editing openapi.yaml
pnpm --filter @workspace/api-spec run codegen

# Push Drizzle schema changes to the database (DESTRUCTIVE — see Boundaries)
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run push-force   # only when you accept data loss
```

Workspace package names (use with `--filter`):

- `@workspace/rant-to-launch` — web frontend
- `@workspace/api-server` — Express API
- `@workspace/api-spec` — OpenAPI + orval codegen
- `@workspace/api-client-react` — generated React Query hooks (do not edit)
- `@workspace/api-zod` — generated Zod schemas (do not edit)
- `@workspace/db` — Drizzle schema and client
- `@workspace/integrations-openai-ai-server` — OpenAI client wrapper
- `@workspace/mockup-sandbox` — canvas component preview server

---

## Workflows (Replit-managed long-running processes)

Four workflows are configured. Use the `restart_workflow` tool — never
`pkill` or run dev commands by hand from the shell.

| Workflow | Command |
| --- | --- |
| `Project` | Runs `API Server` and `web` in parallel |
| `API Server` | `PORT=8080 pnpm --filter @workspace/api-server run dev` |
| `web` | `PORT=5000 BASE_PATH=/ pnpm --filter @workspace/rant-to-launch run dev` |
| `Component Preview Server` | `PORT=8081 BASE_PATH=/__mockup pnpm --filter @workspace/mockup-sandbox run dev` |

After editing files in a workflow's package:

- Frontend (`rant-to-launch`, `mockup-sandbox`): Vite HMR picks up the
  change. Restart only when `vite.config.ts`, `tsconfig.json`, or env
  vars changed.
- Backend (`api-server`): the dev script is `pnpm run build && pnpm run
  start`, so it does **not** hot-reload. Restart the workflow after any
  source change.

When debugging from the shell, use
`https://$REPLIT_DEV_DOMAIN/api/...` — never `localhost`. The user sees
the proxied iframe, not the raw port.

---

## Repo layout

```
artifacts/
  api-server/         Express API (the only backend)
    src/
      lib/launch-schema.ts   Text generation contract — see "Generation contract" below
      lib/visual-assets.ts   gpt-image-1 fan-out + upload for storyboard/carousel
      lib/objectStorage.ts   App Storage client (uploads, signed URLs, streaming)
      lib/objectAcl.ts       Per-object ACL (default-deny; "public" READ for assets)
      routes/projects.ts     POST /api/projects, GET /api/projects/:slug,
                             PATCH /api/projects/:slug/asset-cards/:cardId
      routes/storage.ts      GET /api/storage/objects/* (ACL-checked stream)
      routes/audio.ts        POST /api/audio/tts (short MP3 voiceover preview)
      routes/health.ts       GET /api/healthz
      index.ts               Server entrypoint
    build.mjs           esbuild bundler (do not bypass)
  rant-to-launch/     React + Vite frontend
    src/
      pages/home.tsx              / — intake screen
      pages/project-workspace.tsx /projects/:slug — page composition only
      pages/card-sections.tsx     One editable section component per asset kind
      components/                 Local components (shadcn/ui in components/ui)
      lib/                        Local utilities, no business logic
  mockup-sandbox/     Canvas iframe component server (not user-facing)
lib/
  api-spec/           openapi.yaml + orval.config.ts (source of truth)
  api-client-react/   GENERATED React Query hooks — never hand-edit
  api-zod/            GENERATED Zod schemas — never hand-edit
  db/                 Drizzle schema, client, migrations
  integrations-openai-ai-server/   OpenAI proxy client
docs/demo/            Curated self-demo screenshots and walkthrough
.agents/skills/       Repo-level Agent skills, including Replit integration setup
replit.md             Product spec (what we are building)
AGENTS.md             This file (how we work in the code)
pnpm-workspace.yaml   Workspace + pnpm catalog + supply-chain rules
```

---

## Generation contract (the most important code in the repo)

The whole product is a single text LLM call that has to return eight
assets in a stable shape, plus a fan-out of image calls for the visual
ones. The text contract lives in **one** module:

```
artifacts/api-server/src/lib/launch-schema.ts
```

It exports:

- `LaunchPackageJsonSchema` — shape sent to OpenAI in **strict structured
  outputs** mode (`response_format: { type: "json_schema", strict: true }`).
  Strict mode rules: every object has `additionalProperties: false`, every
  property is in `required`, and arrays cannot use `min`/`max`.
- `LaunchPackageZodSchema` — runtime validator with `.strict()` on every
  object, count constraints (5–7 tweets, 6–8 slides, 5–6 frames, exactly
  7 posting entries, 3–4 features), and refinements that enforce
  contiguous `slide`/`frame` numbering and exact launch-day slot labels.
- `SYSTEM_PROMPT` — section-by-section guidance reinforcing the counts.
- `launchPackageToAssetCards(...)` — pure mapper from the LaunchPackage
  to the eight `asset_cards` rows. Each top-level key of the LaunchPackage
  equals the persisted `asset_cards.content` for its kind.

Rules when you touch this module:

- If you change a payload shape, also update the workspace renderer's
  defensive guards (`asString`, `asCarouselSlides`, `asLandingPage`,
  etc.) in `artifacts/rant-to-launch/src/pages/project-workspace.tsx`.
- If you change counts/refinements, update the `SYSTEM_PROMPT` section
  for that asset *and* the table in `replit.md` ("Asset formats").
- Bump `PROMPT_VERSION` in `routes/projects.ts` whenever the prompt or
  schema changes. Old runs are recorded with their prompt version so we
  can debug regressions.
- Keep `LaunchPackageJsonSchema` hand-written. Do not derive it from
  Zod — `z.toJSONSchema` will not honor strict-mode rules.

### Visual assets (storyboard frames + carousel slides)

After the text payload validates, `lib/visual-assets.ts` fans out one
`gpt-image-1` call per storyboard frame (1536x1024) and per carousel
slide (1024x1024) in parallel, uploads each PNG to App Storage under
`launches/<slug>/<storyboard|carousel>/<index>-<uuid>.png`, and returns
a map of index → object path. The route handler then merges those paths
into `frames[].imageUrl` and `slides[].imageUrl` before persistence.

Rules:

- **Per-image failures are non-fatal** — a failed image is logged and
  skipped, the launch copy still ships with a text-only fallback.
- **Image edits go through PATCH** like text edits. The PATCH handler
  in `routes/projects.ts` strips client-supplied `imageUrl` from
  carousel/storyboard payloads, runs strict Zod validation, and then
  merges the existing persisted `imageUrl` values back. Result: a text
  edit never wipes a generated PNG, and a client can round-trip the
  full GET shape without filtering.
- **Object storage paths are private by default** (`objectAcl.ts`
  default-deny). Launch images are written with `visibility: "public"`
  READ so anonymous browsers can stream them through
  `GET /api/storage/objects/*`. Do not weaken the default-deny.

### Editing contract (PATCH per section)

`PATCH /api/projects/:slug/asset-cards/:cardId` accepts
`{ content: <kind-shaped object> }`. The handler validates path params
with `UpdateAssetCardParams` (so a non-UUID `cardId` is a 400, not a
500) and validates the body against the per-kind Zod payload schema
re-imported from `launch-schema.ts`. The frontend uses a shared
`useCardEditor` hook that, on success, writes the returned card back
into the `ProjectDetail` cache via `setQueryData` *before* invalidating —
so Copy buttons read the freshest content with no stale window.

---

## Code style

- **TypeScript everywhere.** No `.js` source files. `tsc --build` runs
  across all libs.
- **No emojis** anywhere — not in code, not in copy, not in commit
  messages, not in chat. The product enforces this; agents do too.
- **Imports**: workspace packages by name (`@workspace/db`), never by
  relative path. Relative imports stay within a package.
- **Validation at the boundary**: every external input (HTTP body, LLM
  output, env var) goes through Zod. Internal calls are typed.
- **Errors are explicit**: throw or return error responses with a
  message. No silent fallbacks, no fake-success states. The
  `generation_runs` row exists exactly so failures are visible.
- **JSON before columns**: per-kind asset shape lives in
  `asset_cards.content`; per-run telemetry in `generation_runs.metadata`.
  Add a column only when you need to query/sort/filter by the value.
- **shadcn/ui** components live in `components/ui/` and are owned by us
  — edit them in place rather than wrapping them.

Pattern to copy when adding a new API field validated by Zod and used
on both sides:

```ts
// 1. Add it to lib/api-spec/openapi.yaml under the relevant schema.
// 2. Run codegen:
//    pnpm --filter @workspace/api-spec run codegen
// 3. Use the regenerated Zod schema:
import { CreateProjectBodyZ } from "@workspace/api-zod";
const body = CreateProjectBodyZ.parse(req.body);
// 4. Use the regenerated React Query hook on the client:
import { usePostApiProjects } from "@workspace/api-client-react";
```

---

## Testing

There is no automated test suite checked in yet. Until there is:

- **Always run `pnpm run typecheck` before declaring work done.** It is
  the cheapest signal we have.
- **Smoke-test the generation pipeline** after any change to
  `launch-schema.ts`, `visual-assets.ts`, `routes/projects.ts`, or the
  system prompt:

  ```bash
  curl -sf -X POST "https://$REPLIT_DEV_DOMAIN/api/projects" \
    -H "Content-Type: application/json" \
    -d '{"rawText":"<a realistic rant of 1–3 sentences>"}'
  ```

  Confirm: `runs[0].status === "done"`, exactly 8 `assetCards`, slide
  numbers `[1..N]`, frame numbers `[1..N]`, launch-day slot labels,
  every storyboard frame and carousel slide has an `imageUrl` starting
  with `/objects/launches/<slug>/`. Then `curl -I` one of those URLs
  prefixed with `/api/storage` and confirm `200` + `content-type:
  image/png`.

- **Smoke-test the PATCH editing flow** after any change to
  `card-sections.tsx`, the `PATCH` handler, or the per-kind Zod payload
  schemas:

  ```bash
  curl -sf -X PATCH \
    "https://$REPLIT_DEV_DOMAIN/api/projects/<slug>/asset-cards/<cardId>" \
    -H "Content-Type: application/json" \
    -d '{"content":{"text":"edited"}}'
  ```

  Confirm the response echoes the new content and a follow-up GET
  returns the same value. For carousel/storyboard edits, confirm
  `imageUrl` survives a text-only edit. Empty strings must return 400.
  A non-UUID `cardId` must return 400 (not 500).
- **For frontend behavior** (forms, multi-page flows, copy buttons),
  use the `testing` skill (`runTest()`). Browser console alone is not
  enough.
- **For visual changes**, take a screenshot via the `screenshot` tool.

---

## Boundaries (do not do these without an explicit reset)

Product non-goals — these define what Rant-to-Launch is, not a backlog.
See `replit.md` for the full rationale.

- **Do not add a 9th output** or remove one of the 8. Eight cards, in the
  order defined in `launchPackageToAssetCards`, is the contract.
- **No file uploads** (audio, video, PDF, transcript files). Paste-only.
- **No streaming generation**. The LLM call is synchronous and returns
  one atomic JSON payload.
- **No auth, no users, no billing**. Identity is browser-local in
  `localStorage.recentProjectSlugs`.
- **No social posting integrations**. Copy buttons are the integration.

Operational boundaries:

- **Never edit generated files.** `lib/api-client-react/generated/`,
  `lib/api-zod/generated/`, and `artifacts/api-server/dist/` are
  rebuilt — your edits will be erased.
- **Never bypass orval.** Add the field to `openapi.yaml` and run
  codegen. Hand-writing types in the client desyncs the contract.
- **Never lower or remove `minimumReleaseAge: 1440`** in
  `pnpm-workspace.yaml`. It is a supply-chain attack defense.
- **Never bring back the legacy `rants` table** or import it. It is kept
  on disk only for safety; the active schema is the five tables in
  `replit.md`.
- **Never use raw OpenAI API keys.** Use the
  `@workspace/integrations-openai-ai-server` wrapper: `openai` for text,
  `generateImage()` for images, and `textToSpeech()` for short MP3 previews.
- **Never weaken the object-storage default-deny ACL.** Public READ is
  opt-in per object (`visibility: "public"`); never make a bucket-wide
  policy. Never serve raw GCS URLs to the client — always go through
  `GET /api/storage/objects/*` so the ACL is checked.
- **Never strip `imageUrl` merging from the PATCH handler.** A text-only
  edit on carousel or storyboard MUST preserve the persisted image
  path; relying on the client to round-trip it is unsafe.
- **Never hardcode a port.** Frontend and backend bind to `PORT` from
  the env so the workspace proxy can route them.
- **Never `cd` in shell commands.** Use pnpm filters instead.
- **`pnpm --filter @workspace/db run push-force` drops data.** Confirm
  with the user first; prefer `push` and resolve prompts manually.

---

## Secrets and integrations

- `DATABASE_URL` is provided by Replit. Do not reference any other
  Postgres URL.
- `OPENAI_API_KEY` is **not** required by us — the integrations wrapper
  injects credentials. Do not request it from the user.
- `PRIVATE_OBJECT_DIR` is provided by Replit App Storage and is used as
  the prefix for all uploaded image paths. Do not hardcode a bucket
  name or alternate prefix.
- Before asking the user for any third-party credential, check the
  Replit integrations system first (load the `integrations` skill).

---

## Git workflow

- Commits are created automatically by the platform after each task.
  Write a `.local/.commit_message` (≤ 30 lines) summarizing the change
  before calling `mark_task_complete`.
- Destructive git operations (`reset`, `checkout`, `rebase`, `push -f`,
  etc.) must be delegated to a background project task — they are
  blocked from direct execution.
- Do not commit secrets, generated dist output, or `node_modules`.
  `.gitignore` already covers these; do not weaken it.

---

## Maintenance: updating this file

This file is part of the contract with future agents. Update it when:

- A new package is added to `artifacts/` or `lib/` — add a row to the
  workspace package list.
- A new long-running workflow is added — add it to the Workflows table.
- A command in "Commands you will actually run" changes name or flags.
- A new operational boundary is discovered (something that silently
  broke and we want the next agent to avoid).
- The generation contract changes shape, counts, or model.

Do **not** mirror `replit.md` here. Product spec lives there; ops live
here. If the same fact appears in both files and they drift, `replit.md`
wins for product semantics and `AGENTS.md` wins for commands and layout.
