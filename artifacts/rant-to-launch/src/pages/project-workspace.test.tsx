import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import ProjectWorkspace from "@/pages/project-workspace";
import * as storage from "@/lib/storage";

const SLUG = "test-launch";
const NOW_LOCAL = "2026-05-01T00:00:00.000Z";

interface JobMock {
  id: string;
  data: {
    id: string;
    projectId: string;
    status: "queued" | "running" | "succeeded" | "failed";
    progressTotal: number;
    progressDone: number;
    currentStep: string | null;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
}

const hoisted = vi.hoisted(() => {
  const AssetCardKind = {
    launch_angle: "launch_angle",
    x_thread: "x_thread",
    linkedin_post: "linkedin_post",
    carousel_outline: "carousel_outline",
    newsletter_blurb: "newsletter_blurb",
    landing_page_copy: "landing_page_copy",
    storyboard_cards: "storyboard_cards",
    posting_schedule: "posting_schedule",
  } as const;
  const NOW_LOCAL = "2026-05-01T00:00:00.000Z";
  const card = (kind: string, content: Record<string, unknown>) => ({
    id: `card-${kind}`,
    projectId: "p1",
    generationRunId: "r1",
    sourceInputId: "s1",
    kind,
    title: null,
    content,
    position: 0,
    pinned: false,
    previousContentAvailable: false,
    promptVersion: 1,
    createdAt: NOW_LOCAL,
    updatedAt: NOW_LOCAL,
  });
  const project = {
    project: { id: "p1", slug: "test-launch", name: "Test Launch" },
    assetCards: [
      card("launch_angle", { text: "Compress your chaos into a launch." }),
      card("x_thread", {
        tweets: ["Tweet one body.", "Tweet two body.", "Tweet three body."],
      }),
    ],
    sourceInputs: [
      { id: "s1", rawText: "Original rant goes here.", createdAt: NOW_LOCAL },
    ],
    runs: [{ id: "r1", status: "succeeded", errorMessage: null as string | null }],
    activeShareToken: null as string | null,
  };
  // Mutable holder driving the inflight job + useGetGenerationJob mocks.
  const jobState: { current: { id: string; data: unknown } | null } = {
    current: null,
  };
  return { AssetCardKind, project, jobState };
});

vi.mock("@workspace/api-client-react", () => {
  const noop = () => ({
    mutate: () => {},
    mutateAsync: () => Promise.resolve(undefined),
    isPending: false,
    isError: false,
    reset: () => {},
  });
  return {
    AssetCardKind: hoisted.AssetCardKind,
    getGetProjectQueryKey: (slug: string) => ["projects", slug],
    getGetGenerationJobQueryKey: (jobId: string) => ["jobs", jobId],
    createTts: vi.fn(() => Promise.resolve(new Blob(["fake-mp3"]))),
    useGetProject: () => ({
      data: hoisted.project,
      isLoading: false,
      isError: false,
      error: null,
    }),
    // Mirrors the real hook contract: returns data only when called
    // with the matching jobId AND query.enabled is truthy.
    useGetGenerationJob: (
      jobId: string,
      opts?: { query?: { enabled?: boolean } },
    ) => {
      const enabled = opts?.query?.enabled ?? true;
      const expectedId = hoisted.jobState.current?.id;
      const matches = enabled && !!expectedId && jobId === expectedId;
      return {
        data: matches ? hoisted.jobState.current?.data : undefined,
        isLoading: false,
        isError: false,
      };
    },
    useCreateShareLink: noop,
    useRevokeShareLink: noop,
    useUpdateProject: noop,
    useDeleteProject: noop,
    useUpdateAssetCard: noop,
    useRegenerateSection: noop,
    useBackfillLandingFaq: noop,
    useRefreshStoryboardImages: noop,
    useUndoAssetCard: noop,
  };
});

vi.mock("@/lib/storage", () => ({
  getRecentProjects: () => [],
  saveRecentProject: vi.fn(),
  removeRecentProject: vi.fn(),
  renameRecentProject: vi.fn(),
  getInflightJob: vi.fn(() => hoisted.jobState.current?.id ?? null),
  clearInflightJob: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function renderWorkspace(queryClient?: QueryClient) {
  const client =
    queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: `/projects/${SLUG}` });
  // Reuse the same router hook across rerenders so the workspace is
  // updated in place; build a fresh element each call so React does
  // not bail out on element reference equality.
  const buildTree = () => (
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Route path="/projects/:slug" component={ProjectWorkspace} />
      </Router>
    </QueryClientProvider>
  );
  const result = render(buildTree());
  const rerenderInPlace = () => result.rerender(buildTree());
  return { ...result, rerenderInPlace };
}

describe("Project workspace page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.project.activeShareToken = null;
    hoisted.jobState.current = null;
  });

  it("renders the workspace with the mocked project name in the header", () => {
    renderWorkspace();
    // Project name appears in the top header chrome.
    expect(screen.getAllByText("Test Launch").length).toBeGreaterThan(0);
  });

  it("renders asset card sections with their content", () => {
    renderWorkspace();
    // Launch angle text from the mocked card body.
    expect(
      screen.getByText("Compress your chaos into a launch."),
    ).toBeInTheDocument();
    // X thread tweets from the mocked card body.
    expect(screen.getByText("Tweet one body.")).toBeInTheDocument();
    expect(screen.getByText("Tweet two body.")).toBeInTheDocument();
    // Section title from SECTION_META.
    expect(screen.getAllByText(/launch angle/i).length).toBeGreaterThan(0);
  });

  it("clicking Edit on the launch angle reveals the edit form, Cancel hides it", () => {
    renderWorkspace();

    // No textarea before entering edit mode.
    expect(screen.queryByRole("textbox", { name: /launch angle/i })).toBeNull();

    // Each section has its own "Edit section" button — pick the launch angle's
    // by scoping to the card that contains the launch-angle text.
    const editButtons = screen.getAllByRole("button", { name: /edit section/i });
    fireEvent.click(editButtons[0]);

    // Edit form is now visible.
    const textarea = screen.getByRole("textbox", { name: /launch angle/i });
    expect(textarea).toBeInTheDocument();
    expect((textarea as HTMLTextAreaElement).value).toBe(
      "Compress your chaos into a launch.",
    );

    // Cancel restores the read-only view.
    const cancelButtons = screen.getAllByRole("button", { name: /cancel edits/i });
    fireEvent.click(cancelButtons[0]);
    expect(screen.queryByRole("textbox", { name: /launch angle/i })).toBeNull();
  });

  it("share-link trigger appears, and the popover surfaces the public URL when a token is present", () => {
    hoisted.project.activeShareToken = "share-token-abc";
    renderWorkspace();

    const trigger = screen.getByRole("button", {
      name: /manage public share link/i,
    });
    expect(trigger).toBeInTheDocument();
    fireEvent.click(trigger);

    // With a token present, the popover renders the public URL input and
    // a "Copy share URL" button.
    const urlInput = screen.getByLabelText(/public share url/i);
    expect(urlInput).toBeInTheDocument();
    expect((urlInput as HTMLInputElement).value).toContain("share-token-abc");
    expect(
      screen.getByRole("button", { name: /copy share url/i }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------
  // Live progress panel — covers the new job-polling code path that
  // useGetGenerationJob + the inflightJob localStorage key drive.
  // -------------------------------------------------------------------

  it("renders the progress bar, step text, and counter when the job is running", () => {
    hoisted.jobState.current = {
      id: "job-running-1",
      data: {
        id: "job-running-1",
        projectId: "p1",
        status: "running",
        progressTotal: 11,
        progressDone: 5,
        currentStep: "Generating image 5/11",
        errorMessage: null,
        startedAt: NOW_LOCAL,
        completedAt: null,
        createdAt: NOW_LOCAL,
        updatedAt: NOW_LOCAL,
      },
    };

    renderWorkspace();

    expect(
      screen.getByRole("progressbar", { name: /generation progress/i }),
    ).toBeInTheDocument();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Generating image 5/11");
    expect(status).toHaveAttribute("aria-live", "polite");

    // 5/11 → 45% rounded.
    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.getByText("5 / 11")).toBeInTheDocument();

    expect(
      screen.queryByText("Compress your chaos into a launch."),
    ).not.toBeInTheDocument();
    expect(storage.getInflightJob).toHaveBeenCalledWith(SLUG);
  });

  it("when no inflight jobId is stored, the live-progress panel never renders", () => {
    expect(hoisted.jobState.current).toBeNull();

    renderWorkspace();

    expect(storage.getInflightJob).toHaveBeenCalledWith(SLUG);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/compressing your chaos/i)).not.toBeInTheDocument();
    expect(
      screen.getByText("Compress your chaos into a launch."),
    ).toBeInTheDocument();
  });

  it("transitions running → succeeded: invalidates the project query and reveals the card layout", async () => {
    const jobId = "job-succeeded-1";
    hoisted.jobState.current = {
      id: jobId,
      data: {
        id: jobId,
        projectId: "p1",
        status: "running",
        progressTotal: 11,
        progressDone: 8,
        currentStep: "Generating image 8/11",
        errorMessage: null,
        startedAt: NOW_LOCAL,
        completedAt: null,
        createdAt: NOW_LOCAL,
        updatedAt: NOW_LOCAL,
      },
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { rerenderInPlace } = renderWorkspace(queryClient);

    expect(
      screen.getByRole("progressbar", { name: /generation progress/i }),
    ).toBeInTheDocument();
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Flip running → succeeded and rerender in place so the
    // jobData?.status effect fires for real.
    hoisted.jobState.current = {
      id: jobId,
      data: {
        id: jobId,
        projectId: "p1",
        status: "succeeded",
        progressTotal: 11,
        progressDone: 11,
        currentStep: "Done",
        errorMessage: null,
        startedAt: NOW_LOCAL,
        completedAt: NOW_LOCAL,
        createdAt: NOW_LOCAL,
        updatedAt: NOW_LOCAL,
      },
    };
    rerenderInPlace();

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", SLUG],
      });
    });
    expect(storage.clearInflightJob).toHaveBeenCalledWith(SLUG);

    await waitFor(() => {
      expect(
        screen.getByText("Compress your chaos into a launch."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("on a failed job, renders the Launch aborted alert and clamps an overlong errorMessage to 400 chars", async () => {
    // 600+ char message; component does errorMessage.slice(0, 400).
    const longMessage =
      "FATAL: " +
      "Upstream OpenAI threw a 500 with an enormous stack trace. ".repeat(20);
    expect(longMessage.length).toBeGreaterThan(400);
    const expectedClamped = longMessage.slice(0, 400);
    const expectedDropped = longMessage.slice(400);
    expect(expectedDropped.length).toBeGreaterThan(0);

    const job: JobMock = {
      id: "job-failed-1",
      data: {
        id: "job-failed-1",
        projectId: "p1",
        status: "failed",
        progressTotal: 0,
        progressDone: 0,
        currentStep: "Failed",
        errorMessage: longMessage,
        startedAt: NOW_LOCAL,
        completedAt: NOW_LOCAL,
        createdAt: NOW_LOCAL,
        updatedAt: NOW_LOCAL,
      },
    };
    hoisted.jobState.current = job;

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByText(/launch aborted/i)).toBeInTheDocument();
    });

    // Match by text content (not DOM structure) so markup refactors
    // do not break the assertion.
    const bodyNode = screen.getByText(
      (_content, node) =>
        node?.tagName === "P" &&
        (node.textContent ?? "").startsWith(expectedClamped.slice(0, 32)),
    );
    expect(bodyNode.textContent).toBe(expectedClamped);
    expect(bodyNode.textContent!.length).toBe(400);
    expect(screen.queryByText(expectedDropped)).toBeNull();

    expect(storage.clearInflightJob).toHaveBeenCalledWith(SLUG);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
