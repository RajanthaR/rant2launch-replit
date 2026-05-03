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
// Section: X thread
// =====================================================================

export function XThreadSection({ slug, card }: SectionProps) {
  const regen = useRegenSection(slug, AssetCardKind.x_thread, card.updatedAt);
  const undo = useUndoSection(slug, card);
  const tweets = asStringArray((card.content as { tweets?: unknown }).tweets);
  const editor = useCardEditor<{ tweets: string[] }>({
    slug,
    card,
    toDraft: (c) => ({
      tweets: asStringArray((c as { tweets?: unknown }).tweets),
    }),
    toContent: (d) => ({
      tweets: d.tweets.map((t) => t.trim()).filter((t) => t.length > 0),
    }),
    validate: (d) => {
      const cleaned = d.tweets.map((t) => t.trim()).filter((t) => t.length > 0);
      if (cleaned.length < 5 || cleaned.length > 7) {
        return {
          field: "_tweets",
          message: "X thread needs between 5 and 7 non-empty tweets.",
        };
      }
      // Walk the original draft (not the cleaned copy) so the field key
      // points at the actual textarea index the founder is staring at.
      const tooLongIdx = d.tweets.findIndex((t) => t.length > 280);
      if (tooLongIdx >= 0) {
        return {
          field: `tweet-${tooLongIdx}`,
          message: `Tweet ${tooLongIdx + 1} is over 280 characters.`,
        };
      }
      return null;
    },
  });

  const markdown = cardSectionMarkdown(card);
  const sectionErr = editor.fieldError("_tweets");

  return (
    <CardShell
      meta={SECTION_META[AssetCardKind.x_thread]}
      updatedAt={card.updatedAt}
      isSaving={editor.isSaving}
      isRegenerating={regen.isPending}
      isUndoing={undo.isPending}
      swapKey={regen.swapKey}
      toolbar={
        <SectionToolbar
          editor={editor}
          copyText={tweets.join("\n\n")}
          copyLabel="Copy thread"
          markdown={markdown}
          regen={regen}
          undo={undo}
        />
      }
    >
      <>
        {editor.editing && (
          <SectionError message={sectionErr} id="x-thread-section-error" />
        )}
        <div className="space-y-4 pl-4 border-l-2 border-border">
          {(editor.editing ? editor.draft.tweets : tweets).map((tweet, i) => {
            const tweetErr = editor.editing
              ? fieldErrorBinding(
                  editor.fieldError(`tweet-${i}`),
                  `x-thread-tweet-${i}-error`,
                )
              : { attrs: {}, node: null };
            return (
              <div key={i} className="relative">
                <div className="absolute -left-[25px] top-2 w-3 h-3 rounded-full bg-background border-2 border-primary" />
                <Card className="rounded-none border-border bg-card">
                  <CardContent className="p-4">
                    {editor.editing ? (
                      <div className="space-y-1">
                        <Textarea
                          value={tweet}
                          onChange={(e) => {
                            const next = [...editor.draft.tweets];
                            next[i] = e.target.value;
                            editor.setDraft({ tweets: next });
                          }}
                          className="rounded-none text-sm sm:text-base min-h-[80px]"
                          aria-label={`Tweet ${i + 1}`}
                          {...tweetErr.attrs}
                        />
                        <p
                          className={`text-[10px] font-mono text-right ${tweet.length > 280 ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {tweet.length} / 280
                        </p>
                        {tweetErr.node}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm sm:text-base">
                        {tweet}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      </>
    </CardShell>
  );
}
