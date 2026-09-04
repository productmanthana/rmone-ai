// After a production deploy the previous build's hashed JS chunks are gone.
// A browser still running the old index.html that then navigates to a
// lazy-loaded route fails its dynamic import and React renders a blank page
// (there is no error boundary above the router). The fix: on the FIRST chunk
// load failure, force a full reload so the browser picks up the new
// index.html + chunk graph. A session timestamp guards against reload loops
// when the failure is not deploy-related (e.g. the server is briefly down).
//
// If the guard has already been consumed (reloaded once recently and still
// failing), fall through to the banner rather than looping.
import { lazy } from "react";
import type { ComponentType } from "react";
import { markNewVersionAvailable } from "./newVersionSignal";

const KEY = "rm-chunk-reload-at";
const MIN_INTERVAL_MS = 30_000;

/**
 * Attempts a one-shot page reload to recover from a chunk-not-found error.
 * Returns true when the reload was triggered (caller should suspend rendering),
 * false when the guard is still hot (reloaded too recently — show banner instead).
 */
export function reloadOnceOnChunkError(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < MIN_INTERVAL_MS) {
      // Guard consumed — we already reloaded recently and are still failing.
      // Surface the banner so the user isn't stuck with a silent broken page.
      markNewVersionAvailable(true);
      return false;
    }
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    markNewVersionAvailable(true);
    return false;
  }
  window.location.reload();
  return true;
}

export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    factory().catch((err: unknown) => {
      if (reloadOnceOnChunkError()) {
        // The page is reloading — never resolve so nothing else renders.
        return new Promise<{ default: T }>(() => {});
      }
      // Guard was hot — banner is already shown; rethrow so React's error
      // boundary (if present) can render a fallback rather than blank.
      throw err;
    }),
  );
}
