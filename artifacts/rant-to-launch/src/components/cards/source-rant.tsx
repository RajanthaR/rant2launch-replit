import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AssetCardKind,
  useBackfillLandingFaq,
  useRefreshStoryboardImages,
  getGetProjectQueryKey,
} from "@workspace/api-client-react";
import type { ProjectDetail } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Download,
  HelpCircle,
  Plus,
  Trash2,
  Quote,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cardSectionMarkdown } from "@/lib/markdown";
import {
  CardShell,
  CopyButton,
  CopyImageUrlButton,
  CopyMarkdownButton,
  ListenButton,
  SectionError,
  SectionToolbar,
  SOURCE_RANT_ANCHOR,
  SECTION_META,
  asCarouselSlides,
  asLandingPage,
  asScheduleEntries,
  asStoryboardFrames,
  asString,
  asStringArray,
  downloadFilename,
  fieldErrorBinding,
  formatTimestamp,
  imageHref,
  normalizeScheduleDraft,
  useCardEditor,
  useRegenSection,
  useUndoSection,
  type CarouselSlide,
  type LandingPage,
  type ScheduleEntry,
  type SectionProps,
  type StoryboardFrame,
  type ValidationError,
} from "./shared";

// =====================================================================
// Section: Source rant
//
// Read-only — uses the same shell so it sits in the stack alongside the
// editable cards and shares the anchor / nav rail behaviour.
// =====================================================================

export function SourceRantSection({
  rawText,
  createdAt,
}: {
  rawText: string;
  createdAt: string | null | undefined;
}) {
  return (
    <section
      id={SOURCE_RANT_ANCHOR}
      aria-labelledby={`${SOURCE_RANT_ANCHOR}-title`}
      className="scroll-mt-28 sm:scroll-mt-24"
    >
      <div className="border border-border bg-card">
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 shrink-0 bg-muted text-muted-foreground flex items-center justify-center border border-border">
              <Quote className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3
                id={`${SOURCE_RANT_ANCHOR}-title`}
                className="font-serif font-bold text-base sm:text-lg leading-tight truncate"
              >
                Source rant
              </h3>
              {createdAt && (
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Captured {formatTimestamp(createdAt)}
                </p>
              )}
            </div>
          </div>
        </header>
        <div className="px-4 sm:px-6 py-5 sm:py-6">
          <Card className="rounded-none border-border bg-background">
            <CardContent className="p-6">
              <p className="whitespace-pre-wrap leading-relaxed text-sm font-mono text-muted-foreground">
                {rawText}
              </p>
            </CardContent>
          </Card>
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 px-4 sm:px-6 py-3 border-t border-border bg-muted/20 print:hidden">
          <CopyButton text={rawText} label="Copy rant" />
        </footer>
      </div>
    </section>
  );
}
