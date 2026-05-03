import { useState, type ReactElement } from "react";
import { Quote, PenTool, HelpCircle, Table2, LayoutGrid } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AssetCardKind,
  type AssetCard,
} from "@workspace/api-client-react";
import {
  CardShell,
  SECTION_META,
  SECTION_ORDER,
  SOURCE_RANT_ANCHOR,
  StoryboardShotList,
  asString,
  asStringArray,
  asCarouselSlides,
  asStoryboardFrames,
  asScheduleEntries,
  asLandingPage,
  imageHref,
  formatTimestamp,
} from "./card-sections";

// =====================================================================
// Read-only renderers used by the public share page (and printed PDFs).
//
// Mirrors the visual layout of the editable workspace cards but without
// any of the per-card hooks (regenerate / undo / inline edit) — those
// require an authenticated session and aren't useful to public viewers.
// CardShell is reused with `toolbar={null}` so the footer collapses.
// =====================================================================

interface SectionProps {
  card: AssetCard;
}

function ReadOnlyShell({
  card,
  children,
}: {
  card: AssetCard;
  children: React.ReactNode;
}) {
  return (
    <CardShell
      meta={SECTION_META[card.kind]}
      updatedAt={card.updatedAt}
      toolbar={null}
    >
      {children}
    </CardShell>
  );
}

function LaunchAngle({ card }: SectionProps) {
  const text = asString((card.content as { text?: unknown }).text);
  return (
    <ReadOnlyShell card={card}>
      <Card className="border border-primary/30 bg-primary/5 rounded-none">
        <CardContent className="p-6">
          <p className="text-xl sm:text-2xl font-serif font-bold leading-snug text-foreground">
            {text}
          </p>
        </CardContent>
      </Card>
    </ReadOnlyShell>
  );
}

function LandingPage({ card }: SectionProps) {
  const landing = asLandingPage(card.content);
  if (!landing) return null;
  return (
    <ReadOnlyShell card={card}>
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
        {/* Hero */}
        <div className="p-8 sm:p-12 text-center border-b border-border bg-gradient-to-b from-muted/20 to-background space-y-4">
          <h4 className="text-3xl sm:text-5xl font-black font-serif tracking-tight mb-6">
            {landing.headline}
          </h4>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            {landing.subheadline}
          </p>
          <Button
            size="lg"
            className="rounded-none h-12 px-8 text-base font-bold pointer-events-none"
            tabIndex={-1}
          >
            {landing.cta}
          </Button>
        </div>
        {/* Proof strip */}
        {landing.socialProof && (
          <div className="px-6 py-4 bg-muted/40 border-b border-border text-center">
            <p className="text-xs font-mono uppercase text-muted-foreground tracking-widest">
              {landing.socialProof}
            </p>
          </div>
        )}
        {/* Features */}
        <div className="p-8 bg-card border-b border-border">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-6 text-center">
            Features
          </p>
          <div className="grid sm:grid-cols-2 gap-8">
            {landing.features.map((f, i) => (
              <div key={i} className="space-y-2">
                <div className="w-8 h-8 bg-primary text-primary-foreground font-mono font-bold flex items-center justify-center text-sm mb-4">
                  0{i + 1}
                </div>
                <h5 className="font-bold text-lg font-serif">{f.title}</h5>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
        {/* Dedicated CTA band */}
        <div className="px-6 py-10 sm:py-12 bg-primary/5 border-b border-border text-center">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
            Ready when you are
          </p>
          <Button
            size="lg"
            className="rounded-none h-12 px-8 text-base font-bold pointer-events-none"
            tabIndex={-1}
          >
            {landing.cta}
          </Button>
        </div>
        {/* FAQ */}
        {landing.faq.length > 0 && (
          <div className="p-8 bg-background">
            <div className="flex items-center gap-2 mb-6">
              <HelpCircle className="w-4 h-4 text-primary" />
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Frequently asked
              </p>
            </div>
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
          </div>
        )}
      </Card>
    </ReadOnlyShell>
  );
}

function XThread({ card }: SectionProps) {
  const tweets = asStringArray((card.content as { tweets?: unknown }).tweets);
  return (
    <ReadOnlyShell card={card}>
      <div className="space-y-4 pl-4 border-l-2 border-border">
        {tweets.map((tweet, i) => (
          <div key={i} className="relative">
            <div className="absolute -left-[25px] top-2 w-3 h-3 rounded-full bg-background border-2 border-primary" />
            <Card className="rounded-none border-border bg-card">
              <CardContent className="p-4">
                <p className="whitespace-pre-wrap text-sm sm:text-base">{tweet}</p>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </ReadOnlyShell>
  );
}

function PlainText({ card }: SectionProps) {
  const text = asString((card.content as { text?: unknown }).text);
  return (
    <ReadOnlyShell card={card}>
      <Card className="rounded-none border-border bg-card">
        <CardContent className="p-4 sm:p-6">
          <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
        </CardContent>
      </Card>
    </ReadOnlyShell>
  );
}

function Carousel({ card }: SectionProps) {
  const slides = asCarouselSlides((card.content as { slides?: unknown }).slides);
  return (
    <ReadOnlyShell card={card}>
      <div className="grid sm:grid-cols-2 gap-4">
        {slides.map((slide, i) => {
          const href = imageHref(slide.imageUrl);
          return (
            <Card
              key={i}
              className="rounded-none border-border bg-card overflow-hidden flex flex-col"
            >
              <div className="bg-muted px-4 py-2 border-b border-border font-mono text-xs font-bold text-muted-foreground">
                Slide {slide.slide}
              </div>
              {href ? (
                <div className="aspect-square bg-muted border-b border-border overflow-hidden">
                  <img
                    src={href}
                    alt={slide.headline}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="aspect-square bg-muted border-b border-border flex flex-col items-center justify-center text-center p-4">
                  <PenTool className="w-6 h-6 text-muted-foreground mb-2 opacity-50" />
                  <p className="text-[11px] font-mono text-muted-foreground">Image unavailable</p>
                </div>
              )}
              <CardContent className="p-4 space-y-2">
                <h5 className="font-bold font-serif">{slide.headline}</h5>
                <p className="text-sm text-muted-foreground">{slide.body}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ReadOnlyShell>
  );
}

function Storyboard({ card }: SectionProps) {
  const frames = asStoryboardFrames((card.content as { frames?: unknown }).frames);
  const [view, setView] = useState<"cards" | "table">("cards");
  // Read-only mirror of the workspace's STORYBOARD_FIELDS; kept inline
  // here so the shared share-link view doesn't depend on workspace-only
  // editor metadata.
  const FIELDS: ReadonlyArray<{
    key: "hook" | "sourceMoment" | "visual" | "onScreenText" | "voiceover" | "cta";
    label: string;
  }> = [
    { key: "hook", label: "Hook" },
    { key: "sourceMoment", label: "Source moment" },
    { key: "visual", label: "Visual" },
    { key: "onScreenText", label: "On-screen text" },
    { key: "voiceover", label: "Voiceover / caption" },
    { key: "cta", label: "CTA" },
  ];
  return (
    <ReadOnlyShell card={card}>
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {view === "cards"
            ? "Frame previews"
            : "Shot list — print as a call sheet"}
        </p>
        <div
          role="tablist"
          aria-label="Storyboard view"
          className="inline-flex border border-border bg-muted/40"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "cards"}
            onClick={() => setView("cards")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
              view === "cards"
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
            aria-selected={view === "table"}
            onClick={() => setView("table")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border-l border-border transition-colors ${
              view === "table"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Table2 className="w-3 h-3" />
            Shot list
          </button>
        </div>
      </div>
      {view === "table" ? (
        <StoryboardShotList frames={frames} />
      ) : (
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {frames.map((frame, i) => {
          const href = imageHref(frame.imageUrl);
          const altText = frame.voiceover || frame.hook || frame.visual;
          return (
            <Card
              key={i}
              className="rounded-none border-border bg-card overflow-hidden flex flex-col"
            >
              <div className="bg-muted px-4 py-2 border-b border-border font-mono text-xs font-bold text-muted-foreground">
                Frame {frame.frame}
              </div>
              {href ? (
                <div className="aspect-video bg-muted border-b border-border overflow-hidden">
                  <img
                    src={href}
                    alt={altText}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="aspect-video bg-muted border-b border-border p-4 flex flex-col items-center justify-center text-center">
                  <PenTool className="w-6 h-6 text-muted-foreground mb-2 opacity-50" />
                  <p className="text-xs font-mono text-muted-foreground">"{frame.visual}"</p>
                </div>
              )}
              <CardContent className="p-4 space-y-3">
                {FIELDS.map((field) => {
                  const value = frame[field.key];
                  if (!value) return null;
                  return (
                    <div key={field.key} className="space-y-1">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {field.label}
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{value}</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
      )}
    </ReadOnlyShell>
  );
}

function PostingSchedule({ card }: SectionProps) {
  const entries = asScheduleEntries((card.content as { entries?: unknown }).entries);
  return (
    <ReadOnlyShell card={card}>
      <div className="space-y-4">
        {entries.map((entry, i) => (
          <Card
            key={i}
            className="rounded-none border-border bg-card overflow-hidden flex flex-col sm:flex-row"
          >
            <div className="bg-muted p-4 sm:w-32 border-b sm:border-b-0 sm:border-r border-border flex flex-row sm:flex-col items-center justify-between sm:justify-center gap-2">
              <span className="font-bold font-serif text-lg">{entry.day}</span>
              <span className="text-[10px] font-mono bg-background px-2 py-1 border border-border mt-0 sm:mt-2 text-muted-foreground uppercase">
                {entry.platform}
              </span>
            </div>
            <div className="p-4 flex-1">
              <p className="text-sm sm:text-base">{entry.content}</p>
            </div>
          </Card>
        ))}
      </div>
    </ReadOnlyShell>
  );
}

function ReadOnlySection({ card }: SectionProps): ReactElement | null {
  switch (card.kind) {
    case AssetCardKind.launch_angle:
      return <LaunchAngle card={card} />;
    case AssetCardKind.landing_page_copy:
      return <LandingPage card={card} />;
    case AssetCardKind.x_thread:
      return <XThread card={card} />;
    case AssetCardKind.linkedin_post:
    case AssetCardKind.newsletter_blurb:
      return <PlainText card={card} />;
    case AssetCardKind.carousel_outline:
      return <Carousel card={card} />;
    case AssetCardKind.storyboard_cards:
      return <Storyboard card={card} />;
    case AssetCardKind.posting_schedule:
      return <PostingSchedule card={card} />;
    default:
      return null;
  }
}

export function ReadOnlySourceRant({
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
      <div className="border border-border bg-card transition-colors hover:border-border/80">
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 sm:py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3 sm:gap-3.5 min-w-0">
            <div className="w-10 h-10 shrink-0 bg-muted text-muted-foreground flex items-center justify-center border border-border">
              <Quote className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
            </div>
            <div className="min-w-0">
              <h3
                id={`${SOURCE_RANT_ANCHOR}-title`}
                className="font-serif font-bold text-base sm:text-lg leading-tight truncate"
              >
                Source rant
              </h3>
              {createdAt && (
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/80 mt-0.5">
                  Captured {formatTimestamp(createdAt)}
                </p>
              )}
            </div>
          </div>
        </header>
        <div className="px-4 sm:px-6 py-6 sm:py-7">
          <Card className="rounded-none border-border bg-background">
            <CardContent className="p-6">
              <p className="whitespace-pre-wrap leading-relaxed text-sm font-mono text-muted-foreground">
                {rawText}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

interface ReadOnlyStackProps {
  cards: AssetCard[];
  sourceRantText: string | null;
  sourceRantCreatedAt: string | null;
}

export function ReadOnlyStack({
  cards,
  sourceRantText,
  sourceRantCreatedAt,
}: ReadOnlyStackProps) {
  // Render in the canonical SECTION_ORDER, picking the first card for each
  // kind (matches the workspace's `indexByKind` behaviour).
  const byKind = new Map<AssetCard["kind"], AssetCard>();
  for (const c of cards) {
    if (!byKind.has(c.kind)) byKind.set(c.kind, c);
  }
  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      {SECTION_ORDER.map((kind) => {
        const card = byKind.get(kind);
        if (!card) return null;
        return <ReadOnlySection key={kind} card={card} />;
      })}
      {sourceRantText && (
        <ReadOnlySourceRant
          rawText={sourceRantText}
          createdAt={sourceRantCreatedAt}
        />
      )}
    </div>
  );
}
