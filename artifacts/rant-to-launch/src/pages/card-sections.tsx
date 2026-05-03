import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateAssetCard,
  useRegenerateSection,
  useBackfillLandingFaq,
  useRefreshStoryboardImages,
  useUndoAssetCard,
  getGetProjectQueryKey,
  AssetCardKind,
  createTts,
} from "@workspace/api-client-react";
import type { AssetCard, ProjectDetail } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Copy,
  CheckCircle2,
  Pencil,
  Loader2,
  Save,
  X,
  PenTool,
  Twitter,
  Linkedin,
  Mail,
  Download,
  RefreshCw,
  FileCode,
  Rocket,
  LayoutPanelTop,
  Images,
  Film,
  Table2,
  LayoutGrid,
  CalendarDays,
  Quote,
  Undo2,
  HelpCircle,
  Plus,
  Trash2,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cardSectionMarkdown } from "@/lib/markdown";

// =====================================================================
// Editable card sections.
//
// Each section renders the asset card content read-only by default and
// flips into an inline edit mode when the founder hits Edit. The draft
// state lives locally in the section; on Save we PATCH /projects/:slug/
// asset-cards/:cardId, invalidate the project query so the freshest
// content is visible everywhere (including the Copy buttons), and exit
// edit mode. Cancel discards the draft without touching the server.
//
// Every section is rendered inside a shared <CardShell> so the
// workspace gets uniform header (icon + title + last-updated + status
// pill), a consistent body container, and a footer toolbar (Edit /
// Copy / Copy as Markdown / Regenerate, replaced by Save / Cancel
// during edit). The shell is also where the per-section anchor target
// lives so the workspace nav can scroll to it.
//
// `imageUrl` fields on carousel slides and storyboard frames are NOT
// edited here — the server preserves the existing imageUrl on every
// PATCH so a text edit never wipes the generated PNG.
// =====================================================================

// ---------------------------------------------------------------------
// Section presentation metadata — single source of truth used by both
// the section components (icon, title, anchor) and the workspace shell
// (anchor nav rail, ordered render).
// ---------------------------------------------------------------------

export interface SectionMeta {
  kind: AssetCardKind;
  title: string;
  shortTitle: string;
  anchorId: string;
  icon: LucideIcon;
}

export const SECTION_META: Record<AssetCardKind, SectionMeta> = {
  [AssetCardKind.launch_angle]: {
    kind: AssetCardKind.launch_angle,
    title: "Launch angle",
    shortTitle: "Angle",
    anchorId: "section-launch-angle",
    icon: Rocket,
  },
  [AssetCardKind.landing_page_copy]: {
    kind: AssetCardKind.landing_page_copy,
    title: "Landing page",
    shortTitle: "Landing",
    anchorId: "section-landing-page",
    icon: LayoutPanelTop,
  },
  [AssetCardKind.x_thread]: {
    kind: AssetCardKind.x_thread,
    title: "X thread",
    shortTitle: "X thread",
    anchorId: "section-x-thread",
    icon: Twitter,
  },
  [AssetCardKind.linkedin_post]: {
    kind: AssetCardKind.linkedin_post,
    title: "LinkedIn post",
    shortTitle: "LinkedIn",
    anchorId: "section-linkedin",
    icon: Linkedin,
  },
  [AssetCardKind.newsletter_blurb]: {
    kind: AssetCardKind.newsletter_blurb,
    title: "Newsletter blurb",
    shortTitle: "Newsletter",
    anchorId: "section-newsletter",
    icon: Mail,
  },
  [AssetCardKind.carousel_outline]: {
    kind: AssetCardKind.carousel_outline,
    title: "Carousel outline",
    shortTitle: "Carousel",
    anchorId: "section-carousel",
    icon: Images,
  },
  [AssetCardKind.storyboard_cards]: {
    kind: AssetCardKind.storyboard_cards,
    title: "Storyboard",
    shortTitle: "Storyboard",
    anchorId: "section-storyboard",
    icon: Film,
  },
  [AssetCardKind.posting_schedule]: {
    kind: AssetCardKind.posting_schedule,
    title: "Launch-day posting plan",
    shortTitle: "Schedule",
    anchorId: "section-schedule",
    icon: CalendarDays,
  },
};

export const SECTION_ORDER: readonly AssetCardKind[] = [
  AssetCardKind.launch_angle,
  AssetCardKind.landing_page_copy,
  AssetCardKind.x_thread,
  AssetCardKind.linkedin_post,
  AssetCardKind.newsletter_blurb,
  AssetCardKind.carousel_outline,
  AssetCardKind.storyboard_cards,
  AssetCardKind.posting_schedule,
];

export const SOURCE_RANT_ANCHOR = "section-source-rant";

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

export function CopyImageUrlButton({ href, label }: { href: string; label: string }) {
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
      {copied ? <CheckCircle2 className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
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

interface CardEditor<T> {
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

function useCardEditor<T>({ slug, card, toDraft, toContent, validate }: UseCardEditorOptions<T>): CardEditor<T> {
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
        toast({ variant: "destructive", title: "Can't save", description: err.message });
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
      const message = err instanceof Error ? err.message : "Failed to save edits";
      toast({ variant: "destructive", title: "Save failed", description: message });
    }
  };

  const fieldError = (field: string) => (error?.field === field ? error.message : null);

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
  attrs: { "aria-invalid": true; "aria-describedby": string } | Record<string, never>;
  node: ReactNode;
}

function fieldErrorBinding(message: string | null | undefined, id: string): FieldErrorAttrs {
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

function SectionError({ message, id }: { message: string | null; id?: string }) {
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

interface RegenHandle {
  regenerate: () => void;
  isPending: boolean;
  swapKey: string;
  kind: AssetCardKind;
}

function useRegenSection(slug: string, kind: AssetCardKind, swapKeySource: string | undefined): RegenHandle {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useRegenerateSection({
    mutation: {
      onSuccess: (updatedCard) => {
        const queryKey = getGetProjectQueryKey(slug);
        queryClient.setQueryData<ProjectDetail>(queryKey, (prev) => {
          if (!prev) return prev;
          const idx = prev.assetCards.findIndex((c) => c.kind === updatedCard.kind);
          const next =
            idx >= 0
              ? prev.assetCards.map((c, i) => (i === idx ? updatedCard : c))
              : [...prev.assetCards, updatedCard];
          return { ...prev, assetCards: next };
        });
        toast({
          title: "Section regenerated",
          description: "Fresh take loaded — Undo to restore the previous version.",
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

interface UndoHandle {
  undo: () => void;
  isPending: boolean;
  available: boolean;
}

function useUndoSection(slug: string, card: AssetCard): UndoHandle {
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

function RegenerateButton({ isPending, onClick, kind, label = "Regenerate" }: RegenerateButtonProps) {
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
      <span className={isPending ? "text-primary font-bold" : "text-foreground"}>
        {isPending ? "Regenerating..." : label}
      </span>
    </Button>
  );
}

function SectionContent({
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

function UndoButton({ isPending, onClick }: { isPending: boolean; onClick: () => void }) {
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
      <span className={isPending ? "text-primary font-bold" : "text-foreground"}>
        {isPending ? "Undoing..." : "Undo"}
      </span>
    </Button>
  );
}

function SectionToolbar<T>({
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

function StatusPill({ status }: { status: "saving" | "regenerating" | "undoing" }) {
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
      imageUrl: typeof s.imageUrl === "string" && s.imageUrl ? s.imageUrl : null,
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
        imageUrl: typeof f.imageUrl === "string" && f.imageUrl ? f.imageUrl : null,
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

export function downloadFilename(kind: "storyboard" | "carousel", index: number): string {
  return `${kind}-${index}.png`;
}

interface SectionProps {
  slug: string;
  card: AssetCard;
}

// =====================================================================
// Section: Launch angle
// =====================================================================

export function LaunchAngleSection({ slug, card }: SectionProps) {
  const regen = useRegenSection(slug, AssetCardKind.launch_angle, card.updatedAt);
  const undo = useUndoSection(slug, card);
  const editor = useCardEditor<{ text: string }>({
    slug,
    card,
    toDraft: (c) => ({ text: asString((c as { text?: unknown }).text) }),
    toContent: (d) => ({ text: d.text }),
    validate: (d) =>
      d.text.trim().length === 0
        ? { field: "text", message: "Launch angle can't be empty." }
        : null,
  });
  const text = asString((card.content as { text?: unknown }).text);
  const markdown = cardSectionMarkdown(card);
  const textErr = fieldErrorBinding(editor.fieldError("text"), "launch-angle-error");

  return (
    <CardShell
      meta={SECTION_META[AssetCardKind.launch_angle]}
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
      <Card className="border border-primary/30 bg-primary/5 rounded-none">
        <CardContent className="p-6">
          {editor.editing ? (
            <>
              <Textarea
                value={editor.draft.text}
                onChange={(e) => editor.setDraft({ text: e.target.value })}
                className="rounded-none text-xl sm:text-2xl font-serif font-bold leading-snug min-h-[140px] bg-background"
                aria-label="Launch angle"
                {...textErr.attrs}
              />
              {textErr.node}
            </>
          ) : (
            <p className="text-xl sm:text-2xl font-serif font-bold leading-snug text-foreground">
              {text}
            </p>
          )}
        </CardContent>
      </Card>
    </CardShell>
  );
}

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
          description: "Generated 4 to 6 FAQ entries for this landing page — Undo to remove them.",
        });
      },
      onError: (error) => {
        const message =
          (error as Error)?.message ?? "Could not generate FAQ for this landing page.";
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
  const regen = useRegenSection(slug, AssetCardKind.landing_page_copy, card.updatedAt);
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

  const headlineErr = fieldErrorBinding(editor.fieldError("headline"), "landing-headline-error");
  const subheadlineErr = fieldErrorBinding(
    editor.fieldError("subheadline"),
    "landing-subheadline-error",
  );
  const ctaErr = fieldErrorBinding(editor.fieldError("cta"), "landing-cta-error");
  const socialProofErr = fieldErrorBinding(
    editor.fieldError("socialProof"),
    "landing-social-proof-error",
  );
  const featuresSectionErr = editor.fieldError("_features");
  const faqSectionErr = editor.fieldError("_faq");

  const updateFeature = (idx: number, patch: Partial<LandingFeature>) => {
    editor.setDraft({
      ...editor.draft,
      features: editor.draft.features.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
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
              <span className={faqBackfill.isPending ? "text-primary font-bold" : "text-foreground"}>
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
                <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-widest">Headline</span>
                <Textarea
                  value={editor.draft.headline}
                  onChange={(e) => editor.setDraft({ ...editor.draft, headline: e.target.value })}
                  className="rounded-none text-2xl sm:text-4xl font-black font-serif text-center min-h-[80px] mt-2"
                  aria-label="Headline"
                  {...headlineErr.attrs}
                />
                {headlineErr.node}
              </label>
              <label className="block text-left">
                <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-widest">Subheadline</span>
                <Textarea
                  value={editor.draft.subheadline}
                  onChange={(e) => editor.setDraft({ ...editor.draft, subheadline: e.target.value })}
                  className="rounded-none text-base sm:text-lg text-muted-foreground text-center mt-2"
                  aria-label="Subheadline"
                  {...subheadlineErr.attrs}
                />
                {subheadlineErr.node}
              </label>
              <label className="inline-block text-left">
                <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-widest">CTA</span>
                <Input
                  value={editor.draft.cta}
                  onChange={(e) => editor.setDraft({ ...editor.draft, cta: e.target.value })}
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
                <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-widest">Social proof</span>
                <Input
                  value={editor.draft.socialProof}
                  onChange={(e) => editor.setDraft({ ...editor.draft, socialProof: e.target.value })}
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
            <SectionError message={featuresSectionErr} id="landing-features-error" />
          )}
          <div className="grid sm:grid-cols-2 gap-8">
            {(editor.editing ? editor.draft.features : landing.features).map((feature, i) => {
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
                        onChange={(e) => updateFeature(i, { title: e.target.value })}
                        placeholder="Feature title"
                        className="rounded-none font-bold text-lg font-serif"
                        aria-label={`Feature ${i + 1} title`}
                        {...titleErr.attrs}
                      />
                      {titleErr.node}
                      <Textarea
                        value={feature.description}
                        onChange={(e) => updateFeature(i, { description: e.target.value })}
                        placeholder="Feature description"
                        className="rounded-none text-sm text-muted-foreground leading-relaxed"
                        aria-label={`Feature ${i + 1} description`}
                        {...descErr.attrs}
                      />
                      {descErr.node}
                    </>
                  ) : (
                    <>
                      <h5 className="font-bold text-lg font-serif">{feature.title}</h5>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {feature.description}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
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
                    No FAQ entries yet. Add 4 to 6 to publish — or leave empty to keep this block hidden.
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
                        onChange={(e) => updateFaq(i, { question: e.target.value })}
                        placeholder="Question"
                        className="rounded-none font-bold"
                        aria-label={`FAQ ${i + 1} question`}
                        {...qErr.attrs}
                      />
                      {qErr.node}
                      <Textarea
                        value={entry.answer}
                        onChange={(e) => updateFaq(i, { answer: e.target.value })}
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
    toDraft: (c) => ({ tweets: asStringArray((c as { tweets?: unknown }).tweets) }),
    toContent: (d) => ({ tweets: d.tweets.map((t) => t.trim()).filter((t) => t.length > 0) }),
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
              ? fieldErrorBinding(editor.fieldError(`tweet-${i}`), `x-thread-tweet-${i}-error`)
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
                      <p className="whitespace-pre-wrap text-sm sm:text-base">{tweet}</p>
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

// =====================================================================
// Section: LinkedIn post
// =====================================================================

export function LinkedInSection({ slug, card }: SectionProps) {
  const regen = useRegenSection(slug, AssetCardKind.linkedin_post, card.updatedAt);
  const undo = useUndoSection(slug, card);
  const text = asString((card.content as { text?: unknown }).text);
  const editor = useCardEditor<{ text: string }>({
    slug,
    card,
    toDraft: (c) => ({ text: asString((c as { text?: unknown }).text) }),
    toContent: (d) => ({ text: d.text }),
    validate: (d) =>
      d.text.trim().length === 0
        ? { field: "text", message: "LinkedIn post can't be empty." }
        : null,
  });

  const markdown = cardSectionMarkdown(card);
  const textErr = fieldErrorBinding(editor.fieldError("text"), "linkedin-text-error");

  return (
    <CardShell
      meta={SECTION_META[AssetCardKind.linkedin_post]}
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
        <CardContent className="p-4 sm:p-6">
          {editor.editing ? (
            <>
              <Textarea
                value={editor.draft.text}
                onChange={(e) => editor.setDraft({ text: e.target.value })}
                className="rounded-none leading-relaxed min-h-[260px]"
                aria-label="LinkedIn post"
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

// =====================================================================
// Section: Newsletter blurb
// =====================================================================

export function NewsletterSection({ slug, card }: SectionProps) {
  const regen = useRegenSection(slug, AssetCardKind.newsletter_blurb, card.updatedAt);
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
  const textErr = fieldErrorBinding(editor.fieldError("text"), "newsletter-text-error");

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

// =====================================================================
// Section: Carousel outline
// =====================================================================

export function CarouselSection({ slug, card }: SectionProps) {
  const regen = useRegenSection(slug, AssetCardKind.carousel_outline, card.updatedAt);
  const undo = useUndoSection(slug, card);
  const slides = asCarouselSlides((card.content as { slides?: unknown }).slides);
  const editor = useCardEditor<{ slides: CarouselSlide[] }>({
    slug,
    card,
    toDraft: (c) => ({ slides: asCarouselSlides((c as { slides?: unknown }).slides) }),
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
            .map((s) => `Slide ${s.slide}\nHeadline: ${s.headline}\nBody: ${s.body}`)
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
                    <CopyImageUrlButton href={href} label={`Copy slide ${slide.slide} image URL`} />
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
                  <p className="text-[11px] font-mono text-muted-foreground">Image unavailable</p>
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
                    <p className="text-sm text-muted-foreground">{slide.body}</p>
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

// =====================================================================
// Section: Storyboard
// =====================================================================

// Field metadata for the rich storyboard frame contract. Order matters —
// it drives both the inline-edit field order and the "Copy all" labeled
// block format. Keeping it as data avoids hand-repeating the six
// inputs/labels six times in the JSX below.
const STORYBOARD_FIELDS: ReadonlyArray<{
  key: "hook" | "sourceMoment" | "visual" | "onScreenText" | "voiceover" | "cta";
  label: string;
  copyLabel: string;
  placeholder: string;
  multiline: boolean;
}> = [
  { key: "hook", label: "Hook", copyLabel: "Hook", placeholder: "One-line attention grab", multiline: false },
  { key: "sourceMoment", label: "Source moment", copyLabel: "Source moment", placeholder: 'e.g. 02:14 — "where I rant about onboarding" OR Section: opening hook', multiline: false },
  { key: "visual", label: "Visual", copyLabel: "Visual", placeholder: "What the camera shows / B-roll", multiline: true },
  { key: "onScreenText", label: "On-screen text", copyLabel: "On-screen text", placeholder: "Short text overlay (<= 8 words)", multiline: false },
  { key: "voiceover", label: "Voiceover / caption", copyLabel: "Voiceover", placeholder: "1-2 spoken sentences", multiline: true },
  { key: "cta", label: "CTA", copyLabel: "CTA", placeholder: 'e.g. "Tap the link in bio"', multiline: false },
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
  const regen = useRegenSection(slug, AssetCardKind.storyboard_cards, card.updatedAt);
  const undo = useUndoSection(slug, card);
  const refreshImages = useRefreshStoryboardImagesMutation(slug);
  const frames = asStoryboardFrames((card.content as { frames?: unknown }).frames);
  const editor = useCardEditor<{ frames: StoryboardFrame[] }>({
    slug,
    card,
    toDraft: (c) => ({ frames: asStoryboardFrames((c as { frames?: unknown }).frames) }),
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
                    refreshImages.isPending ? "text-primary font-bold" : "text-foreground"
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
                    <CopyImageUrlButton href={href} label={`Copy frame ${frame.frame} image URL`} />
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
                  <p className="text-xs font-mono text-muted-foreground">"{frame.visual}"</p>
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
                        {!editor.editing && field.key === "voiceover" && value.trim() ? (
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
                              onChange={(e) => updateField(field.key, e.target.value)}
                              placeholder={field.placeholder}
                              className="rounded-none text-sm min-h-[60px]"
                              aria-label={`Frame ${frame.frame} ${field.label.toLowerCase()}`}
                              data-testid={`input-storyboard-${i}-${field.key}`}
                              {...errorBinding.attrs}
                            />
                          ) : (
                            <Input
                              value={value}
                              onChange={(e) => updateField(field.key, e.target.value)}
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
            <th scope="col" className={`${cellHead} w-[3.5rem]`}>#</th>
            <th scope="col" className={`${cellHead} w-[10rem]`}>Source moment</th>
            <th scope="col" className={cellHead}>Hook</th>
            <th scope="col" className={cellHead}>Visual</th>
            <th scope="col" className={cellHead}>On-screen text</th>
            <th scope="col" className={cellHead}>Voiceover</th>
            <th scope="col" className={`${cellHead} w-[8rem]`}>CTA</th>
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

// =====================================================================
// Section: Posting schedule
// =====================================================================

export function PostingScheduleSection({ slug, card }: SectionProps) {
  const regen = useRegenSection(slug, AssetCardKind.posting_schedule, card.updatedAt);
  const undo = useUndoSection(slug, card);
  const entries = asScheduleEntries((card.content as { entries?: unknown }).entries);
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
          <SectionError message={scheduleSectionErr} id="schedule-section-error" />
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
