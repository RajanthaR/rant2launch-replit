import { Buffer } from "node:buffer";
import { openai } from "./client";

export const SPEECH_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;

export const SPEECH_FORMATS = ["mp3"] as const;

export type SpeechVoice = (typeof SPEECH_VOICES)[number];
export type SpeechFormat = (typeof SPEECH_FORMATS)[number];

export interface TextToSpeechOptions {
  text: string;
  voice?: SpeechVoice;
  format?: SpeechFormat;
}

export interface GeneratedSpeech {
  buffer: Buffer;
  contentType: "audio/mpeg";
  format: SpeechFormat;
}

/**
 * Generate a single spoken rendering of text using Replit-managed OpenAI audio.
 */
export async function textToSpeech(
  opts: TextToSpeechOptions,
): Promise<GeneratedSpeech> {
  const format = opts.format ?? "mp3";
  const response = await openai.chat.completions.create({
    model: "gpt-audio",
    modalities: ["text", "audio"],
    audio: { voice: opts.voice ?? "onyx", format },
    messages: [
      {
        role: "system",
        content:
          "Read the user's text aloud verbatim in a warm, founder-confident narration voice.",
      },
      { role: "user", content: opts.text },
    ],
  });

  const audio = (response.choices[0]?.message as { audio?: { data?: string } })
    .audio?.data;

  if (!audio) {
    throw new Error("gpt-audio returned no audio data");
  }

  return {
    buffer: Buffer.from(audio, "base64"),
    contentType: "audio/mpeg",
    format,
  };
}
