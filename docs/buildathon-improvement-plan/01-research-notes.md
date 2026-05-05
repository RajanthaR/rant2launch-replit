# Buildathon Research Notes

Verified from public sources on 2026-05-06 in the workspace timezone.

## Official Replit 10 Context

The Replit 10 Year Buildathon was listed on Replit's buildathon platform as a 24-hour build event tied to Replit's 10th anniversary and free Replit Agent access.

Key event facts from the public BuildHub API:

- Buildathon: Replit 10 Year Buildathon
- Event slug: `replit-10-year-buildathon`
- Build window: 2026-05-02T12:00:00Z to 2026-05-03T19:30:00Z
- Hero callouts: 24 hours to build, more than $100K in prizes, community voting, free Agent for all
- Scoring mix: judge 50 percent, admin 30 percent, crowd 20 percent
- Teams disabled
- Replit project was not required by the platform flag, but Replit Agent use was explicitly judged

Source:
https://buildathons.replit.app/api/public/buildathons/visible

## Official Scoring Criteria

The public scoring endpoint exposes four criteria. Weighted maximum is 45 points: 15 for progress, 10 each for execution, story, and Agent use.

| Criterion | Weight | What High Scores Reward | What Low Scores Penalize |
| --- | ---: | --- | --- |
| Progress in 24 hours | 1.5 | Significant visible progress, clear before/after, ambitious scope in the window | Little visible progress, no before/after, or an older finished project |
| Execution | 1.0 | Stable app, polished design, end-to-end core flow | Crashes, broken core features, rough UI |
| Story | 1.0 | Compelling video/social post, authentic human context, clear why | Generic submission, no narrative, no video or social post |
| Use of Agent | 1.0 | Deep iterative Agent use, creative workflow, evidence Agent enabled more | Default prompt output, surface-level use, no evidence of Agent capability |

Source:
https://buildathons.replit.app/api/scoring-criteria/c18c51f4-428d-414c-a797-cdf62fd11058

## Replit YouTube And Event Signals Checked

I checked the Replit YouTube streams page and the visible buildathon-related videos. Relevant Replit videos include:

- 10 Year Buildathon Showcase and Retrospective: https://www.youtube.com/watch?v=AmyIvA8ppvs
- Countdown to Free Agent for 24 Hours + Buildathon Kickoff: $100K+ in Prizes: https://www.youtube.com/watch?v=MHqUg4h5Ig4
- Replit Turns 10: Free Agent for 24 Hours + Slides + Enterprise Series: https://www.youtube.com/watch?v=45PTD_q9r0w
- How to Ship Fast and Get Noticed: https://www.youtube.com/watch?v=X8-Kj_9COww
- Launch your Product with Replit: https://www.youtube.com/watch?v=KFyH1B6r-X8
- How to Make Your App Go Viral: https://www.youtube.com/watch?v=AOhNb9ccuus
- Build Your Brand with Replit: https://www.youtube.com/watch?v=H1iPPS3s_IM
- Agent 4 Buildathon Showcase and Top 100 Sites: https://www.youtube.com/watch?v=hp-_TRMIdGY

Channel source:
https://www.youtube.com/@replit/streams

The related Luma/Replit event pages reinforce the same submission shape:

- A kickoff focused on free Agent access, the 24-hour challenge, and prizes: https://luma.com/ReplitHQ
- A May 8 community showcase / winner-announcement listing: https://luma.com/51xqbj9q
- Agent 4 buildathon events focused on getting noticed, launch, virality, and brand:
  - https://luma.com/a3ojdkaz
  - https://luma.com/dq8hrmzk
  - https://luma.com/lybmlxmp

## Practical Do And Do Not List

Do:

- Show a concrete before/after. Judges need to see what changed during the build window.
- Make the first demo path impossible to miss: open app, perform core action, show result.
- Keep the product narrow enough that the core flow is stable.
- Include a short human story: why this problem matters, what was hard, what changed while building.
- Show iterative Agent use with evidence: prompt log, screenshots, generated diffs, failed attempts, and corrections.
- Polish the first screen, empty states, loading states, and error states.
- Ship a public demo URL, a short video, and a social post. The story criterion explicitly values these.
- Use the app itself to prepare the launch materials when that supports the story.
- Test the entire judge flow on a fresh browser and mobile viewport.

Do not:

- Submit only a generic landing page or pitch page.
- Hide the product behind setup work, missing credentials, or unclear first steps.
- Rely on default Agent output without visible iteration.
- Leave broken core flows, blank media areas, or dead buttons in the main demo.
- Overbuild internal features judges will not see.
- Skip distribution materials. Replit events around the buildathons emphasized getting noticed, launch, virality, and brand.
- Assume code volume proves progress. The rubric asks for visible progress during the 24-hour period.

## Sources Reviewed

- BuildHub event API: https://buildathons.replit.app/api/public/buildathons/visible
- BuildHub scoring API: https://buildathons.replit.app/api/scoring-criteria/c18c51f4-428d-414c-a797-cdf62fd11058
- Buildathon platform: https://buildathons.replit.app/
- Replit birthday page: https://replit.com/birthday
- Replit events calendar: https://luma.com/ReplitHQ
- Replit YouTube streams: https://www.youtube.com/@replit/streams
- Replit Learn, "Build your idea": https://learn.replit.com/docs/ai-foundations/lesson-7
- Replit blog, mobile apps on Replit: https://blog.replit.com/building-mobile-apps-on-replit
- Replit blog, ML hackathon winners: https://blog.replit.com/ml-hackathon-winners
- Replit blog, Made With Replit winners: https://blog.replit.com/mwr-winners
