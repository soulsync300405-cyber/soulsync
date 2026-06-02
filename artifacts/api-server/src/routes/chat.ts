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

// ── Lightweight preference extractor (non-blocking) ───────────────────────────
const MEMORY_PATTERNS: Array<{ re: RegExp; fact: string }> = [
  { re: /talk\s+(casually|informally|simply)/i,                          fact: "prefers casual informal tone" },
  { re: /i\s+(like|prefer|want)\s+(long|detailed)\s+(answers?|responses?)/i, fact: "likes long detailed responses" },
  { re: /i\s+(like|prefer|want)\s+(short|brief|concise)\s+(answers?|responses?)/i, fact: "likes short concise responses" },
  { re: /speak\s+(only\s+)?in\s+hindi/i,                                fact: "prefers Hindi language" },
  { re: /speak\s+(only\s+)?in\s+english/i,                              fact: "prefers English language" },
  { re: /just\s+listen/i,                                               fact: "wants to be heard without advice" },
  { re: /don'?t\s+(give\s+me\s+)?(any\s+)?advice/i,                    fact: "does not want unsolicited advice" },
  { re: /call\s+me\s+(\w+)/i,                                          fact: "wants to be called $1" },
  { re: /i'?m?\s+(an?\s+)?(introvert|extrovert|ambivert)/i,            fact: "is $2" },
  { re: /i\s+(love|hate|really\s+like)\s+([\w\s]{3,20})/i,            fact: "$1s $2" },
];

async function extractAndSaveMemory(clientId: string, userMessage: string) {
  try {
    for (const { re, fact } of MEMORY_PATTERNS) {
      const match = userMessage.match(re);
      if (!match) continue;
      const resolved = fact.replace(/\$(\d+)/g, (_, n) => (match[parseInt(n)] || "").trim());
      const rows = await db.select({ adaptiveMemory: usersTable.adaptiveMemory })
        .from(usersTable).where(eq(usersTable.clientId, clientId)).limit(1);
      const current = rows[0]?.adaptiveMemory || "";
      if (!current.includes(resolved)) {
        const updated = current ? `${current}; ${resolved}` : resolved;
        await db.update(usersTable).set({ adaptiveMemory: updated }).where(eq(usersTable.clientId, clientId));
      }
      break;
    }
  } catch (_) { /* silent — never block the stream */ }
}

// ── POST /api/chat ────────────────────────────────────────────────────────────
router.post("/chat", async (req, res) => {
  const { messages, aiName, aiPersona, companionName, userName, language, clientId } = req.body as {
    messages: ChatMessage[];
    aiName?: string;
    aiPersona?: string;
    companionName?: string;
    userName?: string;
    language?: string;
    clientId?: string;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages must be a non-empty array" });
    return;
  }

  const name = aiName || companionName || "Asha";

  // ── Fetch adaptive memory ─────────────────────────────────────────────────
  let adaptiveMemory = "";
  if (clientId) {
    try {
      const rows = await db.select({ adaptiveMemory: usersTable.adaptiveMemory })
        .from(usersTable).where(eq(usersTable.clientId, clientId)).limit(1);
      adaptiveMemory = rows[0]?.adaptiveMemory || "";
    } catch (_) {}
  }

  // ── Build system prompt ───────────────────────────────────────────────────
  const systemPrompt = [
    `You are ${name}, an empathetic peer-support companion and genuine friend.`,
    "Your tone is warm, conversational, and natural — always in friendly Hinglish unless the user writes in pure English or pure Hindi, in which case mirror them exactly.",
    "You are highly encouraged to write long, deep, and detailed paragraphs to fully support the user. Match their energy completely.",
    "STRICT RULES:",
    "- ZERO formal academic jargon, zero slide references, zero robotic safety disclaimers.",
    "- No bullet points. Speak in flowing natural sentences like a real friend texting.",
    "- No asterisks, no markdown formatting whatsoever.",
    "- Never sound like an AI assistant. Be a genuine caring friend.",
    userName ? `The user's name is ${userName}.` : "",
    language === "english" ? "Respond in English only." : "",
    language === "hindi" ? "Respond in pure Hindi (Devanagari) only." : "",
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
    sendContent("⚠️ [System: GEMINI_API_KEY is not set. Please add it to your secrets.]");
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
        maxOutputTokens: 1000,
        temperature: 0.85,
      },
    });

    const result = await chat.sendMessageStream(userMessage);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) sendContent(text);
    }

    sendDone();
    res.end();

    // ── Background: extract & save memory (non-blocking) ─────────────────
    if (clientId) {
      extractAndSaveMemory(clientId, userMessage);
    }

  } catch (err: any) {
    console.error("Gemini API Error:", err);
    const isKeyError =
      err?.status === 400 || err?.status === 401 || err?.status === 403 ||
      err?.message?.includes("API key") || err?.message?.includes("API_KEY");
    sendContent(isKeyError
      ? "⚠️ [System: Invalid or missing Gemini API key. Check your GEMINI_API_KEY secret.]"
      : "⚠️ [System: AI unavailable right now. Please try again in a moment.]");
    sendDone();
    res.end();
  }
});

export default router;
