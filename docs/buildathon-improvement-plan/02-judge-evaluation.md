# Judge Evaluation For Rant-to-Launch

This evaluation assumes the judge sees the current app, README, product spec, and demo screenshots in this repository, but does not receive a separate build log, video, or social post.

## What I Reviewed

- Product spec: `replit.md`
- Frontend flow: `artifacts/rant-to-launch/src/pages/home.tsx`, `artifacts/rant-to-launch/src/pages/project-workspace.tsx`, workspace/card components
- Backend generation flow: `artifacts/api-server/src/routes/projects/create.ts`, `artifacts/api-server/src/lib/job-worker.ts`, `artifacts/api-server/src/lib/launch-schema.ts`, `artifacts/api-server/src/lib/visual-assets.ts`
- Public share/export routes: `artifacts/api-server/src/routes/projects/share-links.ts`, `artifacts/rant-to-launch/src/pages/share-page.tsx`
- Demo screenshots: `docs/demo/`

Verification note: `pnpm run typecheck` could not run because `node_modules` is missing in this workspace and `tsc` is not available. I did not install dependencies because the requested output is a planning document.

## Executive Judgment

Rant-to-Launch has a strong core idea for a buildathon: it solves the launch bottleneck that many builders hit after they finish the product. The execution is broader than a prototype: async generation, validated structured outputs, generated images, TTS previews, per-section edits, regeneration, undo, sharing, Markdown export, and PDF/print support.

The main risk is not product relevance. The main risk is proof. The Replit 10 rubric rewards 24-hour visible progress, human story, and deep Agent use. The current repository shows a capable app, but it does not yet package the before/after, Agent workflow, and founder narrative in a way a judge can score quickly.

## Score If Submitted As-Is

| Criterion | Weight | Score | Weighted | Judge Rationale |
| --- | ---: | ---: | ---: | --- |
| Progress in 24 hours | 1.5 | 6.0 / 10 | 9.0 / 15 | The app is ambitious and feature-rich, but the repo does not show a clear before/after or build-window timeline. It could be mistaken for older work unless submission materials prove otherwise. |
| Execution | 1.0 | 8.0 / 10 | 8.0 / 10 | Strong full-stack execution, clear schema contracts, async progress, image generation, App Storage, share links, and edit/regenerate flows. Deductions for local verification gap, blank visual areas in demo screenshots, and known worker resilience tradeoff. |
| Story | 1.0 | 5.5 / 10 | 5.5 / 10 | The product story is compelling, but the submission story is not packaged. A judge wants the human behind the build, the problem moment, and a short video/social narrative. |
| Use of Agent | 1.0 | 4.0 / 10 | 4.0 / 10 | The app uses Replit-managed OpenAI integrations, but that is not the same as proving creative Replit Agent use during the build. There is no visible Agent transcript, prompt iteration, or "Agent made this possible" artifact. |

Estimated total: 26.5 / 45, or about 59 percent.

With a strong proof package and targeted polish, this could move into the 37-40 / 45 range without rebuilding the product.

## Strengths

- The core flow is clear: paste founder rant, generate a complete launch kit, edit, copy, export, share.
- The product is tightly matched to buildathon pain: builders often have a working app but weak launch assets.
- The generation contract is unusually disciplined for a hackathon app: strict structured outputs, Zod validation, prompt versioning, per-kind validators, and defensive rendering.
- The app uses Replit-native services well: OpenAI AI Integrations, Postgres, App Storage, and workflows are documented.
- Async generation improves judge experience versus a synchronous frozen page.
- Per-section regeneration and undo make the output feel like a tool, not a one-shot demo.
- Public share links and Markdown/PDF export help distribution.
- Runtime storyboard TTS previews are a strong "extra mile" touch.

## Judge Concerns

- The demo screenshots for carousel and storyboard show large blank image areas. If images failed or were unavailable during capture, that weakens the "visuals" story.
- The README says both "7-day plan" and "launch-day posting schedule"; the product spec now uses seven launch-day slots. This should be made consistent before submission.
- The app does not include a judge-friendly sample path. A first-time judge should be able to load a seeded demo and inspect outputs immediately.
- The submission does not yet prove 24-hour progress. The rubric explicitly penalizes older finished work with no visible new development.
- There is no visible Agent-use evidence. Judges cannot infer deep Agent use from the codebase alone.
- The worker currently documents that an API process restart can leave jobs stuck in `running`. This is acceptable for an MVP but risky for a public demo under traffic.
- The local checkout could not be typechecked without installing dependencies. This is not a product defect, but it is a verification gap for the repository state.
- The app is good at producing launch assets, but it does not yet produce a buildathon submission pack: demo script, social post, before/after proof, and Agent-use summary.

## What I Would Ask As A Judge

- What did you start with at the beginning of the build window?
- What did Replit Agent actually do, and how did you iterate with it?
- Can I see the product working end-to-end in under 90 seconds?
- Are the generated images expected to show in the demo, and are they reliable?
- What is the single user promise: "turn a rant into launch copy" or "launch a buildathon project faster"?
- Did real users or other builders try it during the event?

## Highest-Leverage Fix

Build a judge-ready submission package around the existing product:

1. One seeded public demo.
2. One 90-second video.
3. One before/after timeline backed by the screenshots in `development-screenshots/`.
4. One Agent-use evidence page backed by screenshot captions and prompt/diff examples.
5. One polished self-generated launch package for Rant-to-Launch itself.

That directly targets Progress, Story, and Use of Agent while preserving the strong Execution score.
