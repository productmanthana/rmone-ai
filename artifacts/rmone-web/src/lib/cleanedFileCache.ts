// ── Local cache for cleaned workbooks ──────────────────────────────────────
// The data-cleaning engine keeps every cleaned workbook on the server, but
// re-downloading a multi-MB Excel on every refresh / back-navigation makes
// the import grid sit on the empty template (sample rows) while the fetch
// runs. The blob is cached here (IndexedDB — too big for localStorage) the
// moment a cleaning run finishes, so session re-hydration restores the
// user's rows from disk near-instantly and only falls back to the server
// when the cache misses.
//
// Every helper is fail-soft: any IndexedDB error (private browsing, quota,
// corrupt DB) resolves as a miss / no-op — the server download path is the
// always-available fallback, never the other way around.

const DB_NAME = "rmone-cleaned-files";
const DB_VERSION = 1;
const STORE = "files";
/** Keep only the most recent workbooks — old sessions are pruned on write. */
const MAX_ENTRIES = 6;

interface CachedCleanedFile {
  sessionId: string;
  blob: Blob;
  fileName: string;
  ts: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no indexedDB")); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "sessionId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onblocked = () => reject(new Error("indexedDB blocked"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("tx aborted"));
  });
}

/** Look up a cleaned workbook by cleaning sessionId. Resolves null on miss or any storage error. */
export async function getCachedCleanedFile(sessionId: string): Promise<{ blob: Blob; fileName: string } | null> {
  try {
    const db = await openDb();
    try {
      const rec = await new Promise<CachedCleanedFile | undefined>((resolve, reject) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(sessionId);
        req.onsuccess = () => resolve(req.result as CachedCleanedFile | undefined);
        req.onerror = () => reject(req.error);
      });
      if (rec?.blob instanceof Blob && rec.blob.size > 0) {
        return { blob: rec.blob, fileName: rec.fileName || "cleaned-data.xlsx" };
      }
      return null;
    } finally { db.close(); }
  } catch { return null; }
}

/** Store a cleaned workbook blob; prunes the oldest entries beyond MAX_ENTRIES. Never throws. */
export async function putCachedCleanedFile(sessionId: string, blob: Blob, fileName: string): Promise<void> {
  try {
    if (!sessionId || !(blob instanceof Blob) || blob.size === 0) return;
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.put({ sessionId, blob, fileName, ts: Date.now() } satisfies CachedCleanedFile);
      // Prune: read all keys+timestamps, drop the oldest beyond the cap.
      const all = await new Promise<CachedCleanedFile[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result ?? []) as CachedCleanedFile[]);
        req.onerror = () => reject(req.error);
      });
      if (all.length > MAX_ENTRIES) {
        all.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
        for (const stale of all.slice(MAX_ENTRIES)) store.delete(stale.sessionId);
      }
      await txDone(tx);
    } finally { db.close(); }
  } catch { /* fail-soft — server download remains the fallback */ }
}

/** Remove one cached workbook (cleared grid / expired session). Never throws. */
export async function deleteCachedCleanedFile(sessionId: string): Promise<void> {
  try {
    if (!sessionId) return;
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(sessionId);
      await txDone(tx);
    } finally { db.close(); }
  } catch { /* fail-soft */ }
}
