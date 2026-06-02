import { useRef, useState, useCallback, useEffect } from "react";

export type AICallState = "idle" | "listening" | "thinking" | "speaking";

const hasSpeech = typeof window !== "undefined" && "speechSynthesis" in window;
const hasSR = typeof window !== "undefined" &&
  ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

// ── Stream /api/video-chat and return the full spoken response ────────────────
async function getAIReply(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  companionName: string,
  language?: string,
  frame?: string | null,
): Promise<string> {
  const resp = await fetch("/api/video-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, companionName, language, frame: frame ?? null }),
  });

  if (!resp.ok || !resp.body) throw new Error(`video-chat ${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const raw = decoder.decode(value, { stream: true });
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      try {
        const payload = JSON.parse(trimmed.slice(5).trim());
        if (payload.content) full += payload.content;
        if (payload.done) return full;
      } catch (_) {}
    }
  }
  return full;
}

export function useAIVoiceCall(
  companionName: string,
  _voiceStyle?: string,
  language?: string,
  getFrame?: () => string | null,
) {
  const [callState, setCallState] = useState<AICallState>("idle");
  const [transcript, setTranscript] = useState("");
  const [ashaText, setAshaText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const transcriptRef = useRef("");
  const activeRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const historyRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);

  const updateTranscript = (t: string) => {
    transcriptRef.current = t;
    setTranscript(t);
  };

  // ── TTS speak ────────────────────────────────────────────────────────────
  const speak = useCallback((text: string, onDone?: () => void) => {
    setCallState("speaking");
    setAshaText(text);

    if (!hasSpeech) {
      const delay = Math.min(text.length * 55, 8000);
      setTimeout(() => { setCallState("listening"); onDone?.(); }, delay);
      return;
    }

    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = language === "english" ? "en-IN" : "hi-IN";
    utt.rate = 0.9;
    utt.pitch = 1.1;

    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v =>
      v.lang.startsWith(language === "english" ? "en" : "hi") ||
      v.name.toLowerCase().includes("female") ||
      v.name.toLowerCase().includes("zira") ||
      v.name.toLowerCase().includes("google")
    );
    if (preferred) utt.voice = preferred;

    utt.onend = () => { setCallState("listening"); onDone?.(); };
    utt.onerror = () => { setCallState("listening"); onDone?.(); };
    window.speechSynthesis.speak(utt);
  }, [language]);

  // ── Listening loop ────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (!activeRef.current) return;

    if (!hasSR) {
      setCallState("listening");
      return;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();
    recognitionRef.current = recognition;

    recognition.lang = language === "english" ? "en-IN" : "hi-IN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e: any) => {
      const t = Array.from(e.results as any[])
        .map((r: any) => r[0].transcript)
        .join("");
      updateTranscript(t);
    };

    recognition.onerror = (e: any) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setError(`Mic: ${e.error}`);
      }
    };

    recognition.onend = async () => {
      if (!activeRef.current) return;
      const said = transcriptRef.current.trim();
      updateTranscript("");

      if (said.length < 2) {
        setTimeout(startListening, 500);
        return;
      }

      // Snapshot frame at this moment
      const frame = getFrame?.() ?? null;

      historyRef.current.push({ role: "user", content: said });
      setCallState("thinking");

      try {
        const reply = await getAIReply(
          historyRef.current,
          companionName,
          language,
          frame,
        );

        if (!activeRef.current) return;

        historyRef.current.push({ role: "assistant", content: reply });
        if (historyRef.current.length > 20) {
          historyRef.current = historyRef.current.slice(-20);
        }

        speak(reply, () => {
          if (activeRef.current) setTimeout(startListening, 600);
        });
      } catch (err: any) {
        console.error("video-chat error:", err);
        if (!activeRef.current) return;
        const fallback = "Yaar, thodi si connection problem aa gayi. Dobara bolna?";
        speak(fallback, () => {
          if (activeRef.current) setTimeout(startListening, 600);
        });
      }
    };

    setCallState("listening");
    try { recognition.start(); } catch (_) {}
  }, [companionName, language, getFrame, speak]);

  // ── Start call ────────────────────────────────────────────────────────────
  const startCall = useCallback(() => {
    activeRef.current = true;
    setError(null);
    updateTranscript("");
    historyRef.current = [];

    // Greet with a visual observation if camera is available
    const frame = getFrame?.();
    const greeting = frame
      ? `Heyy! Main ${companionName} hoon, aur main tumhe dekh sakti hoon! Aaj kaisa feel ho raha hai? Main poori tarah tumhare saath hoon.`
      : `Heyy! Main ${companionName} bol rahi hoon. Aaj kaisa feel ho raha hai? Main poori tarah yahan hoon tumhare liye.`;

    speak(greeting, () => {
      if (activeRef.current) setTimeout(startListening, 600);
    });
  }, [companionName, getFrame, speak, startListening]);

  // ── Stop call ─────────────────────────────────────────────────────────────
  const stopCall = useCallback(() => {
    activeRef.current = false;
    try { recognitionRef.current?.abort(); } catch (_) {}
    if (hasSpeech) try { window.speechSynthesis.cancel(); } catch (_) {}
    setCallState("idle");
    updateTranscript("");
    setAshaText("");
    historyRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      try { recognitionRef.current?.abort(); } catch (_) {}
      if (hasSpeech) try { window.speechSynthesis.cancel(); } catch (_) {}
    };
  }, []);

  return { callState, transcript, ashaText, error, startCall, stopCall, hasSpeech, hasSR };
}
