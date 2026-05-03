import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  useGetProject,
  useGetGenerationJob,
  getGetProjectQueryKey,
  getGetGenerationJobQueryKey,
  useCreateShareLink,
  useRevokeShareLink,
  useUpdateProject,
  useDeleteProject,
  type ShareLink,
} from "@workspace/api-client-react";
import type { AssetCard } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sparkles,
  Zap,
  AlertTriangle,
  Rocket,
  ArrowLeft,
  Download,
  FileCode,
  Printer,
  Share2,
  Copy,
  Check,
  Trash2,
  Pencil,
} from "lucide-react";
import { removeRecentProject, renameRecentProject, getInflightJob, clearInflightJob } from "@/lib/storage";
import {
  LaunchAngleSection,
  LandingPageSection,
  XThreadSection,
  LinkedInSection,
  NewsletterSection,
  CarouselSection,
  StoryboardSection,
  PostingScheduleSection,
  SourceRantSection,
  SECTION_META,
  SECTION_ORDER,
  SOURCE_RANT_ANCHOR,
} from "./card-sections";
import { useToast } from "@/hooks/use-toast";
import { downloadMarkdown, projectToMarkdown } from "@/lib/markdown";
import { AssetCardKind } from "@workspace/api-client-react";

// =====================================================================
// Workspace shell.
//
// The page renders every present asset card in a single vertical stack
// (no tabs), framed by a workspace summary header (project name,
// last-updated, card count, primary "Export to Markdown" + secondary
// "Copy all as Markdown") and a sticky anchor jump rail (sidebar on
// desktop, condensed bar on mobile).
//
// Section components own their own edit / save / cancel / regenerate
// state via hooks in card-sections.tsx. This page is purely the
// surrounding chrome plus the export wiring.
// =====================================================================

type CardsByKind = Partial<Record<AssetCard["kind"], AssetCard>>;

function indexByKind(cards: AssetCard[]): CardsByKind {
  const out: CardsByKind = {};
  for (const c of cards) {
    if (!out[c.kind]) out[c.kind] = c;
  }
  return out;
}

function newestUpdatedAt(cards: AssetCard[]): string | null {
  let best = 0;
  let iso: string | null = null;
  for (const c of cards) {
    const t = new Date(c.updatedAt).getTime();
    if (Number.isFinite(t) && t > best) {
      best = t;
      iso = c.updatedAt;
    }
  }
  return iso;
}

function formatHeaderTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const ts = new Date(iso);
  if (Number.isNaN(ts.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - ts.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return ts.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: ts.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/**
 * Returns the id of the section currently most visible in the viewport.
 * Used to highlight the active entry in the anchor nav rail.
 */
function useActiveAnchor(ids: readonly string[]): string | null {
  const key = ids.join("|");
  const [active, setActive] = useState<string | null>(ids[0] ?? null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (ids.length === 0) {
      setActive(null);
      return;
    }
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const visibility = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          visibility.set(e.target.id, e.intersectionRatio);
        }
        let bestId: string | null = null;
        let bestRatio = -1;
        for (const id of ids) {
          const r = visibility.get(id) ?? 0;
          if (r > bestRatio) {
            bestRatio = r;
            bestId = id;
          }
        }
        if (bestId && bestRatio > 0) setActive(bestId);
      },
      {
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
        rootMargin: "-120px 0px -55% 0px",
      },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // We re-run whenever the set of present ids changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return active;
}

interface NavEntry {
  anchorId: string;
  title: string;
  shortTitle: string;
  Icon: React.ComponentType<{ className?: string }>;
}

function buildNav(cards: CardsByKind, hasSource: boolean): NavEntry[] {
  const entries: NavEntry[] = [];
  for (const kind of SECTION_ORDER) {
    if (!cards[kind]) continue;
    const meta = SECTION_META[kind];
    entries.push({
      anchorId: meta.anchorId,
      title: meta.title,
      shortTitle: meta.shortTitle,
      Icon: meta.icon,
    });
  }
  if (hasSource) {
    entries.push({
      anchorId: SOURCE_RANT_ANCHOR,
      title: "Source rant",
      shortTitle: "Source",
      Icon: () => null,
    });
  }
  return entries;
}

function scrollToAnchor(anchorId: string) {
  const el = document.getElementById(anchorId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------------
// Workspace summary header — project name, freshness, card count, and
// the two markdown actions (download + copy).
// ---------------------------------------------------------------------

function WorkspaceHeader({
  slug,
  projectName,
  cardCount,
  lastUpdated,
  activeShareToken,
  onExport,
  onCopyAll,
  isCopying,
  onPrint,
  onRequestDelete,
}: {
  slug: string;
  projectName: string;
  cardCount: number;
  lastUpdated: string | null;
  activeShareToken: string | null;
  onExport: () => void;
  onCopyAll: () => void;
  isCopying: boolean;
  onPrint: () => void;
  onRequestDelete: () => void;
}) {
  const stamp = formatHeaderTimestamp(lastUpdated);
  return (
    <div className="border border-border bg-card mb-6 sm:mb-8">
      <div className="px-4 sm:px-6 py-5 sm:py-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3 sm:gap-3.5 min-w-0">
          <div className="w-10 h-10 sm:w-11 sm:h-11 shrink-0 bg-primary/20 text-primary flex items-center justify-center border border-primary/50">
            <Rocket className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <EditableProjectName slug={slug} projectName={projectName} />
            <p className="font-mono text-[10px] sm:text-xs uppercase tracking-widest text-muted-foreground/80 mt-1.5">
              {cardCount} card{cardCount === 1 ? "" : "s"}
              {stamp && (
                <>
                  <span className="mx-2 text-muted-foreground/40">/</span>
                  Updated {stamp}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:shrink-0 print:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={onCopyAll}
            disabled={isCopying}
            className="rounded-none border-border hover:border-primary/50 hover:bg-primary/10"
            aria-label="Copy entire launch package as Markdown"
          >
            <FileCode className="w-4 h-4 mr-2 text-muted-foreground" />
            {isCopying ? "Copying..." : "Copy Markdown"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            className="rounded-none border-border hover:border-primary/50 hover:bg-primary/10"
            aria-label="Download launch package as a Markdown file"
          >
            <Download className="w-4 h-4 mr-2 text-muted-foreground" />
            Export .md
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onPrint}
            className="rounded-none border-border hover:border-primary/50 hover:bg-primary/10"
            aria-label="Open the print dialog to save the launch package as a PDF"
          >
            <Printer className="w-4 h-4 mr-2 text-muted-foreground" />
            Download PDF
          </Button>
          <ShareLinkButton slug={slug} activeShareToken={activeShareToken} />
          <Button
            variant="outline"
            size="sm"
            onClick={onRequestDelete}
            data-testid="button-delete-project"
            aria-label="Delete this project"
            className="rounded-none border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Click-to-edit project name. Renders the heading inline; clicking it
// (or the pencil button) swaps in an input that submits on Enter or
// blur and reverts on Escape. PATCH /projects/:slug rewrites the name;
// the project detail query is invalidated and the local "recent"
// list is updated so the home page reflects the change.
// ---------------------------------------------------------------------

function EditableProjectName({
  slug,
  projectName,
}: {
  slug: string;
  projectName: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdateProject();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep the draft in sync when the upstream name changes (e.g. after
  // a server-side rename succeeds, or a fresh fetch swaps the name).
  useEffect(() => {
    if (!editing) setDraft(projectName);
  }, [projectName, editing]);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  const beginEdit = () => {
    setDraft(projectName);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(projectName);
    setEditing(false);
  };

  const commit = () => {
    const next = draft.trim();
    if (next.length === 0) {
      cancelEdit();
      return;
    }
    if (next === projectName) {
      setEditing(false);
      return;
    }
    if (next.length > 200) {
      toast({
        variant: "destructive",
        title: "Name too long",
        description: "Project names are capped at 200 characters.",
      });
      return;
    }
    update.mutate(
      { slug, data: { name: next } },
      {
        onSuccess: (project) => {
          renameRecentProject(slug, project.name);
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(slug) });
          setEditing(false);
          toast({ title: "Project renamed" });
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: "Couldn't rename project",
            description: err instanceof Error ? err.message : "Try again in a moment.",
          });
        },
      },
    );
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
          }}
          maxLength={200}
          disabled={update.isPending}
          aria-label="Project name"
          data-testid="input-project-name"
          className="rounded-none border-2 font-serif font-bold text-2xl sm:text-3xl h-auto py-1 px-2"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group/name">
      <button
        type="button"
        onClick={beginEdit}
        data-testid="button-edit-project-name"
        className="text-left min-w-0 cursor-text"
        aria-label="Rename project"
      >
        <h2 className="font-serif font-bold text-2xl sm:text-3xl tracking-tight leading-tight truncate hover:text-primary transition-colors">
          {projectName}
        </h2>
      </button>
      <button
        type="button"
        onClick={beginEdit}
        aria-label="Rename project"
        className="p-1 text-muted-foreground/60 hover:text-primary opacity-0 group-hover/name:opacity-100 focus:opacity-100 transition-opacity print:hidden"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Share-link control — popover-driven so the workspace header stays
// uncluttered. Mints, copies, and revokes the public read-only link.
// The current token is exposed by the project detail (activeShareToken)
// so the popover can show the existing URL on first open.
// ---------------------------------------------------------------------

function ShareLinkButton({
  slug,
  activeShareToken,
}: {
  slug: string;
  activeShareToken: string | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [latestLink, setLatestLink] = useState<ShareLink | null>(null);

  const create = useCreateShareLink();
  const revoke = useRevokeShareLink();

  // Build the public URL for an existing token using the current page
  // origin so the link always points at this deployment, even before a
  // freshly minted ShareLink (which carries the server's idea of the
  // URL) is in hand.
  const url = useMemo(() => {
    if (latestLink) return latestLink.url;
    if (activeShareToken && typeof window !== "undefined") {
      return `${window.location.origin}/share/${activeShareToken}`;
    }
    return null;
  }, [latestLink, activeShareToken]);

  const handleMint = () => {
    create.mutate(
      { slug },
      {
        onSuccess: (link) => {
          setLatestLink(link);
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(slug) });
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: "Couldn't create share link",
            description: err instanceof Error ? err.message : "Try again in a moment.",
          });
        },
      },
    );
  };

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Copy failed",
        description: err instanceof Error ? err.message : "Couldn't access the clipboard.",
      });
    }
  };

  const handleRevoke = () => {
    revoke.mutate(
      { slug },
      {
        onSuccess: () => {
          setLatestLink(null);
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(slug) });
          toast({ title: "Share link revoked", description: "The public URL no longer works." });
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: "Couldn't revoke",
            description: err instanceof Error ? err.message : "Try again in a moment.",
          });
        },
      },
    );
  };

  const hasLink = url !== null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          className="rounded-none"
          aria-label="Manage public share link"
        >
          <Share2 className="w-4 h-4 mr-2" />
          Share link
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] rounded-none p-4">
        <div className="space-y-3">
          <div>
            <h4 className="font-serif font-bold text-base">Public share link</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Anyone with the link gets a read-only view of the full launch package. Revoke any time.
            </p>
          </div>
          {hasLink ? (
            <>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={url ?? ""}
                  className="rounded-none font-mono text-xs h-9"
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Public share URL"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleCopy}
                  className="rounded-none shrink-0"
                  aria-label="Copy share URL"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-primary" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleRevoke}
                disabled={revoke.isPending}
                className="rounded-none w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {revoke.isPending ? "Revoking..." : "Revoke link"}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={handleMint}
              disabled={create.isPending}
              className="rounded-none w-full"
            >
              <Share2 className="w-4 h-4 mr-2" />
              {create.isPending ? "Creating..." : "Create share link"}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------
// Anchor nav — sticky sidebar on desktop, condensed sticky strip on
// mobile. Pure in-page scroll, no router.
// ---------------------------------------------------------------------

function DesktopNavRail({
  entries,
  activeId,
}: {
  entries: NavEntry[];
  activeId: string | null;
}) {
  if (entries.length === 0) return null;
  return (
    <nav
      aria-label="Launch package sections"
      className="sticky top-6 hidden lg:flex flex-col gap-1 border border-border bg-card p-3"
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground px-2 pt-1 pb-2">
        Sections
      </p>
      {entries.map((entry) => {
        const Icon = entry.Icon;
        const active = entry.anchorId === activeId;
        return (
          <button
            key={entry.anchorId}
            type="button"
            onClick={() => scrollToAnchor(entry.anchorId)}
            aria-current={active ? "true" : undefined}
            className={`group flex items-center gap-2 px-2 py-2 text-left text-sm font-mono transition-colors border-l-2 ${
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
            }`}
          >
            <Icon
              className={`w-3.5 h-3.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
            />
            <span className="truncate">{entry.title}</span>
          </button>
        );
      })}
    </nav>
  );
}

function MobileNavBar({
  entries,
  activeId,
}: {
  entries: NavEntry[];
  activeId: string | null;
}) {
  if (entries.length === 0) return null;
  return (
    <nav
      aria-label="Launch package sections"
      className="lg:hidden sticky top-0 z-10 -mx-4 sm:-mx-6 mb-4 bg-background/95 backdrop-blur border-b border-border"
    >
      <div className="overflow-x-auto">
        <div className="flex items-center gap-1 px-4 sm:px-6 py-2 min-w-max">
          {entries.map((entry) => {
            const active = entry.anchorId === activeId;
            return (
              <button
                key={entry.anchorId}
                type="button"
                onClick={() => scrollToAnchor(entry.anchorId)}
                aria-current={active ? "true" : undefined}
                className={`shrink-0 px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest border ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {entry.shortTitle}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

export default function ProjectWorkspace() {
  const params = useParams();
  const slug = params.slug as string;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [isCopyingAll, setIsCopyingAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteProject = useDeleteProject();

  const { data, isLoading, isError, error } = useGetProject(slug, {
    query: { queryKey: getGetProjectQueryKey(slug) },
  });

  // ---- Job polling ----
  const [inflightJobId, setInflightJobId] = useState<string | null>(() =>
    getInflightJob(slug),
  );

  // True once the job reports succeeded. We keep the progress panel visible
  // while this is true, then clear it atomically when project data arrives
  // with cards — avoiding any intermediate spinner flash.
  const [jobSucceeded, setJobSucceeded] = useState(false);

  // Preserve the failed-job error message so the failure UI stays visible
  // after inflightJobId is cleared (which would otherwise drop jobData).
  const [failedJobMessage, setFailedJobMessage] = useState<string | null>(null);

  const isJobTerminal = (status: string) =>
    status === "succeeded" || status === "failed";

  const { data: jobData } = useGetGenerationJob(inflightJobId ?? "", {
    query: {
      queryKey: getGetGenerationJobQueryKey(inflightJobId ?? ""),
      enabled: !!inflightJobId,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (!status || isJobTerminal(status)) return false;
        return 2000;
      },
    },
  });

  // React to job terminal events.
  useEffect(() => {
    if (!jobData) return;
    if (jobData.status === "succeeded") {
      // Clear localStorage so a refresh won't re-poll this job. Keep
      // inflightJobId alive so we continue showing the progress panel
      // at 100% until the project query re-fetches with fresh cards.
      clearInflightJob(slug);
      setJobSucceeded(true);
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(slug) });
    } else if (jobData.status === "failed") {
      // Snapshot the error message before clearing the query so the
      // failure alert stays visible after jobData drops.
      const msg = (
        jobData.errorMessage ?? "Generation failed. Try again from the home page."
      ).slice(0, 400);
      setFailedJobMessage(msg);
      clearInflightJob(slug);
      setInflightJobId(null);
      // Refresh project data so latestRun.status reflects the real outcome
      // rather than a stale queued/running value.
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(slug) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobData?.status]);

  // Once job succeeded AND the project query has returned fresh cards,
  // atomically drop the job state so the card layout renders without a flash.
  useEffect(() => {
    if (jobSucceeded && data && data.assetCards.length > 0) {
      setInflightJobId(null);
      setJobSucceeded(false);
    }
  }, [jobSucceeded, data]);

  const projectName = data?.project.name ?? "";

  const handleDelete = () => {
    deleteProject.mutate(
      { slug },
      {
        onSuccess: () => {
          removeRecentProject(slug);
          queryClient.removeQueries({ queryKey: getGetProjectQueryKey(slug) });
          toast({
            title: "Project deleted",
            description: projectName ? `"${projectName}" was removed.` : "Project removed.",
          });
          setConfirmDelete(false);
          setLocation("/");
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: "Couldn't delete project",
            description: err instanceof Error ? err.message : "Try again in a moment.",
          });
        },
      },
    );
  };

  const cards = useMemo<CardsByKind>(
    () => (data ? indexByKind(data.assetCards) : {}),
    [data],
  );
  const sourceInput = data?.sourceInputs[0];
  const presentCardCount = useMemo(
    () => SECTION_ORDER.reduce((n, k) => (cards[k] ? n + 1 : n), 0),
    [cards],
  );
  const lastUpdated = useMemo(
    () => (data ? newestUpdatedAt(data.assetCards) : null),
    [data],
  );

  const navEntries = useMemo(
    () => buildNav(cards, !!sourceInput),
    [cards, sourceInput],
  );
  const activeAnchor = useActiveAnchor(navEntries.map((e) => e.anchorId));

  // Honor `?…#section-id` deep links on cold load. The anchor click
  // handler does smooth-scroll on user click, but the browser's native
  // hash-on-load only works if the target exists at first paint —
  // and ours doesn't (cards render after the GET resolves). Run once
  // the cards are in the DOM (audit U4).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!data || data.assetCards.length === 0) return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    // Defer to the next frame so the just-rendered card is in the DOM.
    const id = window.requestAnimationFrame(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [data]);

  const handleExport = () => {
    if (!data) return;
    try {
      const md = projectToMarkdown(data);
      const filename = `${data.project.slug || "launch"}.md`;
      downloadMarkdown(filename, md);
      toast({
        title: "Markdown exported",
        description: `Downloaded ${filename}.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not export.";
      toast({
        variant: "destructive",
        title: "Export failed",
        description: message,
      });
    }
  };

  const handlePrint = () => {
    // window.print() picks up the @media print rules in index.css plus
    // the `print:hidden` Tailwind classes we sprinkle on chrome to
    // produce a stacked PDF of the full launch package. The browser's
    // print dialog handles the actual "Save as PDF" step.
    if (typeof window !== "undefined") window.print();
  };

  const handleCopyAll = async () => {
    if (!data) return;
    setIsCopyingAll(true);
    try {
      const md = projectToMarkdown(data);
      await navigator.clipboard.writeText(md);
      toast({
        title: "Markdown copied",
        description: "Full launch package on your clipboard.",
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not access the clipboard.";
      toast({
        variant: "destructive",
        title: "Copy failed",
        description: message,
      });
    } finally {
      setIsCopyingAll(false);
    }
  };

  const renderBody = () => {
    // Show the progress panel while the job is actively running OR while we
    // are waiting for the freshly-invalidated project query to land after
    // success (jobSucceeded=true keeps this branch active until cards arrive,
    // preventing an intermediate spinner flash).
    const jobInProgress =
      (jobData && (jobData.status === "queued" || jobData.status === "running")) ||
      jobSucceeded;

    if (jobInProgress) {
      const total = Math.max(0, jobData?.progressTotal ?? 0);
      const done = Math.min(Math.max(0, jobData?.progressDone ?? 0), total);
      const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : (jobSucceeded ? 100 : 0);
      const step = jobSucceeded
        ? "Finalizing your launch…"
        : (jobData?.currentStep ?? (jobData?.status === "queued" ? "Queued…" : "Working…"));
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-in fade-in duration-500 px-4">
          <div className="relative w-20 h-20 mx-auto mb-8">
            <div className="absolute inset-0 border-2 border-primary/20 rounded-full animate-ping" />
            <div className="absolute inset-0 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <Zap className="absolute inset-0 m-auto w-8 h-8 text-primary animate-pulse" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold font-serif mb-6">Compressing your chaos...</h2>
          <div className="w-full max-w-sm mx-auto space-y-3">
            <Progress
              value={pct}
              className="h-2 rounded-none"
              aria-label="Generation progress"
            />
            <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
              <span>{pct}%</span>
              {total > 0 && <span>{done} / {total}</span>}
            </div>
          </div>
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="mt-4 font-mono text-sm text-foreground/80"
          >
            {step}
          </p>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground/60">
            This can take a couple of minutes
          </p>
        </div>
      );
    }

    // Show the preserved failed-job error. This branch uses failedJobMessage
    // (captured before inflightJobId was cleared) so it stays stable even
    // after jobData becomes undefined.
    if (failedJobMessage !== null) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mb-6">
            <AlertTriangle className="w-10 h-10 text-destructive" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Launch aborted</h2>
          <p className="text-muted-foreground max-w-md mx-auto mb-6">{failedJobMessage}</p>
          <Link href="/">
            <Button variant="outline" className="rounded-none">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Try a new rant
            </Button>
          </Link>
        </div>
      );
    }

    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-in fade-in duration-500 px-4">
          <div className="relative w-32 h-32 mx-auto mb-8">
            <div className="absolute inset-0 border-2 border-primary/20 rounded-full animate-ping" />
            <div className="absolute inset-0 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <Zap className="absolute inset-0 m-auto w-12 h-12 text-primary animate-pulse" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold font-serif mb-2">Loading your launch...</h2>
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground/70">
            Hydrating your asset cards
          </p>
        </div>
      );
    }

    if (isError || !data) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mb-6">
            <AlertTriangle className="w-10 h-10 text-destructive" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Project not found</h2>
          <p className="text-muted-foreground max-w-md mx-auto mb-6">
            {(error as Error | undefined)?.message ?? "This project doesn't exist or has been removed."}
          </p>
          <Link href="/">
            <Button variant="outline" className="rounded-none">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to home
            </Button>
          </Link>
        </div>
      );
    }

    const latestRun = data.runs[0];
    if (latestRun?.status === "error") {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mb-6">
            <AlertTriangle className="w-10 h-10 text-destructive" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Launch aborted</h2>
          <p className="text-muted-foreground max-w-md mx-auto mb-6">
            {latestRun.errorMessage ?? "Generation failed. Try again from the home page."}
          </p>
          <Link href="/">
            <Button variant="outline" className="rounded-none">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Try a new rant
            </Button>
          </Link>
        </div>
      );
    }

    // Fallback for when there's no inflight job in localStorage but the run is
    // still in progress (e.g., different browser or cleared storage). Show a
    // generic spinner — no progress data available in this case.
    if (latestRun?.status === "running" || latestRun?.status === "queued") {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-in fade-in duration-500 px-4">
          <div className="relative w-32 h-32 mx-auto mb-8">
            <div className="absolute inset-0 border-2 border-primary/20 rounded-full animate-ping" />
            <div className="absolute inset-0 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <Zap className="absolute inset-0 m-auto w-12 h-12 text-primary animate-pulse" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold font-serif mb-2">Compressing your chaos...</h2>
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground/70">
            This can take a couple of minutes
          </p>
        </div>
      );
    }

    if (presentCardCount === 0 && !sourceInput) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center text-muted-foreground/70">
          <Rocket className="w-16 h-16 mb-4 opacity-30" />
          <p className="font-mono text-sm">No asset cards found for this project.</p>
        </div>
      );
    }

    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 animate-in fade-in duration-500">
        <WorkspaceHeader
          slug={slug}
          projectName={data.project.name || "Launch package"}
          cardCount={presentCardCount}
          lastUpdated={lastUpdated}
          activeShareToken={data.activeShareToken}
          onExport={handleExport}
          onCopyAll={handleCopyAll}
          isCopying={isCopyingAll}
          onPrint={handlePrint}
          onRequestDelete={() => setConfirmDelete(true)}
        />

        <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8 lg:items-start print-stack">
          <aside className="hidden lg:block print:hidden">
            <DesktopNavRail entries={navEntries} activeId={activeAnchor} />
          </aside>

          <div className="min-w-0">
            <div className="print:hidden">
              <MobileNavBar entries={navEntries} activeId={activeAnchor} />
            </div>
            <div className="flex flex-col gap-6 sm:gap-8">
              {renderSection(slug, AssetCardKind.launch_angle, cards)}
              {renderSection(slug, AssetCardKind.landing_page_copy, cards)}
              {renderSection(slug, AssetCardKind.x_thread, cards)}
              {renderSection(slug, AssetCardKind.linkedin_post, cards)}
              {renderSection(slug, AssetCardKind.newsletter_blurb, cards)}
              {renderSection(slug, AssetCardKind.carousel_outline, cards)}
              {renderSection(slug, AssetCardKind.storyboard_cards, cards)}
              {renderSection(slug, AssetCardKind.posting_schedule, cards)}
              {sourceInput && (
                <SourceRantSection
                  rawText={sourceInput.rawText}
                  createdAt={sourceInput.createdAt}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <header className="h-14 border-b border-border flex items-center justify-between px-4 sm:px-6 shrink-0 bg-background z-20 relative print:hidden">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-2 text-primary font-bold tracking-tight hover:opacity-80 transition-opacity"
          >
            <Zap className="w-5 h-5" />
            <span className="hidden sm:inline">RANT-TO-LAUNCH</span>
          </Link>
          {data?.project.name && (
            <>
              <span className="text-muted-foreground/50 mx-1">/</span>
              <span className="font-serif text-sm sm:text-base truncate">{data.project.name}</span>
            </>
          )}
        </div>
        <Link href="/">
          <Button
            variant="ghost"
            size="sm"
            className="font-mono text-xs uppercase tracking-wider hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            New launch
          </Button>
        </Link>
      </header>
      <main className="flex-1 overflow-y-auto">{renderBody()}</main>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!open && !deleteProject.isPending) setConfirmDelete(false);
        }}
      >
        <AlertDialogContent className="rounded-none border-2">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;<span className="font-bold text-foreground">{projectName || "This project"}</span>&rdquo;
              and every asset card it generated will be permanently removed. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none" disabled={deleteProject.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-delete-project"
              className="rounded-none bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteProject.isPending}
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
            >
              {deleteProject.isPending ? "Deleting..." : "Delete project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------
// Render the right section component for a given asset card kind. Kept
// in one place so the stack and the nav rail stay in lockstep.
// ---------------------------------------------------------------------

function renderSection(
  slug: string,
  kind: AssetCard["kind"],
  cards: CardsByKind,
): ReactElement | null {
  const card = cards[kind];
  if (!card) return null;
  switch (kind) {
    case AssetCardKind.launch_angle:
      return <LaunchAngleSection slug={slug} card={card} />;
    case AssetCardKind.landing_page_copy:
      return <LandingPageSection slug={slug} card={card} />;
    case AssetCardKind.x_thread:
      return <XThreadSection slug={slug} card={card} />;
    case AssetCardKind.linkedin_post:
      return <LinkedInSection slug={slug} card={card} />;
    case AssetCardKind.newsletter_blurb:
      return <NewsletterSection slug={slug} card={card} />;
    case AssetCardKind.carousel_outline:
      return <CarouselSection slug={slug} card={card} />;
    case AssetCardKind.storyboard_cards:
      return <StoryboardSection slug={slug} card={card} />;
    case AssetCardKind.posting_schedule:
      return <PostingScheduleSection slug={slug} card={card} />;
    default:
      return null;
  }
}
