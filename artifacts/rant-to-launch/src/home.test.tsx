import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import Home from "@/pages/home";

vi.mock("@workspace/api-client-react", () => ({
  useCreateProject: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    reset: vi.fn(),
  }),
  useDeleteProject: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  getGetProjectQueryKey: (slug: string) => ["projects", slug],
  ErrorResponse: {},
}));

vi.mock("@/lib/storage", () => ({
  getRecentProjects: () => [],
  saveRecentProject: vi.fn(),
  removeRecentProject: vi.fn(),
}));

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <Home />
      </Router>
    </QueryClientProvider>,
  );
}

describe("Home page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing and shows the brand name", () => {
    renderHome();
    expect(screen.getByText("RANT-TO-LAUNCH")).toBeInTheDocument();
  });

  it("submit button is disabled when the rant textarea is empty", () => {
    renderHome();
    const button = screen.getByRole("button", { name: /make it shippable/i });
    expect(button).toBeDisabled();
  });

  it("submit button becomes enabled once text is entered", () => {
    renderHome();
    const textarea = screen.getByRole("textbox", {
      name: /rant or transcript/i,
    });
    fireEvent.change(textarea, { target: { value: "Here is my rant" } });
    const button = screen.getByRole("button", { name: /make it shippable/i });
    expect(button).not.toBeDisabled();
  });

  it("each channel toggle flips its aria-checked state when clicked", () => {
    renderHome();
    const toggles = screen.getAllByRole("checkbox");
    expect(toggles).toHaveLength(4);

    for (const toggle of toggles) {
      // All start checked (DEFAULT_CHANNELS includes all four)
      expect(toggle).toHaveAttribute("aria-checked", "true");
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-checked", "false");
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-checked", "true");
    }
  });
});
