import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  useCreateProject,
  useDeleteProject,
  getGetProjectQueryKey,
  ErrorResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  getRecentProjects,
  saveRecentProject,
  removeRecentProject,
  saveInflightJob,
  RecentProject,
} from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  Loader2,
  Zap,
  History,
  ArrowRight,
  ChevronDown,
  Upload,
  Lock,
  Trash2,
  AlertTriangle,
  Rocket,
  Check,
} from "lucide-react";

const MAX_CHARS = 50000;
const MAX_TIMESTAMP_CHARS = 5000;

const TONE_OPTIONS = [
  { value: "founder-direct", label: "Founder-direct (default)" },
  { value: "calm-confident", label: "Calm and confident" },
  { value: "bold and witty", label: "Bold and witty" },
  { value: "plainspoken", label: "Plainspoken" },
  { value: "hype", label: "Hype / high energy" },
  { value: "warm and human", label: "Warm and human" },
];

const CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "x", label: "X / Twitter" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "newsletter", label: "Newsletter" },
  { value: "carousel", label: "Carousel" },
];

const DEFAULT_CHANNELS = ["x", "linkedin", "newsletter", "carousel"];

interface FieldLabelProps {
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}

function FieldLabel({ htmlFor, required, children, hint }: FieldLabelProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-1.5">
      <label
        htmlFor={htmlFor}
        className="font-mono text-[11px] uppercase tracking-widest font-bold text-foreground"
      >
        {children}
        {required ? (
          <span className="text-primary ml-1.5" aria-label="required">
            *
          </span>
        ) : (
          <span className="ml-2 text-[10px] font-normal tracking-wider text-muted-foreground/70 normal-case">
            optional
          </span>
        )}
      </label>
      {hint ? (
        <span className="text-[11px] text-muted-foreground/70 hidden sm:block truncate">{hint}</span>
      ) : null}
    </div>
  );
}

export default function Home() {
  const [rantText, setRantText] = useState("");
  const [projectName, setProjectName] = useState("");
  const [audience, setAudience] = useState("");
  const [offer, setOffer] = useState("");
  const [cta, setCta] = useState("");
  const [tone, setTone] = useState<string>("founder-direct");
  const [channels, setChannels] = useState<string[]>(DEFAULT_CHANNELS);
  const [timestamps, setTimestamps] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [pendingDelete, setPendingDelete] = useState<RecentProject | null>(null);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const deleteProject = useDeleteProject();

  const handleDeleteRecent = (project: RecentProject) => {
    deleteProject.mutate(
      { slug: project.slug },
      {
        onSuccess: () => {
          removeRecentProject(project.slug);
          setRecent(getRecentProjects());
          queryClient.removeQueries({ queryKey: getGetProjectQueryKey(project.slug) });
          setPendingDelete(null);
          toast({
            title: "Project deleted",
            description: `"${project.name}" was removed.`,
          });
        },
        onError: (err) => {
          // 404 just means the server is already rid of it; clean up locally too
          // so a stale entry doesn't haunt the home page list.
          const status = (err as unknown as { status?: number }).status;
          if (status === 404) {
            removeRecentProject(project.slug);
            setRecent(getRecentProjects());
            queryClient.removeQueries({ queryKey: getGetProjectQueryKey(project.slug) });
            setPendingDelete(null);
            toast({
              title: "Project removed",
              description: "It was already gone on the server.",
            });
            return;
          }
          toast({
            variant: "destructive",
            title: "Couldn't delete project",
            description: err instanceof Error ? err.message : "Try again in a moment.",
          });
        },
      },
    );
  };

  useEffect(() => {
    setRecent(getRecentProjects());
  }, []);

  const createProject = useCreateProject({
    mutation: {
      onSuccess: (data) => {
        const preview = rantText.slice(0, 100) + (rantText.length > 100 ? "..." : "");
        saveRecentProject({
          slug: data.slug,
          name: projectName.trim() || "Generating…",
          preview,
          createdAt: new Date().toISOString(),
        });
        saveInflightJob(data.slug, data.jobId);
        setLocation(`/projects/${data.slug}`);
      },
      onError: (error) => {
        const body = (error as unknown as { data?: ErrorResponse }).data;
        const slug = body?.slug;
        // If the backend persisted a project before failing, jump the user
        // into the workspace where the run-level error surfaces. Use the
        // toast there since the user is navigating away. Otherwise stay on
        // the home page and rely on the inline alert below — no toast, so
        // we don't double-announce the same error to assistive tech.
        if (slug) {
          toast({
            variant: "destructive",
            title: "Generation failed",
            description: error.message || body?.error || "Something went wrong. Try again.",
          });
          setLocation(`/projects/${slug}`);
        }
      },
    },
  });

  const charCount = rantText.length;
  const timestampCount = timestamps.length;
  const isOverLimit = charCount > MAX_CHARS;
  const isOverTimestampLimit = timestampCount > MAX_TIMESTAMP_CHARS;
  const isPending = createProject.isPending;
  // Submit only depends on the rant. Optional fields (incl. timestamps) have
  // hard `maxLength` caps on their inputs so they can never overflow and
  // dead-end the primary paste-only path.
  const canSubmit = rantText.trim().length > 0 && !isOverLimit && !isPending;

  const toggleChannel = (value: string) => {
    setChannels((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value],
    );
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    createProject.mutate({
      data: {
        rawText: rantText,
        ...(projectName.trim() ? { name: projectName.trim() } : {}),
        ...(audience.trim() ? { audience: audience.trim() } : {}),
        ...(offer.trim() ? { offer: offer.trim() } : {}),
        ...(cta.trim() ? { cta: cta.trim() } : {}),
        ...(tone && tone !== "founder-direct" ? { tone } : {}),
        ...(channels.length > 0 && channels.length < CHANNEL_OPTIONS.length
          ? { channels }
          : {}),
        ...(timestamps.trim() ? { timestamps: timestamps.trim() } : {}),
      },
    });
  };

  const inputClass =
    "w-full bg-background border-2 border-border rounded-none p-3 font-mono text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors disabled:opacity-50";

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <header className="h-14 border-b border-border flex items-center justify-between px-4 sm:px-6 shrink-0 bg-background z-10 relative">
        <div className="flex items-center gap-2 text-primary font-bold tracking-tight">
          <Zap aria-hidden="true" className="w-5 h-5" />
          <span>RANT-TO-LAUNCH</span>
        </div>
      </header>

      <main
        id="main-content"
        className="flex-1 flex flex-col items-center px-4 sm:px-8 py-10 sm:py-16"
      >
        <div className="w-full max-w-3xl">
          {/* Hero */}
          <div className="mb-12 space-y-4">
            <p className="font-mono text-xs uppercase tracking-widest text-primary">
              Founder &rarr; Launch in one paste
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-serif font-bold tracking-tight leading-[1.05]">
              Paste the chaos.
              <br />
              Ship the launch.
            </h1>
            <p className="text-muted-foreground text-base sm:text-lg leading-relaxed max-w-2xl">
              Drop a voice-note transcript or a stream-of-consciousness rant. Add a few details
              if you have them. We turn it into a launch angle, X thread, LinkedIn post, landing
              page, carousel, storyboard, and a launch-day posting plan that hits at the right hour.
            </p>
          </div>

          {/* Step 1 — the rant */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-widest font-bold">
                <span className="text-primary mr-2">01.</span>The rant
                <span className="text-primary ml-1.5">*</span>
              </h2>
              <span className="text-[11px] text-muted-foreground/70 hidden sm:block">
                Voice-note transcript, brain-dump, frustrated Slack message — anything.
              </span>
            </div>
            <div className="relative">
              <Textarea
                placeholder={
                  "Just start typing. Example:\n\n\"OK so I built this thing because every invoicing tool wanted me to set up a workspace and invite teammates and pick a plan. I just wanted to send one invoice. So I made a one-screen app — paste your details, hit download, get a PDF. No accounts, no CRM nonsense. Shipping next week if I can stop second-guessing the empty state.\""
                }
                className={`min-h-[280px] resize-y bg-card rounded-none border-2 focus-visible:ring-0 focus-visible:border-primary p-4 sm:p-6 text-base sm:text-lg shadow-inner font-sans transition-colors placeholder:text-muted-foreground/40 ${
                  isOverLimit ? "border-destructive focus-visible:border-destructive" : "border-border"
                }`}
                value={rantText}
                onChange={(e) => setRantText(e.target.value)}
                disabled={isPending}
                maxLength={MAX_CHARS}
                aria-label="Rant or transcript"
                aria-describedby="rant-charcount"
              />
              <div className="absolute bottom-3 right-3">
                <span
                  id="rant-charcount"
                  className={`text-xs font-mono font-bold bg-background/80 backdrop-blur-sm px-2 py-1 border ${
                    isOverLimit
                      ? "text-destructive border-destructive"
                      : "text-muted-foreground border-border"
                  }`}
                >
                  {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
                </span>
              </div>
            </div>
          </section>

          {/* Step 2 — context */}
          <section className="mt-10 space-y-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-widest font-bold">
                <span className="text-primary mr-2">02.</span>Sharpen the launch
              </h2>
              <span className="text-[11px] text-muted-foreground/70 hidden sm:block">
                Skip any field — we'll infer it from the rant.
              </span>
            </div>

            <div>
              <FieldLabel htmlFor="project-name">Project name</FieldLabel>
              <input
                id="project-name"
                type="text"
                placeholder="Auto-named if you skip this"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                disabled={isPending}
                maxLength={200}
                className={inputClass}
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <FieldLabel htmlFor="audience">Audience</FieldLabel>
                <input
                  id="audience"
                  type="text"
                  placeholder="e.g. Solo SaaS founders"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  disabled={isPending}
                  maxLength={500}
                  className={inputClass}
                />
              </div>
              <div>
                <FieldLabel htmlFor="offer">Offer</FieldLabel>
                <input
                  id="offer"
                  type="text"
                  placeholder="e.g. Free 14-day trial"
                  value={offer}
                  onChange={(e) => setOffer(e.target.value)}
                  disabled={isPending}
                  maxLength={500}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <FieldLabel htmlFor="cta">CTA</FieldLabel>
                <input
                  id="cta"
                  type="text"
                  placeholder="e.g. Start your free trial"
                  value={cta}
                  onChange={(e) => setCta(e.target.value)}
                  disabled={isPending}
                  maxLength={200}
                  className={inputClass}
                />
              </div>
              <div>
                <FieldLabel htmlFor="tone">Tone</FieldLabel>
                <Select value={tone} onValueChange={setTone} disabled={isPending}>
                  <SelectTrigger
                    id="tone"
                    className="w-full h-[46px] bg-background border-2 border-border rounded-none font-mono text-sm focus:ring-0 focus:border-primary data-[state=open]:border-primary"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-none border-2 border-border font-mono text-sm">
                    {TONE_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value} className="rounded-none">
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <fieldset>
              <legend className="contents">
                <FieldLabel hint="Tap to toggle. We default to all four.">Channels</FieldLabel>
              </legend>
              <div
                role="group"
                aria-label="Publishing channels"
                className="flex flex-wrap gap-2"
              >
                {CHANNEL_OPTIONS.map((c) => {
                  const active = channels.includes(c.value);
                  return (
                    <button
                      key={c.value}
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      aria-label={c.label}
                      onClick={() => toggleChannel(c.value)}
                      disabled={isPending}
                      className={`inline-flex items-center gap-1.5 px-4 py-2 border-2 font-mono text-xs uppercase tracking-widest font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-primary hover:text-foreground"
                      }`}
                    >
                      {/* Non-color affordance: a check icon backs up the
                          color/border state so users who can't perceive
                          color (or are on grayscale) still see selection. */}
                      <Check
                        aria-hidden="true"
                        className={`w-3.5 h-3.5 transition-opacity ${
                          active ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      {c.label}
                    </button>
                  );
                })}
              </div>
              {channels.length === 0 ? (
                <p className="mt-2 text-[11px] font-mono text-muted-foreground/70">
                  Pick at least one channel, or we'll plan for all four.
                </p>
              ) : null}
            </fieldset>

            {/* Advanced */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest font-bold text-muted-foreground hover:text-foreground transition-colors py-2"
                >
                  <ChevronDown
                    aria-hidden="true"
                    className={`w-3.5 h-3.5 transition-transform ${
                      advancedOpen ? "rotate-180" : ""
                    }`}
                  />
                  Advanced — timestamps &amp; uploads
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-5 pt-3">
                <div>
                  <FieldLabel
                    htmlFor="timestamps"
                    hint="Helps the model anchor sections of the storyboard."
                  >
                    Timestamps
                  </FieldLabel>
                  <Textarea
                    id="timestamps"
                    placeholder={
                      "00:14 problem statement\n00:42 demo\n01:30 pricing\n02:05 ask"
                    }
                    value={timestamps}
                    onChange={(e) => setTimestamps(e.target.value)}
                    disabled={isPending}
                    maxLength={MAX_TIMESTAMP_CHARS}
                    className={`min-h-[110px] resize-y bg-background rounded-none border-2 focus-visible:ring-0 focus-visible:border-primary p-3 font-mono text-sm placeholder:text-muted-foreground/40 transition-colors ${
                      isOverTimestampLimit
                        ? "border-destructive focus-visible:border-destructive"
                        : "border-border"
                    }`}
                  />
                  <div className="flex justify-end mt-1">
                    <span
                      className={`text-[10px] font-mono ${
                        isOverTimestampLimit ? "text-destructive" : "text-muted-foreground/60"
                      }`}
                    >
                      {timestampCount.toLocaleString()} / {MAX_TIMESTAMP_CHARS.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div>
                  <FieldLabel hint="Audio &amp; transcript files coming later.">
                    File upload
                  </FieldLabel>
                  <div
                    className="flex items-center gap-3 p-4 border-2 border-dashed border-border bg-card/40 cursor-not-allowed"
                    aria-disabled="true"
                  >
                    <div className="w-10 h-10 border-2 border-border bg-background flex items-center justify-center shrink-0">
                      <Upload aria-hidden="true" className="w-4 h-4 text-muted-foreground/60" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-xs uppercase tracking-widest font-bold text-muted-foreground/70">
                        Drop an audio or transcript file
                      </p>
                      <p className="text-xs text-muted-foreground/60 mt-0.5">
                        Paste-only for now — uploads land in a later release.
                      </p>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1 shrink-0">
                      <Lock aria-hidden="true" className="w-3 h-3" />
                      Coming soon
                    </span>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </section>

          {/* Submit */}
          <div className="mt-10">
            <Button
              size="lg"
              className="w-full h-14 rounded-none font-bold text-lg uppercase tracking-wider shadow-[4px_4px_0px_0px_rgba(104,255,0,0.3)] hover:shadow-[2px_2px_0px_0px_rgba(104,255,0,0.5)] motion-safe:hover:translate-y-[2px] motion-safe:hover:translate-x-[2px] transition-all disabled:opacity-50 disabled:shadow-none disabled:transform-none disabled:cursor-not-allowed"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {isPending ? (
                <>
                  <Loader2 aria-hidden="true" className="mr-2 w-5 h-5 motion-safe:animate-spin" />
                  Compressing chaos...
                </>
              ) : (
                <>
                  <Sparkles aria-hidden="true" className="mr-2 w-5 h-5" />
                  Make it shippable
                </>
              )}
            </Button>
            {/* aria-live so the multi-minute generation kicks an
                announcement to assistive tech (a11y A6). */}
            <div role="status" aria-live="polite" className="sr-only">
              {isPending ? "Generating your launch package. This can take up to two minutes." : ""}
            </div>
            <p className="mt-2 text-center text-[11px] font-mono text-muted-foreground/70">
              {!isPending && rantText.trim().length === 0
                ? "Add a few sentences in the rant box above to get started."
                : "Pasting alone is enough — every other field just sharpens the output."}
            </p>

            {createProject.isError ? (
              <div
                role="alert"
                data-testid="alert-generation-failed"
                className="mt-6 border-2 border-destructive bg-destructive/5 p-5"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle aria-hidden="true" className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-serif font-bold text-base text-foreground">
                      We couldn't ship that one.
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Could be the model, could be the network — give it another
                      shot in a minute. While you wait, check out our pre-baked
                      demo launch to see exactly what you'll get back.
                    </p>
                    <Link
                      href={`/projects/demo`}
                      data-testid="link-view-demo-project"
                      className="mt-4 inline-flex items-center gap-2 border-2 border-foreground bg-background px-4 py-2 font-mono text-xs uppercase tracking-widest font-bold hover:bg-foreground hover:text-background transition-colors"
                    >
                      <Rocket aria-hidden="true" className="w-4 h-4" />
                      View demo launch
                      <ArrowRight aria-hidden="true" className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Recent */}
          {recent.length > 0 ? (
            <section className="mt-16" aria-labelledby="recent-launches-heading">
              <div className="flex items-center gap-2 text-muted-foreground mb-4">
                <History aria-hidden="true" className="w-4 h-4" />
                <h2
                  id="recent-launches-heading"
                  className="font-mono text-xs uppercase tracking-widest font-bold"
                >
                  Recent launches
                </h2>
              </div>
              {/* Show all 20 saved entries inside a scroll container
                  instead of silently slicing to 8 (audit U6). */}
              <ul className="divide-y divide-border border border-border max-h-[480px] overflow-y-auto">
                {recent.slice(0, 20).map((p) => (
                  <li key={p.slug} className="group/row relative hover:bg-card transition-colors">
                    <Link
                      href={`/projects/${p.slug}`}
                      className="group flex items-start justify-between gap-4 p-4"
                    >
                      <div className="flex-1 min-w-0 pr-10">
                        <div className="font-serif font-bold text-base truncate group-hover:text-primary transition-colors">{p.name}</div>
                        <div className="text-sm text-muted-foreground truncate mt-1">
                          {p.preview}
                        </div>
                        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/80 mt-2">
                          {new Date(p.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <ArrowRight aria-hidden="true" className="w-4 h-4 text-muted-foreground group-hover:text-primary motion-safe:group-hover:translate-x-1 transition-all shrink-0 mt-2" />
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setPendingDelete(p);
                      }}
                      aria-label={`Delete ${p.name}`}
                      data-testid={`button-delete-recent-${p.slug}`}
                      className="absolute top-3 right-3 p-1.5 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover/row:opacity-100 focus:opacity-100"
                    >
                      <Trash2 aria-hidden="true" className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="mt-16">
              <div className="flex items-center gap-2 text-muted-foreground mb-4">
                <History className="w-4 h-4" />
                <h2 className="font-mono text-xs uppercase tracking-widest font-bold">
                  Recent launches
                </h2>
              </div>
              <div className="border border-dashed border-border p-6 text-center">
                <p className="font-serif text-lg text-muted-foreground/80">
                  No launches yet.
                </p>
                <p className="mt-1 text-sm text-muted-foreground/60">
                  Your first one will live here the moment you ship it.
                </p>
              </div>
            </section>
          )}
        </div>
      </main>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteProject.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent className="rounded-none border-2">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? (
                <>
                  &ldquo;<span className="font-bold text-foreground">{pendingDelete.name}</span>&rdquo;
                  and every asset card it generated will be permanently removed. This can&apos;t be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none" disabled={deleteProject.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-delete-recent"
              className="rounded-none bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteProject.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) handleDeleteRecent(pendingDelete);
              }}
            >
              {deleteProject.isPending ? "Deleting..." : "Delete project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
