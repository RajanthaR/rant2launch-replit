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
  PenTool,
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
// Section: Carousel outline
// =====================================================================

export function CarouselSection({ slug, card }: SectionProps) {
  const regen = useRegenSection(
    slug,
    AssetCardKind.carousel_outline,
    card.updatedAt,
  );
  const undo = useUndoSection(slug, card);
  const slides = asCarouselSlides(
    (card.content as { slides?: unknown }).slides,
  );
  const editor = useCardEditor<{ slides: CarouselSlide[] }>({
    slug,
    card,
    toDraft: (c) => ({
      slides: asCarouselSlides((c as { slides?: unknown }).slides),
    }),
    toContent: (d) => ({
      // Image URLs are server-owned and merged back in by the API.
      slides: d.slides.map((s) => ({
        slide: s.slide,
        headline: s.headline,
        body: s.body,
      })),
    }),
    validate: (d) => {
      for (const [i, s] of d.slides.entries()) {
        if (!s.headline.trim()) {
          return {
            field: `slide-${i}-headline`,
            message: `Slide ${i + 1} headline can't be empty.`,
          };
        }
        if (!s.body.trim()) {
          return {
            field: `slide-${i}-body`,
            message: `Slide ${i + 1} body can't be empty.`,
          };
        }
      }
      return null;
    },
  });

  const visibleSlides = editor.editing ? editor.draft.slides : slides;
  const markdown = cardSectionMarkdown(card);

  return (
    <CardShell
      meta={SECTION_META[AssetCardKind.carousel_outline]}
      updatedAt={card.updatedAt}
      isSaving={editor.isSaving}
      isRegenerating={regen.isPending}
      isUndoing={undo.isPending}
      swapKey={regen.swapKey}
      toolbar={
        <SectionToolbar
          editor={editor}
          copyText={slides
            .map(
              (s) =>
                `Slide ${s.slide}\nHeadline: ${s.headline}\nBody: ${s.body}`,
            )
            .join("\n\n")}
          copyLabel="Copy all"
          markdown={markdown}
          regen={regen}
          undo={undo}
          regenLabel="Regenerate (incl. images)"
        />
      }
    >
      <div className="grid sm:grid-cols-2 gap-4">
        {visibleSlides.map((slide, i) => {
          const href = imageHref(slide.imageUrl);
          const headlineErr = editor.editing
            ? fieldErrorBinding(
                editor.fieldError(`slide-${i}-headline`),
                `carousel-slide-${i}-headline-error`,
              )
            : { attrs: {}, node: null };
          const bodyErr = editor.editing
            ? fieldErrorBinding(
                editor.fieldError(`slide-${i}-body`),
                `carousel-slide-${i}-body-error`,
              )
            : { attrs: {}, node: null };
          return (
            <Card
              key={i}
              className="rounded-none border-border bg-card overflow-hidden flex flex-col"
            >
              <div className="bg-muted px-4 py-2 border-b border-border font-mono text-xs font-bold text-muted-foreground flex items-center justify-between">
                <span>Slide {slide.slide}</span>
                {href && (
                  <span className="inline-flex items-center gap-3 print:hidden">
                    <CopyImageUrlButton
                      href={href}
                      label={`Copy slide ${slide.slide} image URL`}
                    />
                    <a
                      href={href}
                      download={downloadFilename("carousel", slide.slide)}
                      className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                      aria-label={`Download slide ${slide.slide} image`}
                    >
                      <Download className="w-3 h-3" />
                      PNG
                    </a>
                  </span>
                )}
              </div>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block aspect-square bg-muted border-b border-border overflow-hidden"
                >
                  <img
                    src={href}
                    alt={slide.headline}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </a>
              ) : (
                <div className="aspect-square bg-muted border-b border-border flex flex-col items-center justify-center text-center p-4">
                  <PenTool className="w-6 h-6 text-muted-foreground mb-2 opacity-50" />
                  <p className="text-[11px] font-mono text-muted-foreground">
                    Image unavailable
                  </p>
                </div>
              )}
              <CardContent className="p-4 space-y-2">
                {editor.editing ? (
                  <>
                    <Input
                      value={slide.headline}
                      onChange={(e) => {
                        const next = [...editor.draft.slides];
                        next[i] = { ...next[i]!, headline: e.target.value };
                        editor.setDraft({ slides: next });
                      }}
                      placeholder="Headline"
                      className="rounded-none font-bold font-serif"
                      aria-label={`Slide ${slide.slide} headline`}
                      {...headlineErr.attrs}
                    />
                    {headlineErr.node}
                    <Textarea
                      value={slide.body}
                      onChange={(e) => {
                        const next = [...editor.draft.slides];
                        next[i] = { ...next[i]!, body: e.target.value };
                        editor.setDraft({ slides: next });
                      }}
                      placeholder="Body"
                      className="rounded-none text-sm text-muted-foreground"
                      aria-label={`Slide ${slide.slide} body`}
                      {...bodyErr.attrs}
                    />
                    {bodyErr.node}
                  </>
                ) : (
                  <>
                    <h5 className="font-bold font-serif">{slide.headline}</h5>
                    <p className="text-sm text-muted-foreground">
                      {slide.body}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </CardShell>
  );
}
