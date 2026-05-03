import { type Request } from "express";
import {
  db,
  projectsTable,
  sourceInputsTable,
  generationRunsTable,
  assetCardsTable,
  shareLinksTable,
} from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";

export function serializeProject(row: typeof projectsTable.$inferSelect) {
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
export function coerceStoryboardContent(
  content: Record<string, unknown>,
): Record<string, unknown> {
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

export function serializeAssetCard(row: typeof assetCardsTable.$inferSelect) {
  const rawContent = (row.content ?? {}) as Record<string, unknown>;
  const content =
    row.kind === "storyboard_cards"
      ? coerceStoryboardContent(rawContent)
      : rawContent;
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

export async function loadProjectDetail(
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
    db
      .select()
      .from(sourceInputsTable)
      .where(eq(sourceInputsTable.projectId, projectId)),
    db
      .select()
      .from(generationRunsTable)
      .where(eq(generationRunsTable.projectId, projectId)),
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
      .sort(
        (a, b) =>
          a.position - b.position ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      )
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

export function buildShareUrl(req: Request, token: string): string {
  // Honor proxy headers (Replit fronts the app via mTLS proxy) so the URL
  // we hand back is one the recipient can actually open. Fallback to the
  // request's Host header.
  const forwardedProto = req.get("x-forwarded-proto");
  const forwardedHost = req.get("x-forwarded-host");
  const proto =
    forwardedProto?.split(",")[0]?.trim() || req.protocol || "https";
  const host =
    forwardedHost?.split(",")[0]?.trim() || req.get("host") || "localhost";
  // The web artifact mounts at "/" in this workspace; the share page lives
  // at /share/:token under that base.
  return `${proto}://${host}/share/${token}`;
}
