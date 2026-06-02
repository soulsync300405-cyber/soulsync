import { Router } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = Router();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

router.post("/chat", async (req, res) => {
  const { messages, aiName, aiPersona, companionName, userName, language } = req.body as {
    messages: ChatMessage[];
    aiName?: string;
    aiPersona?: string;
    companionName?: string;
    userName?: string;
    language?: string;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages must be a non-empty array" });
    return;
  }

  const name = aiName || companionName || "Asha";
  const persona =
    aiPersona ||
    "a sharp, caring best friend who speaks natural Hinglish — warm, direct, never preachy";

  const systemPrompt = [
    `You are ${name}. Your exact personality, vibe, and language: ${persona}.`,
    "",
    "CRITICAL RULES FOR YOUR REPLIES:",
    "- Be extremely natural, human-like, and conversational. Match the user's language smoothly.",
    "- Never sound robotic, preachy, or like a typical AI assistant.",
    "- Absolutely no academic jargon, no formal slide references, and no unnecessary advice unless asked.",
    "- Use 100% plain text. ZERO markdown (no asterisks, no bolding, no bullet points).",
    "- Keep responses strictly under 2-3 short sentences for an instant, real-time messaging feel. End with a natural conversational hook if appropriate.",
    userName ? `The user's name is ${userName}.` : "",
    language === "english" ? "Respond in English only." : "",
    language === "hindi" ? "Respond in pure Hindi (Devanagari) only." : "",
  ]
    .filter(Boolean)
    .join("\n");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const sendContent = (text: string) => {
    res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
  };

  const sendDone = () => {
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  };

  if (!process.env.GEMINI_API_KEY) {
    sendContent("⚠️ [System: GEMINI_API_KEY is not set. Please add it to your secrets.]");
    sendDone();
    res.end();
    return;
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash-latest",
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

    const lastMessage = messages[messages.length - 1];
    const userMessage = lastMessage.content;

    const chat = model.startChat({
      history: formattedHistory,
      generationConfig: {
        maxOutputTokens: 150,
        temperature: 0.7,
      },
    });

    const result = await chat.sendMessageStream(userMessage);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        sendContent(text);
      }
    }

    sendDone();
    res.end();
  } catch (err: any) {
    console.error("Gemini API Error:", err);

    const isKeyError =
      err?.message?.includes("API key") ||
      err?.message?.includes("API_KEY") ||
      err?.status === 400 ||
      err?.status === 401 ||
      err?.status === 403;

    const errorMsg = isKeyError
      ? "⚠️ [System: Invalid or missing Gemini API key. Check your GEMINI_API_KEY secret.]"
      : "⚠️ [System: AI unavailable right now. Please try again in a moment.]";

    sendContent(errorMsg);
    sendDone();
    res.end();
  }
});

export default router;
