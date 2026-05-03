import { randomUUID } from "node:crypto";
import {
  generateImage,
  type GptImageSize,
} from "@workspace/integrations-openai-ai-server";
import {
  objectStorageClient,
  ObjectStorageService,
} from "./objectStorage";
import { setObjectAclPolicy } from "./objectAcl";
import { logger } from "./logger";

// =====================================================================
// Visual asset generation for storyboard frames + carousel slides.
//
// After the launch package text has been generated and validated, we
// fan out one gpt-image-1 call per storyboard frame and per carousel
// slide. Each PNG is uploaded into the project's own folder under
// PRIVATE_OBJECT_DIR with a public ACL so the workspace can render it
// inline via /api/storage/objects/...
//
// Per-image failures are logged and skipped — a missing image leaves
// the frame/slide rendering with the existing text-only fallback. We do
// NOT fail the whole launch because a single image-gen call timed out;
// the launch is still shippable copy.
// =====================================================================

interface ParsedObjectPath {
  bucketName: string;
  objectName: string;
}

function parseObjectPath(path: string): ParsedObjectPath {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/");
  if (parts.length < 3) {
    throw new Error(`Invalid object path: ${path}`);
  }
  return {
    bucketName: parts[1]!,
    objectName: parts.slice(2).join("/"),
  };
}

const STORYBOARD_STYLE = `Cinematic editorial photograph. Bold composition, high contrast lighting, shallow depth of field, modern color grading. No text, no captions, no logos, no watermarks, no emojis.`;
const CAROUSEL_STYLE = `Bold modern editorial illustration in a vibrant magenta-and-cyan palette. Clean geometric composition, generous negative space, premium magazine aesthetic. No text, no captions, no logos, no watermarks, no emojis.`;

export interface StoryboardFrameVisualInput {
  frame: number;
  visual: string;
  // Any of these may be empty for legacy data; the prompt builder handles
  // missing fields gracefully by skipping the corresponding line.
  hook?: string;
  voiceover?: string;
  onScreenText?: string;
}

export interface VisualGenInput {
  storyboardFrames: StoryboardFrameVisualInput[];
  carouselSlides: Array<{ slide: number; headline: string; body: string }>;
  projectSlug: string;
  launchAngle: string;
  // Optional progress hook fired once per image as soon as its
  // generate-and-upload promise settles (success OR failure). The job
  // worker uses this to bump generation_jobs.progress_done so polling
  // clients see per-image progress. Errors thrown by the callback are
  // swallowed so a flaky progress sink can't break image generation.
  onImageComplete?: (info: {
    kind: "storyboard" | "carousel";
    index: number;
    success: boolean;
  }) => void;
}

export interface VisualGenResult {
  storyboardImages: Map<number, string>;
  carouselImages: Map<number, string>;
}

/**
 * Generate and persist all storyboard + carousel visuals in parallel.
 * Returns maps from frame/slide index to the public objectPath for each
 * image. Frames/slides whose generation failed are simply absent from
 * the maps, and the workspace falls back to the text-only card.
 */
export async function generateLaunchVisuals(
  input: VisualGenInput,
): Promise<VisualGenResult> {
  const service = new ObjectStorageService();
  let privateDir: string;
  try {
    privateDir = service.getPrivateObjectDir();
  } catch (err) {
    logger.error({ err }, "Object storage is not configured; skipping visuals");
    return {
      storyboardImages: new Map(),
      carouselImages: new Map(),
    };
  }

  const tasks: Array<Promise<void>> = [];
  const storyboardImages = new Map<number, string>();
  const carouselImages = new Map<number, string>();

  const fireProgress = (
    kind: "storyboard" | "carousel",
    index: number,
    success: boolean,
  ) => {
    if (!input.onImageComplete) return;
    try {
      input.onImageComplete({ kind, index, success });
    } catch (err) {
      logger.warn({ err, kind, index }, "onImageComplete callback threw; ignoring");
    }
  };

  for (const frame of input.storyboardFrames) {
    tasks.push(
      generateAndUpload({
        prompt: buildStoryboardPrompt(frame, input.launchAngle),
        size: "1536x1024",
        privateDir,
        projectSlug: input.projectSlug,
        kindFolder: "storyboard",
        index: frame.frame,
      }).then((path) => {
        if (path) storyboardImages.set(frame.frame, path);
        fireProgress("storyboard", frame.frame, Boolean(path));
      }),
    );
  }

  for (const slide of input.carouselSlides) {
    tasks.push(
      generateAndUpload({
        prompt: buildCarouselPrompt(slide.headline, slide.body, input.launchAngle),
        size: "1024x1024",
        privateDir,
        projectSlug: input.projectSlug,
        kindFolder: "carousel",
        index: slide.slide,
      }).then((path) => {
        if (path) carouselImages.set(slide.slide, path);
        fireProgress("carousel", slide.slide, Boolean(path));
      }),
    );
  }

  await Promise.allSettled(tasks);
  logger.info(
    {
      projectSlug: input.projectSlug,
      storyboardCount: storyboardImages.size,
      carouselCount: carouselImages.size,
      storyboardRequested: input.storyboardFrames.length,
      carouselRequested: input.carouselSlides.length,
    },
    "Launch visuals generation complete",
  );

  return { storyboardImages, carouselImages };
}

/**
 * Regenerate visuals for a single section (storyboard OR carousel) when
 * the founder asks for a new take on just that one section. Same shape
 * as `generateLaunchVisuals` but accepts the lists optionally so the
 * caller can pass only the slides or only the frames it actually needs.
 */
export async function regenerateSectionVisuals(input: {
  projectSlug: string;
  launchAngle: string;
  storyboardFrames?: StoryboardFrameVisualInput[];
  carouselSlides?: Array<{ slide: number; headline: string; body: string }>;
}): Promise<VisualGenResult> {
  return generateLaunchVisuals({
    projectSlug: input.projectSlug,
    launchAngle: input.launchAngle,
    storyboardFrames: input.storyboardFrames ?? [],
    carouselSlides: input.carouselSlides ?? [],
  });
}

interface GenerateAndUploadArgs {
  prompt: string;
  size: GptImageSize;
  privateDir: string;
  projectSlug: string;
  kindFolder: "storyboard" | "carousel";
  index: number;
}

async function generateAndUpload(args: GenerateAndUploadArgs): Promise<string | null> {
  try {
    const image = await generateImage({
      prompt: args.prompt,
      size: args.size,
      quality: "low",
    });

    const objectId = randomUUID();
    // Entity id (relative to PRIVATE_OBJECT_DIR) becomes the public path
    // that the workspace renders, e.g. /objects/launches/<slug>/storyboard/3-<uuid>.png
    const entityId = `launches/${args.projectSlug}/${args.kindFolder}/${args.index}-${objectId}.png`;
    const fullPath = `${stripTrailingSlash(args.privateDir)}/${entityId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.save(image.buffer, {
      contentType: image.contentType,
      resumable: false,
      metadata: { contentType: image.contentType },
    });

    // Public visibility so the workspace can render the image without auth.
    // The serve route still goes through our Express handler so we can
    // change visibility later without invalidating saved URLs.
    await setObjectAclPolicy(file, {
      owner: `project:${args.projectSlug}`,
      visibility: "public",
    });

    return `/objects/${entityId}`;
  } catch (err) {
    logger.warn(
      { err, projectSlug: args.projectSlug, kind: args.kindFolder, index: args.index },
      "Visual asset generation failed; continuing without image",
    );
    return null;
  }
}

function stripTrailingSlash(p: string): string {
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

function buildStoryboardPrompt(
  frame: StoryboardFrameVisualInput,
  angle: string,
): string {
  // Use the richest text available from the new contract to shape the
  // image. `visual` is always the scene; `hook` and `voiceover` (or the
  // legacy `caption` mapped onto `voiceover` upstream) supply mood.
  const moodParts = [frame.hook?.trim(), frame.voiceover?.trim()].filter(
    (s): s is string => Boolean(s && s.length > 0),
  );
  const lines = [
    `Storyboard frame for a startup launch video.`,
    `Scene: ${frame.visual}`,
  ];
  if (moodParts.length > 0) {
    lines.push(`Mood / message: ${moodParts.join(" — ")}`);
  }
  if (frame.onScreenText?.trim()) {
    // Note: STORYBOARD_STYLE explicitly forbids text in the rendered
    // image. We pass the on-screen line for thematic cueing only.
    lines.push(`Thematic cue (do NOT render as text): ${frame.onScreenText.trim()}`);
  }
  lines.push(`Launch context: ${angle}`);
  lines.push(STORYBOARD_STYLE);
  return lines.join("\n\n");
}

function buildCarouselPrompt(headline: string, body: string, angle: string): string {
  return [
    `Instagram-style carousel slide artwork supporting this headline.`,
    `Headline: ${headline}`,
    `Body: ${body}`,
    `Launch context: ${angle}`,
    CAROUSEL_STYLE,
  ].join("\n\n");
}
