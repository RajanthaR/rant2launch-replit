import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assetCardsTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../../lib/logger";
import {
  LaunchPackageZodSchema,
  LaunchPackageJsonSchema,
  LAUNCH_PACKAGE_SCHEMA_NAME,
  SYSTEM_PROMPT,
  launchPackageToAssetCards,
  type LaunchPackage,
} from "../../lib/launch-schema";

// Model + prompt-version are env-overridable so swapping models or
// version-bumping a prompt doesn't require a code change. Defaults
// preserve the production contract documented in `replit.md`.
export const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.4";
// v4-visuals: same structured-outputs contract as v3-structured, plus a
// post-generation step that fans out to gpt-image-1 to produce one PNG per
// storyboard frame and per carousel slide. Generated PNGs are uploaded to
// object storage and their objectPath is merged into asset_cards.content
// (storyboard_cards.frames[].imageUrl, carousel_outline.slides[].imageUrl).
export const PROMPT_VERSION =
  process.env.PROMPT_VERSION?.trim() || "v4-visuals";

const CHANNEL_LABELS: Record<string, string> = {
  x: "X / Twitter",
  linkedin: "LinkedIn",
  newsletter: "Newsletter / email",
  carousel: "Carousel (Instagram / LinkedIn carousel)",
};

export interface IntakeContext {
  audience?: string;
  offer?: string;
  cta?: string;
  tone?: string;
  channels?: string[];
  timestamps?: string;
}

export function buildLaunchContextBlock(ctx: IntakeContext): string {
  const lines: string[] = [];
  if (ctx.audience?.trim()) lines.push(`- Audience: ${ctx.audience.trim()}`);
  if (ctx.offer?.trim()) lines.push(`- Offer: ${ctx.offer.trim()}`);
  if (ctx.cta?.trim()) {
    lines.push(
      `- Desired CTA: ${ctx.cta.trim()} (use this exact phrase as the landing page CTA when natural)`,
    );
  }
  if (ctx.tone?.trim()) lines.push(`- Tone: ${ctx.tone.trim()}`);
  if (ctx.channels && ctx.channels.length > 0) {
    const labeled = ctx.channels
      .map((c) => CHANNEL_LABELS[c.toLowerCase()] ?? c)
      .join(", ");
    lines.push(
      `- Channels (prioritize these in the posting schedule): ${labeled}`,
    );
  }
  if (ctx.timestamps?.trim()) {
    lines.push(`- Source recording timestamps:\n${ctx.timestamps.trim()}`);
  }
  if (lines.length === 0) return "";
  return `\n\nLaunch context (founder-supplied — honor these over inferences):\n${lines.join("\n")}`;
}

const PROJECT_NAME_PROMPT = `In 3-6 words, give a punchy project name for this founder rant. Output ONLY the name, no quotes, no preface, no period. Example: "Voice Notes To Launches".`;

export async function generateOutputs(
  rawText: string,
  intake: IntakeContext,
  extraSystem?: string,
): Promise<{ outputs?: LaunchPackage; failure?: string }> {
  const launchContext = buildLaunchContextBlock(intake);
  const userContent = `Founder rant / transcript:\n\n${rawText}${launchContext}`;
  // Strict structured outputs: the model is guaranteed by the API to return
  // JSON that conforms to LaunchPackageJsonSchema (object/property shape).
  // Count and length constraints still come from the prompt + Zod check
  // because strict mode does not allow min/max constraints in the schema.
  const completion = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 8192,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: LAUNCH_PACKAGE_SCHEMA_NAME,
        schema: LaunchPackageJsonSchema,
        strict: true,
      },
    },
    messages: [
      {
        role: "system",
        content: extraSystem
          ? `${SYSTEM_PROMPT}\n\n${extraSystem}`
          : SYSTEM_PROMPT,
      },
      { role: "user", content: userContent },
    ],
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) return { failure: "Empty response from model" };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch (err) {
    return {
      failure: `Model returned invalid JSON: ${(err as Error).message}`,
    };
  }
  const validated = LaunchPackageZodSchema.safeParse(parsedJson);
  if (!validated.success) {
    const detail = validated.error.issues
      .slice(0, 5)
      .map((i: z.ZodIssue) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    return { failure: `Model output failed schema validation: ${detail}` };
  }
  return { outputs: validated.data };
}

export async function deriveProjectName(rawText: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 32,
      messages: [
        { role: "system", content: PROJECT_NAME_PROMPT },
        { role: "user", content: rawText.slice(0, 2000) },
      ],
    });
    const name = completion.choices[0]?.message?.content?.trim();
    if (name && name.length > 0 && name.length <= 200) return name;
  } catch (err) {
    logger.warn({ err }, "Project name derivation failed; falling back");
  }
  const firstLine = rawText.trim().split(/\r?\n/)[0] ?? "Untitled launch";
  return firstLine.slice(0, 60) || "Untitled launch";
}

export function makeSlug(): string {
  return randomUUID().replace(/-/g, "").slice(0, 10);
}

export function outputsToAssetCards(
  outputs: LaunchPackage,
  projectId: string,
  generationRunId: string,
  sourceInputId: string,
  visuals: {
    storyboardImages: Map<number, string>;
    carouselImages: Map<number, string>;
  },
): Array<typeof assetCardsTable.$inferInsert> {
  // Single source of truth for asset card kind/title/position/content lives
  // in launch-schema.ts. Here we just bind the FK columns and weave in the
  // generated image objectPaths for the two visual asset kinds.
  return launchPackageToAssetCards(outputs).map((spec) => {
    let content: Record<string, unknown> = spec.content;
    if (spec.kind === "storyboard_cards") {
      const frames = (spec.content as { frames: Array<{ frame: number }> })
        .frames;
      content = {
        ...spec.content,
        frames: frames.map((f) => ({
          ...f,
          imageUrl: visuals.storyboardImages.get(f.frame) ?? null,
        })),
      };
    } else if (spec.kind === "carousel_outline") {
      const slides = (spec.content as { slides: Array<{ slide: number }> })
        .slides;
      content = {
        ...spec.content,
        slides: slides.map((s) => ({
          ...s,
          imageUrl: visuals.carouselImages.get(s.slide) ?? null,
        })),
      };
    }
    return {
      projectId,
      generationRunId,
      sourceInputId,
      kind: spec.kind,
      title: spec.title,
      content,
      position: spec.position,
    };
  });
}
