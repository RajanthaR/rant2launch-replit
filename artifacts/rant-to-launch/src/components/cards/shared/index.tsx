import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateAssetCard,
  useRegenerateSection,
  useUndoAssetCard,
  getGetProjectQueryKey,
  AssetCardKind,
  createTts,
} from "@workspace/api-client-react";
import type { AssetCard, ProjectDetail } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Copy,
  CheckCircle2,
  Pencil,
  Loader2,
  Save,
  X,
  RefreshCw,
  FileCode,
  Undo2,
  Volume2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  SECTION_META,
  SECTION_ORDER,
  SOURCE_RANT_ANCHOR,
  type SectionMeta,
} from "./metadata";
export {
  SECTION_META,
  SECTION_ORDER,
  SOURCE_RANT_ANCHOR,
  type SectionMeta,
} from "./metadata";

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "";
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - ts.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return ts.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: ts.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

// ---------------------------------------------------------------------
// Copy buttons (plain text + Markdown)
// ---------------------------------------------------------------------

export function CopyImageUrlButton({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      const absolute = new URL(href, window.location.origin).toString();
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      toast({ title: "Image URL copied", description: absolute });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        variant: "destructive",
        title: "Failed to copy",
        description: "Could not access the clipboard.",
      });
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 hover:text-primary transition-colors"
      aria-label={label}
    >
      {copied ? (
        <CheckCircle2 className="w-3 h-3 text-primary" />
      ) : (
        <Copy className="w-3 h-3" />
      )}
      URL
    </button>
  );
}

export function CopyButton({
  text,
  className,
  label = "Copy",
}: {
  text: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({
        title: "Copied to clipboard",
        description: "The content has been copied.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        variant: "destructive",
        title: "Failed to copy",
        description: "Please try selecting and copying manually.",
      });
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleCopy}
      className={`rounded-none border-border hover:border-primary/50 hover:bg-primary/10 transition-colors ${className ?? ""}`}
      aria-label={label}
    >
      {copied ? (
        <CheckCircle2 className="w-4 h-4 mr-2 text-primary" />
      ) : (
        <Copy className="w-4 h-4 mr-2 text-muted-foreground" />
      )}
      <span className={copied ? "text-primary font-bold" : "text-foreground"}>
        {copied ? "Copied" : label}
      </span>
    </Button>
  );
}

export function ListenButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleListen = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      toast({
        variant: "destructive",
        title: "Nothing to play",
        description: "Add a voiceover line first.",
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await createTts({ text: trimmed });
      if (!(result instanceof Blob)) {
        throw new Error("TTS endpoint did not return audio.");
      }

      const url = URL.createObjectURL(result);
      const audio = new Audio(url);
      const cleanup = () => URL.revokeObjectURL(url);
      audio.addEventListener("ended", cleanup, { once: true });
      audio.addEventListener("error", cleanup, { once: true });
      await audio.play();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Voiceover preview failed",
        description:
          (error as Error)?.message ?? "Could not generate the audio preview.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleListen}
      disabled={isLoading}
      aria-label={label}
      title={label}
      className={`h-7 rounded-none px-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary ${className ?? ""}`}
    >
      {isLoading ? (
        <Loader2 className="w-3 h-3 mr-1.5 animate-spin text-primary" />
      ) : (
        <Volume2 className="w-3 h-3 mr-1.5" />
      )}
      {isLoading ? "Loading" : "Listen"}
    </Button>
  );
}

export function CopyMarkdownButton({
  markdown,
  label = "Copy as Markdown",
  shortLabel = "Markdown",
  toastTitle = "Markdown copied",
  toastDescription = "Section copied as Markdown.",
  className,
}: {
  markdown: string;
  label?: string;
  shortLabel?: string;
  toastTitle?: string;
  toastDescription?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      toast({ title: toastTitle, description: toastDescription });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        variant: "destructive",
        title: "Failed to copy",
        description: "Could not access the clipboard.",
      });
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleCopy}
      className={`rounded-none border-border hover:border-primary/50 hover:bg-primary/10 transition-colors ${className ?? ""}`}
      aria-label={label}
    >
      {copied ? (
        <CheckCircle2 className="w-4 h-4 mr-2 text-primary" />
      ) : (
        <FileCode className="w-4 h-4 mr-2 text-muted-foreground" />
      )}
      <span className={copied ? "text-primary font-bold" : "text-foreground"}>
        {copied ? "Copied" : shortLabel}
      </span>
    </Button>
  );
}

// ---------------------------------------------------------------------
// Shared editor scaffolding
// ---------------------------------------------------------------------

// Structured validation errors let sections render the message inline next
// to the offending input (and/or section header) instead of relying solely on
// the transient toast. `field` is a stable key the section knows how to map
// back to one of its inputs (e.g. `headline`, `feature-2-title`, `tweet-3`),
// or a `_section` key for whole-section rules like "needs 4 to 6 entries".
export interface ValidationError {
  field: string;
  message: string;
}

interface UseCardEditorOptions<T> {
  slug: string;
  card: AssetCard;
  toDraft: (content: AssetCard["content"]) => T;
  toContent: (draft: T) => Record<string, unknown>;
  validate?: (draft: T) => ValidationError | null;
}

export interface CardEditor<T> {
  editing: boolean;
  draft: T;
  setDraft: (next: T) => void;
  start: () => void;
  cancel: () => void;
  save: () => Promise<void>;
  isSaving: boolean;
  error: ValidationError | null;
  fieldError: (field: string) => string | null;
}

export function useCardEditor<T>({
  slug,
  card,
  toDraft,
  toContent,
  validate,
}: UseCardEditorOptions<T>): CardEditor<T> {
  const [editing, setEditing] = useState(false);
  const [draft, setDraftState] = useState<T>(() => toDraft(card.content));
  const [error, setError] = useState<ValidationError | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useUpdateAssetCard({
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
        queryClient.invalidateQueries({ queryKey });
      },
    },
  });

  // Re-run validation on every edit *if* an error is currently shown so the
  // inline message clears (or moves to the next failing field) the moment
  // the founder fixes the input. We don't show errors before the first save
  // attempt — that would be noisy on a freshly opened editor.
  const setDraft = (next: T) => {
    setDraftState(next);
    if (error && validate) {
      setError(validate(next));
    }
  };
  const start = () => {
    setDraftState(toDraft(card.content));
    setError(null);
    setEditing(true);
  };
  const cancel = () => {
    setDraftState(toDraft(card.content));
    setError(null);
    setEditing(false);
  };
  const save = async () => {
    if (validate) {
      const err = validate(draft);
      if (err) {
        setError(err);
        toast({
          variant: "destructive",
          title: "Can't save",
          description: err.message,
        });
        return;
      }
    }
    setError(null);
    try {
      await mutation.mutateAsync({
        slug,
        cardId: card.id,
        data: { content: toContent(draft) },
      });
      toast({ title: "Saved", description: "Your edits are persisted." });
      setEditing(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save edits";
      toast({
        variant: "destructive",
        title: "Save failed",
        description: message,
      });
    }
  };

  const fieldError = (field: string) =>
    error?.field === field ? error.message : null;

  return {
    editing,
    draft,
    setDraft,
    start,
    cancel,
    save,
    isSaving: mutation.isPending,
    error,
    fieldError,
  };
}

// ---------------------------------------------------------------------
// Inline error helpers — render a small destructive message under the
// failing input and provide the aria attributes that wire it to the
// input via aria-describedby for screen readers.
// ---------------------------------------------------------------------

interface FieldErrorAttrs {
  attrs:
    | { "aria-invalid": true; "aria-describedby": string }
    | Record<string, never>;
  node: ReactNode;
}

export function fieldErrorBinding(
  message: string | null | undefined,
  id: string,
): FieldErrorAttrs {
  if (!message) return { attrs: {}, node: null };
  return {
    attrs: { "aria-invalid": true, "aria-describedby": id },
    node: (
      <p
        id={id}
        role="alert"
        className="text-[11px] font-mono text-destructive mt-1 leading-snug"
      >
        {message}
      </p>
    ),
  };
}

export function SectionError({
  message,
  id,
}: {
  message: string | null;
  id?: string;
}) {
  if (!message) return null;
  return (
    <div
      id={id}
      role="alert"
      className="mb-4 px-3 py-2 border border-destructive/50 bg-destructive/10 text-destructive text-xs font-mono"
    >
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------
// Per-section regeneration: button + body overlay + shared hook.
//
// Each section can be regenerated independently via POST /projects/:slug/
// sections/:section. The hook fires the mutation, splices the returned
// AssetCard into the cached project detail (so the section swaps in
// place without a full refetch), and exposes a `swapKey` derived from
// the card's updatedAt so SectionContent's animate-in fade-in remounts.
// `imageUrl` fields on visual sections are returned by the server with
// the new payload — no extra client work needed.
// ---------------------------------------------------------------------

export interface RegenHandle {
  regenerate: () => void;
  isPending: boolean;
  swapKey: string;
  kind: AssetCardKind;
}

export function useRegenSection(
  slug: string,
  kind: AssetCardKind,
  swapKeySource: string | undefined,
): RegenHandle {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useRegenerateSection({
    mutation: {
      onSuccess: (updatedCard) => {
        const queryKey = getGetProjectQueryKey(slug);
        queryClient.setQueryData<ProjectDetail>(queryKey, (prev) => {
          if (!prev) return prev;
          const idx = prev.assetCards.findIndex(
            (c) => c.kind === updatedCard.kind,
          );
          const next =
            idx >= 0
              ? prev.assetCards.map((c, i) => (i === idx ? updatedCard : c))
              : [...prev.assetCards, updatedCard];
          return { ...prev, assetCards: next };
        });
        toast({
          title: "Section regenerated",
          description:
            "Fresh take loaded — Undo to restore the previous version.",
        });
      },
      onError: (error) => {
        const message =
          (error as Error)?.message ?? "Could not regenerate this section.";
        toast({
          variant: "destructive",
          title: "Regeneration failed",
          description: message,
        });
      },
    },
  });
  return {
    regenerate: () => mutation.mutate({ slug, section: kind }),
    isPending: mutation.isPending,
    swapKey: swapKeySource ?? "0",
    kind,
  };
}

// ---------------------------------------------------------------------
// Per-card undo: restore the previous content snapshot the server kept
// the last time this card was saved or regenerated. The hook splices the
// returned AssetCard into the cached project detail so the section
// swaps back in place — no full refetch needed. `hasUndo` on the card
// tells the toolbar whether to show the Undo button at all.
// ---------------------------------------------------------------------

export interface UndoHandle {
  undo: () => void;
  isPending: boolean;
  available: boolean;
}

export function useUndoSection(slug: string, card: AssetCard): UndoHandle {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useUndoAssetCard({
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
          title: "Undone",
          description: "Restored the previous version of this section.",
        });
      },
      onError: (error) => {
        const message =
          (error as Error)?.message ?? "Could not undo the last change.";
        toast({
          variant: "destructive",
          title: "Undo failed",
          description: message,
        });
      },
    },
  });
  return {
    undo: () => mutation.mutate({ slug, cardId: card.id }),
    isPending: mutation.isPending,
    available: card.hasUndo,
  };
}

interface RegenerateButtonProps {
  isPending: boolean;
  onClick: () => void;
  kind: AssetCardKind;
  label?: string;
}

export function RegenerateButton({
  isPending,
  onClick,
  kind,
  label = "Regenerate",
}: RegenerateButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={isPending}
      aria-label={`Regenerate ${kind.replace(/_/g, " ")}`}
      className="rounded-none border-primary/20 hover:border-primary/50 hover:bg-primary/10 transition-colors"
    >
      {isPending ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin text-primary" />
      ) : (
        <RefreshCw className="w-4 h-4 mr-2 text-muted-foreground" />
      )}
      <span
        className={isPending ? "text-primary font-bold" : "text-foreground"}
      >
        {isPending ? "Regenerating..." : label}
      </span>
    </Button>
  );
}

export function SectionContent({
  isPending,
  swapKey,
  children,
}: {
  isPending: boolean;
  swapKey: string | number;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <div
        key={swapKey}
        className={`transition-opacity duration-300 animate-in fade-in ${
          isPending ? "opacity-40 pointer-events-none" : "opacity-100"
        }`}
        aria-busy={isPending}
      >
        {children}
      </div>
      {isPending && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-background/80 backdrop-blur-sm border border-primary/30 px-4 py-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-primary">
            <Loader2 className="w-4 h-4 animate-spin" />
            Regenerating...
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Toolbar that lives in the CardShell footer: Edit / Copy / Markdown /
// Regenerate when idle, Save / Cancel while editing.
// ---------------------------------------------------------------------

interface SectionToolbarProps<T> {
  editor: CardEditor<T>;
  copyText: string;
  copyLabel?: string;
  markdown?: string;
  regen?: RegenHandle;
  regenLabel?: string;
  undo?: UndoHandle;
  // Optional extra action button(s) rendered in the idle toolbar (between
  // Copy/Markdown and Regenerate). Used by the Storyboard section to
  // surface the "Refresh images" affordance alongside the standard
  // toolbar without duplicating the whole footer.
  extraActions?: ReactNode;
  className?: string;
}

function UndoButton({
  isPending,
  onClick,
}: {
  isPending: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={isPending}
      aria-label="Undo last change"
      title="Restore the previous version of this section"
      className="rounded-none border-border hover:border-primary/50 hover:bg-primary/10 transition-colors"
    >
      {isPending ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin text-primary" />
      ) : (
        <Undo2 className="w-4 h-4 mr-2 text-muted-foreground" />
      )}
      <span
        className={isPending ? "text-primary font-bold" : "text-foreground"}
      >
        {isPending ? "Undoing..." : "Undo"}
      </span>
    </Button>
  );
}

export function SectionToolbar<T>({
  editor,
  copyText,
  copyLabel,
  markdown,
  regen,
  regenLabel,
  undo,
  extraActions,
  className,
}: SectionToolbarProps<T>) {
  if (editor.editing) {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
        <Button
          size="sm"
          onClick={editor.save}
          disabled={editor.isSaving}
          className="rounded-none"
          aria-label="Save edits"
        >
          {editor.isSaving ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={editor.cancel}
          disabled={editor.isSaving}
          className="rounded-none"
          aria-label="Cancel edits"
        >
          <X className="w-4 h-4 mr-2" />
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <Button
        variant="outline"
        size="sm"
        onClick={editor.start}
        className="rounded-none border-border hover:border-primary/50 hover:bg-primary/10"
        aria-label="Edit section"
      >
        <Pencil className="w-4 h-4 mr-2 text-muted-foreground" />
        Edit
      </Button>
      {undo?.available && (
        <UndoButton isPending={undo.isPending} onClick={undo.undo} />
      )}
      <CopyButton text={copyText} label={copyLabel ?? "Copy"} />
      {markdown && <CopyMarkdownButton markdown={markdown} />}
      {extraActions}
      {regen && (
        <RegenerateButton
          isPending={regen.isPending}
          onClick={regen.regenerate}
          kind={regen.kind}
          label={regenLabel}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// CardShell — uniform header / body / footer wrapper for every card.
//
// The shell renders the anchor target so the workspace nav can scroll
// directly to the card. The status pill surfaces the in-flight state
// of the section's editor and regenerator without crowding the body.
// ---------------------------------------------------------------------

export { formatTimestamp };

export interface CardShellProps {
  meta: SectionMeta;
  updatedAt: string | null | undefined;
  isSaving?: boolean;
  isRegenerating?: boolean;
  isUndoing?: boolean;
  swapKey?: string | number;
  toolbar: ReactNode;
  children: ReactNode;
}

function StatusPill({
  status,
}: {
  status: "saving" | "regenerating" | "undoing";
}) {
  const label =
    status === "saving"
      ? "Saving"
      : status === "regenerating"
        ? "Regenerating"
        : "Undoing";
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 border border-primary/40 bg-primary/10 text-primary font-mono text-[10px] uppercase tracking-widest">
      <Loader2 className="w-3 h-3 animate-spin" />
      {label}
    </div>
  );
}

export function CardShell({
  meta,
  updatedAt,
  isSaving,
  isRegenerating,
  isUndoing,
  swapKey,
  toolbar,
  children,
}: CardShellProps) {
  const Icon = meta.icon;
  const status = isSaving
    ? "saving"
    : isRegenerating
      ? "regenerating"
      : isUndoing
        ? "undoing"
        : null;
  const stamp = formatTimestamp(updatedAt);

  return (
    <section
      id={meta.anchorId}
      aria-labelledby={`${meta.anchorId}-title`}
      className="scroll-mt-28 sm:scroll-mt-24"
    >
      <div className="border border-border bg-card transition-colors hover:border-border/80">
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 sm:py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3 sm:gap-3.5 min-w-0">
            <div className="w-10 h-10 shrink-0 bg-primary/10 text-primary flex items-center justify-center border border-primary/30">
              <Icon className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
            </div>
            <div className="min-w-0">
              <h3
                id={`${meta.anchorId}-title`}
                className="font-serif font-bold text-base sm:text-lg leading-tight truncate"
              >
                {meta.title}
              </h3>
              {stamp && (
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/80 mt-0.5">
                  Updated {stamp}
                </p>
              )}
            </div>
          </div>
          {status && <StatusPill status={status} />}
        </header>
        <div className="px-4 sm:px-6 py-6 sm:py-7">
          <SectionContent isPending={!!isRegenerating} swapKey={swapKey ?? "0"}>
            {children}
          </SectionContent>
        </div>
        {toolbar != null && (
          <footer className="flex flex-wrap items-center justify-end gap-2 px-4 sm:px-6 py-3 border-t border-border bg-muted/20 print:hidden">
            {toolbar}
          </footer>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// Type helpers (mirror project-workspace.tsx parsers)
// ---------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export interface CarouselSlide {
  slide: number;
  headline: string;
  body: string;
  imageUrl: string | null;
}
export interface StoryboardFrame {
  frame: number;
  hook: string;
  sourceMoment: string;
  visual: string;
  onScreenText: string;
  voiceover: string;
  cta: string;
  imageUrl: string | null;
}
export interface ScheduleEntry {
  day: string;
  platform: string;
  content: string;
}
export interface LandingFeature {
  title: string;
  description: string;
}
export interface FaqEntry {
  question: string;
  answer: string;
}
export interface LandingPage {
  headline: string;
  subheadline: string;
  cta: string;
  features: LandingFeature[];
  socialProof: string;
  // Optional so legacy landing cards generated before the FAQ block was
  // added still parse cleanly. Empty / missing = render the FAQ block as
  // hidden in read mode; in edit mode the founder can backfill 4-6 entries.
  faq: FaqEntry[];
}

export { asString, asStringArray };

export function asCarouselSlides(v: unknown): CarouselSlide[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObject)
    .map((s) => ({
      slide: typeof s.slide === "number" ? s.slide : 0,
      headline: asString(s.headline),
      body: asString(s.body),
      imageUrl:
        typeof s.imageUrl === "string" && s.imageUrl ? s.imageUrl : null,
    }))
    .filter((s) => s.headline || s.body);
}

export function asStoryboardFrames(v: unknown): StoryboardFrame[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObject)
    .map((f) => {
      // Tolerate legacy `caption` payloads (pre-task-12 storyboard
      // contract) by mapping the old field onto `voiceover` so the
      // founder doesn't lose the only piece of text the old card had.
      // The server already does this on the read path, but we double up
      // here so cached client payloads / share-link fetches still
      // render gracefully.
      const legacyCaption = asString((f as { caption?: unknown }).caption);
      const voiceoverRaw = asString(f.voiceover);
      return {
        frame: typeof f.frame === "number" ? f.frame : 0,
        hook: asString(f.hook),
        sourceMoment: asString(f.sourceMoment),
        visual: asString(f.visual),
        onScreenText: asString(f.onScreenText),
        voiceover: voiceoverRaw || legacyCaption,
        cta: asString(f.cta),
        imageUrl:
          typeof f.imageUrl === "string" && f.imageUrl ? f.imageUrl : null,
      };
    })
    .filter(
      (f) =>
        f.hook ||
        f.sourceMoment ||
        f.visual ||
        f.onScreenText ||
        f.voiceover ||
        f.cta,
    );
}

export function asScheduleEntries(v: unknown): ScheduleEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObject)
    .map((e) => ({
      day: asString(e.day),
      platform: asString(e.platform),
      content: asString(e.content),
    }))
    .filter((e) => e.day || e.content);
}

// Fixed launch-day slot labels — must match POSTING_SCHEDULE_SLOTS in
// artifacts/api-server/src/lib/launch-schema.ts. The server's PATCH and
// regen validators reject any other label in any other order, so the
// editor always writes these on save (which migrates legacy
// "Day 1..Day 7" cards on the next save).
export const POSTING_SCHEDULE_SLOTS: readonly string[] = [
  "Launch",
  "+1 hour",
  "+3 hours",
  "+6 hours",
  "Next morning",
  "Next afternoon",
  "Final voting-window reminder",
] as const;

// Normalize raw schedule entries into exactly 7 slots in canonical order
// for the editor draft. Pads with empty rows if the persisted card has
// fewer than 7 entries (defensive — server enforces 7) and overwrites
// the `day` field with the canonical slot label so a save migrates
// legacy cards. Platform/content are preserved by index.
export function normalizeScheduleDraft(
  entries: ScheduleEntry[],
): ScheduleEntry[] {
  return POSTING_SCHEDULE_SLOTS.map((slot, i) => {
    const existing = entries[i];
    return {
      day: slot,
      platform: existing?.platform ?? "",
      content: existing?.content ?? "",
    };
  });
}

export function asLandingPage(v: unknown): LandingPage | null {
  if (!isObject(v)) return null;
  const headline = asString(v.headline);
  const subheadline = asString(v.subheadline);
  if (!headline) return null;
  const features = Array.isArray(v.features)
    ? v.features.filter(isObject).map((f) => ({
        title: asString(f.title),
        description: asString(f.description),
      }))
    : [];
  // Tolerate legacy content (no faq field at all) and partially-filled rows.
  const faq = Array.isArray(v.faq)
    ? v.faq.filter(isObject).map((f) => ({
        question: asString(f.question),
        answer: asString(f.answer),
      }))
    : [];
  return {
    headline,
    subheadline,
    cta: asString(v.cta),
    features,
    socialProof: asString(v.socialProof),
    faq,
  };
}

export function imageHref(objectPath: string | null): string | null {
  if (!objectPath) return null;
  if (!objectPath.startsWith("/objects/")) return null;
  return `/api/storage${objectPath}`;
}

export function downloadFilename(
  kind: "storyboard" | "carousel",
  index: number,
): string {
  return `${kind}-${index}.png`;
}

export interface SectionProps {
  slug: string;
  card: AssetCard;
}
