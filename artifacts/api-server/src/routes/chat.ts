import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "dummy",
});

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

  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "messages must be an array" });
    return;
  }

  const name = aiName || "AI";
  const persona = aiPersona || "friendly and helpful";

  const systemPrompt = `You are ${name}. Your exact personality, vibe, and language: ${persona}.

CRITICAL RULES FOR YOUR REPLIES:
- Be extremely natural, human-like, and conversational. Match the user's language smoothly.
- Never sound robotic, preachy, or like a typical AI assistant.
- Absolutely no academic jargon, no formal slide references, and no unnecessary advice unless asked.
- Use 100% plain text. ZERO markdown (no asterisks, no bolding, no bullet points).
- Keep responses strictly under 2-3 short sentences for an instant, real-time messaging feel. End with a natural conversational hook if appropriate.`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.slice(-12),
  ];

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 150,
      temperature: 0.7,
      messages: chatMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: "AI unavailable" })}\n\n`);
    res.end();
  }
});

export default router;
