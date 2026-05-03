import { eq, sql } from "drizzle-orm";
import {
  db,
  projectsTable,
  sourceInputsTable,
  generationRunsTable,
  generationJobsTable,
  assetCardsTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { z, type ZodTypeAny } from "zod";
import { logger } from "./logger";
import { clampErrorMessage } from "./clamp-error";
import {
  LaunchPackageZodSchema,
  LaunchPackageJsonSchema,
  LAUNCH_PACKAGE_SCHEMA_NAME,
  SYSTEM_PROMPT,
  launchPackageToAssetCards,
  type LaunchPackage,
} from "./launch-schema";
import { generateLaunchVisuals } from "./visual-assets";

// =====================================================================
// In-process generation job worker.
//
// `enqueueGenerationJob` schedules the heavy POST /api/projects pipeline
// (OpenAI text + 11 image calls) on a setImmediate callback so the HTTP
// handler can persist the job row and return 202 in <500ms.
//
// This is a deliberately simple single-instance queue: every job runs in
// the same Node process that accepted the request. It is correct for
// today's deployment topology (single api-server replica) and side-steps
// the operational cost of standing up Redis just to ship the async
// contract. The trade-offs you accept by using it:
//   - A process restart loses any job currently in `running` state.
//     The job row stays at status=running forever; the polling client
//     will hang. Mitigation: a future janitor sweep can mark
//     status=failed for jobs whose updated_at is older than N minutes.
//   - Horizontal scale-out would let two replicas race on the same job.
//     Until we have a multi-instance deployment this cannot happen.
//
// To upgrade to BullMQ + Redis when those constraints bite:
//   1. `pnpm add bullmq ioredis` and add a REDIS_URL secret.
//   2. Replace the body of `enqueueGenerationJob` with a `queue.add(...)`
//      call, where `queue = new Queue("generation", { connection })`.
//   3. Move the `runGenerationPipeline` body into a Worker:
//        new Worker("generation", async (job) => runGenerationPipeline(job.data))
//      hosted in a separate worker process (or the same one for now).
//   4. Replace the in-process `derivedNamePromise` with a job step inside
//      the worker so the name persists if the api-server crashes between
//      enqueue and pickup.
// The function signatures and the database side-effects (job row updates,
// generation_runs lifecycle, asset_cards finalize) stay identical, so
// the HTTP handler and the polling client need no changes.
// =====================================================================

const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.4";
const PROMPT_VERSION = process.env.PROMPT_VERSION?.trim() || "v4-visuals";

const PROJECT_NAME_PROMPT = `In 3-6 words, give a punchy project name for this founder rant. Output ONLY the name, no quotes, no preface, no period. Example: "Voice Notes To Launches".`;

export interface IntakeContext {
  audience?: string;
  offer?: string;
  cta?: string;
  tone?: string;
  channels?: string[];
  timestamps?: string;
}

export interface EnqueueArgs {
  jobId: string;
  runId: string;
  projectId: string;
  projectSlug: string;
  sourceInputId: string;
  rawText: string;
  intake: IntakeContext;
  // When the founder did not supply a project name we derive one inside
  // the worker (a small OpenAI call) and update projects.name.
  needsNameDerivation: boolean;
}

const CHANNEL_LABELS: Record<string, string> = {
  x: "X / Twitter",
  linkedin: "LinkedIn",
  newsletter: "Newsletter / email",
  carousel: "Carousel (Instagram / LinkedIn carousel)",
};

function buildLaunchContextBlock(ctx: IntakeContext): string {
  const lines: string[] = [];
  if (ctx.audience?.trim()) lines.push(`- Audience: ${ctx.audience.trim()}`);
  if (ctx.offer?.trim()) lines.push(`- Offer: ${ctx.offer.trim()}`);
  if (ctx.cta?.trim()) {
    lines.push(
      `- Desired CTA: ${ctx.cta.trim()} (use this exact phrase as the landing page CTA when natural)`,
    );
  }
  if (ctx.tone?.trim()) lines.push(`- Tone: ${ctx.tone.trim()}`);
  if (ctx.channels && ctx.channels.length > 0) {
    const labeled = ctx.channels
      .map((c) => CHANNEL_LABELS[c.toLowerCase()] ?? c)
      .join(", ");
    lines.push(
      `- Channels (prioritize these in the posting schedule): ${labeled}`,
    );
  }
  if (ctx.timestamps?.trim()) {
    lines.push(`- Source recording timestamps:\n${ctx.timestamps.trim()}`);
  }
  if (lines.length === 0) return "";
  return `\n\nLaunch context (founder-supplied — honor these over inferences):\n${lines.join("\n")}`;
}

async function generateOutputs(
  rawText: string,
  intake: IntakeContext,
  extraSystem?: string,
): Promise<{ outputs?: LaunchPackage; failure?: string }> {
  const launchContext = buildLaunchContextBlock(intake);
  const userContent = `Founder rant / transcript:\n\n${rawText}${launchContext}`;
  const completion = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 8192,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: LAUNCH_PACKAGE_SCHEMA_NAME,
        schema: LaunchPackageJsonSchema,
        strict: true,
      },
    },
    messages: [
      {
        role: "system",
        content: extraSystem ? `${SYSTEM_PROMPT}\n\n${extraSystem}` : SYSTEM_PROMPT,
      },
      { role: "user", content: userContent },
    ],
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) return { failure: "Empty response from model" };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch (err) {
    return { failure: `Model returned invalid JSON: ${(err as Error).message}` };
  }
  // Cast keeps the function generic-free at the call site; the schema
  // narrows back to LaunchPackage on success.
  const validated = (LaunchPackageZodSchema as ZodTypeAny).safeParse(parsedJson) as
    z.SafeParseReturnType<unknown, LaunchPackage>;
  if (!validated.success) {
    const detail = validated.error.issues
      .slice(0, 5)
      .map((i: z.ZodIssue) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    return { failure: `Model output failed schema validation: ${detail}` };
  }
  return { outputs: validated.data };
}

async function deriveProjectName(rawText: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 32,
      messages: [
        { role: "system", content: PROJECT_NAME_PROMPT },
        { role: "user", content: rawText.slice(0, 2000) },
      ],
    });
    const name = completion.choices[0]?.message?.content?.trim();
    if (name && name.length > 0 && name.length <= 200) return name;
  } catch (err) {
    logger.warn({ err }, "Project name derivation failed; falling back");
  }
  const firstLine = rawText.trim().split(/\r?\n/)[0] ?? "Untitled launch";
  return firstLine.slice(0, 60) || "Untitled launch";
}

// Bumps `progress_done` atomically (SQL `+ delta`, no read-then-write
// race), optionally sets a new `current_step`, and refuses to touch
// rows that have already reached a terminal state. The terminal guard
// is critical: per-image progress callbacks fire from inside Promise
// `.then()` handlers and the DB write they spawn can land AFTER the
// worker has already marked the job succeeded/failed if the caller
// does not await them. The `WHERE status NOT IN ('succeeded','failed')`
// clause makes those late writes a no-op so the terminal snapshot the
// polling client sees can never be corrupted.
//
// Returns a promise so callers that need ordering can await it (the
// worker awaits all in-flight progress writes before transitioning to
// the Finalizing/terminal state). Failures are logged, never thrown.
function bumpProgress(
  jobId: string,
  delta: number,
  currentStep?: string,
): Promise<void> {
  const setClause: Record<string, unknown> = {
    progressDone: sql`${generationJobsTable.progressDone} + ${delta}`,
    updatedAt: new Date(),
  };
  if (currentStep !== undefined) setClause.currentStep = currentStep;
  return db
    .update(generationJobsTable)
    .set(setClause)
    .where(
      sql`${generationJobsTable.id} = ${jobId} AND ${generationJobsTable.status} NOT IN ('succeeded','failed')`,
    )
    .then(
      () => undefined,
      (err: unknown) => {
        logger.warn({ err, jobId }, "Failed to bump job progress");
      },
    );
}

async function setJobStep(jobId: string, currentStep: string): Promise<void> {
  try {
    await db
      .update(generationJobsTable)
      .set({ currentStep, updatedAt: new Date() })
      .where(eq(generationJobsTable.id, jobId));
  } catch (err) {
    logger.warn({ err, jobId }, "Failed to update job step");
  }
}

async function setJobTotal(jobId: string, total: number): Promise<void> {
  try {
    await db
      .update(generationJobsTable)
      .set({ progressTotal: total, updatedAt: new Date() })
      .where(eq(generationJobsTable.id, jobId));
  } catch (err) {
    logger.warn({ err, jobId }, "Failed to set job total");
  }
}

function outputsToAssetCards(
  outputs: LaunchPackage,
  projectId: string,
  generationRunId: string,
  sourceInputId: string,
  visuals: {
    storyboardImages: Map<number, string>;
    carouselImages: Map<number, string>;
  },
): Array<typeof assetCardsTable.$inferInsert> {
  return launchPackageToAssetCards(outputs).map((spec) => {
    let content: Record<string, unknown> = spec.content;
    if (spec.kind === "storyboard_cards") {
      const frames = (spec.content as { frames: Array<{ frame: number }> }).frames;
      content = {
        ...spec.content,
        frames: frames.map((f) => ({
          ...f,
          imageUrl: visuals.storyboardImages.get(f.frame) ?? null,
        })),
      };
    } else if (spec.kind === "carousel_outline") {
      const slides = (spec.content as { slides: Array<{ slide: number }> }).slides;
      content = {
        ...spec.content,
        slides: slides.map((s) => ({
          ...s,
          imageUrl: visuals.carouselImages.get(s.slide) ?? null,
        })),
      };
    }
    return {
      projectId,
      generationRunId,
      sourceInputId,
      kind: spec.kind,
      title: spec.title,
      content,
      position: spec.position,
    };
  });
}

async function runGenerationPipeline(args: EnqueueArgs): Promise<void> {
  const { jobId, runId, projectId, projectSlug, sourceInputId, rawText, intake } = args;
  const startedAt = new Date();

  // Mark both the job and the legacy run row as running. The
  // generation_runs row is what the project-detail GET surfaces today;
  // the generation_jobs row is what the new polling client reads.
  try {
    await db
      .update(generationJobsTable)
      .set({
        status: "running",
        startedAt,
        currentStep: "Generating launch copy",
        updatedAt: new Date(),
      })
      .where(eq(generationJobsTable.id, jobId));
    await db
      .update(generationRunsTable)
      .set({ status: "running", startedAt })
      .where(eq(generationRunsTable.id, runId));
  } catch (err) {
    logger.error({ err, jobId, runId }, "Failed to mark job/run running");
    // Surface as failure — the worker can't reliably continue if it
    // can't even update its own status row.
    await markJobFailed(jobId, runId, err instanceof Error ? err.message : "Failed to start job");
    return;
  }

  try {
    // Phase A — derive name (only when founder didn't supply one).
    if (args.needsNameDerivation) {
      try {
        const name = await deriveProjectName(rawText);
        await db
          .update(projectsTable)
          .set({ name, updatedAt: new Date() })
          .where(eq(projectsTable.id, projectId));
      } catch (err) {
        // Name derivation is best-effort; the placeholder name persists.
        logger.warn({ err, projectId }, "Project name derivation failed; keeping placeholder");
      }
    }

    // Phase B — text generation (with one stricter retry, mirrors the
    // pre-async sync flow). Output-shape failures become job failures.
    await setJobStep(jobId, "Generating launch copy");
    let result = await generateOutputs(rawText, intake);
    if (!result.outputs) {
      logger.warn(
        { failure: result.failure, projectId, runId },
        "First generation failed validation; retrying once with stricter prompt",
      );
      const stricter = `RETRY: Your previous response did not match the required JSON schema (${result.failure}). Output ONLY a valid JSON object with EVERY required key, correct types, and the count constraints listed above. No markdown, no commentary.`;
      result = await generateOutputs(rawText, intake, stricter);
    }
    if (!result.outputs) {
      throw new Error(result.failure || "Generation failed after retry");
    }

    // Phase C — visuals. Total = 1 (text) + N visuals + 1 (finalize).
    // Bump done to 1 for the text step we just finished.
    const visualsCount =
      result.outputs.storyboardCards.frames.length +
      result.outputs.carouselOutline.slides.length;
    const total = 1 + visualsCount + 1;
    await setJobTotal(jobId, total);
    await bumpProgress(jobId, 1, `Generating ${visualsCount} visuals`);

    let imagesDone = 0;
    // Collect every per-image progress write so we can await them all
    // before transitioning to the Finalizing/terminal state. Without
    // this barrier a late progress write could land AFTER the terminal
    // update and corrupt the snapshot the polling client sees. The
    // bumpProgress UPDATE itself also ignores rows in terminal status,
    // so this is defense-in-depth against ordering bugs.
    const progressWrites: Array<Promise<void>> = [];
    const visuals = await generateLaunchVisuals({
      storyboardFrames: result.outputs.storyboardCards.frames,
      carouselSlides: result.outputs.carouselOutline.slides,
      projectSlug,
      launchAngle: result.outputs.launchAngle.text,
      onImageComplete: () => {
        imagesDone += 1;
        progressWrites.push(
          bumpProgress(jobId, 1, `Generating image ${imagesDone}/${visualsCount}`),
        );
      },
    });
    await Promise.allSettled(progressWrites);

    // Phase D — finalize: insert all 8 cards + mark run done atomically.
    await setJobStep(jobId, "Finalizing");
    const cards = outputsToAssetCards(result.outputs, projectId, runId, sourceInputId, visuals);
    const completedAt = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(assetCardsTable).values(cards);
      await tx
        .update(generationRunsTable)
        .set({ status: "done", completedAt })
        .where(eq(generationRunsTable.id, runId));
    });

    // Mark job succeeded; pin progressDone to total so the polling
    // client sees a clean 100%.
    await db
      .update(generationJobsTable)
      .set({
        status: "succeeded",
        progressDone: total,
        currentStep: "Done",
        completedAt,
        updatedAt: new Date(),
      })
      .where(eq(generationJobsTable.id, jobId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    logger.error({ err, projectId, runId, jobId }, "Project generation failed");
    await markJobFailed(jobId, runId, message);
  }
}

async function markJobFailed(
  jobId: string,
  runId: string,
  message: string,
): Promise<void> {
  const clamped = clampErrorMessage(message);
  const completedAt = new Date();
  // Update both rows independently — if either write fails we still
  // want the other to land. Errors are logged, not thrown, because
  // there's nobody up the stack to handle them on the worker thread.
  try {
    await db
      .update(generationJobsTable)
      .set({
        status: "failed",
        errorMessage: clamped,
        currentStep: "Failed",
        completedAt,
        updatedAt: new Date(),
      })
      .where(eq(generationJobsTable.id, jobId));
  } catch (dbErr) {
    logger.error({ err: dbErr, jobId }, "Failed to mark job as failed");
  }
  try {
    await db
      .update(generationRunsTable)
      .set({ status: "error", errorMessage: clamped, completedAt })
      .where(eq(generationRunsTable.id, runId));
  } catch (dbErr) {
    logger.error({ err: dbErr, runId }, "Failed to mark run as error");
  }
}

// Keep the model + prompt-version values in scope for the per-run row
// metadata writes the HTTP handler stamps (so the legacy generation_runs
// row carries the same model/prompt strings the sync flow used to set).
export const WORKER_MODEL = MODEL;
export const WORKER_PROMPT_VERSION = PROMPT_VERSION;

/**
 * Schedule the generation pipeline to run on the next tick. Returns
 * immediately; the caller (the HTTP handler) MUST have already inserted
 * the project + source_input + generation_run + generation_job rows
 * before calling this.
 *
 * Errors thrown synchronously by `runGenerationPipeline` are caught and
 * funnel through `markJobFailed`; the function never rejects from the
 * caller's perspective.
 */
export function enqueueGenerationJob(args: EnqueueArgs): void {
  setImmediate(() => {
    runGenerationPipeline(args).catch((err) => {
      logger.error(
        { err, jobId: args.jobId, runId: args.runId },
        "Worker pipeline rejected unexpectedly",
      );
    });
  });
}
