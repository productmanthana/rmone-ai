import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(DATA_DIR, "uptime-history.json");

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 60_000;
const PING_TIMEOUT_MS = 5_000;

export type Service = { id: string; label: string; path: string };

export const SERVICES: Service[] = [
  { id: "api",   label: "API Server",  path: "/api/healthz" },
  { id: "rmone", label: "RM ONE Proxy", path: "/api/rmone/healthz" },
  { id: "chat",  label: "AI / Chat",   path: "/api/chat/healthz" },
];

type Sample = { t: number; s: string; ok: boolean; ms: number };

let _samples: Sample[] = [];
let _loaded = false;
let _writeTimer: NodeJS.Timeout | null = null;

function loadFromDisk() {
  if (_loaded) return;
  _loaded = true;
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cutoff = Date.now() - RETENTION_MS;
        _samples = parsed.filter((s: Sample) => s && s.t >= cutoff);
        console.log(`[uptime-monitor] loaded ${_samples.length} samples from disk`);
      }
    }
  } catch (e) {
    console.warn("[uptime-monitor] failed to load history:", e);
    _samples = [];
  }
}

function scheduleWrite() {
  if (_writeTimer) return;
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify(_samples), "utf-8");
    } catch (e) {
      console.warn("[uptime-monitor] failed to persist:", e);
    }
  }, 2000);
}

function pruneOld() {
  const cutoff = Date.now() - RETENTION_MS;
  if (_samples.length === 0 || _samples[0]!.t >= cutoff) return;
  _samples = _samples.filter((s) => s.t >= cutoff);
}

async function pingService(baseUrl: string, svc: Service): Promise<Sample> {
  const start = performance.now();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl + svc.path, { signal: ctrl.signal });
    const ms = Math.round(performance.now() - start);
    return { t: Date.now(), s: svc.id, ok: res.ok, ms };
  } catch {
    const ms = Math.round(performance.now() - start);
    return { t: Date.now(), s: svc.id, ok: false, ms };
  } finally {
    clearTimeout(to);
  }
}

async function tick(baseUrl: string) {
  const results = await Promise.all(SERVICES.map((s) => pingService(baseUrl, s)));
  _samples.push(...results);
  pruneOld();
  scheduleWrite();
}

export function startUptimeMonitor(port: number) {
  loadFromDisk();
  const baseUrl = `http://127.0.0.1:${port}`;
  // First tick after 3s so the server is fully ready
  setTimeout(() => {
    tick(baseUrl).catch((e) => console.warn("[uptime-monitor] tick failed:", e));
  }, 3000);
  setInterval(() => {
    tick(baseUrl).catch((e) => console.warn("[uptime-monitor] tick failed:", e));
  }, SAMPLE_INTERVAL_MS);
  console.log(`[uptime-monitor] started — sampling ${SERVICES.length} services every ${SAMPLE_INTERVAL_MS / 1000}s`);
}

/* ───────────── Read API ───────────── */

export type HourBucket = {
  hourStart: number;        // epoch ms aligned to hour
  byService: Record<string, { total: number; ok: number; avgMs: number; uptimePct: number }>;
};

export type UptimeHistory = {
  services: Service[];
  rangeMs: number;
  generatedAt: number;
  totalSamples: number;
  hours: HourBucket[];      // 168 buckets, oldest first
  recentFailures: Array<{ t: number; serviceId: string; serviceLabel: string; ms: number }>;
  perService: Record<string, { uptimePct: number; total: number; ok: number; avgMs: number }>;
};

const HOUR_MS = 60 * 60 * 1000;

export function getUptimeHistory(): UptimeHistory {
  loadFromDisk();
  const now = Date.now();
  const startHour = Math.floor((now - RETENTION_MS) / HOUR_MS) * HOUR_MS;
  const numHours = Math.ceil(RETENTION_MS / HOUR_MS);

  const hours: HourBucket[] = [];
  for (let i = 0; i < numHours; i++) {
    const hourStart = startHour + i * HOUR_MS;
    const byService: HourBucket["byService"] = {};
    for (const svc of SERVICES) {
      byService[svc.id] = { total: 0, ok: 0, avgMs: 0, uptimePct: 100 };
    }
    hours.push({ hourStart, byService });
  }

  const labelMap = new Map(SERVICES.map((s) => [s.id, s.label] as const));
  const sumMs: Record<number, Record<string, number>> = {};

  for (const sample of _samples) {
    if (sample.t < startHour) continue;
    const idx = Math.floor((sample.t - startHour) / HOUR_MS);
    if (idx < 0 || idx >= hours.length) continue;
    const bucket = hours[idx]!.byService[sample.s];
    if (!bucket) continue;
    bucket.total += 1;
    if (sample.ok) bucket.ok += 1;
    if (!sumMs[idx]) sumMs[idx] = {};
    sumMs[idx]![sample.s] = (sumMs[idx]![sample.s] ?? 0) + sample.ms;
  }

  for (let i = 0; i < hours.length; i++) {
    for (const svc of SERVICES) {
      const b = hours[i]!.byService[svc.id]!;
      if (b.total > 0) {
        b.uptimePct = (b.ok / b.total) * 100;
        b.avgMs = Math.round((sumMs[i]?.[svc.id] ?? 0) / b.total);
      }
    }
  }

  // Per-service totals across the whole window
  const perService: UptimeHistory["perService"] = {};
  for (const svc of SERVICES) {
    let total = 0, ok = 0, sum = 0;
    for (const s of _samples) {
      if (s.s !== svc.id) continue;
      total++;
      if (s.ok) ok++;
      sum += s.ms;
    }
    perService[svc.id] = {
      uptimePct: total > 0 ? (ok / total) * 100 : 100,
      total,
      ok,
      avgMs: total > 0 ? Math.round(sum / total) : 0,
    };
  }

  // Recent failures (most recent first, last 50)
  const recentFailures: UptimeHistory["recentFailures"] = [];
  for (let i = _samples.length - 1; i >= 0 && recentFailures.length < 50; i--) {
    const s = _samples[i]!;
    if (!s.ok) {
      recentFailures.push({
        t: s.t,
        serviceId: s.s,
        serviceLabel: labelMap.get(s.s) ?? s.s,
        ms: s.ms,
      });
    }
  }

  return {
    services: SERVICES,
    rangeMs: RETENTION_MS,
    generatedAt: now,
    totalSamples: _samples.length,
    hours,
    recentFailures,
    perService,
  };
}
