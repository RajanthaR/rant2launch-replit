import { type IRouter } from "express";
import {
  db,
  projectsTable,
  sourceInputsTable,
  generationRunsTable,
  generationJobsTable,
} from "@workspace/db";
import { CreateProjectBody } from "@workspace/api-zod";
import { enqueueGenerationJob } from "../../lib/job-worker";
import { logger } from "../../lib/logger";
import {
  MODEL,
  PROMPT_VERSION,
  makeSlug,
  type IntakeContext,
} from "./generation";

export function registerCreateProjectRoutes(router: IRouter): void {
  // =====================================================================
  // POST /api/projects — async (202) entrypoint.
  //
  // The handler does ONLY fast, transactional work and returns 202 in
  // well under 500ms (target: tens of ms in the typical case):
  //
  //   1. Validate the request body.
  //   2. Insert project + source_input + generation_run(queued) +
  //      generation_job(queued) in a single transaction.
  //   3. Schedule the heavy generation pipeline on an in-process worker
  //      via enqueueGenerationJob (setImmediate; see lib/job-worker.ts
  //      for the BullMQ/Redis upgrade path).
  //   4. Respond 202 with { projectId, slug, jobId } so the client can
  //      redirect to /projects/:slug and poll GET /api/jobs/:jobId.
  //
  // Name derivation has been moved into the worker — when the founder
  // did not supply a name we persist a placeholder ("Generating launch…")
  // up front and the worker overwrites projects.name once the small
  // project-naming OpenAI call returns. This keeps the HTTP path off the
  // network entirely.
  // =====================================================================
  const PROJECT_NAME_PLACEHOLDER = "Generating launch…";

  router.post("/projects", async (req, res) => {
    const parsed = CreateProjectBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid input: rawText is required (1-50000 chars)." });
      return;
    }
    const {
      rawText,
      name: providedName,
      audience,
      offer,
      cta,
      tone,
      channels,
      timestamps,
    } = parsed.data;

    const intake: IntakeContext = {
      audience,
      offer,
      cta,
      tone,
      channels,
      timestamps,
    };

    // Persist the intake metadata on the source_input so the workspace can show
    // what context the founder provided alongside the raw rant.
    const sourceInputMetadata: Record<string, unknown> = {};
    if (audience?.trim()) sourceInputMetadata.audience = audience.trim();
    if (offer?.trim()) sourceInputMetadata.offer = offer.trim();
    if (cta?.trim()) sourceInputMetadata.cta = cta.trim();
    if (tone?.trim()) sourceInputMetadata.tone = tone.trim();
    if (channels && channels.length > 0)
      sourceInputMetadata.channels = channels;
    if (timestamps?.trim()) sourceInputMetadata.timestamps = timestamps.trim();

    const slug = makeSlug();
    const trimmedProvidedName = providedName?.trim();
    const initialName =
      trimmedProvidedName && trimmedProvidedName.length > 0
        ? trimmedProvidedName
        : PROJECT_NAME_PLACEHOLDER;
    const needsNameDerivation = !trimmedProvidedName;

    let projectId: string;
    let runId: string;
    let sourceInputId: string;
    let jobId: string;
    try {
      const boot = await db.transaction(async (tx) => {
        const [project] = await tx
          .insert(projectsTable)
          .values({ name: initialName, slug, description: null })
          .returning();
        const [sourceInput] = await tx
          .insert(sourceInputsTable)
          .values({
            projectId: project!.id,
            kind: "rant",
            title: null,
            rawText,
            metadata:
              Object.keys(sourceInputMetadata).length > 0
                ? sourceInputMetadata
                : null,
          })
          .returning();
        const [run] = await tx
          .insert(generationRunsTable)
          .values({
            projectId: project!.id,
            sourceInputId: sourceInput!.id,
            status: "queued",
            model: MODEL,
            promptVersion: PROMPT_VERSION,
          })
          .returning();
        const [job] = await tx
          .insert(generationJobsTable)
          .values({
            projectId: project!.id,
            status: "queued",
            progressTotal: 0,
            progressDone: 0,
            currentStep: "Queued",
          })
          .returning();
        return {
          projectId: project!.id,
          sourceInputId: sourceInput!.id,
          runId: run!.id,
          jobId: job!.id,
        };
      });
      projectId = boot.projectId;
      sourceInputId = boot.sourceInputId;
      runId = boot.runId;
      jobId = boot.jobId;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create project";
      logger.error({ err, slug }, "Project boot transaction failed");
      res.status(500).json({ error: message });
      return;
    }

    // Schedule the heavy work on the next tick. The worker owns all
    // subsequent state transitions (job + run + cards). The HTTP handler
    // returns immediately so the browser can navigate to /projects/:slug
    // and start polling /api/jobs/:jobId.
    enqueueGenerationJob({
      jobId,
      runId,
      projectId,
      projectSlug: slug,
      sourceInputId,
      rawText,
      intake,
      needsNameDerivation,
    });

    res.status(202).json({ projectId, slug, jobId });
  });
}
