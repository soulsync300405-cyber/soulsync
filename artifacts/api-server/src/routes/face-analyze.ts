import { Router } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

router.post("/face-analyze", async (req, res) => {
  const { frame } = req.body as { frame?: string | null };

  if (!frame || frame.length < 100) {
    res.status(400).json({ error: "No valid frame provided" });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: "API key missing" });
    return;
  }

  const base64 = frame.startsWith("data:") ? frame.split(",")[1] : frame;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const result = await model.generateContent([
      {
        inlineData: { mimeType: "image/jpeg", data: base64 },
      },
      {
        text: `Analyze this person's facial expression and body language. Respond ONLY with a valid JSON object (no markdown, no code blocks) with exactly these keys:
{
  "emotion": "<primary emotion in 2-3 words, e.g. 'Mild Anxiety', 'Calm Focus', 'Tired But Okay', 'Happy & Energized'>",
  "fatigue": <integer 0-100, 0=fully rested, 100=extremely tired>,
  "focus": <integer 0-100, 0=very distracted, 100=deeply focused>,
  "confidence": <integer 0-100>,
  "stress": <integer 0-100>,
  "advice": "<1-2 warm, friendly sentences of advice based on what you see, in Hinglish or English, like a caring bestie>"
}
Be honest but kind. If you cannot see a face clearly, still make a reasonable estimate.`,
      },
    ]);

    const raw = result.response.text().trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON in response");
    }
    const data = JSON.parse(jsonMatch[0]);
    res.json(data);
  } catch (err: any) {
    console.error("Face analyze error:", err);
    res.status(500).json({
      emotion: "Thoughtful",
      fatigue: 45,
      focus: 60,
      confidence: 72,
      stress: 35,
      advice: "Looks like you're doing okay! Take a moment to breathe and center yourself.",
    });
  }
});

export default router;
