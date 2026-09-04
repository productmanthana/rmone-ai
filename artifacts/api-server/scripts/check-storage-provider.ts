import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../../..");
const self = resolve(import.meta.filename);
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".toml", ".yaml", ".yml", ".sh"]);
const ignoredDirectories = new Set([".git", "node_modules", ".pythonlibs", "dist", "build", ".cache"]);

const forbidden = [
  ["DEFAULT", "OBJECT", "STORAGE", "BUCKET", "ID"].join("_"),
  ["managed", "objstore"].join("-"),
  ["@managed-workspace", "object-storage"].join("/"),
  ["@google-cloud", "storage"].join("/"),
];

function violations(content: string): string[] {
  const lower = content.toLowerCase();
  return forbidden.filter(token => lower.includes(token.toLowerCase()));
}

// Canary: every bypass class must be detected before repository scanning.
for (const token of forbidden) {
  if (!violations(`prefix ${token} suffix`).includes(token)) {
    throw new Error(`Storage-provider gate canary failed for ${token}`);
  }
}

const files: string[] = [];
for (const rootName of ["artifacts", "infra", "lib", "scripts", ".github"]) {
  const root = join(workspace, rootName);
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      if (ignoredDirectories.has(entry)) continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        stack.push(path);
      } else if (textExtensions.has(extname(path))) {
        files.push(path);
      }
    }
  }
}

const failures: string[] = [];
for (const file of files) {
  if (resolve(file) === self) continue;
  for (const token of violations(readFileSync(file, "utf8"))) {
    failures.push(`${relative(workspace, file)} contains retired storage marker ${token}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("✓ application storage is AWS S3 only");