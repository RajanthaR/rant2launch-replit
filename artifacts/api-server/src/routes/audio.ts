import { Router, type IRouter, type Request, type Response } from "express";
import { CreateTtsBody } from "@workspace/api-zod";
import { textToSpeech } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

router.post("/audio/tts", async (req: Request, res: Response) => {
  const parsed = CreateTtsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid input: ${parsed.error.message}` });
    return;
  }

  const text = parsed.data.text.trim();
  if (!text) {
    res.status(400).json({ error: "Text can't be empty." });
    return;
  }

  try {
    const speech = await textToSpeech({
      text,
      voice: parsed.data.voice ?? "onyx",
      format: parsed.data.format ?? "mp3",
    });

    res.status(200);
    res.setHeader("Content-Type", speech.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(speech.buffer);
  } catch (error) {
    req.log?.error({ err: error }, "TTS generation failed");
    res.status(502).json({ error: "Failed to generate speech." });
  }
});

export default router;
