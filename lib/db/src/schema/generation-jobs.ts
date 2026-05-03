import { pgTable, pgEnum, text, integer, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

// Status lifecycle:
//   queued    – row inserted, worker has not picked it up yet
//   running   – worker is actively executing the generation pipeline
//   succeeded – pipeline finished and asset cards are persisted
//   failed    – pipeline raised; error_message holds a clamped message
export const generationJobStatusEnum = pgEnum("generation_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

export const generationJobsTable = pgTable(
  "generation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    status: generationJobStatusEnum("status").notNull().default("queued"),
    // Total/done are simple counters the worker bumps. Total may be 0
    // until the worker has computed how many sub-units (cards + visuals)
    // the run actually has, which only happens after text generation.
    progressTotal: integer("progress_total").notNull().default(0),
    progressDone: integer("progress_done").notNull().default(0),
    // Human-readable label for what the worker is doing right now
    // (e.g. "Generating launch copy", "Generating image 3/11", "Done").
    // Surfaced via GET /api/jobs/:jobId for the polling client.
    currentStep: text("current_step"),
    // Clamped via clampErrorMessage() (4000 chars) on the write path so a
    // multi-MB upstream stack trace can never blow up the row.
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    projectIdx: index("generation_jobs_project_idx").on(t.projectId),
    statusIdx: index("generation_jobs_status_idx").on(t.status),
    projectCreatedIdx: index("generation_jobs_project_created_idx").on(
      t.projectId,
      t.createdAt.desc(),
    ),
  }),
);

export type GenerationJob = typeof generationJobsTable.$inferSelect;
export type InsertGenerationJob = typeof generationJobsTable.$inferInsert;
