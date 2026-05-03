---
name: replit-integrations
description: Use when working on this Rant-to-Launch repo in Replit, especially setup, cloning, OpenAI AI Integrations, App Storage, Postgres, workflows, or runtime audio/image generation.
---

# Rant-to-Launch Replit Integrations

This project is designed to run on Replit-managed services. Do not ask for or
commit raw provider credentials when a Replit integration exists.

## Required Services

- OpenAI AI Integration provides `AI_INTEGRATIONS_OPENAI_BASE_URL` and
  `AI_INTEGRATIONS_OPENAI_API_KEY`.
- Replit Postgres provides `DATABASE_URL`.
- Replit App Storage provides `PRIVATE_OBJECT_DIR`,
  `PUBLIC_OBJECT_SEARCH_PATHS`, and `DEFAULT_OBJECT_STORAGE_BUCKET_ID`.

## Setup Workflow

1. Use Replit-managed OpenAI for text, images, and TTS. Do not introduce
   `OPENAI_API_KEY`.
2. Provision Postgres before running Drizzle commands.
3. Provision App Storage before smoke-testing generation, image refresh, or
   object streaming.
4. Run `pnpm install --frozen-lockfile`, then
   `pnpm --filter @workspace/db run push`.
5. Start the `Project` workflow. It runs the API server and web app.

## Code Conventions

- Use `@workspace/integrations-openai-ai-server` for OpenAI access.
- Use `openai` for text generation, `generateImage` for `gpt-image-1`, and
  `textToSpeech` for `gpt-audio` MP3 previews.
- Keep App Storage objects private by default. Public launch assets must opt in
  with per-object public READ ACLs and be served through `/api/storage/objects`.
- Keep `.local/`, `.config/`, build outputs, and Agent asset metadata out of
  git.
