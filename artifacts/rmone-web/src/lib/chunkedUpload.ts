/**
 * Size-safe file upload.
 *
 * The production edge rejects any single HTTP request over ~32MB with a bare
 * 413 before it ever reaches the app — the dev workspace has no such limit,
 * which is why big uploads only broke on the live site. This helper keeps the
 * classic single-request POST for small files, and transparently switches to
 * chunked mode for anything bigger: the file is sliced into ~20MB pieces,
 * sent one at a time to `<base>/upload-chunk`, then `<base>/upload-complete`
 * reassembles it server-side and returns the SAME response shape as the
 * classic endpoint — so callers just swap their fetch() for uploadFileSmart()
 * and everything downstream stays identical. No practical file-size ceiling.
 *
 * Every request here carries a hard time limit: a dropped connection used to
 * leave fetch() pending FOREVER, so submit screens ("Uploading your data…")
 * could spin silently for 15+ minutes while the server had never heard of the
 * upload (live incident, Aug 2026). With a timeout the failure THROWS, and
 * every caller already surfaces thrown upload errors loudly.
 */

const CHUNK_THRESHOLD = 25 * 1024 * 1024; // switch to chunked mode above this
const CHUNK_SIZE = 20 * 1024 * 1024;      // comfortably under the ~32MB edge cap

const SINGLE_SHOT_TIMEOUT_MS = 180_000;   // one POST, file < 25MB — generous for slow uplinks
const CHUNK_ATTEMPT_TIMEOUT_MS = 120_000; // per ~20MB piece, per attempt (3 attempts each)
const ASSEMBLE_TIMEOUT_MS = 600_000;      // server reassembles + parses the whole workbook —
                                          // 10 min so a 200MB+ parse under load never falsely
                                          // times out; still bounded instead of forever

/** Caller's abort signal (if any) combined with a hard timeout. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

export async function uploadFileSmart(opts: {
  /** Classic single-request endpoint, e.g. "/api/onboarding/upload". */
  url: string;
  file: File;
  /** Extra fields (tenantId, forcedTabType, …) sent alongside the file. */
  extra?: Record<string, string>;
  headers: Record<string, string>;
  signal?: AbortSignal;
}): Promise<Response> {
  const { url, file, extra = {}, headers, signal } = opts;

  if (file.size < CHUNK_THRESHOLD) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    fd.append("file", file);
    return fetch(url, {
      method: "POST",
      body: fd,
      headers,
      signal: withTimeout(signal, SINGLE_SHOT_TIMEOUT_MS),
    });
  }

  const base = url.replace(/\/upload$/, "");
  const sessionId = crypto.randomUUID();
  const total = Math.ceil(file.size / CHUNK_SIZE);

  for (let seq = 0; seq < total; seq++) {
    const piece = file.slice(seq * CHUNK_SIZE, Math.min(file.size, (seq + 1) * CHUNK_SIZE));
    let ok = false;
    let lastErr = "";
    // Up to 3 tries per piece — a transient network blip shouldn't force the
    // user to restart a multi-hundred-MB upload from scratch. Re-sending the
    // same piece is safe (the server upserts by sessionId+seq).
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const fd = new FormData();
      fd.append("sessionId", sessionId);
      fd.append("seq", String(seq));
      fd.append("chunk", piece, `${file.name}.part${seq}`);
      try {
        // Fresh timeout per attempt — AbortSignal.timeout() starts counting
        // the moment it is created, so it must live INSIDE the retry loop.
        const r = await fetch(`${base}/upload-chunk`, {
          method: "POST",
          body: fd,
          headers,
          signal: withTimeout(signal, CHUNK_ATTEMPT_TIMEOUT_MS),
        });
        if (r.ok) { ok = true; break; }
        lastErr = `HTTP ${r.status}`;
        try { lastErr = ((await r.json()) as { error?: string })?.error ?? lastErr; } catch { /* non-JSON */ }
        // Retrying won't fix auth or validation rejections.
        if ([400, 401, 403, 413].includes(r.status)) break;
      } catch (e) {
        if (signal?.aborted) throw e; // the CALLER cancelled — never retry past that
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    if (!ok) {
      throw new Error(`Upload failed while sending part ${seq + 1} of ${total}${lastErr ? ` (${lastErr})` : ""}`);
    }
  }

  try {
    return await fetch(`${base}/upload-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ sessionId, fileName: file.name, totalChunks: total, ...extra }),
      signal: withTimeout(signal, ASSEMBLE_TIMEOUT_MS),
    });
  } catch (e) {
    if (signal?.aborted) throw e; // the CALLER cancelled — report as-is
    // Every byte is already on the server at this point — only the final
    // confirmation was lost. The server may well finish assembling and
    // registering the upload after we give up waiting, so "nothing was
    // saved" would be a lie here (code-review catch): steer the user to
    // CHECK before re-sending instead of promising a clean slate. A stray
    // upload that did land self-cancels server-side within 5 minutes if it
    // is never started.
    throw new Error(
      "The file was sent, but the final confirmation timed out. Please refresh the page — if your upload doesn't show as in progress (or in the import history) within a few minutes, upload the file again.",
    );
  }
}
