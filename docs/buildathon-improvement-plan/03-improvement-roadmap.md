# Improvement Roadmap

Goal: make Rant-to-Launch score well under the actual Replit 10 rubric, not just look like a polished app.

## Priority 0: Judge-Ready Submission Package

These changes most directly raise Progress, Story, and Use of Agent.

1. Add a public "Buildathon proof" route or section.
   - Route: `/buildathon` or a prominent link from the home header.
   - Content: build window, starting point, before/after screenshots, what changed in 24 hours, final deployed URL.
   - Include links to the Replit project, GitHub repo, demo project, and social post.
   - Source screenshot evidence from `docs/buildathon-improvement-plan/development-screenshots/`.

2. Add a seeded demo flow.
   - Add a "Load sample launch" button on the home page.
   - Use a pre-generated project or static demo payload so judges do not wait on AI or depend on storage/image generation.
   - Keep the normal generate path available for live proof.

3. Capture a new self-demo with working visuals.
   - Generate a fresh Rant-to-Launch package for the app itself.
   - Confirm carousel and storyboard images render.
   - Replace or supplement `docs/demo` screenshots where image panes are blank.
   - Add a 90-second walkthrough video: problem, paste rant, generation progress, output cards, copy/export/share.

4. Create an Agent-use evidence page.
   - Include prompt snippets, screenshots, and examples of where Agent changed the implementation.
   - Show at least three iterations: first attempt, issue found, Agent-guided correction.
   - Focus on concrete areas: async job polling, strict structured output, image storage/ACLs, share page, editing contract.
   - Use `development-screenshots/screenshot-evidence-board.md` as the inventory until final screenshots are copied in.

5. Use Rant-to-Launch to produce its own submission assets.
   - Generate the X thread, LinkedIn post, video storyboard, carousel, and launch-day plan for Rant-to-Launch.
   - Publish the social post and link it from the buildathon proof page.
   - This reinforces the story: the tool solved its own launch problem.

Acceptance checklist:

- A judge can understand the app in 15 seconds.
- A judge can inspect a working output in 30 seconds.
- A judge can watch the whole story in 90 seconds.
- A judge can see before/after progress without asking.
- A judge can see Replit Agent use without trusting a claim.

## Priority 1: Execution Polish

These changes protect the current strong Execution score.

1. Add stale-job recovery.
   - Mark jobs stuck in `running` or `queued` for more than a configured threshold as failed.
   - Surface a clear retry path in the workspace.
   - This addresses the known in-process worker restart risk documented in `job-worker.ts`.

2. Add a generation smoke script.
   - Script should POST a realistic rant to `https://$REPLIT_DEV_DOMAIN/api/projects`.
   - Poll `/api/jobs/{jobId}` until terminal.
   - Verify 8 cards, canonical schedule slots, contiguous slide/frame numbers, and image URL shape.
   - Curl one `/api/storage/objects/...` image and assert `200` plus `image/png`.

3. Add a PATCH smoke script.
   - Verify text edits persist.
   - Verify empty strings return 400.
   - Verify non-UUID card IDs return 400.
   - Verify carousel/storyboard `imageUrl` survives text-only edits.

4. Improve visual fallback states.
   - Distinguish "image still generating", "image failed", and "image unavailable".
   - Add a per-slide carousel image refresh action instead of only full carousel regeneration.
   - Make blank image areas visually intentional and informative.

5. Tighten first-screen CTA hierarchy.
   - Primary: generate from pasted rant.
   - Secondary: load sample demo.
   - Tertiary: view buildathon proof.
   - Keep the current paste-first identity, but reduce judge friction.

6. Mobile and small-screen pass.
   - Verify home, generation, workspace nav, card actions, share link popover, and editor fields on mobile.
   - The buildathon audience will often open submissions from social links.

7. Re-run verification after installing dependencies.
   - `pnpm install --frozen-lockfile`
   - `pnpm run typecheck`
   - `pnpm --filter @workspace/rant-to-launch run test`
   - `pnpm run build`

## Priority 2: Product Differentiation

These changes make the app feel built for the Replit 10 moment while still serving founders after the event.

1. Add a "Buildathon Launch Pack" mode.
   - Optional intake toggle: "I am submitting to a buildathon".
   - Output should prioritize: 90-second demo script, before/after social post, Replit submission description, launch thread, voting-window reminder, and short video storyboard.
   - Keep the eight-card contract unless the product spec is intentionally changed. The mode can change content inside existing cards.

2. Add evidence extraction from the rant.
   - Pull out: target user, pain, proof point, demo moment, build constraint, and ask.
   - Show these as a small "Launch brief" above the cards so users trust the generated strategy.

3. Add a share-page polish pass.
   - Make `/share/:token` read like a public launch kit, not only an internal workspace without buttons.
   - Add a top summary: headline, audience, CTA, and direct copy buttons for top assets.
   - Use this as the public artifact in social posts.

4. Add "copy for Replit submission" export.
   - One button produces:
     - 120-character title
     - 1-paragraph description
     - demo video script
     - social post
     - "built with Replit Agent" summary
     - tags

5. Add lightweight analytics for self-evaluation.
   - Track generation started, generation succeeded, share link created, export copied.
   - Keep it privacy-aware and local to project runs.
   - Use results in the story if real users try it.

## Priority 3: Reliability And Maintenance

1. Convert worker to durable queue if traffic grows.
   - BullMQ plus Redis or a Replit-compatible queue.
   - Preserve the current job row API so the frontend does not change.

2. Add generated asset cleanup policy.
   - Deleting a project should eventually clean its storage folder or mark it orphaned for cleanup.

3. Add prompt regression fixtures.
   - Save a few representative rants and expected structural properties.
   - Test validators and markdown serialization without calling OpenAI.

4. Add API contract drift checks.
   - CI should fail if `openapi.yaml` changes without regenerated clients.
   - CI should fail on generated file manual edits.

## Suggested Implementation Order

1. Build seeded demo route and proof page.
2. Replace the placeholder SVG slots in `development-screenshots/` with real development screenshots.
3. Capture fresh demo screenshots and video.
4. Add Agent-use evidence and generated submission copy.
5. Fix visual fallback and image refresh UX.
6. Add smoke scripts and stale-job janitor.
7. Run full verification after dependency install.

## Expected Score After Priority 0 And 1

| Criterion | Current Estimate | Target After Plan |
| --- | ---: | ---: |
| Progress in 24 hours | 6.0 | 8.5 |
| Execution | 8.0 | 9.0 |
| Story | 5.5 | 9.0 |
| Use of Agent | 4.0 | 8.0 |

Target total: 38.75 / 45.

The shortest path to a much higher score is not adding more product surface. It is proving the work, making the demo impossible to miss, and showing the human and Agent collaboration behind it.
