import { and, lt, notInArray, inArray, isNotNull, sql } from "drizzle-orm";
import { db, generationRunsTable, assetCardsTable } from "@workspace/db";
import { logger } from "./logger";

export interface CleanupResult {
  cutoff: Date;
  deletedRuns: number;
  preservedLatestRuns: number;
  deletedAssetCardRevisions: number;
  clearedAssetCardRefs: number;
}

export interface CleanupOptions {
  retentionDays?: number;
  now?: Date;
}

function readRetentionDays(explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const raw = process.env.CLEANUP_RETENTION_DAYS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 30;
}

/**
 * Delete generation_runs older than the configured retention window
 * AND prune orphaned asset_card revisions (archived rows past the
 * cutoff that the live UI never reads).
 *
 * Safety invariants:
 *  - The most recent run per project is ALWAYS preserved, regardless
 *    of age, so loadProjectDetail always has at least one run to show.
 *  - Only asset_cards rows with a non-null `archivedAt` are deleted.
 *    Active (un-archived) cards are the live UI state and are never
 *    touched here — they keep their content even if the run that last
 *    produced them is pruned (asset_cards.generation_run_id has
 *    ON DELETE SET NULL).
 *
 * Both deletions run in a single transaction so an error in either
 * step rolls the whole sweep back.
 */
export async function cleanupOldGenerationRuns(
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const retentionDays = readRetentionDays(options.retentionDays);
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  const result = await db.transaction(async (tx) => {
    // Latest run id per project — these are always preserved.
    const latestRows = await tx
      .select({
        id: sql<string>`DISTINCT ON (${generationRunsTable.projectId}) ${generationRunsTable.id}`,
      })
      .from(generationRunsTable)
      .orderBy(
        generationRunsTable.projectId,
        sql`${generationRunsTable.createdAt} DESC`,
      );
    const latestIds = latestRows.map((r) => r.id);

    // 1) Prune orphaned/archived asset_card revisions older than the
    //    cutoff. These are rows the UI doesn't read (archivedAt set).
    const deletedCards = await tx
      .delete(assetCardsTable)
      .where(
        and(
          isNotNull(assetCardsTable.archivedAt),
          lt(assetCardsTable.archivedAt, cutoff),
        ),
      )
      .returning({ id: assetCardsTable.id });

    // 2) Identify the runs to delete (older than cutoff, excluding the
    //    latest run per project).
    const targetWhere =
      latestIds.length > 0
        ? and(
            lt(generationRunsTable.createdAt, cutoff),
            notInArray(generationRunsTable.id, latestIds),
          )
        : lt(generationRunsTable.createdAt, cutoff);

    const targetRuns = await tx
      .select({ id: generationRunsTable.id })
      .from(generationRunsTable)
      .where(targetWhere);
    const targetIds = targetRuns.map((r) => r.id);

    // Count active asset_cards whose generation_run_id will be NULL'd
    // by the FK ON DELETE SET NULL — useful for operator visibility.
    let clearedAssetCardRefs = 0;
    if (targetIds.length > 0) {
      const [row] = await tx
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(assetCardsTable)
        .where(inArray(assetCardsTable.generationRunId, targetIds));
      clearedAssetCardRefs = row?.count ?? 0;
    }

    const deletedRuns =
      targetIds.length > 0
        ? await tx
            .delete(generationRunsTable)
            .where(inArray(generationRunsTable.id, targetIds))
            .returning({ id: generationRunsTable.id })
        : [];

    return {
      cutoff,
      deletedRuns: deletedRuns.length,
      preservedLatestRuns: latestIds.length,
      deletedAssetCardRevisions: deletedCards.length,
      clearedAssetCardRefs,
    } satisfies CleanupResult;
  });

  logger.info(
    {
      cutoff: result.cutoff.toISOString(),
      retentionDays,
      deletedRuns: result.deletedRuns,
      preservedLatestRuns: result.preservedLatestRuns,
      deletedAssetCardRevisions: result.deletedAssetCardRevisions,
      clearedAssetCardRefs: result.clearedAssetCardRefs,
    },
    "generation_runs cleanup complete",
  );

  return result;
}

let scheduledTimer: ReturnType<typeof setInterval> | null = null;

function readIntervalMs(): number {
  const raw = process.env.CLEANUP_INTERVAL_MS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 24 * 60 * 60 * 1000; // 24 hours
}

/**
 * Start a recurring background timer that prunes old generation_runs
 * and orphaned asset_card revisions. Disabled when CLEANUP_ENABLED=0.
 * Returns a stop() handle for tests.
 */
export function startCleanupScheduler(): { stop: () => void } {
  if (process.env.CLEANUP_ENABLED === "0") {
    logger.info("generation_runs cleanup scheduler disabled (CLEANUP_ENABLED=0)");
    return { stop: () => {} };
  }

  const intervalMs = readIntervalMs();

  // Kick off once shortly after boot, then on the recurring interval.
  // Boot delay avoids racing with seedDemoProject and other startup work.
  const bootDelayMs = 60 * 1000;
  const bootTimer = setTimeout(() => {
    cleanupOldGenerationRuns().catch((err) => {
      logger.error({ err }, "generation_runs cleanup failed (boot run)");
    });
  }, bootDelayMs);
  bootTimer.unref?.();

  scheduledTimer = setInterval(() => {
    cleanupOldGenerationRuns().catch((err) => {
      logger.error({ err }, "generation_runs cleanup failed (scheduled run)");
    });
  }, intervalMs);
  scheduledTimer.unref?.();

  logger.info(
    { intervalMs, bootDelayMs },
    "generation_runs cleanup scheduler started",
  );

  return {
    stop: () => {
      clearTimeout(bootTimer);
      if (scheduledTimer) {
        clearInterval(scheduledTimer);
        scheduledTimer = null;
      }
    },
  };
}
