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
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../../lib/logger";
import { clampErrorMessage } from "../../lib/clamp-error";
import { SYSTEM_PROMPT, LANDING_FAQ_CONTRACT } from "../../lib/launch-schema";
import {
  MODEL,
  PROMPT_VERSION,
  buildLaunchContextBlock,
  type IntakeContext,
} from "./generation";
import { intakeFromSourceInput } from "./intake";
import { serializeAssetCard } from "./serialization";
import { SLUG_PARAM } from "./params";

export function registerLandingFaqRoutes(router: IRouter): void {
  // =====================================================================
  // POST /projects/:slug/sections/landing_page_copy/faq
  //
  // Backfill the FAQ block on an existing landing card without touching the
  // rest of the copy. Used for landing cards that were generated before the
  // FAQ block existed (or where the founder removed FAQ during an edit).
  //
  // Flow:
  //   1. Load project + most recent source input (rant + intake context).
  //   2. Load the existing landing card. If none exists, 404 — this is a
  //      backfill endpoint, not a creation endpoint (the full regen route
  //      handles that case).
  //   3. Call OpenAI with the FAQ-only contract; the prompt also receives
  //      the existing landing copy so the FAQ tone/topics line up with
  //      the rest of the page.
  //   4. Merge the new faq array into the existing payload, preserving
  //      headline / subheadline / cta / features / socialProof exactly.
  //   5. Persist with snapshot so the founder can Undo, plus a generation
  //      run row for audit history. Returns the updated AssetCard.
  // =====================================================================
  async function generateLandingFaq(
    rawText: string,
    intake: IntakeContext,
    existing: Record<string, unknown>,
  ): Promise<{
    faq?: Array<{ question: string; answer: string }>;
    failure?: string;
  }> {
    const contract = LANDING_FAQ_CONTRACT;
    const launchContext = buildLaunchContextBlock(intake);
    // Surface the existing landing copy in the user message so the model can
    // tune FAQ tone/topics to what's already on the page rather than guessing
    // from the rant alone.
    const existingBlock = JSON.stringify(
      {
        headline: existing.headline,
        subheadline: existing.subheadline,
        cta: existing.cta,
        features: existing.features,
        socialProof: existing.socialProof,
      },
      null,
      2,
    );
    const userContent = `Founder rant / transcript:\n\n${rawText}${launchContext}\n\nExisting landing page copy (do NOT rewrite — only generate the FAQ that fits with this):\n${existingBlock}\n\nReturn ONLY a JSON object with a single top-level key "landingPageFaq" whose value is an object with a "faq" array of 4 to 6 entries.`;
    const sectionSystemPrompt = `${SYSTEM_PROMPT}\n\nYou are now generating ONLY the FAQ block for an existing landing page. Do not rewrite the headline, subheadline, CTA, features, or social proof — those already exist and are shown for context. Per-section guidance:\n- ${contract.guidance}`;

    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 2048,
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
      return { failure: `FAQ payload failed schema validation: ${detail}` };
    }
    return {
      faq: (
        validated.data as { faq: Array<{ question: string; answer: string }> }
      ).faq,
    };
  }

  router.post(
    "/projects/:slug/sections/landing_page_copy/faq",
    async (req, res) => {
      const parsed = SLUG_PARAM.safeParse(req.params);
      if (!parsed.success) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const { slug } = parsed.data;

      const [project] = await db
        .select()
        .from(projectsTable)
        .where(eq(projectsTable.slug, slug))
        .limit(1);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

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

      // The landing card MUST already exist — this endpoint is for backfilling
      // FAQ onto an existing card, not for generating a fresh landing section.
      const existing = await db
        .select()
        .from(assetCardsTable)
        .where(
          and(
            eq(assetCardsTable.projectId, project.id),
            eq(assetCardsTable.kind, "landing_page_copy"),
          ),
        )
        .orderBy(desc(assetCardsTable.createdAt))
        .limit(1);
      const existingCard = existing[0];
      if (!existingCard) {
        res.status(404).json({
          error:
            "No landing page card to backfill FAQ on. Generate the landing section first.",
        });
        return;
      }
      const existingContent = (existingCard.content ?? {}) as Record<
        string,
        unknown
      >;

      const intake = intakeFromSourceInput(
        (sourceInput.metadata ?? null) as Record<string, unknown> | null,
      );

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
            promptVersion: `${PROMPT_VERSION}-landing-faq`,
            metadata: { regeneratedSection: "landing_page_copy", scope: "faq" },
            startedAt,
          })
          .returning();
        runId = run!.id;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to record FAQ run";
        logger.error(
          { err, projectId: project.id },
          "Landing FAQ run insert failed",
        );
        res.status(500).json({ error: message });
        return;
      }

      try {
        let result = await generateLandingFaq(
          sourceInput.rawText,
          intake,
          existingContent,
        );
        if (!result.faq) {
          logger.warn(
            { failure: result.failure, projectId: project.id, runId },
            "Landing FAQ generation failed validation; retrying once",
          );
          result = await generateLandingFaq(
            sourceInput.rawText,
            intake,
            existingContent,
          );
        }
        if (!result.faq) {
          throw new Error(
            result.failure || "FAQ generation failed after retry",
          );
        }

        // Merge inside the transaction against the LATEST persisted content,
        // not the snapshot we read before the OpenAI call. If the founder
        // edited or regenerated the landing card while FAQ generation was in
        // flight, we still preserve their newer headline/subheadline/cta/
        // features/socialProof and only splice the new faq array onto it.
        // This shrinks the lost-update race window dramatically — a competing
        // PATCH/regen would have to land between this re-read and the UPDATE
        // a few statements later — without taking an explicit row lock.
        // (No SELECT FOR UPDATE: drizzle's pg builder doesn't expose it on
        // .select(), and for a single-row UPDATE on the same connection the
        // exposure window is small enough that the trade-off is fine.)
        const completedAt = new Date();
        const faqResult = result.faq;
        const updatedCard = await db.transaction(async (tx) => {
          const fresh = await tx
            .select()
            .from(assetCardsTable)
            .where(eq(assetCardsTable.id, existingCard.id))
            .limit(1);
          const freshCard = fresh[0];
          if (!freshCard) {
            // Race: card was deleted while FAQ was generating. Surface as a
            // generic failure — caller already shows a toast.
            throw new Error(
              "Landing card was removed before FAQ could be saved",
            );
          }
          const freshContent = (freshCard.content ?? {}) as Record<
            string,
            unknown
          >;
          const mergedContent: Record<string, unknown> = {
            ...freshContent,
            faq: faqResult,
          };
          const [row] = await tx
            .update(assetCardsTable)
            .set({
              content: mergedContent,
              previousContent: freshContent,
              previousUpdatedAt: freshCard.updatedAt,
              generationRunId: runId,
              sourceInputId: sourceInput.id,
              updatedAt: completedAt,
            })
            .where(eq(assetCardsTable.id, freshCard.id))
            .returning();
          await tx
            .update(generationRunsTable)
            .set({ status: "done", completedAt })
            .where(eq(generationRunsTable.id, runId));
          return row!;
        });

        res.status(200).json(serializeAssetCard(updatedCard));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "FAQ generation failed";
        logger.error(
          { err, projectId: project.id, runId },
          "Landing FAQ generation failed",
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
            "Failed to mark FAQ run as error",
          );
        }
        res.status(500).json({ error: message });
      }
    },
  );
}
