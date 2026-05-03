import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Sparkles, Zap } from "lucide-react";

export function WorkspaceTopBar({
  projectName,
}: {
  projectName: string | undefined;
}) {
  return (
    <header className="h-14 border-b border-border flex items-center justify-between px-4 sm:px-6 shrink-0 bg-background z-20 relative print:hidden">
      <div className="flex items-center gap-2 min-w-0">
        <Link
          href="/"
          className="flex items-center gap-2 text-primary font-bold tracking-tight hover:opacity-80 transition-opacity"
        >
          <Zap className="w-5 h-5" />
          <span className="hidden sm:inline">RANT-TO-LAUNCH</span>
        </Link>
        {projectName && (
          <>
            <span className="text-muted-foreground/50 mx-1">/</span>
            <span className="font-serif text-sm sm:text-base truncate">
              {projectName}
            </span>
          </>
        )}
      </div>
      <Link href="/">
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-xs uppercase tracking-wider hover:bg-primary/10 hover:text-primary transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
          New launch
        </Button>
      </Link>
    </header>
  );
}
