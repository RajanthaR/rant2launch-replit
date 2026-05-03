import { type ReactElement } from "react";
import {
  AssetCardKind,
  type AssetCard,
  type GenerationJob,
  type ProjectDetail,
} from "@workspace/api-client-react";
import {
  CarouselSection,
  LandingPageSection,
  LaunchAngleSection,
  LinkedInSection,
  NewsletterSection,
  PostingScheduleSection,
  SourceRantSection,
  StoryboardSection,
  XThreadSection,
} from "@/components/cards";
import { type CardsByKind, type NavEntry } from "@/lib/workspace-utils";
import { WorkspaceHeader } from "./header";
import { DesktopNavRail, MobileNavBar } from "./nav";
import {
  EmptyProjectView,
  GenerationProgressView,
  GenericRunningView,
  LaunchAbortedView,
  LoadingProjectView,
  ProjectNotFoundView,
} from "./states";

export function WorkspaceBody({
  slug,
  data,
  isLoading,
  isError,
  error,
  cards,
  sourceInput,
  presentCardCount,
  lastUpdated,
  navEntries,
  activeAnchor,
  jobData,
  jobSucceeded,
  failedJobMessage,
  isCopyingAll,
  onExport,
  onCopyAll,
  onPrint,
  onRequestDelete,
}: {
  slug: string;
  data: ProjectDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  cards: CardsByKind;
  sourceInput: ProjectDetail["sourceInputs"][number] | undefined;
  presentCardCount: number;
  lastUpdated: string | null;
  navEntries: NavEntry[];
  activeAnchor: string | null;
  jobData: GenerationJob | undefined;
  jobSucceeded: boolean;
  failedJobMessage: string | null;
  isCopyingAll: boolean;
  onExport: () => void;
  onCopyAll: () => void;
  onPrint: () => void;
  onRequestDelete: () => void;
}) {
  const jobInProgress =
    (jobData &&
      (jobData.status === "queued" || jobData.status === "running")) ||
    jobSucceeded;

  if (jobInProgress) {
    return (
      <GenerationProgressView jobData={jobData} jobSucceeded={jobSucceeded} />
    );
  }

  if (failedJobMessage !== null) {
    return <LaunchAbortedView message={failedJobMessage} />;
  }

  if (isLoading) {
    return <LoadingProjectView />;
  }

  if (isError || !data) {
    return (
      <ProjectNotFoundView
        message={
          (error as Error | undefined)?.message ??
          "This project doesn't exist or has been removed."
        }
      />
    );
  }

  const latestRun = data.runs[0];
  if (latestRun?.status === "error") {
    return (
      <LaunchAbortedView
        message={
          latestRun.errorMessage ??
          "Generation failed. Try again from the home page."
        }
      />
    );
  }

  if (latestRun?.status === "running" || latestRun?.status === "queued") {
    return <GenericRunningView />;
  }

  if (presentCardCount === 0 && !sourceInput) {
    return <EmptyProjectView />;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 animate-in fade-in duration-500">
      <WorkspaceHeader
        slug={slug}
        projectName={data.project.name || "Launch package"}
        cardCount={presentCardCount}
        lastUpdated={lastUpdated}
        activeShareToken={data.activeShareToken}
        onExport={onExport}
        onCopyAll={onCopyAll}
        isCopying={isCopyingAll}
        onPrint={onPrint}
        onRequestDelete={onRequestDelete}
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
}

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
