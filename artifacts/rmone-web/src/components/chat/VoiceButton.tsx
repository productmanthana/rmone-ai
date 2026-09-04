/**
 * VoiceButton — captures audio in the browser via MediaRecorder, POSTs the
 * blob to /api/transcribe?stream=1 (same streaming endpoint mobile uses), and
 * surfaces transcript deltas to its parent as they arrive (live-typing UX).
 * Mirrors the mobile mic UX:
 *   idle        → green mic
 *   recording   → red pulsing mic (tap again to stop & transcribe)
 *   transcribing → spinner until first delta lands
 */
import { useEffect, useRef, useState } from "react";
import { Mic, Loader2 } from "lucide-react";

type State = "idle" | "recording" | "transcribing";

interface Props {
  disabled?: boolean;
  /** Called once per delta as words come in from the streaming endpoint.
   *  When provided, this is the live-typing path — parent should append the
   *  raw text directly (no separator munging) to mirror the mobile UX. */
  onDelta?: (deltaText: string) => void;
  /** Fallback for non-streaming mode: called once with the final transcript. */
  onTranscript: (text: string) => void;
  onError?: (msg: string) => void;
}

export function VoiceButton({ disabled, onDelta, onTranscript, onError }: Props) {
  const [state, setState] = useState<State>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      try { recorderRef.current?.stop(); } catch { /* noop */ }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const start = async () => {
    if (state !== "idle") return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      onError?.("Microphone access is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMimeType();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
          await transcribe(blob);
        } finally {
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          recorderRef.current = null;
        }
      };
      recorderRef.current = mr;
      mr.start();
      setState("recording");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not access the microphone.";
      onError?.(msg);
    }
  };

  const stop = () => {
    if (state !== "recording") return;
    setState("transcribing");
    try { recorderRef.current?.stop(); } catch { /* noop */ }
  };

  const transcribe = async (blob: Blob) => {
    try {
      const ext =
        blob.type.includes("webm") ? "webm" :
        blob.type.includes("ogg") ? "ogg" :
        blob.type.includes("mp4") || blob.type.includes("m4a") ? "m4a" :
        "webm";
      const fd = new FormData();
      fd.append("audio", blob, `recording.${ext}`);
      const token = (typeof localStorage !== "undefined" && localStorage.getItem("rmone_token")) || "";

      // Stream deltas via XHR (matches mobile chat.tsx voice flow exactly).
      // We use XHR rather than fetch+ReadableStream because XHR's incremental
      // responseText works reliably across browsers + behind the workspace
      // iframe, while fetch streaming with FormData uploads can be flaky.
      const accumulated = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/transcribe?stream=1");
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

        let lastIndex = 0;
        let buf = "";
        let firstDelta = true;
        let combined = "";
        let streamErr: string | null = null;

        const drain = (chunk: string) => {
          buf += chunk;
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (!frame.startsWith("data:")) continue;
            const payload = frame.slice(5).trim();
            if (!payload) continue;
            try {
              const obj = JSON.parse(payload) as { delta?: string; error?: string; text?: string };
              if (typeof obj.delta === "string" && obj.delta) {
                if (firstDelta) { setState("idle"); firstDelta = false; }
                combined += obj.delta;
                if (onDelta) onDelta(obj.delta);
              } else if (typeof obj.text === "string" && obj.text) {
                combined = obj.text;
              } else if (obj.error) {
                streamErr = obj.error;
              }
            } catch { /* ignore unparseable frames */ }
          }
        };

        xhr.onreadystatechange = () => {
          if (xhr.readyState >= 3 && xhr.responseText) {
            const newChunk = xhr.responseText.slice(lastIndex);
            lastIndex = xhr.responseText.length;
            if (newChunk) drain(newChunk);
          }
        };
        xhr.onload = () => {
          if (xhr.responseText && lastIndex < xhr.responseText.length) {
            drain(xhr.responseText.slice(lastIndex));
          }
          if (xhr.status >= 400) {
            // Try to surface a JSON error payload from non-streaming responses
            try {
              const j = JSON.parse(xhr.responseText) as { error?: string };
              if (j?.error) { reject(new Error(j.error)); return; }
            } catch { /* fall through */ }
            reject(new Error(`Transcription failed (${xhr.status})`));
            return;
          }
          if (streamErr) reject(new Error(streamErr));
          else resolve(combined);
        };
        xhr.onerror = () => reject(new Error("Network error during transcription."));
        xhr.send(fd);
      });

      const finalText = accumulated.trim();
      // If parent didn't subscribe to deltas, fall back to one-shot push so the
      // text still ends up in the input box.
      if (!onDelta && finalText) onTranscript(finalText);
      else if (!finalText) onError?.("No speech detected.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Transcription failed.";
      onError?.(msg);
    } finally {
      setState("idle");
    }
  };

  const onClick = () => {
    if (state === "idle") start();
    else if (state === "recording") stop();
    // ignore clicks while transcribing
  };

  const isRec = state === "recording";
  const isTrans = state === "transcribing";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isTrans}
      aria-label={isRec ? "Stop recording" : isTrans ? "Transcribing" : "Start voice input"}
      title={isRec ? "Stop & transcribe" : isTrans ? "Transcribing…" : "Voice input"}
      style={{
        width: 40, height: 40, borderRadius: 12,
        // Idle bg/fg flip with theme: white surface + green mic in light
        // mode, black surface + white mic in dark mode. Recording state
        // (red w/ white icon) stays fixed in both themes for clarity.
        background: isRec ? "#E03C3C" : "var(--rm-voice-bg)",
        border: `1px solid ${isRec ? "#E03C3C" : "var(--rm-voice-border)"}`,
        color: isRec ? "#FFFFFF" : "var(--rm-voice-fg)",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: disabled || isTrans ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 0.15s ease",
        animation: isRec ? "rmone-mic-pulse 1.2s ease-in-out infinite" : undefined,
        boxShadow: isRec
          ? "0 0 0 4px rgba(224,60,60,0.18)"
          : "0 1px 2px rgba(15,23,42,0.06), inset 0 0 0 1px rgba(15,23,42,0.02)",
      }}
    >
      {isTrans ? <Loader2 size={16} className="rmone-spin" /> : <Mic size={16} />}
    </button>
  );
}

function pickMimeType(): string | null {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return null;
}
