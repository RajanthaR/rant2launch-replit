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
  Images,
  PenTool,
  Table2,
  LayoutGrid,
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
// Section: Storyboard
// =====================================================================

// Field metadata for the rich storyboard frame contract. Order matters —
// it drives both the inline-edit field order and the "Copy all" labeled
// block format. Keeping it as data avoids hand-repeating the six
// inputs/labels six times in the JSX below.
const STORYBOARD_FIELDS: ReadonlyArray<{
  key:
    | "hook"
    | "sourceMoment"
    | "visual"
    | "onScreenText"
    | "voiceover"
    | "cta";
  label: string;
  copyLabel: string;
  placeholder: string;
  multiline: boolean;
}> = [
  {
    key: "hook",
    label: "Hook",
    copyLabel: "Hook",
    placeholder: "One-line attention grab",
    multiline: false,
  },
  {
    key: "sourceMoment",
    label: "Source moment",
    copyLabel: "Source moment",
    placeholder:
      'e.g. 02:14 — "where I rant about onboarding" OR Section: opening hook',
    multiline: false,
  },
  {
    key: "visual",
    label: "Visual",
    copyLabel: "Visual",
    placeholder: "What the camera shows / B-roll",
    multiline: true,
  },
  {
    key: "onScreenText",
    label: "On-screen text",
    copyLabel: "On-screen text",
    placeholder: "Short text overlay (<= 8 words)",
    multiline: false,
  },
  {
    key: "voiceover",
    label: "Voiceover / caption",
    copyLabel: "Voiceover",
    placeholder: "1-2 spoken sentences",
    multiline: true,
  },
  {
    key: "cta",
    label: "CTA",
    copyLabel: "CTA",
    placeholder: 'e.g. "Tap the link in bio"',
    multiline: false,
  },
];

function storyboardCopyAll(frames: StoryboardFrame[]): string {
  return frames
    .map((f) => {
      const lines = [`Frame ${f.frame}`];
      for (const field of STORYBOARD_FIELDS) {
        lines.push(`${field.copyLabel}: ${f[field.key]}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

// Hook for the storyboard-only "Refresh images" action. Mirrors
// useRegenSection / useBackfillFaq: fires the mutation, splices the
// returned card into the project query cache so the section swaps in
// place with the new imageUrls, and surfaces a toast for success and
// failure. Only the per-frame `imageUrl` field changes; all storyboard
// text content is preserved server-side.
function useRefreshStoryboardImagesMutation(slug: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useRefreshStoryboardImages({
    mutation: {
      onSuccess: (updatedCard) => {
        const queryKey = getGetProjectQueryKey(slug);
        queryClient.setQueryData<ProjectDetail>(queryKey, (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            assetCards: prev.assetCards.map((c) =>
              c.id === updatedCard.id ? updatedCard : c,
            ),
          };
        });
        toast({
          title: "Storyboard images refreshed",
          description:
            "Generated new artwork for each frame using the current text — Undo to restore the previous images.",
        });
      },
      onError: (error) => {
        const message =
          (error as Error)?.message ?? "Could not refresh storyboard images.";
        toast({
          variant: "destructive",
          title: "Image refresh failed",
          description: message,
        });
      },
    },
  });
  return {
    refresh: () => mutation.mutate({ slug }),
    isPending: mutation.isPending,
  };
}

export function StoryboardSection({ slug, card }: SectionProps) {
  const regen = useRegenSection(
    slug,
    AssetCardKind.storyboard_cards,
    card.updatedAt,
  );
  const undo = useUndoSection(slug, card);
  const refreshImages = useRefreshStoryboardImagesMutation(slug);
  const frames = asStoryboardFrames(
    (card.content as { frames?: unknown }).frames,
  );
  const editor = useCardEditor<{ frames: StoryboardFrame[] }>({
    slug,
    card,
    toDraft: (c) => ({
      frames: asStoryboardFrames((c as { frames?: unknown }).frames),
    }),
    toContent: (d) => ({
      frames: d.frames.map((f) => ({
        frame: f.frame,
        hook: f.hook,
        sourceMoment: f.sourceMoment,
        visual: f.visual,
        onScreenText: f.onScreenText,
        voiceover: f.voiceover,
        cta: f.cta,
      })),
    }),
    validate: (d) => {
      for (const [i, f] of d.frames.entries()) {
        for (const field of STORYBOARD_FIELDS) {
          if (!f[field.key].trim()) {
            return {
              field: `frame-${i}-${field.key}`,
              message: `Frame ${i + 1} ${field.label.toLowerCase()} can't be empty.`,
            };
          }
        }
      }
      return null;
    },
  });

  const visibleFrames = editor.editing ? editor.draft.frames : frames;
  const markdown = cardSectionMarkdown(card);
  const [view, setView] = useState<"cards" | "table">("cards");
  // Editing always happens in the card grid (the inputs live there); the
  // shot-list table is a read-only filming reference, so flip back to cards
  // whenever an edit session starts.
  const effectiveView = editor.editing ? "cards" : view;

  return (
    <CardShell
      meta={SECTION_META[AssetCardKind.storyboard_cards]}
      updatedAt={card.updatedAt}
      isSaving={editor.isSaving}
      isRegenerating={regen.isPending || refreshImages.isPending}
      isUndoing={undo.isPending}
      swapKey={regen.swapKey}
      toolbar={
        <SectionToolbar
          editor={editor}
          copyText={storyboardCopyAll(frames)}
          copyLabel="Copy all"
          markdown={markdown}
          regen={regen}
          undo={undo}
          regenLabel="Regenerate (incl. images)"
          extraActions={
            !editor.editing ? (
              <Button
                variant="outline"
                size="sm"
                onClick={refreshImages.refresh}
                disabled={refreshImages.isPending || regen.isPending}
                aria-label="Refresh storyboard images using the current frame text"
                title="Re-run image generation only — keeps all frame text"
                className="rounded-none border-border hover:border-primary/50 hover:bg-primary/10 transition-colors"
              >
                {refreshImages.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin text-primary" />
                ) : (
                  <Images className="w-4 h-4 mr-2 text-muted-foreground" />
                )}
                <span
                  className={
                    refreshImages.isPending
                      ? "text-primary font-bold"
                      : "text-foreground"
                  }
                >
                  {refreshImages.isPending ? "Refreshing..." : "Refresh images"}
                </span>
              </Button>
            ) : null
          }
        />
      }
    >
      {!editor.editing && (
        <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {effectiveView === "cards"
              ? "Frame previews — best for review"
              : "Shot list — keep open while filming or print as a call sheet"}
          </p>
          <div
            role="tablist"
            aria-label="Storyboard view"
            className="inline-flex border border-border bg-muted/40"
          >
            <button
              type="button"
              role="tab"
              aria-selected={effectiveView === "cards"}
              onClick={() => setView("cards")}
              data-testid="button-storyboard-view-cards"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                effectiveView === "cards"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="w-3 h-3" />
              Cards
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveView === "table"}
              onClick={() => setView("table")}
              data-testid="button-storyboard-view-table"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border-l border-border transition-colors ${
                effectiveView === "table"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Table2 className="w-3 h-3" />
              Shot list
            </button>
          </div>
        </div>
      )}
      {effectiveView === "table" ? (
        <StoryboardShotList frames={visibleFrames} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleFrames.map((frame, i) => {
            const href = imageHref(frame.imageUrl);
            const updateField = (
              key: (typeof STORYBOARD_FIELDS)[number]["key"],
              value: string,
            ) => {
              const next = [...editor.draft.frames];
              next[i] = { ...next[i]!, [key]: value };
              editor.setDraft({ frames: next });
            };
            return (
              <Card
                key={i}
                className="rounded-none border-border bg-card overflow-hidden flex flex-col"
              >
                <div className="bg-muted px-4 py-2 border-b border-border font-mono text-xs font-bold text-muted-foreground flex items-center justify-between">
                  <span>Frame {frame.frame}</span>
                  {href && (
                    <span className="inline-flex items-center gap-3 print:hidden">
                      <CopyImageUrlButton
                        href={href}
                        label={`Copy frame ${frame.frame} image URL`}
                      />
                      <a
                        href={href}
                        download={downloadFilename("storyboard", frame.frame)}
                        className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                        aria-label={`Download frame ${frame.frame} image`}
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
                    className="block aspect-video bg-muted border-b border-border overflow-hidden"
                  >
                    <img
                      src={href}
                      alt={frame.voiceover || frame.hook || frame.visual}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  </a>
                ) : (
                  <div className="aspect-video bg-muted border-b border-border p-4 flex flex-col items-center justify-center text-center">
                    <PenTool className="w-6 h-6 text-muted-foreground mb-2 opacity-50" />
                    <p className="text-xs font-mono text-muted-foreground">
                      "{frame.visual}"
                    </p>
                  </div>
                )}
                <CardContent className="p-4 space-y-3">
                  {STORYBOARD_FIELDS.map((field) => {
                    const value = frame[field.key];
                    const errorBinding = editor.editing
                      ? fieldErrorBinding(
                          editor.fieldError(`frame-${i}-${field.key}`),
                          `storyboard-frame-${i}-${field.key}-error`,
                        )
                      : { attrs: {}, node: null };
                    return (
                      <div key={field.key} className="space-y-1">
                        <div className="flex min-h-7 items-center justify-between gap-2">
                          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                            {field.label}
                          </p>
                          {!editor.editing &&
                          field.key === "voiceover" &&
                          value.trim() ? (
                            <ListenButton
                              text={value}
                              label={`Listen to frame ${frame.frame} voiceover`}
                            />
                          ) : null}
                        </div>
                        {editor.editing ? (
                          <>
                            {field.multiline ? (
                              <Textarea
                                value={value}
                                onChange={(e) =>
                                  updateField(field.key, e.target.value)
                                }
                                placeholder={field.placeholder}
                                className="rounded-none text-sm min-h-[60px]"
                                aria-label={`Frame ${frame.frame} ${field.label.toLowerCase()}`}
                                data-testid={`input-storyboard-${i}-${field.key}`}
                                {...errorBinding.attrs}
                              />
                            ) : (
                              <Input
                                value={value}
                                onChange={(e) =>
                                  updateField(field.key, e.target.value)
                                }
                                placeholder={field.placeholder}
                                className="rounded-none text-sm"
                                aria-label={`Frame ${frame.frame} ${field.label.toLowerCase()}`}
                                data-testid={`input-storyboard-${i}-${field.key}`}
                                {...errorBinding.attrs}
                              />
                            )}
                            {errorBinding.node}
                          </>
                        ) : (
                          <p
                            className="text-sm whitespace-pre-wrap"
                            data-testid={`text-storyboard-${i}-${field.key}`}
                          >
                            {value || (
                              <span className="text-muted-foreground italic">
                                (empty — click Edit to fill in)
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </CardShell>
  );
}

// Compact, horizontal shot-list table for the storyboard. Lives next to
// the storyboard section so it can share STORYBOARD_FIELDS / column
// metadata without going through a public export. The table is the
// primary print target — see the `.shot-list-table` print rules in
// index.css for the printer-friendly layout.
export function StoryboardShotList({ frames }: { frames: StoryboardFrame[] }) {
  if (frames.length === 0) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        No frames yet — regenerate to populate the shot list.
      </p>
    );
  }
  const cellHead =
    "px-3 py-2 border border-border bg-muted/40 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground align-top";
  const cellBody =
    "px-3 py-2 border border-border align-top text-sm whitespace-pre-wrap break-words";
  return (
    <div className="overflow-x-auto">
      <table
        className="shot-list-table w-full border-collapse text-sm"
        data-testid="table-storyboard-shot-list"
      >
        <thead>
          <tr>
            <th scope="col" className={`${cellHead} w-[3.5rem]`}>
              #
            </th>
            <th scope="col" className={`${cellHead} w-[10rem]`}>
              Source moment
            </th>
            <th scope="col" className={cellHead}>
              Hook
            </th>
            <th scope="col" className={cellHead}>
              Visual
            </th>
            <th scope="col" className={cellHead}>
              On-screen text
            </th>
            <th scope="col" className={cellHead}>
              Voiceover
            </th>
            <th scope="col" className={`${cellHead} w-[8rem]`}>
              CTA
            </th>
          </tr>
        </thead>
        <tbody>
          {frames.map((frame, i) => {
            const empty = (v: string) =>
              v ? (
                <span>{v}</span>
              ) : (
                <span className="text-muted-foreground italic">—</span>
              );
            return (
              <tr key={i} data-testid={`row-storyboard-shot-${i}`}>
                <th
                  scope="row"
                  className={`${cellBody} font-mono text-xs font-bold text-muted-foreground bg-muted/20`}
                >
                  {frame.frame}
                </th>
                <td className={`${cellBody} font-mono text-xs`}>
                  {empty(frame.sourceMoment)}
                </td>
                <td className={`${cellBody} font-bold`}>{empty(frame.hook)}</td>
                <td className={cellBody}>{empty(frame.visual)}</td>
                <td className={cellBody}>{empty(frame.onScreenText)}</td>
                <td className={cellBody}>{empty(frame.voiceover)}</td>
                <td className={`${cellBody} font-mono text-xs`}>
                  {empty(frame.cta)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
