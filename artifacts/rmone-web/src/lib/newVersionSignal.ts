// Global signal: a new app version is available (post-deploy chunks rotated).
//
// Two sources fire this:
//   1. vite:preloadError / lazyWithReload catch — chunk load failed (force=true)
//   2. Periodic version.json poll — stamp differs from this bundle's stamp
//
// force=true bypasses any "already dismissed" state so the banner re-appears
// even if the user previously dismissed it this session.

export interface NewVersionEvent {
  force: boolean;
}

type Listener = (ev: NewVersionEvent) => void;
const _listeners = new Set<Listener>();

export function markNewVersionAvailable(force = false): void {
  const ev: NewVersionEvent = { force };
  for (const fn of _listeners) {
    try { fn(ev); } catch { /* ignore listener errors */ }
  }
}

export function subscribeNewVersion(fn: Listener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}
