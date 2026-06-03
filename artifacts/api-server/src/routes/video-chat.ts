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
  const { messages, companionName, userName, language, clientId, frame, mode } = req.body as {
    messages: ChatMessage[];
    companionName?: string;
    userName?: string;
    language?: string;
    clientId?: string;
    frame?: string | null; // base64 JPEG, no data-URL prefix
    mode?: "voice" | "chat"; // voice = short, TTS-optimised; chat = full
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages must be a non-empty array" });
    return;
  }

  const name = companionName || "Asha";
  const isVoiceMode = mode === "voice";

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
  const voiceModeRules = isVoiceMode ? [
    "VOICE CALL MODE: Keep each reply to 1-2 sentences maximum. Be punchy and conversational.",
    "Never start with filler words like 'Of course' or 'Sure'. Jump straight in.",
    "One idea per reply. The user will speak again — you are in a real-time back-and-forth.",
  ] : [
    "Be real, be warm — give heartfelt, detailed responses. Match their energy completely.",
  ];

  const systemPrompt = [
    `You are ${name}, a warm and caring AI bestie on a live ${isVoiceMode ? "voice" : "video"} call.`,
    hasCamera
      ? "You can SEE the user right now through their camera — their face, expressions, body language, environment."
      : "You are on a live voice call with the user.",
    ...voiceModeRules,
    hasCamera && !isVoiceMode
      ? "When visually relevant (tired eyes, messy room, sad expression), mention it naturally like a bestie — not clinically."
      : "",
    "Use natural fillers: Hmm, Acha, Haan yaar, Arre, Dekh, Suno.",
    "STRICT TTS RULES:",
    "- ZERO markdown, ZERO asterisks, ZERO bullet points, ZERO emojis.",
    "- Only natural punctuation: commas, periods, ellipses.",
    "- Write exactly as you would SPEAK OUT LOUD — no formatting whatsoever.",
    "- No disclaimers, no clinical language.",
    userName ? `The user's name is ${userName}.` : "",
    language === "english" ? "Speak in English only." : "",
    language === "hindi" ? "Speak in Hindi only. Use Devanagari script only." : "",
    adaptiveMemory ? `Learned context: ${adaptiveMemory}. Adapt your tone to these traits.` : "",
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
        maxOutputTokens: isVoiceMode ? 220 : 800,
        temperature: isVoiceMode ? 1.0 : 0.9,
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
