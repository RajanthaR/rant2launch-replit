import { Buffer } from "node:buffer";
import { beforeEach, describe, it, expect, vi } from "vitest";
import request from "supertest";

const now = new Date("2024-06-01T00:00:00.000Z");

const mockProject = {
  id: "demo-id",
  slug: "demo",
  name: "Demo Project",
  description: null,
  archivedAt: null,
  userId: null,
  editToken: null,
  createdAt: now,
  updatedAt: now,
};

// Stateful job row the mock returns from SELECT and updates on UPDATE.
// Tests mutate this directly to simulate worker progress.
const mockJob: Record<string, unknown> = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId: "demo-id",
  status: "queued",
  progressTotal: 0,
  progressDone: 0,
  currentStep: "Queued",
  errorMessage: null,
  startedAt: null,
  completedAt: null,
  createdAt: now,
  updatedAt: now,
};

const col = () => ({});
const mockTextToSpeech = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const makeChain = (tableTag?: string): Record<string, unknown> => {
    const resolveData = (): Promise<unknown[]> => {
      if (tableTag === "projects") return Promise.resolve([mockProject]);
      if (tableTag === "generationJobs") return Promise.resolve([mockJob]);
      return Promise.resolve([]);
    };
    return {
      select: () => makeChain(),
      from: (t: { __tag?: string }) => makeChain(t?.__tag),
      where: () => makeChain(tableTag),
      orderBy: () => makeChain(tableTag),
      limit: resolveData,
      then: (
        onFulfilled: (v: unknown[]) => unknown,
        onRejected: (e: unknown) => unknown,
      ) => resolveData().then(onFulfilled, onRejected),
      catch: (onRejected: (e: unknown) => unknown) =>
        resolveData().catch(onRejected),
    };
  };

  // Insert mock used by POST /api/projects boot transaction. Returns a
  // chainable that resolves to a single row matching the inserted table
  // shape (so the handler can pull project!.id, run!.id, job!.id, etc).
  const insertChain = (tableTag: string) => {
    const row =
      tableTag === "projects"
        ? mockProject
        : tableTag === "sourceInputs"
          ? { id: "src-1", projectId: "demo-id", createdAt: now }
          : tableTag === "generationRuns"
            ? { id: "run-1", projectId: "demo-id", createdAt: now }
            : tableTag === "generationJobs"
              ? mockJob
              : { id: "x", createdAt: now };
    return {
      values: () => ({ returning: () => Promise.resolve([row]) }),
    };
  };
  const updateChain = () => ({
    set: () => ({
      where: () => Promise.resolve([]),
    }),
  });

  // Transaction helper: invoke the callback with a tx whose insert/update
  // shapes match the top-level db so the boot transaction can run end-to-end.
  const transaction = async <T>(cb: (tx: Record<string, unknown>) => Promise<T>) => {
    const tx = {
      insert: (t: { __tag?: string }) => insertChain(t?.__tag ?? ""),
      update: (_t: unknown) => updateChain(),
      select: () => makeChain(),
    };
    return cb(tx);
  };

  const dbStub = {
    ...makeChain(),
    insert: (t: { __tag?: string }) => insertChain(t?.__tag ?? ""),
    update: (_t: unknown) => updateChain(),
    transaction,
  };

  return {
    db: dbStub,
    projectsTable: {
      __tag: "projects",
      id: col(),
      slug: col(),
      name: col(),
      userId: col(),
      editToken: col(),
      createdAt: col(),
      updatedAt: col(),
      description: col(),
      archivedAt: col(),
    },
    sourceInputsTable: {
      __tag: "sourceInputs",
      projectId: col(),
      id: col(),
      kind: col(),
      title: col(),
      rawText: col(),
      metadata: col(),
      createdAt: col(),
      updatedAt: col(),
    },
    generationRunsTable: {
      __tag: "generationRuns",
      projectId: col(),
      id: col(),
      sourceInputId: col(),
      status: col(),
      model: col(),
      errorMessage: col(),
      startedAt: col(),
      completedAt: col(),
      createdAt: col(),
      updatedAt: col(),
    },
    generationJobsTable: {
      __tag: "generationJobs",
      id: col(),
      projectId: col(),
      status: col(),
      progressTotal: col(),
      progressDone: col(),
      currentStep: col(),
      errorMessage: col(),
      startedAt: col(),
      completedAt: col(),
      createdAt: col(),
      updatedAt: col(),
    },
    assetCardsTable: {
      __tag: "assetCards",
      projectId: col(),
      id: col(),
      kind: col(),
      content: col(),
      position: col(),
      createdAt: col(),
      updatedAt: col(),
      sectionLabel: col(),
      generationRunId: col(),
      sourceInputId: col(),
    },
    shareLinksTable: {
      __tag: "shareLinks",
      projectId: col(),
      id: col(),
      token: col(),
      revokedAt: col(),
      createdAt: col(),
    },
    pool: { end: vi.fn() },
    eq: vi.fn(() => ({})),
    and: vi.fn(() => ({})),
    desc: vi.fn(() => ({})),
    isNull: vi.fn(() => ({})),
  };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  textToSpeech: mockTextToSpeech,
  openai: {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "{}" } }],
        }),
      },
    },
    images: {
      generate: vi.fn().mockResolvedValue({ data: [] }),
    },
  },
}));

vi.mock("pino-http", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("./lib/logger", () => {
  const noop = () => undefined;
  const logger: Record<string, unknown> = {
    info: noop,
    error: noop,
    warn: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => logger,
    bindings: () => ({}),
    isLevelEnabled: () => false,
    level: "silent",
  };
  return { logger };
});

const { default: app } = await import("./app.js");

describe("API smoke tests", () => {
  beforeEach(() => {
    mockTextToSpeech.mockResolvedValue({
      buffer: Buffer.from("fake-mp3"),
      contentType: "audio/mpeg",
      format: "mp3",
    });
  });

  it("GET /api/projects/demo returns 200 with an ETag header", async () => {
    const res = await request(app).get("/api/projects/demo");
    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toBeDefined();
  });

  it("GET /api/projects/demo with matching If-None-Match returns 304", async () => {
    const first = await request(app).get("/api/projects/demo");
    const etag = first.headers["etag"] as string;
    expect(etag).toBeDefined();

    const second = await request(app)
      .get("/api/projects/demo")
      .set("If-None-Match", etag);

    expect(second.status).toBe(304);
  });

  it("POST /api/projects with a body over 200 kb is rejected with 413", async () => {
    const bigBody = JSON.stringify({ rawText: "x".repeat(210 * 1024) });
    const res = await request(app)
      .post("/api/projects")
      .set("Content-Type", "application/json")
      .send(bigBody);

    expect(res.status).toBe(413);
  });

  it("POST /api/projects returns 202 with {projectId,slug,jobId} in <500ms", async () => {
    const start = Date.now();
    const res = await request(app)
      .post("/api/projects")
      .set("Content-Type", "application/json")
      .send({ rawText: "Voice notes to launches: a punchy launch story." });
    const elapsed = Date.now() - start;

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      projectId: expect.any(String),
      slug: expect.any(String),
      jobId: expect.any(String),
    });
    // The HTTP path does only a single transaction + setImmediate, so
    // 500ms is generous headroom even on a slow CI box.
    expect(elapsed).toBeLessThan(500);
  });

  it("POST /api/projects with empty body returns 400 (validation)", async () => {
    const res = await request(app)
      .post("/api/projects")
      .set("Content-Type", "application/json")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid input/);
  });

  it("POST /api/audio/tts returns MP3 audio bytes", async () => {
    const res = await request(app)
      .post("/api/audio/tts")
      .set("Content-Type", "application/json")
      .send({ text: "This is the voiceover line." });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^audio\/mpeg\b/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(Buffer.from(res.body).toString()).toBe("fake-mp3");
    expect(mockTextToSpeech).toHaveBeenCalledWith({
      text: "This is the voiceover line.",
      voice: "onyx",
      format: "mp3",
    });
  });

  it("POST /api/audio/tts rejects empty and too-long text", async () => {
    const empty = await request(app)
      .post("/api/audio/tts")
      .set("Content-Type", "application/json")
      .send({ text: "   " });
    expect(empty.status).toBe(400);

    const tooLong = await request(app)
      .post("/api/audio/tts")
      .set("Content-Type", "application/json")
      .send({ text: "x".repeat(1001) });
    expect(tooLong.status).toBe(400);
  });

  it("POST /api/audio/tts returns 502 when OpenAI returns no audio", async () => {
    mockTextToSpeech.mockRejectedValueOnce(new Error("gpt-audio returned no audio data"));

    const res = await request(app)
      .post("/api/audio/tts")
      .set("Content-Type", "application/json")
      .send({ text: "This should fail upstream." });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Failed to generate speech.");
  });

  it("GET /api/jobs/:jobId returns the current job snapshot", async () => {
    const jobId = "11111111-1111-4111-8111-111111111111";
    const res = await request(app).get(`/api/jobs/${jobId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: jobId,
      status: "queued",
      progressTotal: 0,
      progressDone: 0,
      currentStep: "Queued",
    });
  });

  it("GET /api/jobs/:jobId with a non-uuid returns 404", async () => {
    const res = await request(app).get("/api/jobs/not-a-uuid");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Job not found");
  });
});
