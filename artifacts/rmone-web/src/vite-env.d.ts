/// <reference types="vite/client" />

/** Injected at build time by vite.config.ts define. Value is a Unix-ms
 *  timestamp string in production builds, "dev" in development. */
declare const __BUILD_STAMP__: string;
