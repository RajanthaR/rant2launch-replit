import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  getGetGenerationJobQueryKey,
  getGetProjectQueryKey,
  useDeleteProject,
  useGetGenerationJob,
  useGetProject,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DeleteProjectDialog,
  useActiveAnchor,
  WorkspaceBody,
  WorkspaceTopBar,
} from "@/components/workspace";
import { useToast } from "@/hooks/use-toast";
import { downloadMarkdown, projectToMarkdown } from "@/lib/markdown";
import {
  buildNav,
  indexByKind,
  newestUpdatedAt,
  scrollToAnchor,
  SECTION_ORDER,
  type CardsByKind,
} from "@/lib/workspace-utils";
import {
  clearInflightJob,
  getInflightJob,
  removeRecentProject,
} from "@/lib/storage";

const isJobTerminal = (status: string) =>
  status === "succeeded" || status === "failed";

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

  const [inflightJobId, setInflightJobId] = useState<string | null>(() =>
    getInflightJob(slug),
  );

  // Keep the progress panel visible after a job succeeds until the
  // invalidated project query returns fresh cards, avoiding a spinner flash.
  const [jobSucceeded, setJobSucceeded] = useState(false);
  const [failedJobMessage, setFailedJobMessage] = useState<string | null>(null);

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

  useEffect(() => {
    if (!jobData) return;
    if (jobData.status === "succeeded") {
      clearInflightJob(slug);
      setJobSucceeded(true);
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(slug) });
    } else if (jobData.status === "failed") {
      const msg = (
        jobData.errorMessage ??
        "Generation failed. Try again from the home page."
      ).slice(0, 400);
      setFailedJobMessage(msg);
      clearInflightJob(slug);
      setInflightJobId(null);
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(slug) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobData?.status]);

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
            description: projectName
              ? `"${projectName}" was removed.`
              : "Project removed.",
          });
          setConfirmDelete(false);
          setLocation("/");
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: "Couldn't delete project",
            description:
              err instanceof Error ? err.message : "Try again in a moment.",
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

  // Honor deep links after cards arrive; the browser's native hash-on-load
  // can run before async project data has rendered the target section.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!data || data.assetCards.length === 0) return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const id = window.requestAnimationFrame(() => scrollToAnchor(hash));
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

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <WorkspaceTopBar projectName={data?.project.name} />
      <main className="flex-1 overflow-y-auto">
        <WorkspaceBody
          slug={slug}
          data={data}
          isLoading={isLoading}
          isError={isError}
          error={error}
          cards={cards}
          sourceInput={sourceInput}
          presentCardCount={presentCardCount}
          lastUpdated={lastUpdated}
          navEntries={navEntries}
          activeAnchor={activeAnchor}
          jobData={jobData}
          jobSucceeded={jobSucceeded}
          failedJobMessage={failedJobMessage}
          isCopyingAll={isCopyingAll}
          onExport={handleExport}
          onCopyAll={handleCopyAll}
          onPrint={handlePrint}
          onRequestDelete={() => setConfirmDelete(true)}
        />
      </main>

      <DeleteProjectDialog
        open={confirmDelete}
        projectName={projectName}
        isPending={deleteProject.isPending}
        onOpenChange={(open) => {
          if (!open && !deleteProject.isPending) setConfirmDelete(false);
        }}
        onConfirm={handleDelete}
      />
    </div>
  );
}
