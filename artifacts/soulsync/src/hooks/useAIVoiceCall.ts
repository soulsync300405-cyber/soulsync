import { useRef, useState, useCallback, useEffect } from "react";

export type AICallState = "idle" | "listening" | "thinking" | "speaking";

const hasSpeech = typeof window !== "undefined" && "speechSynthesis" in window;
const hasSR =
  typeof window !== "undefined" &&
  ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

// ── Voice loading ─────────────────────────────────────────────────────────────
// Chrome loads voices asynchronously. getVoices() returns [] on first call.
// We cache them after the voiceschanged event fires.
let _cachedVoices: SpeechSynthesisVoice[] = [];

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!hasSpeech) return Promise.resolve([]);
  const immediate = window.speechSynthesis.getVoices();
  if (immediate.length > 0) {
    _cachedVoices = immediate;
    return Promise.resolve(immediate);
  }
  if (_cachedVoices.length > 0) return Promise.resolve(_cachedVoices);
  return new Promise(resolve => {
    const handler = () => {
      _cachedVoices = window.speechSynthesis.getVoices();
      resolve(_cachedVoices);
    };
    window.speechSynthesis.addEventListener("voiceschanged", handler, { once: true });
    // fallback if event never fires
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 3000);
  });
}

// ── Pick the best available TTS voice ─────────────────────────────────────────
// IMPORTANT: Hinglish responses are Roman-script text. hi-IN voices read Devanagari
// and will either fail silently or produce garbage. Always prefer an en-IN or en-US
// voice — they handle Hinglish far better than hi-IN.
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  // 1. Google Indian English — best quality + accent
  const googleIN = voices.find(v => v.name.includes("Google") && v.lang === "en-IN");
  if (googleIN) return googleIN;
  // 2. Any Google English voice
  const googleEN = voices.find(v => v.name.includes("Google") && v.lang.startsWith("en"));
  if (googleEN) return googleEN;
  // 3. Any Indian English
  const anyIN = voices.find(v => v.lang === "en-IN");
  if (anyIN) return anyIN;
  // 4. Microsoft / Zira (Windows)
  const zira = voices.find(v => v.name.toLowerCase().includes("zira"));
  if (zira) return zira;
  // 5. Any English voice
  const anyEN = voices.find(v => v.lang.startsWith("en"));
  if (anyEN) return anyEN;
  // 6. Absolute fallback — first voice
  return voices[0];
}

// ── SSE streaming generator — yields complete sentences as they arrive ────────
async function* streamAIReply(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  companionName: string,
  language?: string,
  frame?: string | null,
): AsyncGenerator<string> {
  const resp = await fetch("/api/video-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      companionName,
      language,
      frame: frame ?? null,
      mode: "voice",
    }),
  });

  if (!resp.ok || !resp.body) throw new Error(`video-chat ${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const yieldSentences = function* (text: string): Generator<string> {
    // Match sentence-ending punctuation: . ! ? ... — Indian-style ।
    const re = /(.+?[.!?।…]+)\s*/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const s = m[1].trim();
      if (s.length > 3) yield s;
      last = re.lastIndex;
    }
    return text.slice(last); // return leftover (not a complete sentence)
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const raw = decoder.decode(value, { stream: true });
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      try {
        const payload = JSON.parse(trimmed.slice(5).trim());
        if (payload.content) {
          buffer += payload.content;
          // Yield any complete sentences
          const re = /(.+?[.!?।…]+)\s*/g;
          let last = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(buffer)) !== null) {
            const s = m[1].trim();
            if (s.length > 3) yield s;
            last = re.lastIndex;
          }
          buffer = buffer.slice(last); // keep incomplete sentence
        }
        if (payload.done) {
          const rem = buffer.trim();
          if (rem.length > 2) yield rem;
          return;
        }
      } catch (_) {}
    }
  }
  if (buffer.trim().length > 2) yield buffer.trim();
}

// ── Hook ──────────────────────────────────────────────────────────────────────
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

  const transcriptRef  = useRef("");
  const activeRef      = useRef(false);
  const recognitionRef = useRef<any>(null);
  const historyRef     = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const voicesRef      = useRef<SpeechSynthesisVoice[]>([]);
  const speakingRef    = useRef(false);

  const updateTranscript = (t: string) => { transcriptRef.current = t; setTranscript(t); };

  // Preload voices + Chrome keepalive
  useEffect(() => {
    if (!hasSpeech) return;
    loadVoices().then(v => { voicesRef.current = v; });

    // Chrome bug: speechSynthesis.speaking pauses silently after ~15s of page
    // inactivity. pause()+resume() every 10s keeps it alive.
    const ka = setInterval(() => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10_000);
    return () => clearInterval(ka);
  }, []);

  // ── Speak a single text chunk, returns when done ──────────────────────────
  const speakChunk = useCallback(
    (text: string): Promise<void> =>
      new Promise(resolve => {
        if (!hasSpeech || !text.trim()) { resolve(); return; }
        const utt = new SpeechSynthesisUtterance(text);

        // Always use English TTS — Hinglish text is Roman script, hi-IN voice can't read it
        utt.lang  = "en-IN";
        utt.rate  = 1.0;
        utt.pitch = 1.05;
        utt.volume = 1.0;

        // Use cached voices, try to load if empty
        const voices = voicesRef.current.length > 0
          ? voicesRef.current
          : window.speechSynthesis.getVoices();
        const voice = pickVoice(voices);
        if (voice) utt.voice = voice;

        utt.onend   = () => resolve();
        utt.onerror = (e) => {
          console.warn("[TTS] error:", e.error, "text:", text.slice(0, 40));
          resolve();
        };
        window.speechSynthesis.speak(utt);
      }),
    [],
  );

  // ── Reference to startListening so async callbacks can call latest version ─
  const startListeningRef = useRef<() => void>(() => {});

  // ── Speak full response (sentence by sentence via queue) ──────────────────
  const speakFull = useCallback(
    async (sentences: string[]) => {
      setCallState("speaking");
      speakingRef.current = true;
      window.speechSynthesis.cancel();

      for (const s of sentences) {
        if (!activeRef.current) break;
        await speakChunk(s);
      }

      speakingRef.current = false;
      if (activeRef.current) {
        setCallState("listening");
        setTimeout(() => startListeningRef.current(), 500);
      }
    },
    [speakChunk],
  );

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

    // Use en-IN for Hinglish recognition too — works better than hi-IN
    recognition.lang            = "en-IN";
    recognition.interimResults  = true;
    recognition.continuous      = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e: any) => {
      const t = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join("");
      updateTranscript(t);
    };

    recognition.onerror = (e: any) => {
      if (e.error === "not-allowed") {
        setError("Microphone access denied — please allow mic in browser settings");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        console.warn("[SR] error:", e.error);
      }
    };

    recognition.onend = async () => {
      if (!activeRef.current) return;
      const said = transcriptRef.current.trim();
      updateTranscript("");

      if (said.length < 2) {
        setTimeout(() => startListeningRef.current(), 350);
        return;
      }

      historyRef.current.push({ role: "user", content: said });
      setCallState("thinking");

      try {
        const frame = getFrame?.() ?? null;
        const sentences: string[] = [];
        let fullReply = "";
        let ttsStarted = false;

        // Start the TTS pipeline as each sentence arrives (streaming TTS)
        const pendingChunks: string[] = [];
        let generatorDone = false;

        const ttsLoop = async () => {
          while (activeRef.current && (!generatorDone || pendingChunks.length > 0)) {
            if (pendingChunks.length === 0) {
              await new Promise(r => setTimeout(r, 30));
              continue;
            }
            const chunk = pendingChunks.shift()!;
            await speakChunk(chunk);
          }
        };

        const gen = streamAIReply(historyRef.current, companionName, language, frame);
        for await (const chunk of gen) {
          if (!activeRef.current) return;
          sentences.push(chunk);
          fullReply += (fullReply ? " " : "") + chunk;
          setAshaText(prev => prev ? prev + " " + chunk : chunk);

          pendingChunks.push(chunk);
          if (!ttsStarted) {
            ttsStarted = true;
            setCallState("speaking");
            speakingRef.current = true;
            ttsLoop(); // fire-and-forget, runs concurrently
          }
        }

        generatorDone = true;

        // Wait for TTS to finish (both queue empty AND last chunk done speaking)
        while (ttsRunning || pendingChunks.length > 0) {
          await new Promise(r => setTimeout(r, 50));
        }

        if (!activeRef.current) return;

        historyRef.current.push({ role: "assistant", content: fullReply });
        if (historyRef.current.length > 20) historyRef.current = historyRef.current.slice(-20);

        speakingRef.current = false;
        setCallState("listening");
        setTimeout(() => startListeningRef.current(), 600);
      } catch (err: any) {
        console.error("[AI Call] error:", err);
        if (!activeRef.current) return;
        await speakChunk("Yaar, thodi si connection problem aa gayi. Ek second ruko.");
        if (activeRef.current) {
          setCallState("listening");
          setTimeout(() => startListeningRef.current(), 800);
        }
      }
    };

    setCallState("listening");
    try { recognition.start(); } catch (_) {}
  }, [companionName, language, getFrame, speakChunk]);

  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);

  // ── Start call ────────────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
    activeRef.current = true;
    speakingRef.current = false;
    setError(null);
    updateTranscript("");
    setAshaText("");
    historyRef.current = [];

    // Ensure voices are loaded before first speak
    if (voicesRef.current.length === 0) {
      voicesRef.current = await loadVoices();
    }

    const greeting = `Heyy! Main ${companionName} bol rahi hoon. Aaj kaisa feel ho raha hai? Main bilkul yahan hoon tumhare liye.`;
    setAshaText(greeting);
    setCallState("speaking");
    speakingRef.current = true;
    await speakFull([greeting]);
  }, [companionName, speakFull]);

  // ── Stop call ─────────────────────────────────────────────────────────────
  const stopCall = useCallback(() => {
    activeRef.current = false;
    speakingRef.current = false;
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
