import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Server, Database, Bot, Cpu, Gauge, Wifi, WifiOff,
  CheckCircle2, AlertTriangle, XCircle, Zap, Clock, RefreshCw,
} from "lucide-react";

const Colors = {
  bg: "var(--rm-bg)",
  card: "var(--rm-panel)",
  cardSoft: "var(--rm-panel-soft)",
  border: "var(--rm-panel-border)",
  text: "var(--rm-text)",
  textSecondary: "var(--rm-text-muted)",
  textMuted: "var(--rm-text-faint)",
  green: "#6BA539",
  greenBright: "#7CB342",
  amber: "#E87722",
  red: "#E03C3C",
  blue: "#3B82F6",
  purple: "#8E5BD9",
};

type PingSample = { t: number; ms: number; ok: boolean };
type UptimeBucket = {
  hourStart: number;
  byService: Record<string, { total: number; ok: number; avgMs: number; uptimePct: number }>;
};
type UptimeHistory = {
  services: Array<{ id: string; label: string; path: string }>;
  rangeMs: number;
  generatedAt: number;
  totalSamples: number;
  hours: UptimeBucket[];
  recentFailures: Array<{ t: number; serviceId: string; serviceLabel: string; ms: number }>;
  perService: Record<string, { uptimePct: number; total: number; ok: number; avgMs: number }>;
};
type ServiceState = {
  name: string;
  endpoint: string;
  icon: typeof Server;
  color: string;
  description: string;
  lastMs: number;
  lastOk: boolean;
  history: PingSample[];
};

const PING_INTERVAL_MS = 5_000;
const HISTORY_SIZE = 60;

async function pingEndpoint(url: string): Promise<{ ms: number; ok: boolean }> {
  const start = performance.now();
  try {
    const res = await fetch(url, { method: "GET", credentials: "same-origin" });
    const ms = Math.round(performance.now() - start);
    return { ms, ok: res.ok };
  } catch {
    return { ms: Math.round(performance.now() - start), ok: false };
  }
}

function statusOf(svc: ServiceState): "up" | "slow" | "down" {
  if (!svc.lastOk) return "down";
  if (svc.lastMs > 1500) return "slow";
  return "up";
}

function statusColor(s: "up" | "slow" | "down"): string {
  return s === "up" ? Colors.green : s === "slow" ? Colors.amber : Colors.red;
}

function statusLabel(s: "up" | "slow" | "down"): string {
  return s === "up" ? "Operational" : s === "slow" ? "Degraded" : "Down";
}

/* ─────────── Sparkline ─────────── */
function Sparkline({ data, color, height = 40 }: { data: PingSample[]; color: string; height?: number }) {
  const w = 280;
  const h = height;
  if (data.length < 2) {
    return <div style={{ height: h, color: Colors.textMuted, fontSize: 11, display: "flex", alignItems: "center" }}>Collecting samples…</div>;
  }
  const max = Math.max(...data.map(d => d.ms), 100);
  const min = 0;
  const stepX = w / Math.max(1, data.length - 1);
  const pts = data.map((d, i) => {
    const x = i * stepX;
    const y = h - ((d.ms - min) / (max - min)) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPts = `0,${h} ${pts.join(" ")} ${w},${h}`;
  const colorId = color.replace("#", "");
  return (
    <div style={{ position: "relative", width: "100%", height: h, overflow: "hidden" }}>
      <style>{`
        @keyframes sysHealthScanSweep {
          0%   { transform: translateX(-12%); opacity: 0; }
          8%   { opacity: 1; }
          92%  { opacity: 1; }
          100% { transform: translateX(112%); opacity: 0; }
        }
        @keyframes sysHealthScanLine {
          0%, 100% { opacity: 0.85; }
          50%      { opacity: 1; }
        }
      `}</style>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block", position: "relative", zIndex: 1 }}>
        <defs>
          <linearGradient id={`grad-${colorId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.5" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={areaPts} fill={`url(#grad-${colorId})`} />
        <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        {data.map((d, i) => !d.ok && (
          <circle key={i} cx={i * stepX} cy={h - 2} r={2.5} fill={Colors.red} />
        ))}
      </svg>
      {/* Heartbeat-style scanner sweep — a soft glowing vertical line that
          travels left→right roughly once per second, like a medical
          monitor or radar sweep. Kept slow (1.6s) so it reads as
          "live monitoring" rather than busy/distracting. */}
      <div
        aria-hidden
        style={{
          position: "absolute", top: 0, bottom: 0, left: 0, width: "8%",
          pointerEvents: "none", zIndex: 2,
          animation: "sysHealthScanSweep 1.6s linear infinite",
          background: `linear-gradient(90deg, transparent 0%, ${color}10 40%, ${color}55 80%, ${color} 100%)`,
          boxShadow: `0 0 12px ${color}88, 0 0 4px ${color}`,
          mixBlendMode: "screen",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute", top: 0, bottom: 0, left: 0, width: 1.5,
          pointerEvents: "none", zIndex: 3,
          backgroundColor: color,
          boxShadow: `0 0 8px ${color}, 0 0 16px ${color}66`,
          animation: "sysHealthScanSweep 1.6s linear infinite, sysHealthScanLine 1.6s ease-in-out infinite",
          opacity: 0.95,
        }}
      />
    </div>
  );
}

/* ─────────── PulseRing ─────────── */
function PulseRing({ color, size = 220 }: { color: string; size?: number }) {
  return (
    <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`
        @keyframes sysHealthPulse {
          0% { transform: scale(0.85); opacity: 0.6; }
          70% { transform: scale(1.4); opacity: 0; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        @keyframes sysHealthSpin { to { transform: rotate(360deg); } }
      `}</style>
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        border: `2px solid ${color}`,
        animation: "sysHealthPulse 2.2s ease-out infinite",
      }} />
      <div style={{
        position: "absolute", inset: 12, borderRadius: "50%",
        border: `2px solid ${color}`, opacity: 0.4,
        animation: "sysHealthPulse 2.2s ease-out 0.6s infinite",
      }} />
      <div style={{
        position: "absolute", inset: 24, borderRadius: "50%",
        background: `radial-gradient(circle, ${color}30 0%, transparent 70%)`,
      }} />
      <div style={{
        width: size * 0.55, height: size * 0.55, borderRadius: "50%",
        background: `linear-gradient(135deg, ${color}, ${color}AA)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: `0 0 30px ${color}66, inset 0 -8px 20px rgba(0,0,0,0.3)`,
      }}>
        <Activity size={size * 0.22} color="#FFF" strokeWidth={2.5} />
      </div>
    </div>
  );
}

/* ─────────── ServiceCard ─────────── */
function ServiceCard({ svc }: { svc: ServiceState }) {
  const s = statusOf(svc);
  const c = statusColor(s);
  const Icon = svc.icon;
  const successCount = svc.history.filter(h => h.ok).length;
  const uptime = svc.history.length > 0 ? Math.round((successCount / svc.history.length) * 1000) / 10 : 100;
  const avg = svc.history.length > 0
    ? Math.round(svc.history.reduce((a, b) => a + b.ms, 0) / svc.history.length)
    : 0;
  return (
    <div style={{
      backgroundColor: Colors.card, borderRadius: 16, padding: 18,
      border: `1px solid ${c}40`,
      boxShadow: `0 4px 14px rgba(0,0,0,0.3), 0 0 0 1px ${c}10 inset`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12,
          backgroundColor: svc.color + "20",
          border: `1px solid ${svc.color}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={20} color={svc.color} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: Colors.text }}>{svc.name}</div>
          <div style={{ fontSize: 10, color: Colors.textMuted, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{svc.endpoint}</div>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "4px 10px", borderRadius: 12,
          backgroundColor: c + "20", border: `1px solid ${c}50`,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%", backgroundColor: c,
            boxShadow: `0 0 8px ${c}`,
          }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: c, letterSpacing: 0.5 }}>{statusLabel(s).toUpperCase()}</span>
        </div>
      </div>

      <Sparkline data={svc.history} color={c} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 14 }}>
        <Stat label="LATEST" value={svc.lastOk ? `${svc.lastMs}ms` : "—"} color={c} />
        <Stat label="AVG" value={avg > 0 ? `${avg}ms` : "—"} color={Colors.text} />
        <Stat label="UPTIME" value={`${uptime}%`} color={uptime >= 99 ? Colors.green : uptime >= 95 ? Colors.amber : Colors.red} />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 16, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 9, fontWeight: 700, color: Colors.textMuted, letterSpacing: 0.5, marginTop: 3 }}>{label}</div>
    </div>
  );
}

/* ─────────── BrowserStats ─────────── */
function BrowserStats() {
  const [fps, setFps] = useState(0);
  const [memory, setMemory] = useState<number | null>(null);
  const [memoryLimit, setMemoryLimit] = useState<number | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0; last = now;
        const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };
        if (perf.memory) {
          setMemory(perf.memory.usedJSHeapSize / 1048576);
          setMemoryLimit(perf.memory.jsHeapSizeLimit / 1048576);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const fpsColor = fps >= 50 ? Colors.green : fps >= 30 ? Colors.amber : Colors.red;
  const memPct = memory && memoryLimit ? Math.round((memory / memoryLimit) * 100) : 0;
  const memColor = memPct < 50 ? Colors.green : memPct < 80 ? Colors.amber : Colors.red;

  return (
    <div style={{
      backgroundColor: Colors.card, borderRadius: 16, padding: 18,
      border: `1px solid ${Colors.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Cpu size={18} color={Colors.purple} />
        <span style={{ fontSize: 14, fontWeight: 700, color: Colors.text }}>Browser Performance</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Gauge2 label="FPS" value={fps} max={60} unit="" color={fpsColor} />
        {memory !== null && memoryLimit !== null ? (
          <Gauge2 label="JS Heap" value={Math.round(memory)} max={Math.round(memoryLimit)} unit="MB" color={memColor} />
        ) : (
          <div style={{ textAlign: "center", padding: 18 }}>
            <div style={{ fontSize: 11, color: Colors.textMuted }}>Heap stats unavailable in this browser</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Gauge2({ label, value, max, unit, color }: { label: string; value: number; max: number; unit: string; color: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ position: "relative", width: 110, height: 110 }}>
        <svg width="110" height="110" viewBox="0 0 110 110" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="55" cy="55" r={radius} fill="none" stroke="var(--rm-panel-border)" strokeWidth="8" />
          <circle
            cx="55" cy="55" r={radius} fill="none" stroke={color} strokeWidth="8"
            strokeLinecap="round" strokeDasharray={`${dash} ${circumference}`}
            style={{ transition: "stroke-dasharray 0.5s ease, stroke 0.3s ease" }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: Colors.text, lineHeight: 1 }}>{value}</div>
          <div style={{ fontSize: 9, color: Colors.textMuted, fontWeight: 600, marginTop: 2 }}>{unit || `/ ${max}`}</div>
        </div>
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: Colors.textMuted, letterSpacing: 0.5, marginTop: 6 }}>{label}</div>
    </div>
  );
}

/* ─────────── EventLog ─────────── */
type LogEvent = { t: number; level: "info" | "warn" | "error"; msg: string };

function EventLog({ events }: { events: LogEvent[] }) {
  return (
    <div style={{
      backgroundColor: Colors.card, borderRadius: 16, padding: 18,
      border: `1px solid ${Colors.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <Clock size={18} color={Colors.blue} />
        <span style={{ fontSize: 14, fontWeight: 700, color: Colors.text }}>Live Event Log</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: Colors.textMuted }}>{events.length} events</span>
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {events.length === 0 && (
          <div style={{ color: Colors.textMuted, fontSize: 12, textAlign: "center", padding: 30 }}>
            Watching for events…
          </div>
        )}
        {[...events].reverse().map((e, i) => {
          const c = e.level === "error" ? Colors.red : e.level === "warn" ? Colors.amber : Colors.green;
          const Icon = e.level === "error" ? XCircle : e.level === "warn" ? AlertTriangle : CheckCircle2;
          const time = new Date(e.t).toLocaleTimeString();
          return (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 10px", borderRadius: 8,
              backgroundColor: "var(--rm-panel-soft)",
              borderLeft: `2px solid ${c}`,
            }}>
              <Icon size={14} color={c} />
              <span style={{ fontSize: 12, color: Colors.text, flex: 1 }}>{e.msg}</span>
              <span style={{ fontSize: 10, color: Colors.textMuted, fontFamily: "monospace" }}>{time}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────── Page ─────────── */
export default function SystemHealthPage() {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [services, setServices] = useState<ServiceState[]>(() => [
    { name: "API Server",     endpoint: "/api/healthz",                    icon: Server,   color: Colors.green, description: "Express proxy", lastMs: 0, lastOk: true,  history: [] },
    { name: "RM ONE Proxy",    endpoint: "/api/rmone/healthz",              icon: Database, color: Colors.blue,  description: "RM ONE OAuth proxy", lastMs: 0, lastOk: true,  history: [] },
    { name: "AI / Chat",      endpoint: "/api/chat/healthz",               icon: Bot,      color: Colors.purple,description: "Chat service", lastMs: 0, lastOk: true,  history: [] },
  ]);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [tickCount, setTickCount] = useState(0);
  const [pageStart] = useState(() => Date.now());
  const [history, setHistory] = useState<UptimeHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Track online/offline
  useEffect(() => {
    const up = () => { setOnline(true); pushEvent("info", "Network back online"); };
    const down = () => { setOnline(false); pushEvent("error", "Network went offline"); };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushEvent = (level: LogEvent["level"], msg: string) => {
    setEvents((prev) => [...prev.slice(-99), { t: Date.now(), level, msg }]);
  };

  // Pinger — each service pings independently so a slow endpoint doesn't
  // block the others, and the UI updates the moment each result lands.
  useEffect(() => {
    let cancelled = false;
    const endpoints = services.map((s) => ({ name: s.name, endpoint: s.endpoint }));

    const pingOne = async (idx: number) => {
      const r = await pingEndpoint(endpoints[idx].endpoint);
      if (cancelled) return;
      setServices((prev) => prev.map((s, i) => {
        if (i !== idx) return s;
        const wasOk = s.lastOk;
        const isFirstSample = s.history.length === 0;
        const newHistory = [...s.history, { t: Date.now(), ms: r.ms, ok: r.ok }].slice(-HISTORY_SIZE);
        if (!isFirstSample && wasOk && !r.ok) {
          setTimeout(() => pushEvent("error", `${s.name} went down`), 0);
        } else if (!isFirstSample && !wasOk && r.ok) {
          setTimeout(() => pushEvent("info", `${s.name} recovered (${r.ms}ms)`), 0);
        } else if (r.ok && r.ms > 1500 && s.lastMs <= 1500 && !isFirstSample) {
          setTimeout(() => pushEvent("warn", `${s.name} slow response (${r.ms}ms)`), 0);
        }
        return { ...s, lastMs: r.ms, lastOk: r.ok, history: newHistory };
      }));
      setTickCount((c) => c + 1);
    };

    // Fire all initial pings immediately and in parallel
    endpoints.forEach((_, i) => { void pingOne(i); });

    const id = setInterval(() => {
      endpoints.forEach((_, i) => { void pingOne(i); });
    }, PING_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial event
  useEffect(() => {
    pushEvent("info", "System Health monitor started");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 7-day uptime history from server (refreshed every 60s)
  useEffect(() => {
    let cancelled = false;
    const fetchHistory = async () => {
      try {
        const res = await fetch("/api/system/uptime-history", { credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as UptimeHistory;
        if (!cancelled) { setHistory(json); setHistoryError(null); }
      } catch (e) {
        if (!cancelled) setHistoryError(e instanceof Error ? e.message : String(e));
      }
    };
    fetchHistory();
    const id = setInterval(fetchHistory, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Aggregate status: worst of all services or offline
  const overall = useMemo<"up" | "slow" | "down">(() => {
    if (!online) return "down";
    const states = services.map(statusOf);
    if (states.includes("down")) return "down";
    if (states.includes("slow")) return "slow";
    return "up";
  }, [services, online]);

  const overallColor = statusColor(overall);
  const overallLabel = !online ? "Offline" : statusLabel(overall);

  // Session uptime
  const sessionMs = Date.now() - pageStart;
  const totalSamples = services.reduce((a, s) => a + s.history.length, 0);
  const totalOk = services.reduce((a, s) => a + s.history.filter(h => h.ok).length, 0);
  const overallUptime = totalSamples > 0 ? (totalOk / totalSamples) * 100 : 100;

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  };

  const handleRefreshAll = () => {
    pushEvent("info", "Manual refresh triggered");
    setServices((prev) => prev.map((s) => ({ ...s, history: [] })));
  };

  return (
    <div style={{ backgroundColor: Colors.bg, minHeight: "100vh", padding: "24px 84px 24px 24px" }}>
      <style>{`
        @keyframes sysHealthShimmer { 0% { background-position: -200px 0; } 100% { background-position: 200px 0; } }
      `}</style>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 24, gap: 16, flexWrap: "nowrap",
      }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, color: Colors.text, letterSpacing: -0.5 }}>System Health</div>
          <div style={{ fontSize: 13, color: Colors.textSecondary, marginTop: 4 }}>
            Live monitoring of every backend service this session
          </div>
        </div>
        <button
          onClick={handleRefreshAll}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 16px", borderRadius: 12,
            backgroundColor: Colors.cardSoft, border: `1px solid ${Colors.border}`,
            color: Colors.text, fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          <RefreshCw size={14} />
          Reset history
        </button>
      </div>

      {/* Hero */}
      <div style={{
        display: "grid", gridTemplateColumns: "minmax(260px, 360px) 1fr", gap: 20,
        marginBottom: 20,
      }}>
        <div style={{
          backgroundColor: Colors.card, borderRadius: 20, padding: 24,
          border: `1px solid ${overallColor}40`,
          boxShadow: `0 6px 24px rgba(0,0,0,0.4), 0 0 60px ${overallColor}15 inset`,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          minHeight: 280,
        }}>
          <PulseRing color={overallColor} size={180} />
          <div style={{ fontSize: 26, fontWeight: 700, color: overallColor, marginTop: 18, letterSpacing: -0.5 }}>
            {overallLabel}
          </div>
          <div style={{ fontSize: 12, color: Colors.textMuted, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
            {online ? <Wifi size={12} /> : <WifiOff size={12} />}
            {online ? "Connected" : "No network"}
            <span style={{ opacity: 0.5 }}>·</span>
            <Zap size={12} /> {tickCount} checks
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <SummaryTile
            label="Overall Uptime"
            value={`${overallUptime.toFixed(1)}%`}
            sub="across all services"
            color={overallUptime >= 99 ? Colors.green : overallUptime >= 95 ? Colors.amber : Colors.red}
            icon={CheckCircle2}
          />
          <SummaryTile
            label="Session Time"
            value={formatDuration(sessionMs)}
            sub="this page open"
            color={Colors.blue}
            icon={Clock}
          />
          <SummaryTile
            label="Services"
            value={`${services.filter(s => statusOf(s) === "up").length} / ${services.length}`}
            sub="operational"
            color={Colors.green}
            icon={Server}
          />
          <SummaryTile
            label="Avg Latency"
            value={(() => {
              const all = services.flatMap(s => s.history.filter(h => h.ok).map(h => h.ms));
              return all.length > 0 ? `${Math.round(all.reduce((a, b) => a + b, 0) / all.length)}ms` : "—";
            })()}
            sub="last 60 pings"
            color={Colors.amber}
            icon={Gauge}
          />
        </div>
      </div>

      {/* Services grid */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: 16, marginBottom: 20,
      }}>
        {services.map((s, i) => <ServiceCard key={i} svc={s} />)}
      </div>

      {/* 7-day uptime heatmap */}
      <SevenDayHistory history={history} historyError={historyError} />

      {/* Browser perf + event log */}
      <div style={{
        display: "grid", gridTemplateColumns: "minmax(300px, 1fr) 2fr", gap: 16,
      }}>
        <BrowserStats />
        <EventLog events={events} />
      </div>
    </div>
  );
}

/* ─────────── 7-Day History ─────────── */

function uptimeColor(pct: number, hasData: boolean): string {
  if (!hasData) return "var(--rm-panel-soft)";
  if (pct >= 99.5) return Colors.green;
  if (pct >= 95)   return "#A8C742";
  if (pct >= 80)   return Colors.amber;
  if (pct > 0)     return "#D9534F";
  return Colors.red;
}

function SevenDayHistory({ history, historyError }: {
  history: UptimeHistory | null;
  historyError: string | null;
}) {
  const [hover, setHover] = useState<{ svcId: string; idx: number } | null>(null);
  const [selected, setSelected] = useState<{ svcId: string; idx: number } | null>(null);

  // Build a rich detail object for the currently-selected bar so the side
  // panel can show date, uptime %, ping count, latency AND — when the
  // bucket is degraded/red — a plain-English explanation that calls out
  // the RM ONE upstream API explicitly so the user knows whether the
  // problem is on our edge or theirs.
  const detail = (() => {
    if (!selected || !history) return null;
    const svc = history.services.find((s) => s.id === selected.svcId);
    const bucket = history.hours[selected.idx];
    if (!svc || !bucket) return null;
    const b = bucket.byService[svc.id]!;
    const hasData = b.total > 0;
    const failed = b.total - b.ok;
    const isApi =
      /api|upstream|rmone/i.test(svc.label) || /api|upstream/i.test(svc.id);
    let reason: string | null = null;
    let severity: "ok" | "slow" | "down" | "no-data" = "ok";
    if (!hasData) {
      severity = "no-data";
      // Look at neighbouring buckets to infer WHY this hour is empty —
      // a future bucket, a fresh monitor that hadn't booted yet, or a
      // mid-week outage where probes around it succeeded fine.
      const nowMs = Date.now();
      const isFuture = bucket.hourStart > nowMs;
      const prevBucket = history.hours[selected.idx - 1];
      const nextBucket = history.hours[selected.idx + 1];
      const prevHas = prevBucket ? (prevBucket.byService[svc.id]?.total ?? 0) > 0 : false;
      const nextHas = nextBucket ? (nextBucket.byService[svc.id]?.total ?? 0) > 0 : false;
      // Count contiguous empty buckets to the left so we can describe
      // the size of the gap (e.g., "≈3h outage window").
      let gapHours = 1;
      for (let i = selected.idx - 1; i >= 0; i--) {
        const t = history.hours[i].byService[svc.id]?.total ?? 0;
        if (t > 0) break;
        gapHours++;
        if (gapHours > 24) break;
      }
      for (let i = selected.idx + 1; i < history.hours.length; i++) {
        const t = history.hours[i].byService[svc.id]?.total ?? 0;
        if (t > 0) break;
        gapHours++;
        if (gapHours > 24) break;
      }
      if (isFuture) {
        reason = "This hour is in the future — probes haven't run yet. The bucket will populate once the monitor reaches this window.";
      } else if (prevHas && nextHas) {
        reason = `Probes ran normally before and after this hour, but every probe in this 60-minute window was missed. Most likely cause: ${
          isApi
            ? "the RM ONE upstream API server was unreachable for the entire hour (connection refused or timed out, so no result was ever recorded)."
            : "the monitor process was restarted or briefly offline during this window, so no probe results were written."
        }`;
      } else if (prevHas && !nextHas) {
        reason = `Probes stopped recording at this hour and have not resumed (≈${gapHours}h gap so far). ${
          isApi
            ? "This typically means the RM ONE upstream API server went down here and is still unreachable."
            : "This typically means the monitor crashed or was stopped at this point."
        }`;
      } else if (!prevHas && nextHas) {
        reason = `No probes were recorded leading up to this hour — the monitor (or upstream service) wasn't producing data yet. Probes started landing in the very next hour.`;
      } else {
        reason = "No probes were recorded in this hour or the hours immediately around it. The monitor was not running for this window yet.";
      }
    } else if (b.uptimePct >= 99.5) {
      severity = "ok";
      reason = `All ${b.total} probes succeeded. Average response ${b.avgMs}ms.`;
    } else if (b.uptimePct >= 80) {
      severity = "slow";
      reason = `${failed} of ${b.total} probes were degraded (slow or partial failure). Average response ${b.avgMs}ms.${
        isApi ? " This points to the RM ONE upstream API server slowing down for some requests." : ""
      }`;
    } else {
      severity = "down";
      reason = `${failed} of ${b.total} probes failed in this hour (${(100 - b.uptimePct).toFixed(1)}% error rate). Average response ${b.avgMs}ms.${
        isApi
          ? " Root cause: the RM ONE upstream API server returned errors or timed out. This is an RM ONE API server issue, not a problem on this dashboard."
          : " The dashboard service was unreachable during this window."
      }`;
    }
    return {
      svc,
      hourStart: bucket.hourStart,
      uptimePct: b.uptimePct,
      total: b.total,
      ok: b.ok,
      failed,
      avgMs: b.avgMs,
      hasData,
      severity,
      reason,
      color: uptimeColor(b.uptimePct, hasData),
    };
  })();

  return (
    <div style={{
      backgroundColor: Colors.card, borderRadius: 16, padding: 20,
      border: `1px solid ${Colors.border}`, marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Activity size={16} color={Colors.green} />
            <div style={{ fontSize: 15, fontWeight: 700, color: Colors.text }}>Last 7 Days</div>
          </div>
          <div style={{ fontSize: 11, color: Colors.textMuted, marginTop: 4 }}>
            {history
              ? `${history.totalSamples.toLocaleString()} samples · 168 hourly buckets per service`
              : historyError
                ? `Unable to load history: ${historyError}`
                : "Loading history…"}
          </div>
        </div>
        {history && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: Colors.textMuted }}>
            <span>0%</span>
            <div style={{ display: "flex", height: 8, borderRadius: 2, overflow: "hidden" }}>
              {[Colors.red, "#D9534F", Colors.amber, "#A8C742", Colors.green].map((c, i) => (
                <div key={i} style={{ width: 18, backgroundColor: c }} />
              ))}
            </div>
            <span>100%</span>
          </div>
        )}
      </div>

      {!history && !historyError && (
        <div style={{
          height: 180, display: "flex", alignItems: "center", justifyContent: "center",
          color: Colors.textMuted, fontSize: 12,
        }}>
          Gathering history…
        </div>
      )}

      {history && (
        <>
          {/* Hour-of-day axis (24h) */}
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, alignItems: "center", marginBottom: 6 }}>
            <div />
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(168, minmax(0, 1fr))", gap: 1,
              fontSize: 9, color: Colors.textMuted,
            }}>
              {Array.from({ length: 7 }).map((_, day) => {
                const dayStart = history.hours[day * 24]?.hourStart;
                const label = dayStart
                  ? new Date(dayStart).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
                  : "";
                return (
                  <div key={day} style={{
                    gridColumn: `${day * 24 + 1} / span 24`,
                    textAlign: "center", paddingBottom: 4,
                    borderBottom: `1px solid ${Colors.border}`,
                    color: Colors.textSecondary, fontSize: 10, fontWeight: 600,
                  }}>{label}</div>
                );
              })}
            </div>
          </div>

          {/* Per-service rows */}
          {history.services.map((svc) => {
            const totals = history.perService[svc.id] ?? { uptimePct: 100, total: 0, ok: 0, avgMs: 0 };
            return (
              <div key={svc.id} style={{
                display: "grid", gridTemplateColumns: "120px 1fr", gap: 12,
                alignItems: "center", marginBottom: 4,
              }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingRight: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: Colors.text }}>{svc.label}</div>
                  <div style={{ fontSize: 10, color: Colors.textMuted, fontFamily: "ui-monospace, monospace" }}>
                    {totals.uptimePct.toFixed(2)}% · {totals.avgMs}ms
                  </div>
                </div>
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(168, minmax(0, 1fr))", gap: 1,
                  height: 28,
                }}>
                  {history.hours.map((h, idx) => {
                    const b = h.byService[svc.id]!;
                    const hasData = b.total > 0;
                    const isHover = hover?.svcId === svc.id && hover.idx === idx;
                    const isSelected = selected?.svcId === svc.id && selected.idx === idx;
                    return (
                      <div
                        key={idx}
                        onMouseEnter={() => setHover({ svcId: svc.id, idx })}
                        onMouseLeave={() => setHover((p) => p && p.svcId === svc.id && p.idx === idx ? null : p)}
                        onClick={() => setSelected({ svcId: svc.id, idx })}
                        style={{
                          backgroundColor: uptimeColor(b.uptimePct, hasData),
                          borderRadius: 1,
                          opacity: isHover ? 0.8 : 1,
                          cursor: "pointer",
                          transition: "opacity 0.1s, outline 0.1s",
                          outline: isSelected ? `2px solid ${Colors.text}` : "none",
                          outlineOffset: isSelected ? 1 : 0,
                          position: "relative",
                          zIndex: isSelected ? 2 : 1,
                        }}
                        title={
                          hasData
                            ? `${new Date(h.hourStart).toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" })}\n${svc.label}: ${b.uptimePct.toFixed(1)}% uptime · ${b.ok}/${b.total} pings · ${b.avgMs}ms avg\n(click for details)`
                            : `${new Date(h.hourStart).toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" })}\n${svc.label}: no data\n(click for details)`
                        }
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Selected-bar detail panel — opens when the user clicks any
              hour bucket. Shows full date/time, uptime %, ping counts,
              latency, AND when the bucket is amber/red explains WHY
              with an explicit "RM ONE API server" callout if the
              affected service is an upstream API. */}
          {detail && (
            <div style={{
              marginTop: 14, padding: 14, borderRadius: 12,
              backgroundColor: "var(--rm-panel-soft)",
              border: `1px solid ${detail.color}55`,
              display: "grid", gap: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: 2,
                    backgroundColor: detail.color,
                  }} />
                  <div style={{ fontSize: 13, fontWeight: 700, color: Colors.text }}>
                    {detail.svc.label}
                  </div>
                  <div style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
                    padding: "2px 8px", borderRadius: 999,
                    backgroundColor: detail.color + "22", color: detail.color,
                    textTransform: "uppercase",
                  }}>
                    {detail.severity === "ok" ? "Healthy"
                      : detail.severity === "slow" ? "Degraded"
                      : detail.severity === "down" ? "Down"
                      : "No data"}
                  </div>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  style={{
                    background: "transparent", border: "none", color: Colors.textMuted,
                    cursor: "pointer", fontSize: 11, fontWeight: 600,
                  }}
                >Close ✕</button>
              </div>

              <div style={{
                display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 10, alignItems: "stretch",
              }}>
                <DetailStat label="Date / hour" value={
                  new Date(detail.hourStart).toLocaleString("en-US", {
                    weekday: "short", month: "short", day: "numeric",
                    hour: "numeric", minute: "2-digit",
                    timeZone: "America/Los_Angeles",
                    timeZoneName: "short",
                  })
                } />
                <DetailStat
                  label="Uptime"
                  value={detail.hasData ? `${detail.uptimePct.toFixed(1)}%` : "—"}
                  valueColor={detail.color}
                />
                <DetailStat
                  label="Probes"
                  value={detail.hasData ? `${detail.ok} / ${detail.total}` : "0"}
                  sub={detail.hasData && detail.failed > 0 ? `${detail.failed} failed` : undefined}
                />
                <DetailStat
                  label="Avg latency"
                  value={detail.hasData ? `${detail.avgMs} ms` : "—"}
                />
              </div>

              {detail.reason && (
                <div style={{
                  fontSize: 12, lineHeight: 1.5, color: Colors.textSecondary,
                  padding: 10, borderRadius: 8,
                  backgroundColor: detail.severity === "down" ? "rgba(224,60,60,0.08)"
                    : detail.severity === "slow" ? "rgba(245,158,11,0.08)"
                    : "var(--rm-panel-soft)",
                  border: `1px solid ${detail.color}22`,
                }}>
                  {detail.reason}
                </div>
              )}
            </div>
          )}

          {/* Recent failures */}
          {(() => {
            // Distinguish "monitored hours with no failure" from "no
            // probes at all". The dev workflow sleeps when the Repl is
            // idle, so most of the 168-hour window can legitimately
            // have zero probes — calling that a "clean week" is
            // misleading. Count how many of the 168 hourly buckets
            // actually have probes across all services.
            const totalHours = history.hours.length;
            const monitoredHours = history.hours.reduce((n, h) => {
              const anyProbe = history.services.some(
                (s) => (h.byService[s.id]?.total ?? 0) > 0,
              );
              return anyProbe ? n + 1 : n;
            }, 0);
            const coverage = totalHours > 0
              ? Math.round((monitoredHours / totalHours) * 100)
              : 0;
            const hasFailures = history.recentFailures.length > 0;
            return (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${Colors.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <AlertTriangle size={14} color={Colors.amber} />
              <div style={{ fontSize: 12, fontWeight: 700, color: Colors.text, letterSpacing: 0.3 }}>
                RECENT FAILURES
              </div>
              <div style={{ fontSize: 11, color: Colors.textMuted }}>
                {hasFailures
                  ? `${history.recentFailures.length} in window`
                  : monitoredHours === 0
                    ? "No probes recorded yet"
                    : `None in ${monitoredHours} monitored hour${monitoredHours === 1 ? "" : "s"}`}
              </div>
            </div>
            {!hasFailures ? (
              <div style={{
                fontSize: 12, color: Colors.textMuted, padding: "12px 0",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <CheckCircle2 size={14} color={Colors.green} />
                {monitoredHours === 0
                  ? "No probes have landed yet — the monitor is still warming up."
                  : `No failures in the ${monitoredHours} hour${monitoredHours === 1 ? "" : "s"} that were monitored (${coverage}% of the last 7 days). The empty stretches above are hours when the monitor itself wasn't running — not silent outages.`}
              </div>
            ) : (
              <div style={{
                display: "grid", gap: 4, maxHeight: 200, overflowY: "auto",
              }}>
                {history.recentFailures.map((f, i) => (
                  <div key={i} style={{
                    display: "grid", gridTemplateColumns: "180px 1fr 80px", gap: 8,
                    fontSize: 11, padding: "6px 10px", borderRadius: 6,
                    backgroundColor: "rgba(224,60,60,0.08)",
                    border: `1px solid rgba(224,60,60,0.18)`,
                    alignItems: "center",
                  }}>
                    <div style={{ color: Colors.textSecondary, fontFamily: "ui-monospace, monospace" }}>
                      {new Date(f.t).toLocaleString()}
                    </div>
                    <div style={{ color: Colors.text, fontWeight: 600 }}>{f.serviceLabel}</div>
                    <div style={{ color: Colors.red, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>
                      {f.ms}ms
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

function DetailStat({ label, value, sub, valueColor }: {
  label: string; value: string; sub?: string; valueColor?: string;
}) {
  return (
    <div style={{
      padding: "8px 10px", borderRadius: 8,
      backgroundColor: "var(--rm-panel-soft)",
      border: `1px solid ${Colors.border}`,
      display: "flex", flexDirection: "column", gap: 2, minWidth: 0,
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: 0.6,
        color: Colors.textMuted, textTransform: "uppercase",
      }}>{label}</div>
      <div style={{
        fontSize: 14, fontWeight: 700,
        color: valueColor ?? Colors.text,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 10, color: Colors.textMuted }}>{sub}</div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub: string; color: string; icon: typeof Server;
}) {
  return (
    <div style={{
      backgroundColor: Colors.card, borderRadius: 16, padding: 18,
      border: `1px solid ${Colors.border}`,
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      minHeight: 120,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: Colors.textMuted, letterSpacing: 0.6 }}>{label.toUpperCase()}</div>
        <Icon size={16} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1, letterSpacing: -0.5 }}>{value}</div>
        <div style={{ fontSize: 11, color: Colors.textMuted, marginTop: 4 }}>{sub}</div>
      </div>
    </div>
  );
}
