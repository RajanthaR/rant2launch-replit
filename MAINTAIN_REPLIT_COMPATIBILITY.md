# Maintain Replit Compatibility

This repo should stay cloneable into a fresh Replit account. Future changes
must preserve the files, workflows, and integration assumptions that let each
cloner use their own Replit-managed OpenAI, Postgres, and App Storage services.

Use this document as a maintenance checklist. `REPLIT_SETUP.md` is the
cloner-facing setup guide; this file is for maintainers changing the repo.

## Preserve These Files

Keep these tracked unless there is a deliberate replacement:

- `.replit` and `replit.nix`
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, and `.npmrc`
- `artifacts/*/.replit-artifact/artifact.toml`
- `REPLIT_SETUP.md`
- `.agents/skills/replit-integrations/SKILL.md`
- `AGENTS.md` and `replit.md`

When one of these files changes, check whether the others need matching updates.
For example, a workflow rename in `.replit` should also be reflected in
`AGENTS.md`, `REPLIT_SETUP.md`, and the Replit integrations skill.

## Replit Services Contract

The app depends on Replit-managed services being provisioned per cloner:

- OpenAI AI Integration provides `AI_INTEGRATIONS_OPENAI_BASE_URL` and
  `AI_INTEGRATIONS_OPENAI_API_KEY`.
- Replit Postgres provides `DATABASE_URL`.
- Replit App Storage provides `PRIVATE_OBJECT_DIR`,
  `PUBLIC_OBJECT_SEARCH_PATHS`, and `DEFAULT_OBJECT_STORAGE_BUCKET_ID`.

Do not commit copied values from any Replit account. Do not introduce a raw
`OPENAI_API_KEY` requirement. Runtime AI calls should go through
`@workspace/integrations-openai-ai-server`.

## OpenAI Integration Rules

The active wrapper package is `@workspace/integrations-openai-ai-server`.
Use its exports for app code:

- `openai` for text generation.
- `generateImage` for `gpt-image-1` visual assets.
- `textToSpeech` for `gpt-audio` storyboard voice previews.

Do not restore or copy the legacy template under
`lib/integrations/openai_ai_integrations/`. If a new AI capability is needed,
add the smallest wrapper needed to the active package and document the runtime
contract.

## App Storage Rules

Generated images are stored under `PRIVATE_OBJECT_DIR/launches/...` and served
through `/api/storage/objects/...`.

Keep object access default-deny. Public launch images must opt into public READ
per object. Do not make the bucket public, serve raw Google Cloud Storage URLs,
or bypass the app's object ACL checks.

## Runtime Audio Rules

Storyboard voiceover previews are a runtime feature, not a demo artifact.

- Keep TTS behind `POST /api/audio/tts`.
- Keep strict input validation and a short text limit.
- Keep a separate IP rate limiter because audio generation consumes credits.
- Default to MP3 output unless the product intentionally adds another format.
- Do not add TTS to public share pages without an explicit product decision.

## Replit Workflow Rules

The Replit Run button should start the `Project` workflow, which runs:

- `API Server` on `PORT=8080`
- `web` on `PORT=5000`

The optional `Component Preview Server` runs on `PORT=8081` with
`BASE_PATH=/__mockup`. Keep ports in `.replit`, artifact metadata, and Vite
configuration aligned. Avoid hardcoding ports inside application source; use
environment variables so Replit can route the workspace correctly.

## Package Management Rules

This repo uses pnpm only.

- Do not add `package-lock.json` or `yarn.lock`.
- Do not remove the preinstall guard that blocks npm and yarn.
- Do not lower or remove `minimumReleaseAge: 1440` from
  `pnpm-workspace.yaml`.
- Run commands from the repo root with pnpm filters rather than changing
  directories.

## Generated API Rules

`lib/api-spec/openapi.yaml` is the source of truth for the HTTP contract.

When the API shape changes:

1. Edit `lib/api-spec/openapi.yaml`.
2. Run `pnpm --filter @workspace/api-spec run codegen`.
3. Use the regenerated React Query hooks and Zod schemas.

Do not hand-edit generated files under `lib/api-client-react/src/generated/` or
`lib/api-zod/src/generated/`.

## Cleanup Rules

Keep downloaded Replit workspace state and local build output out of git:

- `.local/`
- `.config/`
- `node_modules/`
- `dist/`
- `*.tsbuildinfo`
- `.agents/agent_assets_metadata.toml`
- root `screenshots/`
- pasted prompt scratch files under `attached_assets/`

Curated demo material belongs under `docs/demo/`. Runtime packages under
`artifacts/` should be product code, not copied demo-video workspaces or local
recording output.

## Before Pushing Compatibility-Sensitive Changes

Run the relevant checks before declaring the repo ready:

- `pnpm --filter @workspace/api-spec run codegen` after OpenAPI edits.
- `pnpm run typecheck`.
- `pnpm run build` when package config, bundling, or runtime code changed.
- `git status --ignored` to confirm ignored Replit state and build output are
  not staged.

For a Replit smoke test, import the repo into a fresh Replit account or project,
approve OpenAI AI Integration, provision Postgres and App Storage, run
`pnpm --filter @workspace/db run push`, then start the `Project` workflow.
Verify health, project generation, generated image streaming, and one
storyboard TTS playback.

## Red Flags

Pause and re-check compatibility if a change:

- Asks a cloner for a raw OpenAI key.
- Removes `.replit`, `replit.nix`, artifact metadata, or the pnpm lockfile.
- Reintroduces `.local/`, `.config/`, generated `dist/`, or copied template
  packages.
- Changes ports without updating Replit workflow and artifact routing.
- Bypasses App Storage ACL checks.
- Adds frontend API types by hand instead of regenerating them from OpenAPI.
