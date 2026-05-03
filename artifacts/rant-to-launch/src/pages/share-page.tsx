import { Link, useParams } from "wouter";
import {
  useGetPublicProject,
  getGetPublicProjectQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowLeft, Eye, Rocket, Zap } from "lucide-react";
import { ReadOnlyStack } from "./read-only-sections";

// =====================================================================
// Public read-only share page.
//
// Visited via /share/:token. Resolves the token through the public
// endpoint, then renders the project's launch package using the same
// stacked layout as the workspace — minus all toolbars and editing
// affordances. No auth required; revoked tokens fall through to a 404
// message and the home link.
// =====================================================================

export default function SharePage() {
  const params = useParams();
  const token = params.token as string;
  const { data, isLoading, isError, error } = useGetPublicProject(token, {
    query: { queryKey: getGetPublicProjectQueryKey(token), retry: false },
  });

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <header className="h-14 border-b border-border flex items-center justify-between px-4 sm:px-6 shrink-0 bg-background z-20 relative print:hidden">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-2 text-primary font-bold tracking-tight hover:opacity-80 transition-opacity"
          >
            <Zap className="w-5 h-5" />
            <span className="hidden sm:inline">RANT-TO-LAUNCH</span>
          </Link>
          {data?.project.name && (
            <>
              <span className="text-muted-foreground/50 mx-1">/</span>
              <span className="font-serif text-sm sm:text-base truncate">
                {data.project.name}
              </span>
            </>
          )}
        </div>
        <span className="inline-flex items-center gap-2 px-2 py-1 border border-border bg-muted text-muted-foreground font-mono text-[10px] uppercase tracking-widest">
          <Eye className="w-3 h-3" />
          Read-only
        </span>
      </header>
      <main className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-in fade-in duration-500">
            <div className="relative w-32 h-32 mx-auto mb-8">
              <div className="absolute inset-0 border-2 border-primary/20 rounded-full animate-ping" />
              <div className="absolute inset-0 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <Zap className="absolute inset-0 m-auto w-12 h-12 text-primary animate-pulse" />
            </div>
            <h2 className="text-3xl font-bold font-serif mb-4">Loading shared launch...</h2>
          </div>
        )}

        {!isLoading && (isError || !data) && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
            <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mb-6">
              <AlertTriangle className="w-10 h-10 text-destructive" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Link unavailable</h2>
            <p className="text-muted-foreground max-w-md mx-auto mb-6">
              {(error as Error | undefined)?.message ??
                "This shareable link has been revoked or never existed."}
            </p>
            <Link href="/">
              <Button variant="outline" className="rounded-none">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to home
              </Button>
            </Link>
          </div>
        )}

        {!isLoading && data && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 animate-in fade-in duration-500">
            <div className="border border-border bg-card mb-6">
              <div className="px-4 sm:px-6 py-5 flex items-start gap-3">
                <div className="w-10 h-10 shrink-0 bg-primary/20 text-primary flex items-center justify-center border border-primary/50">
                  <Rocket className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-serif font-bold text-2xl sm:text-3xl tracking-tight leading-tight truncate">
                    {data.project.name || "Launch package"}
                  </h2>
                  <p className="font-mono text-[10px] sm:text-xs uppercase tracking-widest text-muted-foreground mt-1">
                    Shared read-only view
                  </p>
                </div>
              </div>
            </div>
            <ReadOnlyStack
              cards={data.assetCards}
              sourceRantText={data.sourceInputs[0]?.rawText ?? null}
              sourceRantCreatedAt={data.sourceInputs[0]?.createdAt ?? null}
            />
          </div>
        )}
      </main>
    </div>
  );
}
