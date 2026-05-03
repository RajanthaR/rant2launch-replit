import { randomBytes } from "node:crypto";
import { type IRouter } from "express";
import { db, projectsTable, shareLinksTable } from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { SLUG_PARAM, TOKEN_PARAM } from "./params";
import { buildShareUrl, loadProjectDetail } from "./serialization";

export function registerShareLinkRoutes(router: IRouter): void {
  // =====================================================================
  // Share-link endpoints — mint, revoke, and resolve a public read-only
  // token for the project. We keep at most one active link per project
  // at a time; minting while a link is active returns the existing one
  // (so callers don't accumulate dead tokens). Revoke marks all active
  // rows revoked and is idempotent.
  // =====================================================================
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
    const detail = await loadProjectDetail(link.projectId, {
      includeShareToken: false,
    });
    if (!detail) {
      res.status(404).json({ error: "Share link not found" });
      return;
    }
    res.json(detail);
  });
}
