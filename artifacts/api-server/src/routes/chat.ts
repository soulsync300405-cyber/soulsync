import { Router } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = Router();

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "dummy");

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

router.post("/chat", async (req, res) => {
  const { messages, aiName, aiPersona } = req.body as {
    messages: ChatMessage[];
    aiName?: string;
    aiPersona?: string;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages must be a non-empty array" });
    return;
  }

  const name = aiName || "Asha";
  const persona =
    aiPersona || "a close friend who talks naturally in friendly Hinglish";

  const systemPrompt = `You are ${name}. Your personality and vibe: ${persona}.
CRITICAL RULES:
1. Act exactly like a human texting a friend. Match the user's tone and language (especially Hinglish).
2. Keep responses extremely short (max 2-3 sentences).
3. Use plain text only. NO markdown, no asterisks, no bolding.
4. Be empathetic, conversational, and never sound like an AI.`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    // Using gemini-1.5-flash for max speed and free tier access
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: systemPrompt,
    });

    // Gemini uses "user" and "model" roles, so we map the history
    const formattedHistory = messages.slice(0, -1).map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const userMessage = messages[messages.length - 1].content;

    const chat = model.startChat({
      history: formattedHistory,
      generationConfig: {
        maxOutputTokens: 150,
        temperature: 0.7,
      },
    });

    const result = await chat.sendMessageStream(userMessage);

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        res.write(`data: ${JSON.stringify({ content: chunkText })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Gemini API Error:", err);
    res.write(
      `data: ${JSON.stringify({ error: "Backend API Error. Check console." })}\n\n`,
    );
    res.end();
  }
});

export default router;
