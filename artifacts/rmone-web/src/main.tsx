import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { reloadOnceOnChunkError } from "./lib/lazyReload";
import { markNewVersionAvailable } from "./lib/newVersionSignal";
import { installAuditActionTracking } from "./lib/auditActions";

// Vite fires this when preloading a dynamic import's dependencies fails —
// typically right after a deploy invalidated the old chunk hashes.
// First attempt: one-shot reload (fixes the common case instantly).
// If the reload guard is already consumed (we reloaded recently and are
// still failing), reloadOnceOnChunkError falls through to the banner via
// markNewVersionAvailable(true). We also always mark a new version available
// so the banner fires even if the reload is in progress (belt-and-suspenders).
window.addEventListener("vite:preloadError", (event) => {
  markNewVersionAvailable(true);
  if (reloadOnceOnChunkError()) event.preventDefault();
});

installAuditActionTracking();
createRoot(document.getElementById("root")!).render(<App />);
