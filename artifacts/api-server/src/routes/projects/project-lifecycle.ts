import { type IRouter } from "express";
import { db, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GetProjectParams, UpdateProjectBody } from "@workspace/api-zod";
import { loadProjectDetail, serializeProject } from "./serialization";

export function registerProjectLifecycleRoutes(router: IRouter): void {
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
}
