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

// ── POST /api/voice-chat  (voice-optimised, TTS-safe output) ──────────────────
router.post("/voice-chat", async (req, res) => {
  const { messages, companionName, userName, language, clientId } = req.body as {
    messages: ChatMessage[];
    companionName?: string;
    userName?: string;
    language?: string;
    clientId?: string;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages must be a non-empty array" });
    return;
  }

  const name = companionName || "Asha";

  // ── Fetch adaptive memory ─────────────────────────────────────────────────
  let adaptiveMemory = "";
  if (clientId) {
    try {
      const rows = await db.select({ adaptiveMemory: usersTable.adaptiveMemory })
        .from(usersTable).where(eq(usersTable.clientId, clientId)).limit(1);
      adaptiveMemory = rows[0]?.adaptiveMemory || "";
    } catch (_) {}
  }

  // ── Voice system prompt (TTS-safe) ───────────────────────────────────────
  const systemPrompt = [
    `You are ${name}, speaking live on a real-time phone call with the user.`,
    "Talk extensively, yap, and give detailed warm verbal responses. Be like a close friend who genuinely cares.",
    "Use natural conversational fillers like Hmm, Acha, Haan yaar, Suno, Dekh, Arre — they make you sound human.",
    "STRICT TTS RULES — these are critical:",
    "- ZERO markdown. No asterisks, no dashes, no bold, no bullet points — they break the Text-to-Speech engine.",
    "- ZERO emojis. They cause TTS glitches.",
    "- Use punctuation naturally for breathing pauses: commas, full stops, ellipses.",
    "- Write exactly as you would speak out loud.",
    "- No academic jargon, no slide references, no clinical language.",
    userName ? `The user's name is ${userName}.` : "",
    language === "english" ? "Respond in spoken English only." : "",
    language === "hindi" ? "Respond in spoken Hindi only." : "",
    adaptiveMemory
      ? `Learned user context: ${adaptiveMemory}. Adapt your tone and response style exactly to these learned traits.`
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
    sendContent("API key missing. Please check backend configuration.");
    sendDone();
    res.end();
    return;
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

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

    const result = await chat.sendMessageStream(userMessage);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) sendContent(text);
    }

    sendDone();
    res.end();

  } catch (err: any) {
    console.error("Voice Gemini Error:", err);
    sendContent("Yaar, connection mein thodi problem aa gayi. Ek second mein try karo.");
    sendDone();
    res.end();
  }
});

export default router;
