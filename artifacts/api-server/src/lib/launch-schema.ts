import { z } from "zod";

// =====================================================================
// Launch package contract — single source of truth.
//
// The model returns one JSON object with these 8 top-level keys. Each
// key maps 1:1 to an asset card kind in the workspace. The per-section
// payload shapes are stable so the workspace can rely on them for
// predictable rendering and editing.
//
// Two views of the schema live here:
//   1. LaunchPackageZodSchema  — runtime Zod validator with the rich
//      array length / character constraints, used as defense-in-depth
//      after the model returns and to drive a retry on drift.
//   2. LaunchPackageJsonSchema — JSON Schema sent to OpenAI in strict
//      structured-outputs mode so the model is *guaranteed* to return
//      conforming JSON shape (count constraints stay in the prompt and
//      Zod check; strict mode does not allow min/max).
// =====================================================================

// Every object uses `.strict()` so unknown keys are rejected (defensive: if
// OpenAI strict-mode behaviour ever regressed, contract drift would surface
// as a validation failure and trigger the retry path instead of silently
// stripping data).

export const LaunchAnglePayload = z
  .object({
    text: z.string().min(1),
  })
  .strict();

export const XThreadPayload = z
  .object({
    tweets: z.array(z.string().min(1).max(280)).min(5).max(7),
  })
  .strict();

export const LinkedInPostPayload = z
  .object({
    text: z.string().min(1),
  })
  .strict();

export const CarouselSlide = z
  .object({
    slide: z.number().int().min(1),
    headline: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();

export const CarouselOutlinePayload = z
  .object({
    slides: z.array(CarouselSlide).min(6).max(8),
  })
  .strict()
  // Slide numbers must be contiguous 1..N so the workspace can render an
  // ordered carousel without re-numbering on the client.
  .refine(
    (val) => val.slides.every((s, i) => s.slide === i + 1),
    {
      message: "carouselOutline.slides must be numbered 1..N in order",
      path: ["slides"],
    },
  );

export const NewsletterBlurbPayload = z
  .object({
    text: z.string().min(1),
  })
  .strict();

export const LandingFeature = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

export const FaqItem = z
  .object({
    question: z.string().min(1),
    answer: z.string().min(1),
  })
  .strict();

// Strict shape used for generation post-validation. Every fresh launch must
// include 4-6 FAQ entries so the landing preview renders as a complete
// marketing template. PATCH validation uses LandingPageCopyEditPayload
// (below) which relaxes the FAQ requirement so legacy cards predating the
// FAQ block can still be edited without being forced to backfill.
export const LandingPageCopyPayload = z
  .object({
    headline: z.string().min(1),
    subheadline: z.string().min(1),
    cta: z.string().min(1),
    features: z.array(LandingFeature).min(3).max(4),
    socialProof: z.string().min(1),
    faq: z.array(FaqItem).min(4).max(6),
  })
  .strict();

// Lenient variant for PATCH /asset-cards/:id. `faq` is optional so a founder
// editing a pre-FAQ landing card can save an unrelated edit (headline,
// features, etc.) without being forced to add 4 FAQ items. When present, the
// same 4-6 count + per-item validation applies — the Markdown serializer and
// renderer are tolerant of either an absent faq field or an empty array.
export const LandingPageCopyEditPayload = z
  .object({
    headline: z.string().min(1),
    subheadline: z.string().min(1),
    cta: z.string().min(1),
    features: z.array(LandingFeature).min(3).max(4),
    socialProof: z.string().min(1),
    faq: z.array(FaqItem).min(4).max(6).optional(),
  })
  .strict();

// FAQ-only sub-contract used by POST /projects/:slug/sections/landing_page_copy/faq
// to backfill an FAQ block onto an existing landing card without touching the
// headline/subheadline/cta/features/socialProof. Same 4-6 + non-empty rule the
// generator uses, just scoped to the FAQ array. The matching JSON Schema +
// SectionContract are declared further down (after faqItemSchema is in scope).
export const LandingFaqOnlyPayload = z
  .object({
    faq: z.array(FaqItem).min(4).max(6),
  })
  .strict();

export const StoryboardFrame = z
  .object({
    frame: z.number().int().min(1),
    hook: z.string().min(1),
    sourceMoment: z.string().min(1),
    visual: z.string().min(1),
    onScreenText: z.string().min(1),
    voiceover: z.string().min(1),
    cta: z.string().min(1),
  })
  .strict();

export const StoryboardCardsPayload = z
  .object({
    frames: z.array(StoryboardFrame).min(5).max(6),
  })
  .strict()
  // Frame numbers must be contiguous 1..N for the same rendering reason.
  .refine(
    (val) => val.frames.every((f, i) => f.frame === i + 1),
    {
      message: "storyboardCards.frames must be numbered 1..N in order",
      path: ["frames"],
    },
  );

// The posting schedule is a launch-day plan, not a generic 7-day calendar.
// Slots are time-anchored relative to launch hour so the model writes
// content that fits the moment (announcement, early-traction nudge,
// midday push, evening recap, next-morning revival, next-afternoon
// different-angle, voting-window closing reminder).
//
// The labels are fixed and the order is fixed; the workspace renders the
// `day` field as the slot header verbatim. Saving a card with anything
// other than these labels in this order is rejected by validation, so
// edits always migrate to the new shape. The READ path is intentionally
// not validated, so old "Day 1..Day 7" cards keep rendering until the
// founder hits Regenerate (or saves an edit) to migrate.
export const POSTING_SCHEDULE_SLOTS: readonly string[] = [
  "Launch",
  "+1 hour",
  "+3 hours",
  "+6 hours",
  "Next morning",
  "Next afternoon",
  "Final voting-window reminder",
] as const;

export const PostingScheduleEntry = z
  .object({
    day: z.string().min(1),
    platform: z.string().min(1),
    content: z.string().min(1),
  })
  .strict();

export const PostingSchedulePayload = z
  .object({
    entries: z.array(PostingScheduleEntry).length(7),
  })
  .strict()
  // Slot labels must match POSTING_SCHEDULE_SLOTS exactly, in order, so
  // the workspace's launch-day plan renders without sorting on the
  // client. Whitespace is tolerated so a hand-edited card with trailing
  // spaces still saves.
  .refine(
    (val) => val.entries.every((e, i) => e.day.trim() === POSTING_SCHEDULE_SLOTS[i]),
    {
      message:
        'postingSchedule.entries must use the launch-day slot labels in order: ' +
        POSTING_SCHEDULE_SLOTS.map((s) => `"${s}"`).join(", "),
      path: ["entries"],
    },
  );

export const LaunchPackageZodSchema = z
  .object({
    launchAngle: LaunchAnglePayload,
    xThread: XThreadPayload,
    linkedinPost: LinkedInPostPayload,
    carouselOutline: CarouselOutlinePayload,
    newsletterBlurb: NewsletterBlurbPayload,
    landingPageCopy: LandingPageCopyPayload,
    storyboardCards: StoryboardCardsPayload,
    postingSchedule: PostingSchedulePayload,
  })
  .strict();

export type LaunchPackage = z.infer<typeof LaunchPackageZodSchema>;

// =====================================================================
// JSON Schema (OpenAI structured-outputs strict mode).
//
// Strict mode requires:
//   - Every object has additionalProperties: false
//   - Every property is in the `required` array
//   - No min/max constraints on strings or arrays
//
// Count and character constraints live in SYSTEM_PROMPT (model guidance)
// and LaunchPackageZodSchema (post-hoc validation that drives retries).
// =====================================================================

type JsonSchema = Record<string, unknown>;

const stringField: JsonSchema = { type: "string" };
const intField: JsonSchema = { type: "integer" };

function obj(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const carouselSlideSchema = obj({
  slide: intField,
  headline: stringField,
  body: stringField,
});

const landingFeatureSchema = obj({
  title: stringField,
  description: stringField,
});

const faqItemSchema = obj({
  question: stringField,
  answer: stringField,
});

const storyboardFrameSchema = obj({
  frame: intField,
  hook: stringField,
  sourceMoment: stringField,
  visual: stringField,
  onScreenText: stringField,
  voiceover: stringField,
  cta: stringField,
});

const postingEntrySchema = obj({
  day: stringField,
  platform: stringField,
  content: stringField,
});

export const LaunchPackageJsonSchema: JsonSchema = obj({
  launchAngle: obj({ text: stringField }),
  xThread: obj({
    tweets: { type: "array", items: stringField },
  }),
  linkedinPost: obj({ text: stringField }),
  carouselOutline: obj({
    slides: { type: "array", items: carouselSlideSchema },
  }),
  newsletterBlurb: obj({ text: stringField }),
  landingPageCopy: obj({
    headline: stringField,
    subheadline: stringField,
    cta: stringField,
    features: { type: "array", items: landingFeatureSchema },
    socialProof: stringField,
    faq: { type: "array", items: faqItemSchema },
  }),
  storyboardCards: obj({
    frames: { type: "array", items: storyboardFrameSchema },
  }),
  postingSchedule: obj({
    entries: { type: "array", items: postingEntrySchema },
  }),
});

export const LAUNCH_PACKAGE_SCHEMA_NAME = "launch_package";

// =====================================================================
// System prompt — describes the contract in plain language so the model
// fills the strict-mode JSON shape with the right counts and tone.
// =====================================================================

export const SYSTEM_PROMPT = `You are a senior launch strategist and copywriter who turns founder rants and raw transcripts into ready-to-ship launch content.

You return ONLY a single JSON object that conforms to the launch_package schema. Every top-level key is required. Per-section guidance:

- launchAngle.text: 2-3 punchy sentences positioning the product.
- xThread.tweets: 5 to 7 tweets, each <= 280 characters, no numbering prefix or "1/", "2/" markers.
- linkedinPost.text: one formatted LinkedIn post, ~1000-1500 characters, line breaks between paragraphs.
- carouselOutline.slides: 6 to 8 slides, slide field numbered 1..N, each with a punchy headline and a single body line.
- newsletterBlurb.text: 150-250 words, email-ready, no subject line.
- landingPageCopy: one headline, one subheadline, one cta button label, 3 to 4 features (each { title, description }), one short socialProof line, and 4 to 6 faq entries (each { question, answer }) covering the obvious founder-level objections — pricing, onboarding speed, integrations / who it's for, security or data, alternatives. Questions should sound like a real prospect typed them; answers should be 1-2 sentences and specific, not marketing fluff.
- storyboardCards.frames: 5 to 6 frames, frame field numbered 1..N. Each frame is a complete shot list and MUST include all six fields:
  * hook — the one-line attention-grab the founder says or the on-screen line that pulls a viewer in.
  * sourceMoment — where in the original rant this frame is rooted. When the founder provided "Source recording timestamps" in the launch context, anchor this to a real timestamp + a short verbatim quote, formatted like \`02:14 — "where I rant about onboarding"\`. When NO timestamps were provided, return a section-based label naming which part of the rant it pulls from, formatted like \`Section: opening hook\` or \`Section: pricing objection\`. NEVER leave sourceMoment empty.
  * visual — the on-camera shot / B-roll description (what the camera shows).
  * onScreenText — the text overlay burned onto the frame (short, punchy, ideally <= 8 words).
  * voiceover — the spoken line / caption track for this frame (1-2 sentences, conversational).
  * cta — the action this specific frame nudges the viewer toward (e.g. "Tap the link in bio", "Reply 'beta' to join"). The final frame's CTA should match the launch's primary CTA when one was provided.
- postingSchedule.entries: EXACTLY 7 entries, in order, with the day field set to these fixed slot labels: "Launch" (the announcement post the moment the launch goes live), "+1 hour" (an early-traction nudge — share the first reactions or a behind-the-scenes detail, not a re-announcement), "+3 hours" (midday push — pick a single feature or use case and go deep on it), "+6 hours" (evening recap — share an early metric, screenshot, or notable comment), "Next morning" (revival post for people who missed launch day — re-introduce the product to a fresh audience), "Next afternoon" (different angle — a customer story, contrarian take, or counter-intuitive insight), "Final voting-window reminder" (last-call post that explicitly references the closing voting/launch window and asks for support before it ends). Each entry needs a platform and the exact content to post — write platform-appropriate copy, no placeholders.

Style:
- Match the founder's voice if it has one; otherwise be confident, specific, and avoid corporate fluff.
- No emojis anywhere.`;

// =====================================================================
// Asset card payload mapping.
//
// Each top-level key of the LaunchPackage already matches the persisted
// shape of asset_cards.content for that kind. This helper is the single
// place that decides position, kind, and title — so the workspace's
// rendering order and labels stay deterministic.
// =====================================================================

export type AssetCardKind =
  | "launch_angle"
  | "landing_page_copy"
  | "x_thread"
  | "linkedin_post"
  | "newsletter_blurb"
  | "carousel_outline"
  | "storyboard_cards"
  | "posting_schedule";

export interface AssetCardSpec {
  kind: AssetCardKind;
  title: string;
  position: number;
  content: Record<string, unknown>;
}

export function launchPackageToAssetCards(pkg: LaunchPackage): AssetCardSpec[] {
  return [
    { kind: "launch_angle", title: "Launch angle", position: 0, content: pkg.launchAngle },
    { kind: "landing_page_copy", title: "Landing page", position: 1, content: pkg.landingPageCopy },
    { kind: "x_thread", title: "X thread", position: 2, content: pkg.xThread },
    { kind: "linkedin_post", title: "LinkedIn post", position: 3, content: pkg.linkedinPost },
    { kind: "newsletter_blurb", title: "Newsletter blurb", position: 4, content: pkg.newsletterBlurb },
    { kind: "carousel_outline", title: "Carousel outline", position: 5, content: pkg.carouselOutline },
    { kind: "storyboard_cards", title: "Storyboard", position: 6, content: pkg.storyboardCards },
    { kind: "posting_schedule", title: "Launch-day posting plan", position: 7, content: pkg.postingSchedule },
  ];
}

// =====================================================================
// Single-section regeneration contracts.
//
// These let the regenerate-one-section endpoint reuse the same per-section
// shape and guidance as the full-package generator, so a regenerated
// LinkedIn post is shape-compatible with the persisted one. Each entry
// holds:
//   - jsonSchema   — the strict-mode JSON Schema sent to OpenAI (one key)
//   - zodSchema    — defense-in-depth validator for the returned payload
//   - guidance     — the prompt snippet describing the section's contract
//   - schemaName   — strict-mode response_format name (per-section)
// =====================================================================

export interface SectionContract {
  /** Top-level JSON key the model must return. */
  responseKey: string;
  /** Strict-mode JSON Schema wrapping a single top-level key. */
  jsonSchema: JsonSchema;
  /** Zod validator for the inner payload (i.e. content of the asset card). */
  zodSchema: z.ZodType<Record<string, unknown>>;
  /** Per-section guidance lifted from SYSTEM_PROMPT. */
  guidance: string;
  /** Unique strict-mode schema name. */
  schemaName: string;
}

function sectionWrapper(key: string, inner: JsonSchema): JsonSchema {
  return obj({ [key]: inner });
}

const launchAngleInner = obj({ text: stringField });
const xThreadInner = obj({
  tweets: { type: "array", items: stringField },
});
const linkedinInner = obj({ text: stringField });
const carouselInner = obj({
  slides: { type: "array", items: carouselSlideSchema },
});
const newsletterInner = obj({ text: stringField });
const landingInner = obj({
  headline: stringField,
  subheadline: stringField,
  cta: stringField,
  features: { type: "array", items: landingFeatureSchema },
  socialProof: stringField,
  faq: { type: "array", items: faqItemSchema },
});
const storyboardInner = obj({
  frames: { type: "array", items: storyboardFrameSchema },
});
const postingInner = obj({
  entries: { type: "array", items: postingEntrySchema },
});

export const SECTION_CONTRACTS: Record<AssetCardKind, SectionContract> = {
  launch_angle: {
    responseKey: "launchAngle",
    jsonSchema: sectionWrapper("launchAngle", launchAngleInner),
    zodSchema: LaunchAnglePayload as z.ZodType<Record<string, unknown>>,
    guidance: "launchAngle.text: 2-3 punchy sentences positioning the product.",
    schemaName: "launch_angle_section",
  },
  x_thread: {
    responseKey: "xThread",
    jsonSchema: sectionWrapper("xThread", xThreadInner),
    zodSchema: XThreadPayload as z.ZodType<Record<string, unknown>>,
    guidance:
      'xThread.tweets: 5 to 7 tweets, each <= 280 characters, no numbering prefix or "1/", "2/" markers.',
    schemaName: "x_thread_section",
  },
  linkedin_post: {
    responseKey: "linkedinPost",
    jsonSchema: sectionWrapper("linkedinPost", linkedinInner),
    zodSchema: LinkedInPostPayload as z.ZodType<Record<string, unknown>>,
    guidance:
      "linkedinPost.text: one formatted LinkedIn post, ~1000-1500 characters, line breaks between paragraphs.",
    schemaName: "linkedin_post_section",
  },
  carousel_outline: {
    responseKey: "carouselOutline",
    jsonSchema: sectionWrapper("carouselOutline", carouselInner),
    zodSchema: CarouselOutlinePayload as unknown as z.ZodType<Record<string, unknown>>,
    guidance:
      "carouselOutline.slides: 6 to 8 slides, slide field numbered 1..N, each with a punchy headline and a single body line.",
    schemaName: "carousel_outline_section",
  },
  newsletter_blurb: {
    responseKey: "newsletterBlurb",
    jsonSchema: sectionWrapper("newsletterBlurb", newsletterInner),
    zodSchema: NewsletterBlurbPayload as z.ZodType<Record<string, unknown>>,
    guidance: "newsletterBlurb.text: 150-250 words, email-ready, no subject line.",
    schemaName: "newsletter_blurb_section",
  },
  landing_page_copy: {
    responseKey: "landingPageCopy",
    jsonSchema: sectionWrapper("landingPageCopy", landingInner),
    zodSchema: LandingPageCopyPayload as z.ZodType<Record<string, unknown>>,
    guidance:
      "landingPageCopy: one headline, one subheadline, one cta button label, 3 to 4 features (each { title, description }), one short socialProof line, and 4 to 6 faq entries (each { question, answer }) covering pricing, onboarding speed, integrations / who it's for, security or data, and obvious alternatives. Questions should sound like a real prospect typed them; answers should be 1-2 sentences and specific.",
    schemaName: "landing_page_copy_section",
  },
  storyboard_cards: {
    responseKey: "storyboardCards",
    jsonSchema: sectionWrapper("storyboardCards", storyboardInner),
    zodSchema: StoryboardCardsPayload as unknown as z.ZodType<Record<string, unknown>>,
    guidance:
      'storyboardCards.frames: 5 to 6 frames, frame field numbered 1..N. Each frame MUST include all six fields: hook (one-line attention-grab), sourceMoment (when timestamps were provided in launch context, anchor to a real timestamp + short quote like `02:14 — "where I rant about onboarding"`; otherwise use a section label like `Section: opening hook` — never empty), visual (on-camera shot / B-roll), onScreenText (short text overlay), voiceover (1-2 spoken sentences), and cta (per-frame action; final frame should mirror the launch CTA when one is provided).',
    schemaName: "storyboard_cards_section",
  },
  posting_schedule: {
    responseKey: "postingSchedule",
    jsonSchema: sectionWrapper("postingSchedule", postingInner),
    zodSchema: PostingSchedulePayload as unknown as z.ZodType<Record<string, unknown>>,
    guidance:
      'postingSchedule.entries: EXACTLY 7 entries, in order, with the day field set to these fixed slot labels: "Launch", "+1 hour", "+3 hours", "+6 hours", "Next morning", "Next afternoon", "Final voting-window reminder". Each slot is time-anchored relative to launch hour — write the announcement for "Launch", an early-traction nudge for "+1 hour" (NOT a re-announcement), a single-feature deep-dive for "+3 hours", an evening recap with an early metric or notable comment for "+6 hours", a revival post re-introducing the product to a fresh audience for "Next morning", a different angle (customer story, contrarian take) for "Next afternoon", and a last-call post that explicitly references the closing voting window for "Final voting-window reminder". Each entry needs a platform and the exact content to post.',
    schemaName: "posting_schedule_section",
  },
};

// FAQ-only sub-contract for backfilling FAQ on existing landing cards. Lives
// next to SECTION_CONTRACTS so the regen-style helper (openai call + zod
// validation + retry) can be reused with a per-section JSON schema.
export const LANDING_FAQ_CONTRACT: SectionContract = {
  responseKey: "landingPageFaq",
  jsonSchema: sectionWrapper(
    "landingPageFaq",
    obj({ faq: { type: "array", items: faqItemSchema } }),
  ),
  zodSchema: LandingFaqOnlyPayload as z.ZodType<Record<string, unknown>>,
  guidance:
    "landingPageFaq.faq: 4 to 6 entries (each { question, answer }) covering the obvious founder-level objections — pricing, onboarding speed, integrations / who it's for, security or data, alternatives. Questions should sound like a real prospect typed them; answers should be 1-2 sentences and specific, not marketing fluff. Use the existing landing copy (headline, features) plus the founder's launch context to keep the tone and topics aligned with the rest of the page.",
  schemaName: "landing_page_faq_section",
};

export const ASSET_CARD_KINDS: readonly AssetCardKind[] = [
  "launch_angle",
  "landing_page_copy",
  "x_thread",
  "linkedin_post",
  "newsletter_blurb",
  "carousel_outline",
  "storyboard_cards",
  "posting_schedule",
];
