import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { id: string; projectId: string; createdAt: Date; archivedAt?: Date | null };

const state: {
  runs: Row[];
  cards: Row[];
  lastDeletedRunIds: string[];
  lastDeletedCardIds: string[];
} = {
  runs: [],
  cards: [],
  lastDeletedRunIds: [],
  lastDeletedCardIds: [],
};

vi.mock("@workspace/db", () => {
  const col = (name: string) => ({ __col: name });
  const generationRunsTable = {
    __tag: "generation_runs",
    id: col("id"),
    projectId: col("project_id"),
    createdAt: col("created_at"),
  };
  const assetCardsTable = {
    __tag: "asset_cards",
    id: col("id"),
    generationRunId: col("generation_run_id"),
    archivedAt: col("archived_at"),
  };

  // Each call records what tx wants to do via a tiny query-builder.
  // We model only the four shapes our cleanup module issues.
  const makeTx = () => {
    const api = {
      select: (_proj?: unknown) => {
        const s: { _table?: string; _whereOp?: string; _whereVals?: unknown } = {};
        const chain: Record<string, unknown> = {
          from: (t: { __tag: string }) => {
            s._table = t.__tag;
            return chain;
          },
          where: (predicate: { __op: string; vals?: unknown }) => {
            s._whereOp = predicate.__op;
            s._whereVals = predicate.vals;
            return chain;
          },
          orderBy: () => chain,
          then: (resolve: (v: unknown) => unknown) => {
            // DISTINCT ON latest run per project
            if (s._table === "generation_runs" && !s._whereOp) {
              const byProj = new Map<string, Row>();
              for (const r of [...state.runs].sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
              )) {
                if (!byProj.has(r.projectId)) byProj.set(r.projectId, r);
              }
              return Promise.resolve([...byProj.values()].map((r) => ({ id: r.id }))).then(
                resolve,
              );
            }
            // Target run ids
            if (s._table === "generation_runs" && s._whereOp === "andLtNotIn") {
              const { cutoff, exclude } = s._whereVals as {
                cutoff: Date;
                exclude: string[];
              };
              return Promise.resolve(
                state.runs
                  .filter(
                    (r) =>
                      r.createdAt < cutoff && !exclude.includes(r.id),
                  )
                  .map((r) => ({ id: r.id })),
              ).then(resolve);
            }
            if (s._table === "generation_runs" && s._whereOp === "lt") {
              const cutoff = s._whereVals as Date;
              return Promise.resolve(
                state.runs
                  .filter((r) => r.createdAt < cutoff)
                  .map((r) => ({ id: r.id })),
              ).then(resolve);
            }
            // Count cards by run id
            if (s._table === "asset_cards" && s._whereOp === "inRun") {
              const ids = s._whereVals as string[];
              const count = state.cards.filter(
                (c) => c.id && ids.includes((c as Row & { generationRunId?: string }).generationRunId ?? ""),
              ).length;
              return Promise.resolve([{ count }]).then(resolve);
            }
            return Promise.resolve([]).then(resolve);
          },
        };
        return chain;
      },
      delete: (table: { __tag: string }) => {
        const d: { _table: string; _whereOp?: string; _whereVals?: unknown } = {
          _table: table.__tag,
        };
        const chain: Record<string, unknown> = {
          where: (predicate: { __op: string; vals?: unknown }) => {
            d._whereOp = predicate.__op;
            d._whereVals = predicate.vals;
            return chain;
          },
          returning: () => ({
            then: (resolve: (v: unknown) => unknown) => {
              if (d._table === "asset_cards" && d._whereOp === "archivedBefore") {
                const cutoff = d._whereVals as Date;
                const removed = state.cards.filter(
                  (c) => c.archivedAt && c.archivedAt < cutoff,
                );
                state.lastDeletedCardIds = removed.map((r) => r.id);
                state.cards = state.cards.filter(
                  (c) => !(c.archivedAt && c.archivedAt < cutoff),
                );
                return Promise.resolve(removed.map((r) => ({ id: r.id }))).then(
                  resolve,
                );
              }
              if (d._table === "generation_runs" && d._whereOp === "inRun") {
                const ids = d._whereVals as string[];
                const removed = state.runs.filter((r) => ids.includes(r.id));
                state.lastDeletedRunIds = removed.map((r) => r.id);
                state.runs = state.runs.filter((r) => !ids.includes(r.id));
                return Promise.resolve(removed.map((r) => ({ id: r.id }))).then(
                  resolve,
                );
              }
              return Promise.resolve([]).then(resolve);
            },
          }),
        };
        return chain;
      },
    };
    return api;
  };

  const db = {
    transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  };

  return { db, generationRunsTable, assetCardsTable };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: Array<{ __op: string; vals?: unknown }>) => {
    // Only the (lt, notInArray) shape used by the cleanup
    const lt = args.find((a) => a.__op === "lt");
    const notIn = args.find((a) => a.__op === "notIn");
    if (lt && notIn) {
      return {
        __op: "andLtNotIn",
        vals: { cutoff: lt.vals as Date, exclude: notIn.vals as string[] },
      };
    }
    // archived asset_cards branch: isNotNull + lt(archivedAt, cutoff)
    const archivedLt = args.find((a) => a.__op === "ltArchived");
    if (archivedLt) {
      return { __op: "archivedBefore", vals: archivedLt.vals };
    }
    return { __op: "and", vals: args };
  },
  lt: (col: { __col: string }, val: Date) => {
    if (col.__col === "archived_at") return { __op: "ltArchived", vals: val };
    return { __op: "lt", vals: val };
  },
  notInArray: (_col: unknown, vals: string[]) => ({ __op: "notIn", vals }),
  inArray: (col: { __col: string }, vals: string[]) => {
    if (col.__col === "id") return { __op: "inRun", vals };
    if (col.__col === "generation_run_id") return { __op: "inRun", vals };
    return { __op: "in", vals };
  },
  isNotNull: (_col: unknown) => ({ __op: "isNotNull" }),
  sql: Object.assign(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => ({ __sql: true }),
    {},
  ),
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { cleanupOldGenerationRuns } from "./cleanup-runs";

const day = 24 * 60 * 60 * 1000;

beforeEach(() => {
  state.runs = [];
  state.cards = [];
  state.lastDeletedRunIds = [];
  state.lastDeletedCardIds = [];
});

describe("cleanupOldGenerationRuns", () => {
  const NOW = new Date("2026-05-01T00:00:00Z");

  it("preserves the latest run per project even when very old", async () => {
    state.runs = [
      // Project A: only one run, 999 days old — must be preserved.
      { id: "a-only", projectId: "A", createdAt: new Date(NOW.getTime() - 999 * day) },
      // Project B: latest is old, plus an older one.
      { id: "b-latest-old", projectId: "B", createdAt: new Date(NOW.getTime() - 100 * day) },
      { id: "b-older", projectId: "B", createdAt: new Date(NOW.getTime() - 200 * day) },
    ];

    const result = await cleanupOldGenerationRuns({ retentionDays: 30, now: NOW });

    expect(result.deletedRuns).toBe(1);
    expect(state.lastDeletedRunIds).toEqual(["b-older"]);
    expect(state.runs.map((r) => r.id).sort()).toEqual(["a-only", "b-latest-old"]);
    expect(result.preservedLatestRuns).toBe(2);
  });

  it("deletes only runs older than the cutoff and keeps fresh ones", async () => {
    state.runs = [
      { id: "fresh", projectId: "A", createdAt: new Date(NOW.getTime() - 5 * day) },
      { id: "old-1", projectId: "A", createdAt: new Date(NOW.getTime() - 60 * day) },
      { id: "old-2", projectId: "A", createdAt: new Date(NOW.getTime() - 90 * day) },
    ];

    const result = await cleanupOldGenerationRuns({ retentionDays: 30, now: NOW });

    expect(result.deletedRuns).toBe(2);
    expect(state.lastDeletedRunIds.sort()).toEqual(["old-1", "old-2"]);
    expect(state.runs.map((r) => r.id)).toEqual(["fresh"]);
  });

  it("prunes archived asset_card revisions older than the cutoff", async () => {
    state.runs = [
      { id: "r1", projectId: "A", createdAt: new Date(NOW.getTime() - 1 * day) },
    ];
    state.cards = [
      // Archived & old — should be deleted
      {
        id: "c-old-archived",
        projectId: "A",
        createdAt: new Date(NOW.getTime() - 200 * day),
        archivedAt: new Date(NOW.getTime() - 100 * day),
      },
      // Archived but recent — keep
      {
        id: "c-recent-archived",
        projectId: "A",
        createdAt: new Date(NOW.getTime() - 5 * day),
        archivedAt: new Date(NOW.getTime() - 1 * day),
      },
      // Active (un-archived) even if old — keep, UI shows it
      {
        id: "c-active-old",
        projectId: "A",
        createdAt: new Date(NOW.getTime() - 500 * day),
        archivedAt: null,
      },
    ];

    const result = await cleanupOldGenerationRuns({ retentionDays: 30, now: NOW });

    expect(result.deletedAssetCardRevisions).toBe(1);
    expect(state.lastDeletedCardIds).toEqual(["c-old-archived"]);
    expect(state.cards.map((c) => c.id).sort()).toEqual([
      "c-active-old",
      "c-recent-archived",
    ]);
  });
});
