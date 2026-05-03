import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projectsTable } from "./projects";

export const shareLinksTable = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    projectIdx: index("share_links_project_idx").on(t.projectId),
    activeIdx: index("share_links_active_idx")
      .on(t.projectId, t.createdAt.desc())
      .where(sql`revoked_at IS NULL`),
  }),
);

export type ShareLink = typeof shareLinksTable.$inferSelect;
export type InsertShareLink = typeof shareLinksTable.$inferInsert;
