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
  type FaqEntry,
  type LandingFeature,
  type LandingPage,
  type ScheduleEntry,
  type SectionProps,
  type StoryboardFrame,
  type ValidationError,
} from "./shared";

// =====================================================================
// Section: Landing page
// =====================================================================

function landingToCopyText(p: LandingPage): string {
  const parts: string[] = [
    `Headline: ${p.headline}`,
    `Subheadline: ${p.subheadline}`,
    `CTA: ${p.cta}`,
    `Social Proof: ${p.socialProof}`,
    `Features:\n${p.features.map((f) => `- ${f.title}: ${f.description}`).join("\n")}`,
  ];
  if (p.faq.length > 0) {
    const faqLines = p.faq
      .map((f, i) => `${i + 1}. Q: ${f.question}\n   A: ${f.answer}`)
      .join("\n");
    parts.push(`FAQ:\n${faqLines}`);
  }
  return parts.join("\n\n");
}

const EMPTY_LANDING: LandingPage = {
  headline: "",
  subheadline: "",
  cta: "",
  features: [],
  socialProof: "",
  faq: [],
};

// FAQ-only backfill hook for legacy landing cards. Mirrors useRegenSection's
// onSuccess cache splice so the section swaps in place with the new FAQ
// without a full project refetch. The endpoint snapshots previousContent on
// the server so the same Undo button works after a backfill.
function useBackfillFaq(slug: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useBackfillLandingFaq({
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
          title: "FAQ added",
          description:
            "Generated 4 to 6 FAQ entries for this landing page — Undo to remove them.",
        });
      },
      onError: (error) => {
        const message =
          (error as Error)?.message ??
          "Could not generate FAQ for this landing page.";
        toast({
          variant: "destructive",
          title: "FAQ generation failed",
          description: message,
        });
      },
    },
  });
  return {
    backfill: () => mutation.mutate({ slug }),
    isPending: mutation.isPending,
  };
}

export function LandingPageSection({ slug, card }: SectionProps) {
  const regen = useRegenSection(
    slug,
    AssetCardKind.landing_page_copy,
    card.updatedAt,
  );
  const undo = useUndoSection(slug, card);
  const faqBackfill = useBackfillFaq(slug);
  const landing = asLandingPage(card.content) ?? EMPTY_LANDING;
  const editor = useCardEditor<LandingPage>({
    slug,
    card,
    toDraft: (c) => asLandingPage(c) ?? EMPTY_LANDING,
    // Strip faq when the founder removes every entry — keeps the persisted
    // content shape clean (no `faq: []` noise) and matches the lenient
    // PATCH validator on the server, which accepts an absent faq field.
    toContent: (d) => {
      const base: Record<string, unknown> = {
        headline: d.headline,
        subheadline: d.subheadline,
        cta: d.cta,
        features: d.features,
        socialProof: d.socialProof,
      };
      if (d.faq.length > 0) base.faq = d.faq;
      return base;
    },
    validate: (d) => {
      if (!d.headline.trim()) {
        return { field: "headline", message: "Headline is required." };
      }
      if (!d.subheadline.trim()) {
        return { field: "subheadline", message: "Subheadline is required." };
      }
      if (!d.cta.trim()) {
        return { field: "cta", message: "CTA is required." };
      }
      if (!d.socialProof.trim()) {
        return { field: "socialProof", message: "Social proof is required." };
      }
      if (d.features.length < 3 || d.features.length > 4) {
        return {
          field: "_features",
          message: "Landing page needs 3 or 4 features.",
        };
      }
      for (const [i, f] of d.features.entries()) {
        if (!f.title.trim()) {
          return {
            field: `feature-${i}-title`,
            message: `Feature ${i + 1} needs a title.`,
          };
        }
        if (!f.description.trim()) {
          return {
            field: `feature-${i}-description`,
            message: `Feature ${i + 1} needs a description.`,
          };
        }
      }
      // FAQ is optional overall (legacy compat) but if any entries exist,
      // enforce the same 4-6 count + non-empty Q/A rule the generator uses.
      if (d.faq.length > 0 && (d.faq.length < 4 || d.faq.length > 6)) {
        return {
          field: "_faq",
          message: "FAQ needs 4 to 6 entries (or remove all of them).",
        };
      }
      for (const [i, f] of d.faq.entries()) {
        if (!f.question.trim()) {
          return {
            field: `faq-${i}-question`,
            message: `FAQ ${i + 1} needs a question.`,
          };
        }
        if (!f.answer.trim()) {
          return {
            field: `faq-${i}-answer`,
            message: `FAQ ${i + 1} needs an answer.`,
          };
        }
      }
      return null;
    },
  });

  const headlineErr = fieldErrorBinding(
    editor.fieldError("headline"),
    "landing-headline-error",
  );
  const subheadlineErr = fieldErrorBinding(
    editor.fieldError("subheadline"),
    "landing-subheadline-error",
  );
  const ctaErr = fieldErrorBinding(
    editor.fieldError("cta"),
    "landing-cta-error",
  );
  const socialProofErr = fieldErrorBinding(
    editor.fieldError("socialProof"),
    "landing-social-proof-error",
  );
  const featuresSectionErr = editor.fieldError("_features");
  const faqSectionErr = editor.fieldError("_faq");

  const updateFeature = (idx: number, patch: Partial<LandingFeature>) => {
    editor.setDraft({
      ...editor.draft,
      features: editor.draft.features.map((f, i) =>
        i === idx ? { ...f, ...patch } : f,
      ),
    });
  };

  const updateFaq = (idx: number, patch: Partial<FaqEntry>) => {
    editor.setDraft({
      ...editor.draft,
      faq: editor.draft.faq.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    });
  };
  const addFaq = () => {
    if (editor.draft.faq.length >= 6) return;
    editor.setDraft({
      ...editor.draft,
      faq: [...editor.draft.faq, { question: "", answer: "" }],
    });
  };
  const removeFaq = (idx: number) => {
    editor.setDraft({
      ...editor.draft,
      faq: editor.draft.faq.filter((_, i) => i !== idx),
    });
  };

  const markdown = cardSectionMarkdown(card);
  const showFaq = editor.editing || landing.faq.length > 0;

  return (
    <CardShell
      meta={SECTION_META[AssetCardKind.landing_page_copy]}
      updatedAt={card.updatedAt}
      isSaving={editor.isSaving}
      isRegenerating={regen.isPending}
      isUndoing={undo.isPending}
      swapKey={regen.swapKey}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <SectionToolbar
            editor={editor}
            copyText={landingToCopyText(landing)}
            copyLabel="Copy all"
            markdown={markdown}
            regen={regen}
            undo={undo}
          />
          {/* Backfill FAQ — only shown for legacy landing cards (no FAQ yet)
              and only outside edit mode, so the founder doesn't trigger a
              regen mid-edit and lose draft state. Disabled while save/regen/
              undo is pending to shrink the race window where another
              landing mutation could land mid-FAQ-generation. The server
              also re-reads the card inside the final transaction so a
              concurrent edit can't be clobbered. The same Undo button
              applies after a backfill (server snapshots previousContent). */}
          {!editor.editing && landing.faq.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={faqBackfill.backfill}
              disabled={
                faqBackfill.isPending ||
                editor.isSaving ||
                regen.isPending ||
                undo.isPending
              }
              aria-label="Generate FAQ for this landing page"
              title="Generate 4-6 FAQ entries from your rant — keeps the rest of the landing copy as-is"
              className="rounded-none border-primary/20 hover:border-primary/50 hover:bg-primary/10 transition-colors"
            >
              {faqBackfill.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin text-primary" />
              ) : (
                <HelpCircle className="w-4 h-4 mr-2 text-muted-foreground" />
              )}
              <span
                className={
                  faqBackfill.isPending
                    ? "text-primary font-bold"
                    : "text-foreground"
                }
              >
                {faqBackfill.isPending ? "Generating FAQ..." : "Generate FAQ"}
              </span>
            </Button>
          )}
        </div>
      }
    >
      <Card className="border-border rounded-none overflow-hidden bg-background flex flex-col">
        {/* Browser chrome */}
        <div className="h-8 bg-muted border-b border-border flex items-center px-4 gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-border" />
            <div className="w-2.5 h-2.5 rounded-full bg-border" />
            <div className="w-2.5 h-2.5 rounded-full bg-border" />
          </div>
          <div className="ml-2 px-2 py-0.5 bg-background text-[10px] font-mono text-muted-foreground border border-border">
            launch.local
          </div>
        </div>

        {/* Block 1 — Hero */}
        <div className="p-8 sm:p-12 text-center border-b border-border bg-gradient-to-b from-muted/20 to-background space-y-4">
          {editor.editing ? (
            <>
              <label className="block text-left">
                <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-widest">
                  Headline
                </span>
                <Textarea
                  value={editor.draft.headline}
                  onChange={(e) =>
                    editor.setDraft({
                      ...editor.draft,
                      headline: e.target.value,
                    })
                  }
                  className="rounded-none text-2xl sm:text-4xl font-black font-serif text-center min-h-[80px] mt-2"
                  aria-label="Headline"
                  {...headlineErr.attrs}
                />
                {headlineErr.node}
              </label>
              <label className="block text-left">
                <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-widest">
                  Subheadline
                </span>
                <Textarea
                  value={editor.draft.subheadline}
                  onChange={(e) =>
                    editor.setDraft({
                      ...editor.draft,
                      subheadline: e.target.value,
                    })
                  }
                  className="rounded-none text-base sm:text-lg text-muted-foreground text-center mt-2"
                  aria-label="Subheadline"
                  {...subheadlineErr.attrs}
                />
                {subheadlineErr.node}
              </label>
              <label className="inline-block text-left">
                <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-widest">
                  CTA
                </span>
                <Input
                  value={editor.draft.cta}
                  onChange={(e) =>
                    editor.setDraft({ ...editor.draft, cta: e.target.value })
                  }
                  className="rounded-none h-12 px-8 text-base font-bold text-center mt-2"
                  aria-label="CTA"
                  {...ctaErr.attrs}
                />
                {ctaErr.node}
              </label>
            </>
          ) : (
            <>
              <h4 className="text-3xl sm:text-5xl font-black font-serif tracking-tight mb-6">
                {landing.headline}
              </h4>
              <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
                {landing.subheadline}
              </p>
              <Button
                size="lg"
                className="rounded-none h-12 px-8 text-base font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] transition-all"
              >
                {landing.cta}
              </Button>
            </>
          )}
        </div>

        {/* Block 2 — Proof strip. In edit mode the band is always shown so the
            founder can fill in social proof; in read mode it mirrors the
            read-only/share view and collapses when empty (legacy / malformed). */}
        {(editor.editing || landing.socialProof) && (
          <div className="px-6 py-4 bg-muted/40 border-b border-border text-center">
            {editor.editing ? (
              <label className="block text-left max-w-2xl mx-auto">
                <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-widest">
                  Social proof
                </span>
                <Input
                  value={editor.draft.socialProof}
                  onChange={(e) =>
                    editor.setDraft({
                      ...editor.draft,
                      socialProof: e.target.value,
                    })
                  }
                  placeholder='e.g. "Trusted by 1,200+ founders shipping this week"'
                  className="rounded-none mt-2 text-center"
                  aria-label="Social proof"
                  {...socialProofErr.attrs}
                />
                {socialProofErr.node}
              </label>
            ) : (
              <p className="text-xs font-mono uppercase text-muted-foreground tracking-widest">
                {landing.socialProof}
              </p>
            )}
          </div>
        )}

        {/* Block 3 — Features grid */}
        <div className="p-8 bg-card border-b border-border">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-6 text-center">
            Features
          </p>
          {editor.editing && (
            <SectionError
              message={featuresSectionErr}
              id="landing-features-error"
            />
          )}
          <div className="grid sm:grid-cols-2 gap-8">
            {(editor.editing ? editor.draft.features : landing.features).map(
              (feature, i) => {
                const titleErr = editor.editing
                  ? fieldErrorBinding(
                      editor.fieldError(`feature-${i}-title`),
                      `landing-feature-${i}-title-error`,
                    )
                  : { attrs: {}, node: null };
                const descErr = editor.editing
                  ? fieldErrorBinding(
                      editor.fieldError(`feature-${i}-description`),
                      `landing-feature-${i}-description-error`,
                    )
                  : { attrs: {}, node: null };
                return (
                  <div key={i} className="space-y-2">
                    <div className="w-8 h-8 bg-primary text-primary-foreground font-mono font-bold flex items-center justify-center text-sm mb-4">
                      0{i + 1}
                    </div>
                    {editor.editing ? (
                      <>
                        <Input
                          value={feature.title}
                          onChange={(e) =>
                            updateFeature(i, { title: e.target.value })
                          }
                          placeholder="Feature title"
                          className="rounded-none font-bold text-lg font-serif"
                          aria-label={`Feature ${i + 1} title`}
                          {...titleErr.attrs}
                        />
                        {titleErr.node}
                        <Textarea
                          value={feature.description}
                          onChange={(e) =>
                            updateFeature(i, { description: e.target.value })
                          }
                          placeholder="Feature description"
                          className="rounded-none text-sm text-muted-foreground leading-relaxed"
                          aria-label={`Feature ${i + 1} description`}
                          {...descErr.attrs}
                        />
                        {descErr.node}
                      </>
                    ) : (
                      <>
                        <h5 className="font-bold text-lg font-serif">
                          {feature.title}
                        </h5>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {feature.description}
                        </p>
                      </>
                    )}
                  </div>
                );
              },
            )}
          </div>
        </div>

        {/* Block 4 — Dedicated CTA band */}
        <div className="px-6 py-10 sm:py-12 bg-primary/5 border-b border-border text-center">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
            Ready when you are
          </p>
          <Button
            size="lg"
            className="rounded-none h-12 px-8 text-base font-bold pointer-events-none"
            tabIndex={-1}
          >
            {editor.editing ? editor.draft.cta || "Get started" : landing.cta}
          </Button>
        </div>

        {/* Block 5 — FAQ */}
        {showFaq && (
          <div className="p-8 bg-background">
            <div className="flex items-center gap-2 mb-6">
              <HelpCircle className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Frequently asked
              </p>
            </div>
            {editor.editing ? (
              <div className="space-y-4">
                <SectionError message={faqSectionErr} id="landing-faq-error" />
                {editor.draft.faq.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">
                    No FAQ entries yet. Add 4 to 6 to publish — or leave empty
                    to keep this block hidden.
                  </p>
                )}
                {editor.draft.faq.map((entry, i) => {
                  const qErr = fieldErrorBinding(
                    editor.fieldError(`faq-${i}-question`),
                    `landing-faq-${i}-question-error`,
                  );
                  const aErr = fieldErrorBinding(
                    editor.fieldError(`faq-${i}-answer`),
                    `landing-faq-${i}-answer-error`,
                  );
                  return (
                    <div
                      key={i}
                      className="border border-border bg-card p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          FAQ {i + 1}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFaq(i)}
                          aria-label={`Remove FAQ ${i + 1}`}
                          className="rounded-none h-7 px-2 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <Input
                        value={entry.question}
                        onChange={(e) =>
                          updateFaq(i, { question: e.target.value })
                        }
                        placeholder="Question"
                        className="rounded-none font-bold"
                        aria-label={`FAQ ${i + 1} question`}
                        {...qErr.attrs}
                      />
                      {qErr.node}
                      <Textarea
                        value={entry.answer}
                        onChange={(e) =>
                          updateFaq(i, { answer: e.target.value })
                        }
                        placeholder="Answer (1-2 sentences, specific)"
                        className="rounded-none text-sm leading-relaxed"
                        aria-label={`FAQ ${i + 1} answer`}
                        {...aErr.attrs}
                      />
                      {aErr.node}
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addFaq}
                  disabled={editor.draft.faq.length >= 6}
                  className="rounded-none border-border hover:border-primary/50 hover:bg-primary/10"
                  aria-label="Add FAQ entry"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add FAQ ({editor.draft.faq.length}/6)
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border border-y border-border">
                {landing.faq.map((entry, i) => (
                  <div key={i} className="py-4 space-y-2">
                    <p className="font-bold font-serif text-base leading-snug">
                      {entry.question}
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {entry.answer}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </CardShell>
  );
}
