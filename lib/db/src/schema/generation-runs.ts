import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { sourceInputsTable } from "./source-inputs";

export const generationRunsTable = pgTable(
  "generation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    sourceInputId: uuid("source_input_id").references(() => sourceInputsTable.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    projectIdx: index("generation_runs_project_idx").on(t.projectId),
    sourceInputIdx: index("generation_runs_source_input_idx").on(t.sourceInputId),
    projectCreatedIdx: index("generation_runs_project_created_idx").on(
      t.projectId,
      t.createdAt.desc(),
    ),
  }),
);

export type GenerationRun = typeof generationRunsTable.$inferSelect;
export type InsertGenerationRun = typeof generationRunsTable.$inferInsert;
