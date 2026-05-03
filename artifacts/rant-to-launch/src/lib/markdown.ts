import type {
  AssetCard,
  ProjectDetail,
} from "@workspace/api-client-react";

// =====================================================================
// Client-side Markdown serialization for the launch package.
//
// Each asset card kind has a deterministic Markdown projection that
// keeps the rendered shape readable when pasted into a doc, posted to
// a wiki, or shipped as a `.md` file. The full-document export wraps
// every present card with an H2 and the original rant as a final
// blockquote, in the same order the workspace renders them.
//
// `imageUrl` fields on visual cards are object paths under
// `/objects/...`; we convert them to the same `/api/storage{path}` URL
// the workspace uses, then resolve them to an absolute URL against the
// caller's `origin` so the markdown is portable.
// =====================================================================

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const SECTION_TITLES: Record<string, string> = {
  launch_angle: "Launch angle",
  landing_page_copy: "Landing page",
  x_thread: "X thread",
  linkedin_post: "LinkedIn post",
  newsletter_blurb: "Newsletter blurb",
  carousel_outline: "Carousel outline",
  storyboard_cards: "Storyboard",
  posting_schedule: "Launch-day posting plan",
};

export function sectionTitleFor(kind: string): string {
  return SECTION_TITLES[kind] ?? kind;
}

export interface MarkdownOptions {
  origin?: string;
}

function defaultOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

function absoluteImageUrl(objectPath: unknown, origin: string): string | null {
  if (typeof objectPath !== "string" || !objectPath.startsWith("/objects/")) {
    return null;
  }
  const path = `/api/storage${objectPath}`;
  if (!origin) return path;
  try {
    return new URL(path, origin).toString();
  } catch {
    return path;
  }
}

/**
 * Markdown body for a single asset card (no leading H2 / title).
 * Used both in per-card "Copy as Markdown" and in the full document.
 */
export function cardBodyMarkdown(
  card: AssetCard,
  opts: MarkdownOptions = {},
): string {
  const origin = opts.origin ?? defaultOrigin();
  const c = card.content;

  switch (card.kind) {
    case "launch_angle":
    case "linkedin_post":
    case "newsletter_blurb":
      return asString((c as { text?: unknown }).text).trim();

    case "x_thread": {
      const tweets = asStringArray((c as { tweets?: unknown }).tweets);
      return tweets
        .map((t, i) => `${i + 1}. ${t.replace(/\r?\n/g, " ").trim()}`)
        .join("\n");
    }

    case "landing_page_copy": {
      if (!isObject(c)) return "";
      const headline = asString(c.headline).trim();
      const subheadline = asString(c.subheadline).trim();
      const cta = asString(c.cta).trim();
      const socialProof = asString(c.socialProof).trim();
      const features = Array.isArray(c.features)
        ? c.features.filter(isObject).map((f) => ({
            title: asString(f.title).trim(),
            description: asString(f.description).trim(),
          }))
        : [];
      const faq = Array.isArray(c.faq)
        ? c.faq.filter(isObject).map((f) => ({
            question: asString(f.question).trim(),
            answer: asString(f.answer).trim(),
          }))
        : [];
      const blocks: string[] = [];
      if (headline) blocks.push(`### Headline\n\n${headline}`);
      if (subheadline) blocks.push(`### Subheadline\n\n${subheadline}`);
      if (cta) blocks.push(`### CTA\n\n${cta}`);
      if (socialProof) blocks.push(`### Social proof\n\n${socialProof}`);
      if (features.length > 0) {
        const featLines = features
          .map((f) => `- **${f.title}** — ${f.description}`)
          .join("\n");
        blocks.push(`### Features\n\n${featLines}`);
      }
      if (faq.length > 0) {
        const faqLines = faq
          .map((f) => `**Q: ${f.question}**\n\nA: ${f.answer}`)
          .join("\n\n");
        blocks.push(`### FAQ\n\n${faqLines}`);
      }
      return blocks.join("\n\n");
    }

    case "carousel_outline": {
      const slidesRaw = (c as { slides?: unknown }).slides;
      const slides = Array.isArray(slidesRaw)
        ? (slidesRaw.filter(isObject) as Record<string, unknown>[])
        : [];
      return slides
        .map((s) => {
          const idx = typeof s.slide === "number" ? s.slide : 0;
          const headline = asString(s.headline).trim();
          const body = asString(s.body).trim();
          const url = absoluteImageUrl(s.imageUrl, origin);
          const parts: string[] = [];
          parts.push(`### Slide ${idx} — ${headline}`);
          if (body) parts.push(body);
          if (url) parts.push(`![Slide ${idx}](${url})`);
          return parts.join("\n\n");
        })
        .join("\n\n");
    }

    case "storyboard_cards": {
      const framesRaw = (c as { frames?: unknown }).frames;
      const frames = Array.isArray(framesRaw)
        ? (framesRaw.filter(isObject) as Record<string, unknown>[])
        : [];
      return frames
        .map((f) => {
          const idx = typeof f.frame === "number" ? f.frame : 0;
          // Tolerate legacy storyboard frames that only carry the old
          // `caption` field — surface its content under "Voiceover" so
          // nothing is lost in the export.
          const legacyCaption = asString(f.caption).trim();
          const hook = asString(f.hook).trim();
          const sourceMoment = asString(f.sourceMoment).trim();
          const visual = asString(f.visual).trim();
          const onScreenText = asString(f.onScreenText).trim();
          const voiceoverRaw = asString(f.voiceover).trim();
          const voiceover = voiceoverRaw || legacyCaption;
          const cta = asString(f.cta).trim();
          const url = absoluteImageUrl(f.imageUrl, origin);
          const parts: string[] = [`### Frame ${idx}`];
          if (hook) parts.push(`**Hook:** ${hook}`);
          if (sourceMoment) parts.push(`**Source moment:** ${sourceMoment}`);
          if (visual) parts.push(`**Visual:** ${visual}`);
          if (onScreenText) parts.push(`**On-screen text:** ${onScreenText}`);
          if (voiceover) parts.push(`**Voiceover:** ${voiceover}`);
          if (cta) parts.push(`**CTA:** ${cta}`);
          if (url) parts.push(`![Frame ${idx}](${url})`);
          return parts.join("\n\n");
        })
        .join("\n\n");
    }

    case "posting_schedule": {
      // One paragraph per slot, slot label as a bold header followed by
      // platform and the content. Reads cleanly when pasted into a doc
      // and survives both the new launch-day labels and any legacy
      // "Day 1..Day 7" labels still on disk.
      const entriesRaw = (c as { entries?: unknown }).entries;
      const entries = Array.isArray(entriesRaw)
        ? (entriesRaw.filter(isObject) as Record<string, unknown>[])
        : [];
      if (entries.length === 0) return "";
      return entries
        .map((e) => {
          const slot = asString(e.day).trim() || "—";
          const platform = asString(e.platform).trim();
          const content = asString(e.content).trim();
          const heading = platform
            ? `### ${slot} — ${platform}`
            : `### ${slot}`;
          return content ? `${heading}\n\n${content}` : heading;
        })
        .join("\n\n");
    }

    default:
      return "";
  }
}

/**
 * `## <Title>\n\n<body>` — used to compose the full document.
 */
export function cardSectionMarkdown(
  card: AssetCard,
  opts: MarkdownOptions = {},
): string {
  const title = sectionTitleFor(card.kind);
  const body = cardBodyMarkdown(card, opts);
  return body ? `## ${title}\n\n${body}` : `## ${title}`;
}

const CARD_ORDER: readonly string[] = [
  "launch_angle",
  "landing_page_copy",
  "x_thread",
  "linkedin_post",
  "newsletter_blurb",
  "carousel_outline",
  "storyboard_cards",
  "posting_schedule",
];

interface MaybeMetadata {
  audience?: unknown;
  tone?: unknown;
  channels?: unknown;
}

/**
 * Full launch package as a single Markdown document.
 */
export function projectToMarkdown(
  detail: ProjectDetail,
  opts: MarkdownOptions = {},
): string {
  const projectName = (detail.project.name || "Launch package").trim();
  const blocks: string[] = [`# ${projectName}`];

  const sourceInput = detail.sourceInputs[0];
  const meta = (sourceInput?.metadata ?? null) as MaybeMetadata | null;
  if (meta) {
    const parts: string[] = [];
    if (typeof meta.audience === "string" && meta.audience.trim()) {
      parts.push(`Audience: ${meta.audience.trim()}`);
    }
    if (typeof meta.tone === "string" && meta.tone.trim()) {
      parts.push(`Tone: ${meta.tone.trim()}`);
    }
    if (Array.isArray(meta.channels)) {
      const channels = meta.channels.filter(
        (c): c is string => typeof c === "string" && c.length > 0,
      );
      if (channels.length > 0) {
        parts.push(`Channels: ${channels.join(", ")}`);
      }
    }
    if (parts.length > 0) {
      blocks.push(`_${parts.join(" · ")}_`);
    }
  }

  const cardsByKind = new Map<string, AssetCard>();
  for (const card of detail.assetCards) {
    if (!cardsByKind.has(card.kind)) cardsByKind.set(card.kind, card);
  }

  for (const kind of CARD_ORDER) {
    const card = cardsByKind.get(kind);
    if (!card) continue;
    blocks.push(cardSectionMarkdown(card, opts));
  }

  if (sourceInput && sourceInput.rawText.trim().length > 0) {
    const blockquote = sourceInput.rawText
      .split(/\r?\n/)
      .map((line) => (line.length > 0 ? `> ${line}` : ">"))
      .join("\n");
    blocks.push(`## Source rant\n\n${blockquote}`);
  }

  return blocks.join("\n\n") + "\n";
}

/**
 * Trigger a client-side download of `content` as a `.md` file.
 * Uses a temporary anchor + Blob URL — no new dependency.
 */
export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
