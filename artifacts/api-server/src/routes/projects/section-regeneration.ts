import { type IRouter } from "express";
import { z } from "zod";
import {
  db,
  projectsTable,
  sourceInputsTable,
  generationRunsTable,
  assetCardsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { RegenerateSectionParams } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../../lib/logger";
import { clampErrorMessage } from "../../lib/clamp-error";
import { regenerateSectionVisuals } from "../../lib/visual-assets";
import {
  SYSTEM_PROMPT,
  SECTION_CONTRACTS,
  type AssetCardKind,
} from "../../lib/launch-schema";
import {
  MODEL,
  PROMPT_VERSION,
  buildLaunchContextBlock,
  type IntakeContext,
} from "./generation";
import { intakeFromSourceInput } from "./intake";
import { loadLaunchAngleText } from "./visual-context";
import { serializeAssetCard } from "./serialization";

export function registerSectionRegenerationRoutes(router: IRouter): void {
  // =====================================================================
  // POST /projects/:slug/sections/:section
  //
  // Regenerate a single section (one of the 8 asset card kinds) without
  // re-running the whole launch package. The endpoint:
  //   1. Loads the project + most recent source input (rant + intake context).
  //   2. Calls OpenAI with a per-section strict-mode JSON schema so only
  //      that section's payload is generated. This is dramatically cheaper
  //      and faster than the full 8-section call.
  //   3. For visual sections (carousel_outline, storyboard_cards) it then
  //      regenerates one PNG per slide/frame via gpt-image-1 and merges
  //      the new objectPaths into the payload. Per-image failures fall
  //      back to text-only, identical to the initial-generation behaviour.
  //   4. Persists a small generation_run row so audit history is preserved,
  //      then UPDATEs the existing asset_cards row in place (kind/position
  //      stay the same; content/generationRunId/updatedAt change).
  //   5. Returns the updated AssetCard so the workspace can swap it in
  //      without reloading the whole project.
  // =====================================================================
  async function regenerateSingleSection(
    rawText: string,
    intake: IntakeContext,
    kind: AssetCardKind,
  ): Promise<{ content?: Record<string, unknown>; failure?: string }> {
    const contract = SECTION_CONTRACTS[kind];
    const launchContext = buildLaunchContextBlock(intake);
    const userContent = `Founder rant / transcript:\n\n${rawText}${launchContext}\n\nRegenerate ONLY the "${contract.responseKey}" section. Return a fresh take — different angle, wording, or structure than a previous attempt.`;
    const sectionSystemPrompt = `${SYSTEM_PROMPT}\n\nYou are now regenerating a single section. Return ONLY a JSON object with the top-level key "${contract.responseKey}". Per-section guidance:\n- ${contract.guidance}`;

    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 4096,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: contract.schemaName,
          schema: contract.jsonSchema,
          strict: true,
        },
      },
      messages: [
        { role: "system", content: sectionSystemPrompt },
        { role: "user", content: userContent },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) return { failure: "Empty response from model" };

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content);
    } catch (err) {
      return {
        failure: `Model returned invalid JSON: ${(err as Error).message}`,
      };
    }
    const wrapped = parsedJson as Record<string, unknown> | null;
    const inner =
      wrapped && typeof wrapped === "object"
        ? wrapped[contract.responseKey]
        : undefined;
    if (inner === undefined) {
      return {
        failure: `Model response missing "${contract.responseKey}" key`,
      };
    }
    const validated = contract.zodSchema.safeParse(inner);
    if (!validated.success) {
      const detail = validated.error.issues
        .slice(0, 5)
        .map((i: z.ZodIssue) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");
      return { failure: `Section payload failed schema validation: ${detail}` };
    }
    return { content: validated.data };
  }

  router.post("/projects/:slug/sections/:section", async (req, res) => {
    const parsed = RegenerateSectionParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({
        error:
          "Invalid section. Must be one of the supported asset card kinds.",
      });
      return;
    }
    const { slug, section } = parsed.data;
    const kind = section as AssetCardKind;

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.slug, slug))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Find the most recent source input for the project. We use the latest
    // rant + intake metadata so regeneration honours any context the founder
    // has supplied (audience, offer, cta, tone, channels, timestamps).
    const sourceInputs = await db
      .select()
      .from(sourceInputsTable)
      .where(eq(sourceInputsTable.projectId, project.id))
      .orderBy(desc(sourceInputsTable.createdAt))
      .limit(1);
    const sourceInput = sourceInputs[0];
    if (!sourceInput) {
      res.status(404).json({ error: "Source input not found for project" });
      return;
    }

    // Find the existing asset card for this kind so we can update it in
    // place (preserve id, position, pinned). If none exists yet (e.g. it
    // was never generated), insert a new row instead.
    const existing = await db
      .select()
      .from(assetCardsTable)
      .where(
        and(
          eq(assetCardsTable.projectId, project.id),
          eq(assetCardsTable.kind, kind),
        ),
      )
      .orderBy(desc(assetCardsTable.createdAt))
      .limit(1);
    const existingCard = existing[0];

    const intake = intakeFromSourceInput(
      (sourceInput.metadata ?? null) as Record<string, unknown> | null,
    );

    // Phase 1 — record a regen run so audit history is preserved.
    const startedAt = new Date();
    let runId: string;
    try {
      const [run] = await db
        .insert(generationRunsTable)
        .values({
          projectId: project.id,
          sourceInputId: sourceInput.id,
          status: "running",
          model: MODEL,
          promptVersion: `${PROMPT_VERSION}-section`,
          metadata: { regeneratedSection: kind },
          startedAt,
        })
        .returning();
      runId = run!.id;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to record regen run";
      logger.error(
        { err, projectId: project.id, kind },
        "Section regen run insert failed",
      );
      res.status(500).json({ error: message });
      return;
    }

    try {
      let result = await regenerateSingleSection(
        sourceInput.rawText,
        intake,
        kind,
      );
      if (!result.content) {
        logger.warn(
          { failure: result.failure, projectId: project.id, runId, kind },
          "Section regen failed validation; retrying once",
        );
        result = await regenerateSingleSection(
          sourceInput.rawText,
          intake,
          kind,
        );
      }
      if (!result.content) {
        throw new Error(
          result.failure || "Section regeneration failed after retry",
        );
      }

      // Phase 2 — for visual sections, regenerate one image per slide/frame
      // and merge the new objectPaths into the payload. Per-image failures
      // are swallowed (logged + skipped); a missing image just falls back
      // to the text-only rendering on the workspace.
      let payload: Record<string, unknown> = result.content;
      if (kind === "storyboard_cards") {
        const angle = await loadLaunchAngleText(project.id);
        const frames = (
          payload as {
            frames: Array<{
              frame: number;
              visual: string;
              hook?: string;
              voiceover?: string;
              onScreenText?: string;
            }>;
          }
        ).frames;
        const visuals = await regenerateSectionVisuals({
          projectSlug: project.slug,
          launchAngle: angle,
          storyboardFrames: frames,
        });
        payload = {
          ...payload,
          frames: frames.map((f) => ({
            ...f,
            imageUrl: visuals.storyboardImages.get(f.frame) ?? null,
          })),
        };
      } else if (kind === "carousel_outline") {
        const angle = await loadLaunchAngleText(project.id);
        const slides = (
          payload as {
            slides: Array<{ slide: number; headline: string; body: string }>;
          }
        ).slides;
        const visuals = await regenerateSectionVisuals({
          projectSlug: project.slug,
          launchAngle: angle,
          carouselSlides: slides,
        });
        payload = {
          ...payload,
          slides: slides.map((s) => ({
            ...s,
            imageUrl: visuals.carouselImages.get(s.slide) ?? null,
          })),
        };
      }

      // Phase 3 — persist: update the existing card in place (or insert
      // if it never existed), then mark the regen run done. Atomic via tx
      // so a partial write can't leave the card and run out of sync.
      const completedAt = new Date();
      const updatedCard = await db.transaction(async (tx) => {
        let card: typeof assetCardsTable.$inferSelect;
        if (existingCard) {
          // Snapshot the about-to-be-replaced content so the founder can undo
          // a regenerate they don't like. Mirrors the PATCH behaviour: a
          // single prior version per card is preserved.
          const [row] = await tx
            .update(assetCardsTable)
            .set({
              content: payload,
              previousContent: (existingCard.content ?? {}) as Record<
                string,
                unknown
              >,
              previousUpdatedAt: existingCard.updatedAt,
              generationRunId: runId,
              sourceInputId: sourceInput.id,
              updatedAt: completedAt,
            })
            .where(eq(assetCardsTable.id, existingCard.id))
            .returning();
          card = row!;
        } else {
          const titleByKind: Record<AssetCardKind, string> = {
            launch_angle: "Launch angle",
            landing_page_copy: "Landing page",
            x_thread: "X thread",
            linkedin_post: "LinkedIn post",
            newsletter_blurb: "Newsletter blurb",
            carousel_outline: "Carousel outline",
            storyboard_cards: "Storyboard",
            posting_schedule: "Launch-day posting plan",
          };
          const positionByKind: Record<AssetCardKind, number> = {
            launch_angle: 0,
            landing_page_copy: 1,
            x_thread: 2,
            linkedin_post: 3,
            newsletter_blurb: 4,
            carousel_outline: 5,
            storyboard_cards: 6,
            posting_schedule: 7,
          };
          const [row] = await tx
            .insert(assetCardsTable)
            .values({
              projectId: project.id,
              generationRunId: runId,
              sourceInputId: sourceInput.id,
              kind,
              title: titleByKind[kind],
              content: payload,
              position: positionByKind[kind],
            })
            .returning();
          card = row!;
        }
        await tx
          .update(generationRunsTable)
          .set({ status: "done", completedAt })
          .where(eq(generationRunsTable.id, runId));
        return card;
      });

      res.status(200).json(serializeAssetCard(updatedCard));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Section regeneration failed";
      logger.error(
        { err, projectId: project.id, runId, kind },
        "Section regeneration failed",
      );
      try {
        await db
          .update(generationRunsTable)
          .set({
            status: "error",
            errorMessage: clampErrorMessage(message),
            completedAt: new Date(),
          })
          .where(eq(generationRunsTable.id, runId));
      } catch (dbErr) {
        logger.error(
          { err: dbErr, runId },
          "Failed to mark regen run as error",
        );
      }
      res.status(500).json({ error: message });
    }
  });
}
