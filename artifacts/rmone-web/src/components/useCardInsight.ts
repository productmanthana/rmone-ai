import { useEffect, useRef, useState } from "react";
import { fetchCardInsightsChunk, getStoredUser, INSIGHT_MAX_PER_REQUEST, type CardInsight, type InsightKind } from "../lib/api";
import { memSeed } from "../lib/memSeed";

interface QueueItem {
  id: string;
  fields: Record<string, unknown>;
  cacheKey: string;
  resolve: (v: CardInsight | null) => void;
}

interface CachedInsight {
  value: CardInsight;
  expiresAt: number;
}

interface KindState {
  pending: Map<string, QueueItem>;
  cache: Map<string, CachedInsight>;
  inflight: Map<string, Promise<CardInsight | null>>;
  timer: ReturnType<typeof setTimeout> | null;
}

const CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
const LS_PREFIX = "rmone:cardInsight:v2:";
const LS_LAST_PREFIX = "rmone:cardInsight:last:";

function tenantTag(): string {
  return getStoredUser()?.tenant || "anon";
}

function lsKey(kind: InsightKind, key: string): string {
  return `${LS_PREFIX}${tenantTag()}:${kind}:${key}`;
}

function lsLastKey(kind: InsightKind, id: string): string {
  return `${LS_LAST_PREFIX}${tenantTag()}:${kind}:${id}`;
}

// MEMORY-ONLY: card insights are cached in the in-memory seed store — nothing
// is persisted to browser storage (customer requirement: zero app data in
// localStorage). Same keys/TTLs as before, so behavior within a session is
// identical; a page reload simply refetches.
function lsRead(kind: InsightKind, key: string): CachedInsight | null {
  try {
    const raw = memSeed.getItem(lsKey(kind, key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedInsight;
    if (!parsed || typeof parsed.expiresAt !== "number" || !parsed.value) return null;
    if (parsed.expiresAt <= Date.now()) {
      memSeed.removeItem(lsKey(kind, key));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function lsWrite(kind: InsightKind, key: string, entry: CachedInsight): void {
  try {
    memSeed.setItem(lsKey(kind, key), JSON.stringify(entry));
  } catch {}
}

function lsReadLast(kind: InsightKind, id: string): CardInsight | null {
  try {
    const raw = memSeed.getItem(lsLastKey(kind, id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CardInsight;
    if (!parsed || !parsed.text) return null;
    return parsed;
  } catch {
    return null;
  }
}

function lsWriteLast(kind: InsightKind, id: string, value: CardInsight): void {
  try {
    memSeed.setItem(lsLastKey(kind, id), JSON.stringify(value));
  } catch {}
}

function readCache(kind: InsightKind, state: KindState, key: string): CardInsight | null {
  const memHit = state.cache.get(key);
  if (memHit) {
    if (memHit.expiresAt > Date.now()) return memHit.value;
    state.cache.delete(key);
  }
  const lsHit = lsRead(kind, key);
  if (lsHit) {
    state.cache.set(key, lsHit);
    return lsHit.value;
  }
  return null;
}

function writeCache(kind: InsightKind, state: KindState, key: string, value: CardInsight): void {
  const entry: CachedInsight = { value, expiresAt: Date.now() + CLIENT_TTL_MS };
  state.cache.set(key, entry);
  lsWrite(kind, key, entry);
}

function emptyKind(): KindState {
  return { pending: new Map(), cache: new Map(), inflight: new Map(), timer: null };
}

const STATE: Record<InsightKind, KindState> = {
  project: emptyKind(),
  opportunity: emptyKind(),
  lead: emptyKind(),
  staff: emptyKind(),
  demand: emptyKind(),
};

function fieldsKey(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).sort();
  return keys.map(k => `${k}=${JSON.stringify(fields[k])}`).join("|");
}

const FLUSH_DELAY_MS = 60;

function scheduleFlush(kind: InsightKind) {
  const state = STATE[kind];
  if (state.timer != null) return;
  state.timer = setTimeout(() => flush(kind), FLUSH_DELAY_MS);
}

async function flush(kind: InsightKind) {
  const state = STATE[kind];
  state.timer = null;
  if (state.pending.size === 0) return;

  const items = Array.from(state.pending.values());
  state.pending.clear();

  const itemsById = new Map<string, QueueItem[]>();
  for (const it of items) {
    const arr = itemsById.get(it.id) ?? [];
    arr.push(it);
    itemsById.set(it.id, arr);
  }
  const uniqueRecords = Array.from(itemsById.entries()).map(([id, arr]) => ({
    id,
    fields: arr[0].fields,
  }));

  const chunks: typeof uniqueRecords[] = [];
  for (let i = 0; i < uniqueRecords.length; i += INSIGHT_MAX_PER_REQUEST) {
    chunks.push(uniqueRecords.slice(i, i + INSIGHT_MAX_PER_REQUEST));
  }
  console.log(`[CardInsight] flush kind=${kind} items=${items.length} unique=${uniqueRecords.length} chunks=${chunks.length}`);

  await Promise.all(chunks.map(async (chunk, idx) => {
    try {
      const result = await fetchCardInsightsChunk(kind, chunk);
      const keys = Object.keys(result);
      console.log(`[CardInsight] chunk ${idx + 1}/${chunks.length} done kind=${kind} returned=${keys.length}`);
      for (const r of chunk) {
        const arr = itemsById.get(r.id) ?? [];
        const v = result[r.id] ?? null;
        for (const it of arr) {
          if (v) {
            writeCache(kind, state, it.cacheKey, v);
            lsWriteLast(kind, it.id, v);
          }
          it.resolve(v);
          state.inflight.delete(it.cacheKey);
        }
      }
    } catch (err) {
      console.log(`[CardInsight] chunk ${idx + 1}/${chunks.length} error kind=${kind}: ${String(err)}`);
      for (const r of chunk) {
        const arr = itemsById.get(r.id) ?? [];
        for (const it of arr) {
          it.resolve(null);
          state.inflight.delete(it.cacheKey);
        }
      }
    }
  }));
}

function requestInsight(
  kind: InsightKind,
  id: string,
  fields: Record<string, unknown>,
): Promise<CardInsight | null> {
  const state = STATE[kind];
  const ck = `${tenantTag()}:${id}:${fieldsKey(fields)}`;
  const cached = readCache(kind, state, ck);
  if (cached) return Promise.resolve(cached);

  const existing = state.inflight.get(ck);
  if (existing) return existing;

  const p = new Promise<CardInsight | null>((resolve) => {
    state.pending.set(ck, { id, fields, cacheKey: ck, resolve });
    scheduleFlush(kind);
  });
  state.inflight.set(ck, p);
  return p;
}

export function useCardInsight(
  kind: InsightKind,
  id: string,
  fields: Record<string, unknown>,
): { insight: CardInsight | null; loading: boolean; refreshing: boolean; ref: (el: HTMLElement | null) => void } {
  const fieldsKeyStr = fieldsKey(fields);
  const initRef = useRef(() => {
    const ck = `${tenantTag()}:${id}:${fieldsKeyStr}`;
    const exact = readCache(kind, STATE[kind], ck);
    const last = exact ? null : lsReadLast(kind, id);
    return { exact, last };
  });
  const [insight, setInsight] = useState<CardInsight | null>(() => {
    const { exact, last } = initRef.current();
    return exact ?? last ?? null;
  });
  const [loading, setLoading] = useState(() => {
    const { exact, last } = initRef.current();
    return !exact && !last;
  });
  const [refreshing, setRefreshing] = useState(() => {
    const { exact, last } = initRef.current();
    return !exact && !!last;
  });
  const elRef = useRef<HTMLElement | null>(null);
  const aliveRef = useRef(true);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    const ck = `${tenantTag()}:${id}:${fieldsKeyStr}`;
    const cached = readCache(kind, STATE[kind], ck);
    if (cached) {
      setInsight(cached);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const lastKnown = lsReadLast(kind, id);
    if (lastKnown) {
      setInsight(lastKnown);
      setLoading(false);
      setRefreshing(true);
    } else {
      setInsight(null);
      setLoading(true);
      setRefreshing(false);
    }

    let cancelled = false;
    console.log(`[CardInsight] mount kind=${kind} id=${id} hasStale=${!!lastKnown}`);
    requestInsight(kind, id, fieldsRef.current).then(v => {
      console.log(`[CardInsight] resolved kind=${kind} id=${id} hasInsight=${!!v} text=${v?.text?.slice(0, 40) ?? "null"}`);
      if (!aliveRef.current || cancelled) return;
      if (v) {
        lsWriteLast(kind, id, v);
        setInsight(v);
      }
      setLoading(false);
      setRefreshing(false);
    });

    return () => {
      cancelled = true;
    };
  }, [kind, id, fieldsKeyStr]);

  const refCb = (el: HTMLElement | null) => {
    elRef.current = el;
  };

  return { insight, loading, refreshing, ref: refCb };
}
