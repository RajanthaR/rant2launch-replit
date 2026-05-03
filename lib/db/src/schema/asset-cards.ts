import { pgTable, text, timestamp, uuid, jsonb, integer, boolean, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { sourceInputsTable } from "./source-inputs";
import { generationRunsTable } from "./generation-runs";

export const assetCardsTable = pgTable(
  "asset_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    generationRunId: uuid("generation_run_id").references(() => generationRunsTable.id, {
      onDelete: "set null",
    }),
    sourceInputId: uuid("source_input_id").references(() => sourceInputsTable.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    title: text("title"),
    content: jsonb("content").notNull(),
    previousContent: jsonb("previous_content"),
    previousUpdatedAt: timestamp("previous_updated_at", { withTimezone: true }),
    position: integer("position").default(0).notNull(),
    pinned: boolean("pinned").default(false).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    projectIdx: index("asset_cards_project_idx").on(t.projectId),
    runIdx: index("asset_cards_run_idx").on(t.generationRunId),
    kindIdx: index("asset_cards_kind_idx").on(t.kind),
    projectKindIdx: index("asset_cards_project_kind_idx").on(t.projectId, t.kind),
  }),
);

export type AssetCard = typeof assetCardsTable.$inferSelect;
export type InsertAssetCard = typeof assetCardsTable.$inferInsert;
