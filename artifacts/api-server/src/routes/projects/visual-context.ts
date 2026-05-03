import { db, assetCardsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

// Helper used by visual section regeneration: pull the current launch
// angle text so the image prompts have the same product context as the
// initial generation. Falls back to an empty string if the angle hasn't
// been generated yet.
export async function loadLaunchAngleText(projectId: string): Promise<string> {
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
