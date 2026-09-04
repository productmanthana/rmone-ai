import path from "path";
import { fileURLToPath } from "url";
import { build as esbuild } from "esbuild";
import { rm, readFile } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times without risking some
// packages that are not bundle compatible
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  const distDir = path.resolve(__dirname, "dist");
  await rm(distDir, { recursive: true, force: true });

  console.log("building server...");
  const pkgPath = path.resolve(__dirname, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter(
    (dep) =>
      !allowlist.includes(dep) &&
      !(pkg.dependencies?.[dep]?.startsWith("workspace:")),
  );

  // ESM output is required because src/index.ts uses top-level `await` (for
  // bootstrapDatabase) and drizzle-kit/api (used by @workspace/db's bootstrap)
  // is ESM-only. drizzle-kit must stay external — it dynamically imports a
  // bunch of optional driver packages we never install (pglite, postgres,
  // @vercel/postgres, @neondatabase/serverless, etc.).
  await esbuild({
    entryPoints: [path.resolve(__dirname, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: path.resolve(distDir, "index.mjs"),
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: [...externals, "drizzle-kit", "drizzle-kit/api"],
    banner: {
      // esbuild ESM bundles lose CommonJS interop helpers; some bundled deps
      // (e.g. pdf-parse) still expect `require`/`__dirname`. Recreate them
      // from the runtime so those packages keep working.
      js: [
        "import { createRequire as __vmCreateRequire } from 'module';",
        "import { fileURLToPath as __vmFileURLToPath } from 'url';",
        "import { dirname as __vmDirname } from 'path';",
        "const require = __vmCreateRequire(import.meta.url);",
        "const __filename = __vmFileURLToPath(import.meta.url);",
        "const __dirname = __vmDirname(__filename);",
      ].join("\n"),
    },
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
