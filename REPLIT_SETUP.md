# Replit Clone Setup

This repo is meant to be cloned into a Replit account and wired to that
account's Replit-managed services. Do not commit API keys or copied
environment variable values.

## Required Replit Services

- **OpenAI AI Integration**: approve the Replit-managed OpenAI integration.
  The app expects Replit to provide `AI_INTEGRATIONS_OPENAI_BASE_URL` and
  `AI_INTEGRATIONS_OPENAI_API_KEY`.
- **PostgreSQL**: provision Replit Postgres so `DATABASE_URL` is available.
- **App Storage**: provision Replit App Storage so `PRIVATE_OBJECT_DIR`,
  `PUBLIC_OBJECT_SEARCH_PATHS`, and `DEFAULT_OBJECT_STORAGE_BUCKET_ID` are
  available.

## First Run

1. Import the GitHub repo into Replit.
2. Approve the OpenAI AI Integration prompt when Agent asks. Usage is billed
   to the cloner's Replit credits.
3. Provision Postgres and App Storage from Replit tools if they are not
   already present.
4. Install dependencies with `pnpm install --frozen-lockfile`.
5. Push the Drizzle schema with `pnpm --filter @workspace/db run push`.
6. Start the `Project` workflow. It runs the API server and web app together.

## Expected Runtime Shape

- Web artifact: `/`, served by `@workspace/rant-to-launch`.
- API artifact: `/api`, served by `@workspace/api-server`.
- Generated images: stored under `PRIVATE_OBJECT_DIR/launches/...` and served
  through `/api/storage/objects/...` after the app sets public object ACLs.
- Voiceover preview: `POST /api/audio/tts`, using Replit-managed OpenAI
  `gpt-audio`, returns short MP3 previews for storyboard voiceover lines.

## What Not To Commit

- `.local/`, `.config/`, `node_modules/`, `dist/`, `*.tsbuildinfo`
- Replit-generated Agent output metadata
- Raw OpenAI keys, Postgres URLs, App Storage bucket credentials, or copied
  values from a specific Replit account
