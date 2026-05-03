import { Router, type IRouter, type Request } from "express";
import { z, type ZodTypeAny } from "zod";
import { randomBytes, randomUUID } from "node:crypto";
import {
  db,
  projectsTable,
  sourceInputsTable,
  generationRunsTable,
  generationJobsTable,
  assetCardsTable,
  shareLinksTable,
} from "@workspace/db";
import { clampErrorMessage as sharedClampErrorMessage } from "../lib/clamp-error";
import { enqueueGenerationJob } from "../lib/job-worker";
import { eq, and, desc, isNull } from "drizzle-orm";
import {
  CreateProjectBody,
  GetProjectParams,
  UpdateAssetCardBody,
  UpdateAssetCardParams,
  UpdateProjectBody,
  RegenerateSectionParams,
  UndoAssetCardParams,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger";
import {
  LaunchPackageZodSchema,
  LaunchPackageJsonSchema,
  LAUNCH_PACKAGE_SCHEMA_NAME,
  SYSTEM_PROMPT,
  launchPackageToAssetCards,
  LaunchAnglePayload,
  XThreadPayload,
  LinkedInPostPayload,
  CarouselOutlinePayload,
  NewsletterBlurbPayload,
  LandingPageCopyPayload,
  LandingPageCopyEditPayload,
  LANDING_FAQ_CONTRACT,
  StoryboardCardsPayload,
  PostingSchedulePayload,
  SECTION_CONTRACTS,
  type AssetCardKind,
  type LaunchPackage,
} from "../lib/launch-schema";
import {
  generateLaunchVisuals,
  regenerateSectionVisuals,
} from "../lib/visual-assets";

// Model + prompt-version are env-overridable so swapping models or
// version-bumping a prompt doesn't require a code change. Defaults
// preserve the production contract documented in `replit.md`.
const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.4";
// v4-visuals: same structured-outputs contract as v3-structured, plus a
// post-generation step that fans out to gpt-image-1 to produce one PNG per
// storyboard frame and per carousel slide. Generated PNGs are uploaded to
// object storage and their objectPath is merged into asset_cards.content
// (storyboard_cards.frames[].imageUrl, carousel_outline.slides[].imageUrl).
const PROMPT_VERSION = process.env.PROMPT_VERSION?.trim() || "v4-visuals";

// Re-exported for legacy call sites in this file. The shared
// implementation lives in ../lib/clamp-error so the job worker can
// import it without circular dependency on this route module.
const clampErrorMessage = sharedClampErrorMessage;

const CHANNEL_LABELS: Record<string, string> = {
  x: "X / Twitter",
  linkedin: "LinkedIn",
  newsletter: "Newsletter / email",
  carousel: "Carousel (Instagram / LinkedIn carousel)",
};

interface IntakeContext {
  audience?: string;
  offer?: string;
  cta?: string;
  tone?: string;
  channels?: string[];
  timestamps?: string;
}

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

const PROJECT_NAME_PROMPT = `In 3-6 words, give a punchy project name for this founder rant. Output ONLY the name, no quotes, no preface, no period. Example: "Voice Notes To Launches".`;

async function generateOutputs(
  rawText: string,
  intake: IntakeContext,
  extraSystem?: string,
): Promise<{ outputs?: LaunchPackage; failure?: string }> {
  const launchContext = buildLaunchContextBlock(intake);
  const userContent = `Founder rant / transcript:\n\n${rawText}${launchContext}`;
  // Strict structured outputs: the model is guaranteed by the API to return
  // JSON that conforms to LaunchPackageJsonSchema (object/property shape).
  // Count and length constraints still come from the prompt + Zod check
  // because strict mode does not allow min/max constraints in the schema.
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
  const validated = LaunchPackageZodSchema.safeParse(parsedJson);
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

function makeSlug(): string {
  return randomUUID().replace(/-/g, "").slice(0, 10);
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
  // Single source of truth for asset card kind/title/position/content lives
  // in launch-schema.ts. Here we just bind the FK columns and weave in the
  // generated image objectPaths for the two visual asset kinds.
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

function serializeProject(row: typeof projectsTable.$inferSelect) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeSourceInput(row: typeof sourceInputsTable.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    title: row.title,
    rawText: row.rawText,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeRun(row: typeof generationRunsTable.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceInputId: row.sourceInputId,
    status: row.status as "queued" | "running" | "done" | "error",
    model: row.model,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// Storyboard cards generated before the rich-shot-list contract (task #12)
// only carry { frame, visual, caption } per frame. Coerce any missing
// fields to empty strings on the read path so the workspace's renderer
// (which expects all six fields) never crashes on legacy projects. The
// founder is then nudged to backfill via inline edit, where PATCH
// validation enforces non-empty strings.
function coerceStoryboardContent(content: Record<string, unknown>): Record<string, unknown> {
  const framesRaw = (content as { frames?: unknown }).frames;
  if (!Array.isArray(framesRaw)) return content;
  const frames = framesRaw.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const f = raw as Record<string, unknown>;
    const legacyCaption = typeof f.caption === "string" ? f.caption : "";
    return {
      frame: typeof f.frame === "number" ? f.frame : 0,
      hook: typeof f.hook === "string" ? f.hook : "",
      sourceMoment: typeof f.sourceMoment === "string" ? f.sourceMoment : "",
      visual: typeof f.visual === "string" ? f.visual : "",
      onScreenText: typeof f.onScreenText === "string" ? f.onScreenText : "",
      // Map legacy `caption` onto `voiceover` so a pre-task-12 frame keeps
      // its single piece of text content visible in the new "Voiceover /
      // caption" slot instead of disappearing entirely.
      voiceover:
        typeof f.voiceover === "string" && f.voiceover.length > 0
          ? f.voiceover
          : legacyCaption,
      cta: typeof f.cta === "string" ? f.cta : "",
      imageUrl: typeof f.imageUrl === "string" ? f.imageUrl : null,
    };
  });
  return { ...content, frames };
}

function serializeAssetCard(row: typeof assetCardsTable.$inferSelect) {
  const rawContent = (row.content ?? {}) as Record<string, unknown>;
  const content =
    row.kind === "storyboard_cards" ? coerceStoryboardContent(rawContent) : rawContent;
  return {
    id: row.id,
    projectId: row.projectId,
    generationRunId: row.generationRunId,
    sourceInputId: row.sourceInputId,
    kind: row.kind as
      | "launch_angle"
      | "x_thread"
      | "linkedin_post"
      | "carousel_outline"
      | "newsletter_blurb"
      | "landing_page_copy"
      | "storyboard_cards"
      | "posting_schedule",
    title: row.title,
    content,
    position: row.position,
    pinned: row.pinned,
    // hasUndo is derived from the presence of a snapshot; we never ship the
    // snapshot itself in responses (avoids doubling the wire payload).
    hasUndo: row.previousContent !== null && row.previousContent !== undefined,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadProjectDetail(
  projectId: string,
  options: { includeShareToken?: boolean } = {},
) {
  const includeShareToken = options.includeShareToken ?? true;
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return null;

  const [sourceInputs, runs, assetCards, activeShareToken] = await Promise.all([
    db.select().from(sourceInputsTable).where(eq(sourceInputsTable.projectId, projectId)),
    db.select().from(generationRunsTable).where(eq(generationRunsTable.projectId, projectId)),
    db
      .select()
      .from(assetCardsTable)
      .where(and(eq(assetCardsTable.projectId, projectId))),
    includeShareToken ? loadActiveShareToken(projectId) : Promise.resolve(null),
  ]);

  return {
    project: serializeProject(project),
    sourceInputs: sourceInputs
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(serializeSourceInput),
    runs: runs
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(serializeRun),
    assetCards: assetCards
      .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())
      .map(serializeAssetCard),
    activeShareToken,
  };
}

async function loadActiveShareToken(projectId: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(shareLinksTable)
    .where(
      and(
        eq(shareLinksTable.projectId, projectId),
        isNull(shareLinksTable.revokedAt),
      ),
    )
    .orderBy(desc(shareLinksTable.createdAt))
    .limit(1);
  return rows[0]?.token ?? null;
}

function buildShareUrl(req: Request, token: string): string {
  // Honor proxy headers (Replit fronts the app via mTLS proxy) so the URL
  // we hand back is one the recipient can actually open. Fallback to the
  // request's Host header.
  const forwardedProto = req.get("x-forwarded-proto");
  const forwardedHost = req.get("x-forwarded-host");
  const proto = (forwardedProto?.split(",")[0]?.trim()) || req.protocol || "https";
  const host = (forwardedHost?.split(",")[0]?.trim()) || req.get("host") || "localhost";
  // The web artifact mounts at "/" in this workspace; the share page lives
  // at /share/:token under that base.
  return `${proto}://${host}/share/${token}`;
}

const router: IRouter = Router();

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
    res.status(400).json({ error: "Invalid input: rawText is required (1-50000 chars)." });
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
  if (channels && channels.length > 0) sourceInputMetadata.channels = channels;
  if (timestamps?.trim()) sourceInputMetadata.timestamps = timestamps.trim();

  const slug = makeSlug();
  const trimmedProvidedName = providedName?.trim();
  const initialName = trimmedProvidedName && trimmedProvidedName.length > 0
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
            Object.keys(sourceInputMetadata).length > 0 ? sourceInputMetadata : null,
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
    const message = err instanceof Error ? err.message : "Failed to create project";
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

type EditableContentValidator = (input: unknown) => {
  ok: true;
  data: Record<string, unknown>;
} | {
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
    const slides = (validated as { slides: Array<{ slide: number; headline: string; body: string }> }).slides;
    const existingSlides = Array.isArray((existing as { slides?: unknown }).slides)
      ? ((existing as { slides: Array<{ slide: number; imageUrl?: string | null }> }).slides)
      : [];
    const byNumber = new Map<number, string | null>();
    for (const s of existingSlides) {
      if (typeof s?.slide === "number") {
        byNumber.set(s.slide, s.imageUrl ?? null);
      }
    }
    return {
      ...validated,
      slides: slides.map((s) => ({ ...s, imageUrl: byNumber.get(s.slide) ?? null })),
    };
  }
  if (kind === "storyboard_cards") {
    const frames = (validated as { frames: Array<{ frame: number }> }).frames;
    const existingFrames = Array.isArray((existing as { frames?: unknown }).frames)
      ? ((existing as { frames: Array<{ frame: number; imageUrl?: string | null }> }).frames)
      : [];
    const byNumber = new Map<number, string | null>();
    for (const f of existingFrames) {
      if (typeof f?.frame === "number") {
        byNumber.set(f.frame, f.imageUrl ?? null);
      }
    }
    return {
      ...validated,
      frames: frames.map((f) => ({ ...f, imageUrl: byNumber.get(f.frame) ?? null })),
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
      and(eq(assetCardsTable.id, cardId), eq(assetCardsTable.projectId, project.id)),
    )
    .limit(1);
  if (!card) {
    res.status(404).json({ error: "Asset card not found" });
    return;
  }

  if (!ASSET_CARD_KINDS.has(card.kind)) {
    res.status(400).json({ error: `Unsupported asset card kind: ${card.kind}` });
    return;
  }

  const kind = card.kind as AssetCardKind;
  const validator = CARD_VALIDATORS[kind];
  const sanitizedContent = stripClientImageUrls(kind, parsedBody.data.content);
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
      and(eq(assetCardsTable.id, cardId), eq(assetCardsTable.projectId, project.id)),
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
    return { failure: `Model returned invalid JSON: ${(err as Error).message}` };
  }
  const wrapped = parsedJson as Record<string, unknown> | null;
  const inner = wrapped && typeof wrapped === "object" ? wrapped[contract.responseKey] : undefined;
  if (inner === undefined) {
    return { failure: `Model response missing "${contract.responseKey}" key` };
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

function intakeFromSourceInput(
  metadata: Record<string, unknown> | null,
): IntakeContext {
  const m = metadata ?? {};
  const ctx: IntakeContext = {};
  if (typeof m.audience === "string") ctx.audience = m.audience;
  if (typeof m.offer === "string") ctx.offer = m.offer;
  if (typeof m.cta === "string") ctx.cta = m.cta;
  if (typeof m.tone === "string") ctx.tone = m.tone;
  if (Array.isArray(m.channels)) {
    ctx.channels = m.channels.filter((c): c is string => typeof c === "string");
  }
  if (typeof m.timestamps === "string") ctx.timestamps = m.timestamps;
  return ctx;
}

router.post("/projects/:slug/sections/:section", async (req, res) => {
  const parsed = RegenerateSectionParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid section. Must be one of the supported asset card kinds.",
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
      and(eq(assetCardsTable.projectId, project.id), eq(assetCardsTable.kind, kind)),
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
    const message = err instanceof Error ? err.message : "Failed to record regen run";
    logger.error({ err, projectId: project.id, kind }, "Section regen run insert failed");
    res.status(500).json({ error: message });
    return;
  }

  try {
    let result = await regenerateSingleSection(sourceInput.rawText, intake, kind);
    if (!result.content) {
      logger.warn(
        { failure: result.failure, projectId: project.id, runId, kind },
        "Section regen failed validation; retrying once",
      );
      result = await regenerateSingleSection(sourceInput.rawText, intake, kind);
    }
    if (!result.content) {
      throw new Error(result.failure || "Section regeneration failed after retry");
    }

    // Phase 2 — for visual sections, regenerate one image per slide/frame
    // and merge the new objectPaths into the payload. Per-image failures
    // are swallowed (logged + skipped); a missing image just falls back
    // to the text-only rendering on the workspace.
    let payload: Record<string, unknown> = result.content;
    if (kind === "storyboard_cards") {
      const angle = await loadLaunchAngleText(project.id);
      const frames = (payload as {
        frames: Array<{
          frame: number;
          visual: string;
          hook?: string;
          voiceover?: string;
          onScreenText?: string;
        }>;
      }).frames;
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
      const slides = (payload as { slides: Array<{ slide: number; headline: string; body: string }> })
        .slides;
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
            previousContent: (existingCard.content ?? {}) as Record<string, unknown>,
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
    const message = err instanceof Error ? err.message : "Section regeneration failed";
    logger.error({ err, projectId: project.id, runId, kind }, "Section regeneration failed");
    try {
      await db
        .update(generationRunsTable)
        .set({ status: "error", errorMessage: clampErrorMessage(message), completedAt: new Date() })
        .where(eq(generationRunsTable.id, runId));
    } catch (dbErr) {
      logger.error({ err: dbErr, runId }, "Failed to mark regen run as error");
    }
    res.status(500).json({ error: message });
  }
});

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
): Promise<{ faq?: Array<{ question: string; answer: string }>; failure?: string }> {
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
    return { failure: `Model returned invalid JSON: ${(err as Error).message}` };
  }
  const wrapped = parsedJson as Record<string, unknown> | null;
  const inner = wrapped && typeof wrapped === "object" ? wrapped[contract.responseKey] : undefined;
  if (inner === undefined) {
    return { failure: `Model response missing "${contract.responseKey}" key` };
  }
  const validated = contract.zodSchema.safeParse(inner);
  if (!validated.success) {
    const detail = validated.error.issues
      .slice(0, 5)
      .map((i: z.ZodIssue) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    return { failure: `FAQ payload failed schema validation: ${detail}` };
  }
  return { faq: (validated.data as { faq: Array<{ question: string; answer: string }> }).faq };
}

router.post("/projects/:slug/sections/landing_page_copy/faq", async (req, res) => {
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
  const existingContent = (existingCard.content ?? {}) as Record<string, unknown>;

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
    const message = err instanceof Error ? err.message : "Failed to record FAQ run";
    logger.error({ err, projectId: project.id }, "Landing FAQ run insert failed");
    res.status(500).json({ error: message });
    return;
  }

  try {
    let result = await generateLandingFaq(sourceInput.rawText, intake, existingContent);
    if (!result.faq) {
      logger.warn(
        { failure: result.failure, projectId: project.id, runId },
        "Landing FAQ generation failed validation; retrying once",
      );
      result = await generateLandingFaq(sourceInput.rawText, intake, existingContent);
    }
    if (!result.faq) {
      throw new Error(result.failure || "FAQ generation failed after retry");
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
        throw new Error("Landing card was removed before FAQ could be saved");
      }
      const freshContent = (freshCard.content ?? {}) as Record<string, unknown>;
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
    const message = err instanceof Error ? err.message : "FAQ generation failed";
    logger.error({ err, projectId: project.id, runId }, "Landing FAQ generation failed");
    try {
      await db
        .update(generationRunsTable)
        .set({ status: "error", errorMessage: clampErrorMessage(message), completedAt: new Date() })
        .where(eq(generationRunsTable.id, runId));
    } catch (dbErr) {
      logger.error({ err: dbErr, runId }, "Failed to mark FAQ run as error");
    }
    res.status(500).json({ error: message });
  }
});

// =====================================================================
// POST /projects/:slug/sections/storyboard_cards/refresh-images
//
// Re-run only the image generation step for the existing storyboard
// card without regenerating any frame text. Lets founders pull in
// visibly better artwork from the new richer image-prompt builder
// (hook + visual + on-screen text + voiceover) when their storyboard
// text was already generated by an older prompt.
//
// Flow:
//   1. Load project + existing storyboard card. 404 if either is missing.
//   2. Read the current frames from the persisted content (after the
//      storyboard coercion that maps legacy `caption` onto `voiceover`).
//   3. Fan out one gpt-image-1 call per frame using the current text.
//      Per-frame failures fall back to the *previous* imageUrl on that
//      frame so a partial failure still leaves usable art instead of
//      blowing away the existing image.
//   4. Snapshot previousContent so the founder can Undo, then UPDATE
//      the card in place with frames carrying their new imageUrl.
// =====================================================================
router.post(
  "/projects/:slug/sections/storyboard_cards/refresh-images",
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

    const existing = await db
      .select()
      .from(assetCardsTable)
      .where(
        and(
          eq(assetCardsTable.projectId, project.id),
          eq(assetCardsTable.kind, "storyboard_cards"),
        ),
      )
      .orderBy(desc(assetCardsTable.createdAt))
      .limit(1);
    const existingCard = existing[0];
    if (!existingCard) {
      res.status(404).json({
        error:
          "No storyboard card to refresh images on. Generate the storyboard section first.",
      });
      return;
    }

    // Coerce so legacy `caption` payloads still render — the prompt
    // builder reads `voiceover`, so the legacy mapping matters here too.
    const existingContent = coerceStoryboardContent(
      (existingCard.content ?? {}) as Record<string, unknown>,
    );
    const framesRaw = (existingContent as { frames?: unknown }).frames;
    if (!Array.isArray(framesRaw) || framesRaw.length === 0) {
      res.status(404).json({
        error: "Storyboard card has no frames to refresh.",
      });
      return;
    }
    const frames = framesRaw as Array<{
      frame: number;
      hook?: string;
      visual: string;
      onScreenText?: string;
      voiceover?: string;
      imageUrl?: string | null;
    }>;

    // Look up the most recent source input only to attribute the run; the
    // refresh doesn't call the LLM so launch context isn't needed beyond
    // the launch angle (loaded below).
    const sourceInputs = await db
      .select({ id: sourceInputsTable.id })
      .from(sourceInputsTable)
      .where(eq(sourceInputsTable.projectId, project.id))
      .orderBy(desc(sourceInputsTable.createdAt))
      .limit(1);
    const sourceInputId = sourceInputs[0]?.id ?? existingCard.sourceInputId;

    const startedAt = new Date();
    let runId: string;
    try {
      const [run] = await db
        .insert(generationRunsTable)
        .values({
          projectId: project.id,
          sourceInputId,
          status: "running",
          model: MODEL,
          promptVersion: `${PROMPT_VERSION}-storyboard-images`,
          metadata: {
            regeneratedSection: "storyboard_cards",
            scope: "images",
          },
          startedAt,
        })
        .returning();
      runId = run!.id;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to record refresh run";
      logger.error(
        { err, projectId: project.id },
        "Storyboard image refresh run insert failed",
      );
      res.status(500).json({ error: message });
      return;
    }

    try {
      const angle = await loadLaunchAngleText(project.id);
      const visuals = await regenerateSectionVisuals({
        projectSlug: project.slug,
        launchAngle: angle,
        storyboardFrames: frames.map((f) => ({
          frame: f.frame,
          visual: f.visual,
          hook: f.hook,
          voiceover: f.voiceover,
          onScreenText: f.onScreenText,
        })),
      });

      const completedAt = new Date();
      const updatedCard = await db.transaction(async (tx) => {
        // Re-read the card inside the transaction and merge new image
        // URLs onto the LATEST persisted text. If a founder edited a
        // frame while images were being generated we still preserve
        // their newer text and only splice in the new imageUrls. This
        // shrinks the lost-update race window dramatically (mirrors
        // the landing-FAQ backfill pattern) without taking a row lock.
        const fresh = await tx
          .select()
          .from(assetCardsTable)
          .where(eq(assetCardsTable.id, existingCard.id))
          .limit(1);
        const freshCard = fresh[0];
        if (!freshCard) {
          throw new Error(
            "Storyboard card was removed before images could be saved",
          );
        }
        const freshContent = coerceStoryboardContent(
          (freshCard.content ?? {}) as Record<string, unknown>,
        );
        const freshFramesRaw = (freshContent as { frames?: unknown }).frames;
        const freshFrames = Array.isArray(freshFramesRaw)
          ? (freshFramesRaw as Array<{
              frame: number;
              imageUrl?: string | null;
            }>)
          : [];
        // Per-frame failure → keep the existing imageUrl so the
        // founder doesn't end up with a worse card than they started
        // with. Use the just-re-read fresh frame as the base.
        const refreshedFrames = freshFrames.map((f) => ({
          ...f,
          imageUrl:
            visuals.storyboardImages.get(f.frame) ?? f.imageUrl ?? null,
        }));
        const newPayload: Record<string, unknown> = {
          ...freshContent,
          frames: refreshedFrames,
        };
        const [row] = await tx
          .update(assetCardsTable)
          .set({
            content: newPayload,
            previousContent: (freshCard.content ?? {}) as Record<
              string,
              unknown
            >,
            previousUpdatedAt: freshCard.updatedAt,
            generationRunId: runId,
            sourceInputId,
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
        err instanceof Error ? err.message : "Image refresh failed";
      logger.error(
        { err, projectId: project.id, runId },
        "Storyboard image refresh failed",
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
          "Failed to mark image refresh run as error",
        );
      }
      res.status(500).json({ error: message });
    }
  },
);

// Helper used by visual section regeneration: pull the current launch
// angle text so the image prompts have the same product context as the
// initial generation. Falls back to an empty string if the angle hasn't
// been generated yet.
async function loadLaunchAngleText(projectId: string): Promise<string> {
  const rows = await db
    .select()
    .from(assetCardsTable)
    .where(
      and(
        eq(assetCardsTable.projectId, projectId),
        eq(assetCardsTable.kind, "launch_angle"),
      ),
    )
    .orderBy(desc(assetCardsTable.createdAt))
    .limit(1);
  const content = rows[0]?.content as { text?: unknown } | undefined;
  return typeof content?.text === "string" ? content.text : "";
}

// =====================================================================
// Share-link endpoints — mint, revoke, and resolve a public read-only
// token for the project. We keep at most one active link per project
// at a time; minting while a link is active returns the existing one
// (so callers don't accumulate dead tokens). Revoke marks all active
// rows revoked and is idempotent.
// =====================================================================

const SLUG_PARAM = z.object({ slug: z.string().min(1) });
const TOKEN_PARAM = z.object({ token: z.string().min(1).max(200) });

function newShareToken(): string {
  // 22 base64url chars (~132 bits) — long enough that guessing is infeasible
  // and short enough to drop into a Slack/Twitter message comfortably.
  return randomBytes(16).toString("base64url");
}

router.post("/projects/:slug/share-link", async (req, res) => {
  const parsed = SLUG_PARAM.safeParse(req.params);
  if (!parsed.success) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const { slug } = parsed.data;

  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.slug, slug))
    .limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const existing = await db
    .select()
    .from(shareLinksTable)
    .where(
      and(
        eq(shareLinksTable.projectId, project.id),
        isNull(shareLinksTable.revokedAt),
      ),
    )
    .orderBy(desc(shareLinksTable.createdAt))
    .limit(1);

  let token: string;
  let createdAt: Date;
  if (existing[0]) {
    token = existing[0].token;
    createdAt = existing[0].createdAt;
  } else {
    const [row] = await db
      .insert(shareLinksTable)
      .values({ projectId: project.id, token: newShareToken() })
      .returning();
    token = row!.token;
    createdAt = row!.createdAt;
  }

  res.status(200).json({
    token,
    url: buildShareUrl(req, token),
    createdAt: createdAt.toISOString(),
  });
});

router.delete("/projects/:slug/share-link", async (req, res) => {
  const parsed = SLUG_PARAM.safeParse(req.params);
  if (!parsed.success) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const { slug } = parsed.data;

  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.slug, slug))
    .limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await db
    .update(shareLinksTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(shareLinksTable.projectId, project.id),
        isNull(shareLinksTable.revokedAt),
      ),
    );

  res.status(204).send();
});

router.get("/public/projects/:token", async (req, res) => {
  const parsed = TOKEN_PARAM.safeParse(req.params);
  if (!parsed.success) {
    res.status(404).json({ error: "Share link not found" });
    return;
  }
  const { token } = parsed.data;

  const [link] = await db
    .select()
    .from(shareLinksTable)
    .where(eq(shareLinksTable.token, token))
    .limit(1);
  if (!link || link.revokedAt) {
    res.status(404).json({ error: "Share link not found" });
    return;
  }

  // Public callers don't need (and shouldn't see) the active token, so we
  // intentionally skip the share-link lookup and stamp activeShareToken=null.
  const detail = await loadProjectDetail(link.projectId, { includeShareToken: false });
  if (!detail) {
    res.status(404).json({ error: "Share link not found" });
    return;
  }
  res.json(detail);
});

// =====================================================================
// Project rename + delete. Both look up the project by slug, perform a
// minimal write, and return either the updated row (rename) or 204
// (delete). Delete cascades through source_inputs, generation_runs,
// asset_cards, and share_links via the FK onDelete: "cascade" rules in
// lib/db/src/schema.
// =====================================================================

router.patch("/projects/:slug", async (req, res) => {
  const parsedParams = GetProjectParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const parsedBody = UpdateProjectBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      error: "Invalid input: name is required (1-200 chars).",
    });
    return;
  }
  const { slug } = parsedParams.data;
  const name = parsedBody.data.name.trim();
  if (name.length === 0) {
    res.status(400).json({ error: "Invalid input: name cannot be blank." });
    return;
  }

  const [updated] = await db
    .update(projectsTable)
    .set({ name, updatedAt: new Date() })
    .where(eq(projectsTable.slug, slug))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(serializeProject(updated));
});

router.delete("/projects/:slug", async (req, res) => {
  const parsedParams = GetProjectParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const { slug } = parsedParams.data;

  const deleted = await db
    .delete(projectsTable)
    .where(eq(projectsTable.slug, slug))
    .returning({ id: projectsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.status(204).send();
});

router.get("/projects/:slug", async (req, res) => {
  const parsed = GetProjectParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const { slug } = parsed.data;

  const rows = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const detail = await loadProjectDetail(row.id);
  if (!detail) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Weak ETag derived from the project + the most recently updated
  // child row. Cheap to compute, lets the share-page reader and the
  // workspace owner short-circuit re-renders on no-op refetches (P10).
  const lastTouched = Math.max(
    new Date(detail.project.updatedAt).getTime(),
    ...detail.assetCards.map((c) => new Date(c.updatedAt).getTime()),
    ...detail.runs.map((r) => new Date(r.createdAt).getTime()),
    0,
  );
  const etag = `W/"${row.id}-${lastTouched}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  res.json(detail);
});

export default router;
