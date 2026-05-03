import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const sourceInputsTable = pgTable(
  "source_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title"),
    rawText: text("raw_text").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    projectIdx: index("source_inputs_project_idx").on(t.projectId),
    projectCreatedIdx: index("source_inputs_project_created_idx").on(
      t.projectId,
      t.createdAt.desc(),
    ),
  }),
);

export type SourceInput = typeof sourceInputsTable.$inferSelect;
export type InsertSourceInput = typeof sourceInputsTable.$inferInsert;
