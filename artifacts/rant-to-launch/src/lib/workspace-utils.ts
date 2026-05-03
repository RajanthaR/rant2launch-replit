import type { ComponentType } from "react";
import { AssetCardKind, type AssetCard } from "@workspace/api-client-react";
import {
  SECTION_META,
  SECTION_ORDER,
  SOURCE_RANT_ANCHOR,
} from "@/components/cards/shared/metadata";

export type CardsByKind = Partial<Record<AssetCard["kind"], AssetCard>>;

export interface NavEntry {
  anchorId: string;
  title: string;
  shortTitle: string;
  Icon: ComponentType<{ className?: string }>;
}

export function indexByKind(cards: AssetCard[]): CardsByKind {
  const out: CardsByKind = {};
  for (const c of cards) {
    if (!out[c.kind]) out[c.kind] = c;
  }
  return out;
}

export function newestUpdatedAt(cards: AssetCard[]): string | null {
  let best = 0;
  let iso: string | null = null;
  for (const c of cards) {
    const t = new Date(c.updatedAt).getTime();
    if (Number.isFinite(t) && t > best) {
      best = t;
      iso = c.updatedAt;
    }
  }
  return iso;
}

export function formatHeaderTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const ts = new Date(iso);
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

export function buildNav(cards: CardsByKind, hasSource: boolean): NavEntry[] {
  const entries: NavEntry[] = [];
  for (const kind of SECTION_ORDER) {
    if (!cards[kind]) continue;
    const meta = SECTION_META[kind];
    entries.push({
      anchorId: meta.anchorId,
      title: meta.title,
      shortTitle: meta.shortTitle,
      Icon: meta.icon,
    });
  }
  if (hasSource) {
    entries.push({
      anchorId: SOURCE_RANT_ANCHOR,
      title: "Source rant",
      shortTitle: "Source",
      Icon: () => null,
    });
  }
  return entries;
}

export function scrollToAnchor(anchorId: string) {
  const el = document.getElementById(anchorId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export { AssetCardKind, SECTION_ORDER };
