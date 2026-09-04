// ── Local cache for original uploaded workbooks (Upload History view) ──────
// "View file" on the history page downloads the ORIGINAL Excel upload from
// the server, where it lives as a blob in the remote SQL Server — for big
// client files (50+ MB) that round trip takes a minute or more. The blob for
// a given uploadId never changes after the upload, so once downloaded it is
// cached here (IndexedDB — far too big for localStorage) and every later
// view opens from disk near-instantly.
//
// Keys embed the tenantId alongside the uploadId so entries stay tenant-
// scoped by construction. Every helper is fail-soft: any IndexedDB error
// (private browsing, quota, corrupt DB) resolves as a miss / no-op — the
// server download path is the always-available fallback.

const DB_NAME = "rmone-history-files";
const DB_VERSION = 1;
const STORE = "files";
/** Files can be 50+ MB each — keep only the few most recently viewed. */
const MAX_ENTRIES = 4;

interface CachedHistoryFile {
  key: string;        // `${tenantId}:${uploadId}`
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
        db.createObjectStore(STORE, { keyPath: "key" });
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

/** Look up a cached upload by tenant+uploadId key. Resolves null on miss or any storage error. */
export async function getCachedHistoryFile(key: string): Promise<{ blob: Blob; fileName: string } | null> {
  try {
    const db = await openDb();
    try {
      const rec = await new Promise<CachedHistoryFile | undefined>((resolve, reject) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result as CachedHistoryFile | undefined);
        req.onerror = () => reject(req.error);
      });
      if (rec?.blob instanceof Blob && rec.blob.size > 0) {
        return { blob: rec.blob, fileName: rec.fileName || "upload.xlsx" };
      }
      return null;
    } finally { db.close(); }
  } catch { return null; }
}

/** Store a downloaded upload blob; prunes the oldest entries beyond MAX_ENTRIES. Never throws. */
export async function putCachedHistoryFile(key: string, blob: Blob, fileName: string): Promise<void> {
  try {
    if (!key || !(blob instanceof Blob) || blob.size === 0) return;
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.put({ key, blob, fileName, ts: Date.now() } satisfies CachedHistoryFile);
      const all = await new Promise<CachedHistoryFile[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result ?? []) as CachedHistoryFile[]);
        req.onerror = () => reject(req.error);
      });
      if (all.length > MAX_ENTRIES) {
        all.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
        for (const stale of all.slice(MAX_ENTRIES)) store.delete(stale.key);
      }
      await txDone(tx);
    } finally { db.close(); }
  } catch { /* fail-soft — server download remains the fallback */ }
}
