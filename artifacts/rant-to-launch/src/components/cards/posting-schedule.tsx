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
  POSTING_SCHEDULE_SLOTS,
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
// Section: Posting schedule
// =====================================================================

export function PostingScheduleSection({ slug, card }: SectionProps) {
  const regen = useRegenSection(
    slug,
    AssetCardKind.posting_schedule,
    card.updatedAt,
  );
  const undo = useUndoSection(slug, card);
  const entries = asScheduleEntries(
    (card.content as { entries?: unknown }).entries,
  );
  const editor = useCardEditor<{ entries: ScheduleEntry[] }>({
    slug,
    card,
    // The editor draft is ALWAYS exactly 7 entries with the canonical
    // launch-day slot labels, regardless of what's persisted (so the
    // editor can render slot labels as fixed, non-editable headers).
    // Platform/content are preserved by index. Saving therefore
    // migrates legacy "Day 1..Day 7" cards to the new shape.
    toDraft: (c) => ({
      entries: normalizeScheduleDraft(
        asScheduleEntries((c as { entries?: unknown }).entries),
      ),
    }),
    toContent: (d) => ({
      entries: d.entries.map((e, i) => ({
        // Force canonical slot label on save — the input never lets the
        // user change it, but this is the defensive write.
        day: POSTING_SCHEDULE_SLOTS[i] ?? e.day,
        platform: e.platform,
        content: e.content,
      })),
    }),
    validate: (d) => {
      if (d.entries.length !== 7) {
        return {
          field: "_entries",
          message: "Launch-day plan needs exactly 7 slots.",
        };
      }
      for (const [i, e] of d.entries.entries()) {
        const expectedSlot = POSTING_SCHEDULE_SLOTS[i] ?? "";
        if (e.day.trim() !== expectedSlot) {
          // Defensive: editor draft is always normalized, so this should
          // never fire — but if it does, surface it on the section banner
          // rather than 500ing on the server.
          return {
            field: "_entries",
            message: `Slot ${i + 1} must be labeled "${expectedSlot}".`,
          };
        }
        if (!e.platform.trim()) {
          return {
            field: `entry-${i}-platform`,
            message: `${expectedSlot}: pick a platform.`,
          };
        }
        if (!e.content.trim()) {
          return {
            field: `entry-${i}-content`,
            message: `${expectedSlot}: write the post content.`,
          };
        }
      }
      return null;
    },
  });

  const visibleEntries = editor.editing ? editor.draft.entries : entries;
  const markdown = cardSectionMarkdown(card);
  const scheduleSectionErr = editor.fieldError("_entries");

  const update = (idx: number, patch: Partial<ScheduleEntry>) => {
    const next = [...editor.draft.entries];
    next[idx] = { ...next[idx]!, ...patch };
    editor.setDraft({ entries: next });
  };

  // "Copy plan" — labeled block, one slot per paragraph. Reads cleanly
  // when pasted into a doc or DM. Uses the read-mode entries (whatever
  // labels are on disk) so old "Day 1.." cards still copy verbatim
  // until they're saved/regenerated.
  const copyPlanText = entries
    .map((s) => {
      const slot = s.day.trim() || "—";
      const platform = s.platform.trim();
      const head = platform ? `${slot} — ${platform}` : slot;
      return s.content.trim() ? `${head}: ${s.content.trim()}` : head;
    })
    .join("\n\n");

  return (
    <CardShell
      meta={SECTION_META[AssetCardKind.posting_schedule]}
      updatedAt={card.updatedAt}
      isSaving={editor.isSaving}
      isRegenerating={regen.isPending}
      isUndoing={undo.isPending}
      swapKey={regen.swapKey}
      toolbar={
        <SectionToolbar
          editor={editor}
          copyText={copyPlanText}
          copyLabel="Copy plan"
          markdown={markdown}
          regen={regen}
          undo={undo}
        />
      }
    >
      <div className="space-y-4">
        {editor.editing && (
          <SectionError
            message={scheduleSectionErr}
            id="schedule-section-error"
          />
        )}
        {visibleEntries.map((entry, i) => {
          // Slot label is fixed (rendered as a static header), so there's
          // no day input to attach validation to. Slot/count errors land
          // on the section banner above.
          const platformErr = editor.editing
            ? fieldErrorBinding(
                editor.fieldError(`entry-${i}-platform`),
                `schedule-entry-${i}-platform-error`,
              )
            : { attrs: {}, node: null };
          const contentErr = editor.editing
            ? fieldErrorBinding(
                editor.fieldError(`entry-${i}-content`),
                `schedule-entry-${i}-content-error`,
              )
            : { attrs: {}, node: null };
          return (
            <Card
              key={i}
              className="rounded-none border-border bg-card overflow-hidden flex flex-col sm:flex-row"
            >
              <div className="bg-muted p-4 sm:w-40 border-b sm:border-b-0 sm:border-r border-border flex flex-row sm:flex-col items-center justify-between sm:justify-center gap-2">
                <span
                  className="font-bold font-serif text-base sm:text-lg leading-tight text-center"
                  title={entry.day}
                >
                  {entry.day}
                </span>
                {editor.editing ? (
                  <div className="w-full">
                    <Input
                      value={entry.platform}
                      onChange={(e) => update(i, { platform: e.target.value })}
                      placeholder="Platform"
                      className="rounded-none h-7 text-[10px] font-mono w-full"
                      aria-label={`${entry.day} platform`}
                      {...platformErr.attrs}
                    />
                    {platformErr.node}
                  </div>
                ) : (
                  <span className="text-[10px] font-mono bg-background px-2 py-1 border border-border mt-0 sm:mt-2 text-muted-foreground uppercase">
                    {entry.platform}
                  </span>
                )}
              </div>
              <div className="p-4 flex-1 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                {editor.editing ? (
                  <div className="flex-1">
                    <Textarea
                      value={entry.content}
                      onChange={(e) => update(i, { content: e.target.value })}
                      placeholder="Post content"
                      className="rounded-none text-sm sm:text-base flex-1 min-h-[80px] w-full"
                      aria-label={`${entry.day} content`}
                      {...contentErr.attrs}
                    />
                    {contentErr.node}
                  </div>
                ) : (
                  <>
                    <p className="text-sm sm:text-base">{entry.content}</p>
                    <CopyButton
                      text={`${entry.day} | ${entry.platform}\n\n${entry.content}`}
                      className="shrink-0 print:hidden"
                    />
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </CardShell>
  );
}
