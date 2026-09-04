import { useState, useEffect } from "react";
import { Z } from "@/lib/zLayers";

export function UploadSuccessOverlay({ label, path, onDone }: {
  label: string; path: string; onDone: (path: string) => void;
}) {
  const [secs, setSecs] = useState(10);
  useEffect(() => {
    if (secs <= 0) { onDone(path); return; }
    const t = setTimeout(() => setSecs(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secs, path, onDone]);
  const PETALS = ["🌸", "✨", "🌺", "⭐", "💫", "🎉", "🌟", "🎊"];
  return (
    <>
      <style>{`
        @keyframes uploadFloatUp {
          0%   { transform: translateY(0) rotate(0deg) scale(1);        opacity: 1; }
          80%  { opacity: 0.7; }
          100% { transform: translateY(-105vh) rotate(720deg) scale(0.5); opacity: 0; }
        }
        @keyframes uploadPopIn {
          from { transform: scale(0); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
      `}</style>
      <div style={{
        position: "fixed", inset: 0, zIndex: Z.POPUP_CHILD,
        background: "rgba(0,0,0,0.82)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {Array.from({ length: 18 }).map((_, i) => (
          <span key={i} aria-hidden style={{
            position: "fixed",
            left: `${(i * 5.6) % 100}%`,
            bottom: "-2rem",
            fontSize: `${1.2 + (i % 3) * 0.45}rem`,
            animation: `uploadFloatUp ${2.4 + (i % 4) * 0.55}s ease-out ${(i % 5) * 0.38}s infinite`,
            pointerEvents: "none", userSelect: "none",
          }}>
            {PETALS[i % PETALS.length]}
          </span>
        ))}
        <div style={{
          background: "var(--rm-panel, #1a2035)",
          border: "1px solid rgba(107,165,57,0.45)",
          borderRadius: 20,
          padding: "44px 52px",
          textAlign: "center",
          maxWidth: 440,
          width: "90%",
          position: "relative",
          zIndex: Z.POPUP_CHILD_2,
          boxShadow: "0 0 80px rgba(107,165,57,0.22), 0 20px 60px rgba(0,0,0,0.55)",
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: "50%",
            background: "rgba(107,165,57,0.12)",
            border: "2px solid #6BA539",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 20px", fontSize: 40,
            animation: "uploadPopIn 0.4s cubic-bezier(0.175,0.885,0.32,1.275) forwards",
          }}>✅</div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--rm-text, #fff)", margin: "0 0 10px" }}>
            Upload Successful!
          </h2>
          <p style={{ fontSize: 15, color: "var(--rm-text-muted, #aaa)", margin: "0 0 28px", lineHeight: 1.5 }}>
            Your <strong style={{ color: "#6BA539" }}>{label}</strong> data has been imported and is ready to view.
          </p>
          <div style={{
            height: 5, borderRadius: 3,
            background: "rgba(255,255,255,0.08)",
            margin: "0 0 24px", overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${(secs / 10) * 100}%`,
              background: "linear-gradient(90deg, #6BA539, #A9C23F)",
              borderRadius: 3,
              transition: "width 1s linear",
            }} />
          </div>
          <button
            onClick={() => onDone(path)}
            style={{
              display: "block", width: "100%",
              padding: "14px 24px",
              background: "linear-gradient(135deg, #6BA539, #A9C23F)",
              border: "none", borderRadius: 12,
              color: "#fff", fontWeight: 700, fontSize: 16,
              cursor: "pointer", marginBottom: 14,
              boxShadow: "0 4px 20px rgba(107,165,57,0.35)",
            }}
          >
            Go to {label} →
          </button>
          <p style={{ fontSize: 12, color: "var(--rm-text-faint, #555)", margin: 0 }}>
            Auto-navigating in {secs}s
          </p>
        </div>
      </div>
    </>
  );
}
