# Rant-to-Launch

Rant-to-Launch turns a rough founder rant into a complete launch kit: landing
page copy, social posts, carousel outline, newsletter blurb, storyboard cards,
posting plan, generated visuals, and runtime voiceover previews.

This project was built as a submission for the Replit 10 Buildathon, held as
part of Replit's 10th anniversary celebration in May 2026. Public reporting on
the event described a 24-hour free Replit Agent day on May 2, 2026 and a
concurrent Replit 10 Buildathon with more than $100,000 in prizes for projects
created during that window.

Event context:
[Replit marks 10th anniversary with AI features and Buildathon](https://www.tipranks.com/news/private-companies/replit-marks-10th-anniversary-with-ai-features-buildathon-and-enterprise-push).

## Author

- RajanthaR: https://github.com/RajanthaR/
- Email: rajantha.rc@gmail.com

## What It Does

Paste a raw product idea, customer frustration, or founder rant. The app
generates eight launch-ready assets in one workflow:

1. Launch angle
2. X / Twitter thread
3. LinkedIn post
4. Carousel outline with generated visuals
5. Newsletter blurb
6. Landing page copy
7. Storyboard cards with generated visuals and TTS voice previews
8. Seven-slot launch-day posting schedule

The app is designed for solo founders who need specific, publishable launch
copy quickly instead of generic brainstorming output.

## Built For Replit

This repository is meant to be imported into Replit and connected to each
cloner's Replit-managed services:

- OpenAI AI Integration for text, images, and TTS
- Replit Postgres for project storage
- Replit App Storage for generated image assets
- Replit workflows for running the API server and web app together

No raw OpenAI API key should be committed or required. See
`REPLIT_SETUP.md` for clone setup and `MAINTAIN_REPLIT_COMPATIBILITY.md` for
maintainer rules.

## Tech Stack

- pnpm workspaces
- React 19, Vite 7, TypeScript, Tailwind CSS, shadcn/ui
- Express, Drizzle ORM, PostgreSQL
- OpenAPI with generated React Query hooks and Zod schemas
- Replit AI Integrations proxy for OpenAI text, image, and audio generation
- Replit App Storage for generated image assets

## Quick Start On Replit

1. Import this GitHub repository into Replit.
2. Approve the OpenAI AI Integration when prompted.
3. Provision Replit Postgres and App Storage.
4. Install dependencies:

   ```bash
   pnpm install --frozen-lockfile
   ```

5. Push the database schema:

   ```bash
   pnpm --filter @workspace/db run push
   ```

6. Start the `Project` workflow from Replit.

## Local Development

Run all commands from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```

Run individual packages with pnpm filters:

```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/rant-to-launch run dev
```

The app expects Replit-provided environment variables for OpenAI integrations,
Postgres, and App Storage. Local development without those services requires
equivalent environment values.

## Repository Notes

- `replit.md` is the product spec.
- `AGENTS.md` is the operations manual for coding agents.
- `REPLIT_SETUP.md` explains clone setup for Replit users.
- `MAINTAIN_REPLIT_COMPATIBILITY.md` explains how to keep the repo compatible
  with fresh Replit imports.
- `lib/api-spec/openapi.yaml` is the API source of truth. Regenerate clients
  with `pnpm --filter @workspace/api-spec run codegen` after API changes.

## License

MIT. See `LICENSE`.
