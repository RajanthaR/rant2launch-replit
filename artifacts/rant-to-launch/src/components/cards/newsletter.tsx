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
// Section: Newsletter blurb
// =====================================================================

export function NewsletterSection({ slug, card }: SectionProps) {
  const regen = useRegenSection(
    slug,
    AssetCardKind.newsletter_blurb,
    card.updatedAt,
  );
  const undo = useUndoSection(slug, card);
  const text = asString((card.content as { text?: unknown }).text);
  const editor = useCardEditor<{ text: string }>({
    slug,
    card,
    toDraft: (c) => ({ text: asString((c as { text?: unknown }).text) }),
    toContent: (d) => ({ text: d.text }),
    validate: (d) =>
      d.text.trim().length === 0
        ? { field: "text", message: "Newsletter blurb can't be empty." }
        : null,
  });

  const markdown = cardSectionMarkdown(card);
  const textErr = fieldErrorBinding(
    editor.fieldError("text"),
    "newsletter-text-error",
  );

  return (
    <CardShell
      meta={SECTION_META[AssetCardKind.newsletter_blurb]}
      updatedAt={card.updatedAt}
      isSaving={editor.isSaving}
      isRegenerating={regen.isPending}
      isUndoing={undo.isPending}
      swapKey={regen.swapKey}
      toolbar={
        <SectionToolbar
          editor={editor}
          copyText={text}
          markdown={markdown}
          regen={regen}
          undo={undo}
        />
      }
    >
      <Card className="rounded-none border-border bg-card">
        <CardContent className="p-6">
          {editor.editing ? (
            <>
              <Textarea
                value={editor.draft.text}
                onChange={(e) => editor.setDraft({ text: e.target.value })}
                className="rounded-none leading-relaxed min-h-[240px]"
                aria-label="Newsletter blurb"
                {...textErr.attrs}
              />
              {textErr.node}
            </>
          ) : (
            <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
          )}
        </CardContent>
      </Card>
    </CardShell>
  );
}
