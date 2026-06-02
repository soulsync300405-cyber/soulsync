import { Router } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// ── POST /api/video-chat  (multimodal — sees camera frame + hears user) ────────
router.post("/video-chat", async (req, res) => {
  const { messages, companionName, userName, language, clientId, frame } = req.body as {
    messages: ChatMessage[];
    companionName?: string;
    userName?: string;
    language?: string;
    clientId?: string;
    frame?: string | null; // base64 JPEG, no data-URL prefix
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages must be a non-empty array" });
    return;
  }

  const name = companionName || "Asha";

  // ── Adaptive memory ───────────────────────────────────────────────────────
  let adaptiveMemory = "";
  if (clientId) {
    try {
      const rows = await db.select({ adaptiveMemory: usersTable.adaptiveMemory })
        .from(usersTable).where(eq(usersTable.clientId, clientId)).limit(1);
      adaptiveMemory = rows[0]?.adaptiveMemory || "";
    } catch (_) {}
  }

  // ── System prompt ─────────────────────────────────────────────────────────
  const hasCamera = Boolean(frame);
  const systemPrompt = [
    `You are ${name}, a warm and genuinely caring AI bestie on a live video call.`,
    hasCamera
      ? "You can SEE the user right now through their camera — their face, expressions, body language, and the environment around them."
      : "You are on a live voice call with the user.",
    "Be real, be warm, yap freely — give detailed, long, heartfelt responses. Match their energy completely.",
    hasCamera
      ? "When something visually relevant appears (tired eyes, a messy room, dim lights, them looking sad or stressed), notice it naturally like a bestie would — not clinically. Say things like \"Arre yaar tu thaka hua dikh raha hai\" or \"Your setup looks cozy!\" only when it genuinely adds to the conversation."
      : "",
    "Use natural conversational fillers: Hmm, Acha, Haan yaar, Arre, Dekh, Suno.",
    "STRICT TTS RULES — these are critical for Text-to-Speech:",
    "- ZERO markdown, ZERO asterisks, ZERO bullet points, ZERO emojis.",
    "- Use only natural punctuation for breathing pauses: commas, periods, ellipses.",
    "- Write exactly as you would speak out loud — no formatting whatsoever.",
    "- No academic jargon, no clinical language, no robotic disclaimers.",
    userName ? `The user's name is ${userName}.` : "",
    language === "english" ? "Speak in English only." : "",
    language === "hindi" ? "Speak in Hindi only." : "",
    adaptiveMemory
      ? `Learned user context: ${adaptiveMemory}. Adapt your tone and style exactly to these traits.`
      : "",
  ].filter(Boolean).join("\n");

  // ── SSE headers ───────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const sendContent = (text: string) =>
    res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
  const sendDone = () =>
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);

  if (!process.env.GEMINI_API_KEY) {
    sendContent("API key missing.");
    sendDone();
    res.end();
    return;
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

    // History is text-only (previous turns)
    const formattedHistory = messages
      .slice(0, -1)
      .map((msg) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      }))
      .filter((_, i, arr) => {
        const firstUserIdx = arr.findIndex((m) => m.role === "user");
        return i >= firstUserIdx;
      });

    const userMessage = messages[messages.length - 1].content;

    const chat = model.startChat({
      history: formattedHistory,
      generationConfig: {
        maxOutputTokens: 800,
        temperature: 0.9,
      },
    });

    // Current turn: text + optional camera frame
    const userParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> =
      [{ text: userMessage }];

    if (frame && frame.length > 100) {
      // Strip data-URL prefix if present
      const base64 = frame.startsWith("data:")
        ? frame.split(",")[1]
        : frame;
      userParts.push({
        inlineData: { mimeType: "image/jpeg", data: base64 },
      });
    }

    const result = await chat.sendMessageStream(userParts);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) sendContent(text);
    }

    sendDone();
    res.end();

  } catch (err: any) {
    console.error("Video-chat Gemini Error:", err);
    sendContent("Yaar, connection mein thodi si problem aa gayi. Ek second ruko.");
    sendDone();
    res.end();
  }
});

export default router;
