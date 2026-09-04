import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { writeFileSync } from "fs";

const isBuild = process.argv.includes("build");
const rawPort = process.env.PORT;

if (!rawPort && !isBuild) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = rawPort ? Number(rawPort) : 5173;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

if (!process.env.BASE_PATH && !isBuild) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// Injected into every bundle as __BUILD_STAMP__.
// • Production builds: Unix-ms timestamp at config evaluation time (unique per build).
// • Dev server:        "dev" — the poll path is skipped for this value so the
//                      dev server never tries to fetch a version.json that doesn't
//                      exist on disk.
const BUILD_STAMP = process.env.NODE_ENV === "production"
  ? String(Date.now())
  : "dev";

// Vite plugin that writes version.json into dist/public after each production
// build.  The file is tiny and lives OUTSIDE the assets/ folder so the
// api-server serves it without the immutable long-cache header.
const emitVersionJson = {
  name: "emit-version-json",
  apply: "build" as const,
  closeBundle() {
    const outDir = path.resolve(import.meta.dirname, "dist/public");
    try {
      writeFileSync(
        path.join(outDir, "version.json"),
        JSON.stringify({ stamp: BUILD_STAMP }),
      );
    } catch (err) {
      console.warn("[emit-version-json] Could not write version.json:", err);
    }
  },
};

export default defineConfig({
  base: basePath,
  define: {
    // Replace the literal __BUILD_STAMP__ in source at bundle time.
    __BUILD_STAMP__: JSON.stringify(BUILD_STAMP),
  },
  plugins: [
    react(),
    tailwindcss(),
    emitVersionJson,
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  // Keep React, its JSX runtimes, and Radix's context providers in one
  // optimizer graph. Workspace installs / automated workflow restarts can
  // otherwise leave an open browser tab with a mixed old/new prebundle,
  // producing a second React module identity and an invalid-hook crash.
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@radix-ui/react-tooltip",
    ],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/api/onboarding": {
        target: `http://localhost:${process.env.API_PORT ?? "5000"}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
