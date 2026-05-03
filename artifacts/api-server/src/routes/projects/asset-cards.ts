import { type IRouter } from "express";
import { z, type ZodTypeAny } from "zod";
import { db, projectsTable, assetCardsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  UpdateAssetCardBody,
  UpdateAssetCardParams,
  UndoAssetCardParams,
} from "@workspace/api-zod";
import {
  LaunchAnglePayload,
  XThreadPayload,
  LinkedInPostPayload,
  CarouselOutlinePayload,
  NewsletterBlurbPayload,
  LandingPageCopyEditPayload,
  StoryboardCardsPayload,
  PostingSchedulePayload,
  type AssetCardKind,
} from "../../lib/launch-schema";
import { serializeAssetCard } from "./serialization";

export function registerAssetCardRoutes(router: IRouter): void {
  // =====================================================================
  // Per-kind content validators for PATCH /projects/:slug/asset-cards/:cardId.
  //
  // Founders edit each section in place; we re-validate the new payload
  // against the same Zod contract used for generation so corrupted shapes
  // (e.g. missing tweets, dropped slide numbers) never reach the database
  // or the workspace renderer.
  //
  // `imageUrl` fields on carousel slides and storyboard frames are NOT part
  // of these validators because images are server-owned: the client only
  // edits the text. We strip any client-supplied imageUrl, then re-merge
  // the existing imageUrl from the persisted card so edits never wipe out
  // generated PNGs.
  // =====================================================================

  type EditableContentValidator = (input: unknown) =>
    | {
        ok: true;
        data: Record<string, unknown>;
      }
    | {
        ok: false;
        detail: string;
      };

  function makeValidator<T extends ZodTypeAny>(
    schema: T,
  ): EditableContentValidator {
    return (input: unknown) => {
      const result = schema.safeParse(input);
      if (!result.success) {
        const detail = result.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; ");
        return { ok: false, detail };
      }
      return { ok: true, data: result.data as Record<string, unknown> };
    };
  }

  const CARD_VALIDATORS: Record<AssetCardKind, EditableContentValidator> = {
    launch_angle: makeValidator(LaunchAnglePayload),
    x_thread: makeValidator(XThreadPayload),
    linkedin_post: makeValidator(LinkedInPostPayload),
    carousel_outline: makeValidator(CarouselOutlinePayload),
    newsletter_blurb: makeValidator(NewsletterBlurbPayload),
    landing_page_copy: makeValidator(LandingPageCopyEditPayload),
    storyboard_cards: makeValidator(StoryboardCardsPayload),
    posting_schedule: makeValidator(PostingSchedulePayload),
  };

  const ASSET_CARD_KINDS = new Set<string>(Object.keys(CARD_VALIDATORS));

  // Visual cards (carousel, storyboard) have a server-owned `imageUrl` per
  // item that the strict per-kind Zod validators do not accept. To keep PATCH
  // ergonomic — so a client can read content via GET, edit it, and PATCH the
  // whole shape back without filtering — we strip any client-supplied
  // `imageUrl` before validation. The server then re-merges the persisted
  // imageUrl values via preserveImageUrls() after validation, so generated
  // PNGs are preserved either way.
  function stripClientImageUrls(kind: AssetCardKind, raw: unknown): unknown {
    if (!raw || typeof raw !== "object") return raw;
    if (kind === "carousel_outline") {
      const obj = raw as { slides?: unknown };
      if (!Array.isArray(obj.slides)) return raw;
      return {
        ...obj,
        slides: obj.slides.map((s) => {
          if (s && typeof s === "object" && "imageUrl" in s) {
            const { imageUrl: _drop, ...rest } = s as Record<string, unknown>;
            return rest;
          }
          return s;
        }),
      };
    }
    if (kind === "storyboard_cards") {
      const obj = raw as { frames?: unknown };
      if (!Array.isArray(obj.frames)) return raw;
      return {
        ...obj,
        frames: obj.frames.map((f) => {
          if (f && typeof f === "object" && "imageUrl" in f) {
            const { imageUrl: _drop, ...rest } = f as Record<string, unknown>;
            return rest;
          }
          return f;
        }),
      };
    }
    return raw;
  }

  function preserveImageUrls(
    kind: AssetCardKind,
    validated: Record<string, unknown>,
    existing: Record<string, unknown>,
  ): Record<string, unknown> {
    if (kind === "carousel_outline") {
      const slides = (
        validated as {
          slides: Array<{ slide: number; headline: string; body: string }>;
        }
      ).slides;
      const existingSlides = Array.isArray(
        (existing as { slides?: unknown }).slides,
      )
        ? (
            existing as {
              slides: Array<{ slide: number; imageUrl?: string | null }>;
            }
          ).slides
        : [];
      const byNumber = new Map<number, string | null>();
      for (const s of existingSlides) {
        if (typeof s?.slide === "number") {
          byNumber.set(s.slide, s.imageUrl ?? null);
        }
      }
      return {
        ...validated,
        slides: slides.map((s) => ({
          ...s,
          imageUrl: byNumber.get(s.slide) ?? null,
        })),
      };
    }
    if (kind === "storyboard_cards") {
      const frames = (validated as { frames: Array<{ frame: number }> }).frames;
      const existingFrames = Array.isArray(
        (existing as { frames?: unknown }).frames,
      )
        ? (
            existing as {
              frames: Array<{ frame: number; imageUrl?: string | null }>;
            }
          ).frames
        : [];
      const byNumber = new Map<number, string | null>();
      for (const f of existingFrames) {
        if (typeof f?.frame === "number") {
          byNumber.set(f.frame, f.imageUrl ?? null);
        }
      }
      return {
        ...validated,
        frames: frames.map((f) => ({
          ...f,
          imageUrl: byNumber.get(f.frame) ?? null,
        })),
      };
    }
    return validated;
  }

  router.patch("/projects/:slug/asset-cards/:cardId", async (req, res) => {
    const parsedParams = UpdateAssetCardParams.safeParse(req.params);
    if (!parsedParams.success) {
      res
        .status(400)
        .json({ error: "Invalid path: 'cardId' must be a valid UUID." });
      return;
    }
    const { slug, cardId } = parsedParams.data;

    const parsedBody = UpdateAssetCardBody.safeParse(req.body);
    if (!parsedBody.success) {
      res
        .status(400)
        .json({ error: "Invalid input: 'content' object is required." });
      return;
    }

    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.slug, slug))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [card] = await db
      .select()
      .from(assetCardsTable)
      .where(
        and(
          eq(assetCardsTable.id, cardId),
          eq(assetCardsTable.projectId, project.id),
        ),
      )
      .limit(1);
    if (!card) {
      res.status(404).json({ error: "Asset card not found" });
      return;
    }

    if (!ASSET_CARD_KINDS.has(card.kind)) {
      res
        .status(400)
        .json({ error: `Unsupported asset card kind: ${card.kind}` });
      return;
    }

    const kind = card.kind as AssetCardKind;
    const validator = CARD_VALIDATORS[kind];
    const sanitizedContent = stripClientImageUrls(
      kind,
      parsedBody.data.content,
    );
    const validation = validator(sanitizedContent);
    if (!validation.ok) {
      res.status(400).json({
        error: `Invalid content for ${kind}: ${validation.detail}`,
      });
      return;
    }

    const merged = preserveImageUrls(
      kind,
      validation.data,
      (card.content ?? {}) as Record<string, unknown>,
    );

    // Snapshot the current content into previous_content so the founder can
    // undo this edit. We keep only one prior version per card, so this
    // unconditionally overwrites whatever prior snapshot was there — meaning
    // a save of an already-saved card moves the undo target forward by one.
    const [updated] = await db
      .update(assetCardsTable)
      .set({
        content: merged,
        previousContent: (card.content ?? {}) as Record<string, unknown>,
        previousUpdatedAt: card.updatedAt,
        updatedAt: new Date(),
      })
      .where(eq(assetCardsTable.id, cardId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Asset card not found" });
      return;
    }

    res.json(serializeAssetCard(updated));
  });

  // =====================================================================
  // POST /projects/:slug/asset-cards/:cardId/undo
  //
  // Restores a card's content to the snapshot captured by the most recent
  // PATCH or regenerate. Lightweight one-step undo — after a successful
  // undo the snapshot is cleared, so calling undo a second time in a row
  // returns 409. To preserve "redo by editing again" semantics we do NOT
  // move the just-restored content into previous_content (otherwise undo
  // would silently turn into a toggle and a second click would feel like
  // a no-op).
  // =====================================================================
  router.post("/projects/:slug/asset-cards/:cardId/undo", async (req, res) => {
    const parsedParams = UndoAssetCardParams.safeParse(req.params);
    if (!parsedParams.success) {
      res
        .status(400)
        .json({ error: "Invalid path: 'cardId' must be a valid UUID." });
      return;
    }
    const { slug, cardId } = parsedParams.data;

    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.slug, slug))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [card] = await db
      .select()
      .from(assetCardsTable)
      .where(
        and(
          eq(assetCardsTable.id, cardId),
          eq(assetCardsTable.projectId, project.id),
        ),
      )
      .limit(1);
    if (!card) {
      res.status(404).json({ error: "Asset card not found" });
      return;
    }

    if (card.previousContent === null || card.previousContent === undefined) {
      res.status(409).json({
        error: "Nothing to undo for this section.",
      });
      return;
    }

    // Set updatedAt to now (not the snapshot's old timestamp) so the
    // workspace's "Updated X ago" stamp reflects that the user just made
    // this change. The snapshot's original timestamp is intentionally
    // discarded — it only existed to support this restore.
    const [updated] = await db
      .update(assetCardsTable)
      .set({
        content: card.previousContent as Record<string, unknown>,
        previousContent: null,
        previousUpdatedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(assetCardsTable.id, cardId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Asset card not found" });
      return;
    }

    res.json(serializeAssetCard(updated));
  });
}
