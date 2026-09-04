import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";
import { subscribeNewVersion } from "@/lib/newVersionSignal";
import { Z } from "@/lib/zLayers";

// Suppress the banner for the current browser session once dismissed.
// A forced signal (vite:preloadError / lazyWithReload failure) clears this
// flag and re-shows the banner regardless.
const DISMISSED_KEY = "rm-version-banner-dismissed";

function isDismissed(): boolean {
  try { return sessionStorage.getItem(DISMISSED_KEY) === "1"; } catch { return false; }
}
function setDismissed(): void {
  try { sessionStorage.setItem(DISMISSED_KEY, "1"); } catch { /* ignore */ }
}
function clearDismissed(): void {
  try { sessionStorage.removeItem(DISMISSED_KEY); } catch { /* ignore */ }
}

// How often to poll version.json for a new stamp (ms).
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Reads the build stamp injected by vite.config.ts at build time.
 * Returns "dev" in development, a Unix-ms string in production.
 */
function getLocalStamp(): string {
  try { return __BUILD_STAMP__; } catch { return "dev"; }
}

/**
 * Fetches /version.json with a cache-busting query string and returns the
 * stamp field, or null on any error.
 */
async function fetchRemoteStamp(): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?_=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json() as unknown;
    if (json && typeof json === "object" && "stamp" in json && typeof (json as Record<string, unknown>).stamp === "string") {
      return (json as { stamp: string }).stamp;
    }
    return null;
  } catch {
    return null;
  }
}

export function NewVersionBanner() {
  const { mode } = useTheme();
  const light = mode === "light";
  const [visible, setVisible] = useState(false);
  const localStamp = useRef(getLocalStamp());

  // Subscribe to the global signal (fired by vite:preloadError and lazyWithReload).
  useEffect(() => {
    return subscribeNewVersion(({ force }) => {
      if (force) {
        clearDismissed();
        setVisible(true);
      } else if (!isDismissed()) {
        setVisible(true);
      }
    });
  }, []);

  // Periodic poll: skip entirely in dev (stamp === "dev") or when already visible.
  useEffect(() => {
    const stamp = localStamp.current;
    if (stamp === "dev") return; // dev builds never poll

    async function check() {
      if (isDismissed()) return; // user already dismissed this session
      const remote = await fetchRemoteStamp();
      if (remote !== null && remote !== stamp) {
        setVisible(true);
      }
    }

    // Run once at mount (after a short delay so the app settles), then on interval.
    const initial = window.setTimeout(() => { void check(); }, 10_000);
    const interval = window.setInterval(() => { void check(); }, POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, []);

  if (!visible) return null;

  const bg   = light ? "#1e293b" : "#0f172a";
  const text = light ? "#f1f5f9" : "#e2e8f0";
  const borderColor = light ? "rgba(99,102,241,0.5)" : "rgba(99,102,241,0.4)";
  const btnBg = light ? "#6366f1" : "#4f46e5";
  const btnHoverBg = light ? "#4f46e5" : "#4338ca";

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: Z.BANNER,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "9px 16px",
        background: bg,
        borderBottom: `1px solid ${borderColor}`,
        boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
        flexWrap: "wrap",
      }}
    >
      {/* Pulse dot */}
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: "#6366f1",
        flexShrink: 0,
        boxShadow: "0 0 0 2px rgba(99,102,241,0.35)",
      }} />

      <span style={{
        fontSize: 13,
        fontWeight: 500,
        color: text,
        letterSpacing: 0.1,
        flexShrink: 0,
      }}>
        A new version of RM ONE is available.
      </span>

      <RefreshButton bg={btnBg} hoverBg={btnHoverBg} />

      {/* Dismiss */}
      <button
        onClick={() => { setDismissed(); setVisible(false); }}
        aria-label="Dismiss"
        style={{
          marginLeft: 4,
          padding: "2px 4px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: light ? "#94a3b8" : "#64748b",
          lineHeight: 1,
          flexShrink: 0,
          fontSize: 16,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = text; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = light ? "#94a3b8" : "#64748b"; }}
      >
        ×
      </button>
    </div>
  );
}

/** Separate component so hover state is isolated and doesn't re-render the banner. */
function RefreshButton({ bg, hoverBg }: { bg: string; hoverBg: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={() => window.location.reload()}
      style={{
        padding: "4px 12px",
        borderRadius: 6,
        border: "none",
        background: hovered ? hoverBg : bg,
        color: "#fff",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        letterSpacing: 0.2,
        flexShrink: 0,
        transition: "background 0.15s",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      Refresh now
    </button>
  );
}
