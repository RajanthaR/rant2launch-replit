import { useEffect, useState } from "react";
import { scrollToAnchor, type NavEntry } from "@/lib/workspace-utils";

/**
 * Returns the id of the section currently most visible in the viewport.
 * Used to highlight the active entry in the anchor nav rail.
 */
export function useActiveAnchor(ids: readonly string[]): string | null {
  const key = ids.join("|");
  const [active, setActive] = useState<string | null>(ids[0] ?? null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (ids.length === 0) {
      setActive(null);
      return;
    }
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const visibility = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          visibility.set(e.target.id, e.intersectionRatio);
        }
        let bestId: string | null = null;
        let bestRatio = -1;
        for (const id of ids) {
          const r = visibility.get(id) ?? 0;
          if (r > bestRatio) {
            bestRatio = r;
            bestId = id;
          }
        }
        if (bestId && bestRatio > 0) setActive(bestId);
      },
      {
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
        rootMargin: "-120px 0px -55% 0px",
      },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // We re-run whenever the set of present ids changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return active;
}

export function DesktopNavRail({
  entries,
  activeId,
}: {
  entries: NavEntry[];
  activeId: string | null;
}) {
  if (entries.length === 0) return null;
  return (
    <nav
      aria-label="Launch package sections"
      className="sticky top-6 hidden lg:flex flex-col gap-1 border border-border bg-card p-3"
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground px-2 pt-1 pb-2">
        Sections
      </p>
      {entries.map((entry) => {
        const Icon = entry.Icon;
        const active = entry.anchorId === activeId;
        return (
          <button
            key={entry.anchorId}
            type="button"
            onClick={() => scrollToAnchor(entry.anchorId)}
            aria-current={active ? "true" : undefined}
            className={`group flex items-center gap-2 px-2 py-2 text-left text-sm font-mono transition-colors border-l-2 ${
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
            }`}
          >
            <Icon
              className={`w-3.5 h-3.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
            />
            <span className="truncate">{entry.title}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function MobileNavBar({
  entries,
  activeId,
}: {
  entries: NavEntry[];
  activeId: string | null;
}) {
  if (entries.length === 0) return null;
  return (
    <nav
      aria-label="Launch package sections"
      className="lg:hidden sticky top-0 z-10 -mx-4 sm:-mx-6 mb-4 bg-background/95 backdrop-blur border-b border-border"
    >
      <div className="overflow-x-auto">
        <div className="flex items-center gap-1 px-4 sm:px-6 py-2 min-w-max">
          {entries.map((entry) => {
            const active = entry.anchorId === activeId;
            return (
              <button
                key={entry.anchorId}
                type="button"
                onClick={() => scrollToAnchor(entry.anchorId)}
                aria-current={active ? "true" : undefined}
                className={`shrink-0 px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest border ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {entry.shortTitle}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
