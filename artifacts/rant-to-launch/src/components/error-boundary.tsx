import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

// Catches render errors from any child subtree (workspace sections,
// share page, home page) so a single misbehaving section doesn't blank
// the whole app. Logs to the console so the user-visible "something
// broke" screen still leaves a debugging trail.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          role="alert"
          className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center"
        >
          <AlertTriangle
            aria-hidden="true"
            className="w-10 h-10 text-destructive mb-4"
          />
          <h1 className="font-serif font-bold text-2xl mb-2">
            Something broke on this screen.
          </h1>
          <p className="text-sm text-muted-foreground max-w-md">
            The page hit an unexpected error. Reload to try again — your saved
            launches are still on the home page.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="border-2 border-foreground bg-background px-4 py-2 font-mono text-xs uppercase tracking-widest font-bold hover:bg-foreground hover:text-background transition-colors"
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={this.reset}
              className="border-2 border-border bg-background px-4 py-2 font-mono text-xs uppercase tracking-widest font-bold hover:border-primary hover:text-primary transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
