"use strict";

const fs = require("node:fs");

for (const lockfile of ["package-lock.json", "yarn.lock"]) {
  try {
    fs.rmSync(lockfile, { force: true });
  } catch {
    // A stale lockfile should never prevent a pnpm install.
  }
}

const userAgent = process.env.npm_config_user_agent || "";
if (!userAgent.startsWith("pnpm/")) {
  console.error("Use pnpm to install this workspace.");
  process.exit(1);
}