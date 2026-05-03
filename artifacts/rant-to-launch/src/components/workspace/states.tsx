import { Link } from "wouter";
import { type GenerationJob } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, ArrowLeft, Rocket, Zap } from "lucide-react";

export function GenerationProgressView({
  jobData,
  jobSucceeded,
}: {
  jobData: GenerationJob | undefined;
  jobSucceeded: boolean;
}) {
  const total = Math.max(0, jobData?.progressTotal ?? 0);
  const done = Math.min(Math.max(0, jobData?.progressDone ?? 0), total);
  const pct =
    total > 0
      ? Math.min(100, Math.round((done / total) * 100))
      : jobSucceeded
        ? 100
        : 0;
  const step = jobSucceeded
    ? "Finalizing your launch…"
    : (jobData?.currentStep ??
      (jobData?.status === "queued" ? "Queued…" : "Working…"));

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-in fade-in duration-500 px-4">
      <div className="relative w-20 h-20 mx-auto mb-8">
        <div className="absolute inset-0 border-2 border-primary/20 rounded-full animate-ping" />
        <div className="absolute inset-0 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <Zap className="absolute inset-0 m-auto w-8 h-8 text-primary animate-pulse" />
      </div>
      <h2 className="text-2xl sm:text-3xl font-bold font-serif mb-6">
        Compressing your chaos...
      </h2>
      <div className="w-full max-w-sm mx-auto space-y-3">
        <Progress
          value={pct}
          className="h-2 rounded-none"
          aria-label="Generation progress"
        />
        <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
          <span>{pct}%</span>
          {total > 0 && (
            <span>
              {done} / {total}
            </span>
          )}
        </div>
      </div>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="mt-4 font-mono text-sm text-foreground/80"
      >
        {step}
      </p>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground/60">
        This can take a couple of minutes
      </p>
    </div>
  );
}

export function LaunchAbortedView({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mb-6">
        <AlertTriangle className="w-10 h-10 text-destructive" />
      </div>
      <h2 className="text-2xl font-bold mb-2">Launch aborted</h2>
      <p className="text-muted-foreground max-w-md mx-auto mb-6">{message}</p>
      <Link href="/">
        <Button variant="outline" className="rounded-none">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Try a new rant
        </Button>
      </Link>
    </div>
  );
}

export function LoadingProjectView() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-in fade-in duration-500 px-4">
      <div className="relative w-32 h-32 mx-auto mb-8">
        <div className="absolute inset-0 border-2 border-primary/20 rounded-full animate-ping" />
        <div className="absolute inset-0 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <Zap className="absolute inset-0 m-auto w-12 h-12 text-primary animate-pulse" />
      </div>
      <h2 className="text-2xl sm:text-3xl font-bold font-serif mb-2">
        Loading your launch...
      </h2>
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground/70">
        Hydrating your asset cards
      </p>
    </div>
  );
}

export function ProjectNotFoundView({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mb-6">
        <AlertTriangle className="w-10 h-10 text-destructive" />
      </div>
      <h2 className="text-2xl font-bold mb-2">Project not found</h2>
      <p className="text-muted-foreground max-w-md mx-auto mb-6">{message}</p>
      <Link href="/">
        <Button variant="outline" className="rounded-none">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to home
        </Button>
      </Link>
    </div>
  );
}

export function GenericRunningView() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-in fade-in duration-500 px-4">
      <div className="relative w-32 h-32 mx-auto mb-8">
        <div className="absolute inset-0 border-2 border-primary/20 rounded-full animate-ping" />
        <div className="absolute inset-0 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <Zap className="absolute inset-0 m-auto w-12 h-12 text-primary animate-pulse" />
      </div>
      <h2 className="text-2xl sm:text-3xl font-bold font-serif mb-2">
        Compressing your chaos...
      </h2>
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground/70">
        This can take a couple of minutes
      </p>
    </div>
  );
}

export function EmptyProjectView() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center text-muted-foreground/70">
      <Rocket className="w-16 h-16 mb-4 opacity-30" />
      <p className="font-mono text-sm">
        No asset cards found for this project.
      </p>
    </div>
  );
}
