import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetProjectQueryKey,
  useCreateShareLink,
  useRevokeShareLink,
  useUpdateProject,
  type ShareLink,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { renameRecentProject } from "@/lib/storage";
import { formatHeaderTimestamp } from "@/lib/workspace-utils";
import {
  Check,
  Copy,
  Download,
  FileCode,
  Pencil,
  Printer,
  Rocket,
  Share2,
  Trash2,
} from "lucide-react";

export function WorkspaceHeader({
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
          queryClient.invalidateQueries({
            queryKey: getGetProjectQueryKey(slug),
          });
          setEditing(false);
          toast({ title: "Project renamed" });
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: "Couldn't rename project",
            description:
              err instanceof Error ? err.message : "Try again in a moment.",
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
          queryClient.invalidateQueries({
            queryKey: getGetProjectQueryKey(slug),
          });
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: "Couldn't create share link",
            description:
              err instanceof Error ? err.message : "Try again in a moment.",
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
        description:
          err instanceof Error ? err.message : "Couldn't access the clipboard.",
      });
    }
  };

  const handleRevoke = () => {
    revoke.mutate(
      { slug },
      {
        onSuccess: () => {
          setLatestLink(null);
          queryClient.invalidateQueries({
            queryKey: getGetProjectQueryKey(slug),
          });
          toast({
            title: "Share link revoked",
            description: "The public URL no longer works.",
          });
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: "Couldn't revoke",
            description:
              err instanceof Error ? err.message : "Try again in a moment.",
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
            <h4 className="font-serif font-bold text-base">
              Public share link
            </h4>
            <p className="text-xs text-muted-foreground mt-1">
              Anyone with the link gets a read-only view of the full launch
              package. Revoke any time.
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
