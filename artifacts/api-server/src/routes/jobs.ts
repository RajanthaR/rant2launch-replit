import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, generationJobsTable } from "@workspace/db";

const router: IRouter = Router();

const JOB_PARAM = z.object({ jobId: z.string().uuid() });

function serializeJob(row: typeof generationJobsTable.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status as "queued" | "running" | "succeeded" | "failed",
    progressTotal: row.progressTotal,
    progressDone: row.progressDone,
    currentStep: row.currentStep,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /api/jobs/:jobId — readLimiter applies automatically via the
// routing-aware middleware in app.ts (any GET under /api → readLimiter).
router.get("/jobs/:jobId", async (req, res) => {
  const parsed = JOB_PARAM.safeParse(req.params);
  if (!parsed.success) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const { jobId } = parsed.data;

  const rows = await db
    .select()
    .from(generationJobsTable)
    .where(eq(generationJobsTable.id, jobId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.status(200).json(serializeJob(row));
});

export default router;
