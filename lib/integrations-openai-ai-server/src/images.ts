import { Buffer } from "node:buffer";
import { openai } from "./client";

export type GptImageSize = "1024x1024" | "1024x1536" | "1536x1024";
export type GptImageQuality = "low" | "medium" | "high" | "auto";

export interface GenerateImageOptions {
  prompt: string;
  size?: GptImageSize;
  quality?: GptImageQuality;
}

export interface GeneratedImage {
  buffer: Buffer;
  contentType: "image/png";
}

/**
 * Generate a single image with gpt-image-1 and return raw bytes.
 *
 * gpt-image-1 always responds with a base64 PNG; the wrapper exists so callers
 * never have to remember the encoding contract or the model name.
 */
export async function generateImage(
  opts: GenerateImageOptions,
): Promise<GeneratedImage> {
  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt: opts.prompt,
    size: opts.size ?? "1024x1024",
    quality: opts.quality ?? "low",
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("gpt-image-1 returned no image data");
  }
  return {
    buffer: Buffer.from(b64, "base64"),
    contentType: "image/png",
  };
}
