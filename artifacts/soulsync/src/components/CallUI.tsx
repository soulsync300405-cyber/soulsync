import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Volume2, VolumeX,
  Camera, Shield, Wifi, WifiOff, Eye, EyeOff, Sparkles, Radio
} from "lucide-react";
import { AnimeAvatar } from "@/components/AnimeAvatar";
import type { Companion } from "@/lib/store";
import { useAIVoiceCall } from "@/hooks/useAIVoiceCall";
import { useWebRTC } from "@/hooks/useWebRTC";

interface CallUIProps {
  type: "ai" | "psychologist";
  companion?: Companion | null;
  psychName?: string;
  onEnd: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function requestStream(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return null;
    }
  }
}

function useLocalStream() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);

  const start = useCallback(async () => {
    const s = await requestStream();
    if (s) {
      setStream(s);
      setHasVideo(s.getVideoTracks().length > 0);
      setHasAudio(s.getAudioTracks().length > 0);
    }
    return s;
  }, []);

  const stop = useCallback(() => {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
  }, [stream]);

  const toggleMute = useCallback(() => {
    stream?.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setMuted(m => !m);
  }, [stream]);

  const toggleCam = useCallback(() => {
    stream?.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    setCamOff(c => !c);
  }, [stream]);

  return { stream, hasVideo, hasAudio, muted, camOff, start, stop, toggleMute, toggleCam };
}

// ── Camera frame capture hook (1 FPS for AI vision) ─────────────────────────
function useFrameCapture(stream: MediaStream | null, active: boolean) {
  const videoRef = useRef<HTMLVideoElement>(document.createElement("video"));
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const [lastFrame, setLastFrame] = useState<string | null>(null);

  useEffect(() => {
    if (!stream || !active) return;
    const video = videoRef.current;
    video.srcObject = stream;
    video.play().catch(() => {});

    const interval = setInterval(() => {
      const canvas = canvasRef.current;
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d");
      if (ctx && video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, 320, 240);
        setLastFrame(canvas.toDataURL("image/jpeg", 0.7));
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      video.srcObject = null;
    };
  }, [stream, active]);

  return lastFrame;
}

// ── Duration timer ───────────────────────────────────────────────────────────
function useDuration(running: boolean) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!running) { setSecs(0); return; }
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return fmt(secs);
}

// ── Main CallUI ──────────────────────────────────────────────────────────────
export function CallUI({ type, companion, psychName, onEnd }: CallUIProps) {
  const [phase, setPhase] = useState<"permission" | "starting" | "active">("permission");
  const local = useLocalStream();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [speakerMuted, setSpeakerMuted] = useState(false);

  const roomId = `psych-${(psychName || "asha").toLowerCase().replace(/\s+/g, "-")}-room`;
  const webrtc = useWebRTC(roomId, type === "psychologist" ? local.stream : null);

  const aiCall = useAIVoiceCall(
    companion?.name || "Asha",
    companion?.voiceStyle,
    companion?.language,
  );

  const duration = useDuration(phase === "active");
  const _frame = useFrameCapture(local.stream, phase === "active" && type === "ai");

  // Wire local stream → local video element
  useEffect(() => {
    if (localVideoRef.current && local.stream) {
      localVideoRef.current.srcObject = local.stream;
    }
  }, [local.stream]);

  // Wire remote stream → remote video element
  useEffect(() => {
    if (remoteVideoRef.current && webrtc.remoteStream) {
      remoteVideoRef.current.srcObject = webrtc.remoteStream;
    }
  }, [webrtc.remoteStream]);

  const handleStart = useCallback(async () => {
    setPhase("starting");
    await local.start();

    if (type === "psychologist") {
      webrtc.connect();
    } else {
      aiCall.startCall();
    }

    setTimeout(() => setPhase("active"), 800);
  }, [local, type, webrtc, aiCall]);

  const handleEnd = useCallback(() => {
    local.stop();
    aiCall.stopCall();
    if (type === "psychologist") webrtc.disconnect();
    onEnd();
  }, [local, aiCall, type, webrtc, onEnd]);

  const bars = Array.from({ length: 24 });
  const aiSpeaking = type === "ai" && aiCall.callState === "speaking";
  const aiListening = type === "ai" && aiCall.callState === "listening";

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "radial-gradient(ellipse 120% 100% at 50% 0%, #0d1f15 0%, #070a08 100%)" }}>

      {/* Subtle grid texture */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.3) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

      {/* Ambient glow */}
      <motion.div animate={{ opacity: [0.15, 0.25, 0.15] }} transition={{ duration: 4, repeat: Infinity }}
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full blur-3xl"
        style={{ background: "radial-gradient(ellipse, #3A7A52 0%, transparent 70%)" }} />

      <AnimatePresence mode="wait">

        {/* ══ PERMISSION SCREEN ══════════════════════════════════════════════ */}
        {phase === "permission" && (
          <motion.div key="perm"
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            className="relative w-full max-w-sm mx-4 space-y-5">

            {/* Glass card */}
            <div className="rounded-3xl border border-white/10 overflow-hidden shadow-2xl"
              style={{ background: "rgba(10,16,11,0.85)", backdropFilter: "blur(24px)" }}>

              {/* Top gradient strip */}
              <div className="h-1 bg-gradient-to-r from-primary via-emerald-400 to-teal-500" />

              <div className="p-7 space-y-6">
                {/* Icon + title */}
                <div className="text-center space-y-3">
                  <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ duration: 4, repeat: Infinity }}
                    className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center border border-primary/30"
                    style={{ background: "rgba(58,122,82,0.15)" }}>
                    <Shield size={26} className="text-primary" />
                  </motion.div>
                  <div>
                    <h2 className="text-xl font-black text-white font-serif">
                      {type === "ai" ? `Connect with ${companion?.name || "Asha"}` : `Call Dr. ${psychName}`}
                    </h2>
                    <p className="text-white/50 text-sm mt-1">
                      {type === "ai"
                        ? "Your AI companion needs your camera and mic to see and hear you"
                        : "Allow access so your psychologist can see and hear you clearly"}
                    </p>
                  </div>
                </div>

                {/* Permission items */}
                <div className="space-y-2.5">
                  {[
                    { icon: Mic, label: "Microphone", sub: "Real-time voice conversation" },
                    { icon: Camera, label: "Camera", sub: type === "ai" ? "Visual context for your AI companion" : "Face-to-face session" },
                  ].map(item => (
                    <div key={item.label}
                      className="flex items-center gap-4 rounded-2xl border border-white/8 px-4 py-3.5"
                      style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center border border-primary/20"
                        style={{ background: "rgba(58,122,82,0.12)" }}>
                        <item.icon size={17} className="text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="text-white text-sm font-semibold">{item.label}</p>
                        <p className="text-white/40 text-xs">{item.sub}</p>
                      </div>
                      <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 2, repeat: Infinity }}
                        className="w-2 h-2 rounded-full bg-primary" />
                    </div>
                  ))}
                </div>

                {/* Privacy note */}
                <p className="text-center text-[11px] text-white/30 flex items-center justify-center gap-1.5">
                  <Shield size={10} className="text-primary/60" />
                  End-to-end encrypted · Never stored without consent
                </p>

                {/* Buttons */}
                <div className="flex gap-3">
                  <button onClick={onEnd}
                    className="flex-1 py-3.5 rounded-2xl border border-white/10 text-white/60 text-sm font-medium hover:border-white/20 hover:text-white/80 transition-all">
                    Cancel
                  </button>
                  <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    onClick={handleStart}
                    className="flex-1 py-3.5 rounded-2xl text-sm font-bold text-white relative overflow-hidden"
                    style={{ background: "linear-gradient(135deg, #3A7A52 0%, #2d6142 100%)" }}>
                    <motion.div className="absolute inset-0"
                      animate={{ x: ["-100%", "200%"] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)", transform: "skewX(-20deg)" }} />
                    {type === "ai" ? "Start AI Session" : "Join Call"}
                  </motion.button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ══ STARTING ═══════════════════════════════════════════════════════ */}
        {phase === "starting" && (
          <motion.div key="starting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4">
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="w-12 h-12 rounded-full border-2 border-primary/30 border-t-primary" />
            <p className="text-white/60 text-sm">
              {type === "ai" ? "Connecting to Asha..." : "Joining room..."}
            </p>
          </motion.div>
        )}

        {/* ══ ACTIVE CALL ════════════════════════════════════════════════════ */}
        {phase === "active" && (
          <motion.div key="active" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="w-full h-full flex flex-col">

            {/* ── AI CALL LAYOUT ── */}
            {type === "ai" && (
              <div className="flex-1 flex flex-col items-center justify-between py-10 px-6 relative">

                {/* Top bar */}
                <div className="w-full flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
                      className="w-2 h-2 rounded-full bg-primary" />
                    <span className="text-white/50 text-xs uppercase tracking-widest">AI Session</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Call state badge */}
                    <AnimatePresence mode="wait">
                      {aiCall.callState === "listening" && (
                        <motion.div key="listening"
                          initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30"
                          style={{ background: "rgba(58,122,82,0.15)" }}>
                          <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 0.8, repeat: Infinity }}
                            className="w-1.5 h-1.5 rounded-full bg-primary" />
                          <span className="text-xs text-primary font-semibold">Listening</span>
                        </motion.div>
                      )}
                      {aiCall.callState === "thinking" && (
                        <motion.div key="thinking"
                          initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-500/30"
                          style={{ background: "rgba(245,158,11,0.12)" }}>
                          <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.6, repeat: Infinity }}
                            className="text-xs text-amber-400 font-semibold">Thinking...</motion.span>
                        </motion.div>
                      )}
                      {aiCall.callState === "speaking" && (
                        <motion.div key="speaking"
                          initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-emerald-500/30"
                          style={{ background: "rgba(16,185,129,0.1)" }}>
                          <Sparkles size={11} className="text-emerald-400" />
                          <span className="text-xs text-emerald-400 font-semibold">Speaking</span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <span className="text-white/30 text-sm font-mono">{duration}</span>
                  </div>
                </div>

                {/* Avatar + waveform */}
                <div className="flex flex-col items-center gap-8">
                  {/* Outer pulsing ring */}
                  <div className="relative">
                    {aiSpeaking && (
                      <>
                        <motion.div animate={{ scale: [1, 1.25, 1], opacity: [0.2, 0, 0.2] }}
                          transition={{ duration: 1.8, repeat: Infinity }}
                          className="absolute inset-0 rounded-full border-2 border-primary" style={{ margin: -24 }} />
                        <motion.div animate={{ scale: [1, 1.45, 1], opacity: [0.12, 0, 0.12] }}
                          transition={{ duration: 1.8, repeat: Infinity, delay: 0.3 }}
                          className="absolute inset-0 rounded-full border border-primary" style={{ margin: -40 }} />
                      </>
                    )}
                    <AnimeAvatar speaking={aiSpeaking} size={180}
                      style={companion?.appearance as any || "soft-pastel"}
                      gender={companion?.gender || "female"}
                      name={companion?.name || "Asha"}
                    />
                  </div>

                  {/* Name */}
                  <div className="text-center">
                    <h2 className="text-white text-2xl font-black font-serif">{companion?.name || "Asha"}</h2>
                    <p className="text-white/40 text-sm">Your AI Wellness Companion</p>
                  </div>

                  {/* Waveform */}
                  <div className="flex items-center gap-[3px]" style={{ height: 40 }}>
                    {bars.map((_, i) => (
                      <motion.div key={i} className="rounded-full"
                        style={{
                          width: 3,
                          background: aiSpeaking
                            ? `linear-gradient(to top, #3A7A52, ${i % 2 === 0 ? "#4CAF75" : "#34D399"})`
                            : aiListening
                              ? `linear-gradient(to top, rgba(58,122,82,0.4), rgba(58,122,82,0.6))`
                              : "rgba(255,255,255,0.1)"
                        }}
                        animate={aiSpeaking
                          ? { height: [4, Math.random() * 28 + 8, 4] }
                          : aiListening
                            ? { height: [3, Math.random() * 10 + 4, 3] }
                            : { height: 4 }}
                        transition={{ duration: 0.2 + Math.random() * 0.25, repeat: Infinity, delay: i * 0.035 }}
                      />
                    ))}
                  </div>
                </div>

                {/* Transcript + response bubbles */}
                <div className="w-full max-w-sm space-y-2">
                  <AnimatePresence>
                    {aiCall.transcript && (
                      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="flex justify-end">
                        <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-sm text-sm text-white"
                          style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)" }}>
                          {aiCall.transcript}
                        </div>
                      </motion.div>
                    )}
                    {aiCall.ashaText && aiCall.callState === "speaking" && (
                      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm text-white/90 border border-primary/20"
                          style={{ background: "rgba(58,122,82,0.2)", backdropFilter: "blur(8px)" }}>
                          {aiCall.ashaText}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Vision indicator */}
                  {local.hasVideo && (
                    <div className="flex items-center gap-1.5 justify-center mt-1">
                      <Eye size={11} className="text-primary/60" />
                      <span className="text-[10px] text-white/30">Asha can see your environment</span>
                    </div>
                  )}

                  {/* Error */}
                  {aiCall.error && (
                    <p className="text-center text-xs text-amber-400">{aiCall.error}</p>
                  )}
                </div>

                {/* Controls */}
                <div className="flex items-center gap-4">
                  <CtrlBtn icon={local.muted ? MicOff : Mic} active={!local.muted} danger={local.muted}
                    onClick={local.toggleMute} label={local.muted ? "Unmute" : "Mute"} />
                  <CtrlBtn icon={speakerMuted ? VolumeX : Volume2} active={!speakerMuted}
                    onClick={() => setSpeakerMuted(m => !m)} label="Speaker" />
                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.93 }}
                    onClick={handleEnd}
                    className="w-16 h-16 rounded-full flex items-center justify-center shadow-2xl shadow-red-900/40"
                    style={{ background: "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)" }}>
                    <PhoneOff size={22} className="text-white" />
                  </motion.button>
                  <CtrlBtn icon={local.camOff ? EyeOff : Camera} active={!local.camOff}
                    onClick={local.toggleCam} label="Camera" />
                  <CtrlBtn icon={Radio} active label="AI" onClick={() => {}} />
                </div>

                {/* Local PiP */}
                {local.hasVideo && !local.camOff && (
                  <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
                    className="absolute top-16 right-5 w-24 h-32 rounded-2xl overflow-hidden border border-white/15 shadow-xl">
                    <video ref={localVideoRef} autoPlay muted playsInline
                      className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
                    <div className="absolute bottom-1.5 left-1.5 text-[9px] text-white/60 bg-black/40 px-1.5 py-0.5 rounded-full">You</div>
                  </motion.div>
                )}
              </div>
            )}

            {/* ── HUMAN / PSYCHOLOGIST CALL LAYOUT ── */}
            {type === "psychologist" && (
              <div className="flex-1 relative flex flex-col">

                {/* Remote video (full) */}
                <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
                  {webrtc.remoteStream ? (
                    <video ref={remoteVideoRef} autoPlay playsInline
                      className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-4">
                      <motion.div
                        animate={webrtc.status === "connecting"
                          ? { boxShadow: ["0 0 0 0 rgba(58,122,82,0.3)", "0 0 0 24px rgba(58,122,82,0)", "0 0 0 0 rgba(58,122,82,0)"] }
                          : {}}
                        transition={{ duration: 1.8, repeat: Infinity }}
                        className="w-36 h-36 rounded-full border-2 border-white/15 flex items-center justify-center"
                        style={{ background: "rgba(58,122,82,0.1)" }}>
                        <span className="text-4xl font-black text-white/70">
                          {psychName?.slice(0, 2).toUpperCase() || "DR"}
                        </span>
                      </motion.div>
                      <div className="text-center space-y-1">
                        <p className="text-white font-bold font-serif text-lg">Dr. {psychName}</p>
                        <div className="flex items-center justify-center gap-2">
                          {webrtc.status === "connecting" && (
                            <>
                              <motion.div animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 1.2, repeat: Infinity }}
                                className="flex gap-1">
                                {[0, 1, 2].map(i => (
                                  <motion.div key={i} animate={{ scale: [1, 1.3, 1] }}
                                    transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                                    className="w-1.5 h-1.5 rounded-full bg-primary" />
                                ))}
                              </motion.div>
                              <span className="text-white/50 text-sm">Waiting for Dr. {psychName}...</span>
                            </>
                          )}
                          {webrtc.status === "error" && (
                            <div className="flex items-center gap-2 text-red-400 text-sm">
                              <WifiOff size={14} />
                              <span>Connection failed — check your network</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Top HUD */}
                  <div className="absolute top-0 inset-x-0 flex items-center justify-between px-5 pt-5 pb-8"
                    style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)" }}>
                    <div className="flex items-center gap-2">
                      <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
                        className={`w-2 h-2 rounded-full ${webrtc.status === "connected" ? "bg-primary" : "bg-amber-400"}`} />
                      <span className="text-white/60 text-xs uppercase tracking-widest">
                        {webrtc.status === "connected" ? "Psychologist Session" : webrtc.status === "connecting" ? "Connecting..." : "Session"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {webrtc.status === "connected"
                        ? <Wifi size={13} className="text-primary" />
                        : <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
                            <Wifi size={13} className="text-amber-400" />
                          </motion.div>}
                      <span className="text-white/50 text-sm font-mono">{duration}</span>
                    </div>
                  </div>
                </div>

                {/* Bottom controls + PiP */}
                <div className="relative px-6 pb-8 pt-6 flex flex-col gap-4"
                  style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)" }}>

                  {/* PiP self-view */}
                  <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                    className="absolute right-5 -top-36 w-28 h-40 rounded-2xl overflow-hidden border-2 border-white/15 shadow-2xl">
                    {local.hasVideo && !local.camOff ? (
                      <video ref={localVideoRef} autoPlay muted playsInline
                        className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"
                        style={{ background: "rgba(15,20,16,0.9)" }}>
                        <VideoOff size={20} className="text-white/30" />
                      </div>
                    )}
                    <div className="absolute bottom-1.5 left-1.5 text-[9px] text-white/60 bg-black/50 px-1.5 py-0.5 rounded-full">You</div>
                  </motion.div>

                  <div className="flex items-center justify-center gap-4">
                    <CtrlBtn icon={local.muted ? MicOff : Mic} active={!local.muted} danger={local.muted}
                      onClick={local.toggleMute} label={local.muted ? "Unmute" : "Mute"} />
                    <CtrlBtn icon={speakerMuted ? VolumeX : Volume2} active={!speakerMuted}
                      onClick={() => setSpeakerMuted(m => !m)} label="Speaker" />
                    <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.93 }}
                      onClick={handleEnd}
                      className="w-16 h-16 rounded-full flex items-center justify-center shadow-2xl shadow-red-900/40"
                      style={{ background: "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)" }}>
                      <PhoneOff size={22} className="text-white" />
                    </motion.button>
                    <CtrlBtn icon={local.camOff ? VideoOff : Video} active={!local.camOff} danger={local.camOff}
                      onClick={local.toggleCam} label={local.camOff ? "Start cam" : "Stop cam"} />
                    <CtrlBtn icon={Shield} active label="Secure" onClick={() => {}} />
                  </div>

                  <p className="text-center text-[10px] text-white/20">
                    HIPAA compliant · End-to-end encrypted · No recording without consent
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Control button ────────────────────────────────────────────────────────────
function CtrlBtn({ icon: Icon, active, danger, onClick, label }: {
  icon: React.ElementType;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.88 }}
      onClick={onClick}
      title={label}
      className="flex flex-col items-center gap-1.5 group">
      <div className={`w-13 h-13 w-12 h-12 rounded-2xl flex items-center justify-center border transition-all ${
        danger
          ? "border-red-500/40 bg-red-900/30"
          : active
            ? "border-white/15 bg-white/10 group-hover:bg-white/15"
            : "border-white/8 bg-white/5 group-hover:bg-white/10"
      }`}>
        <Icon size={18} className={danger ? "text-red-400" : active ? "text-white" : "text-white/40"} />
      </div>
      <span className="text-[9px] text-white/30 group-hover:text-white/50 transition-colors">{label}</span>
    </motion.button>
  );
}
