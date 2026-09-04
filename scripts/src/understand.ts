/**
 * understand.ts — Codebase knowledge graph generator for RMOne monorepo.
 *
 * Reads understand.config.json, walks each configured source package,
 * extracts top-level exports and file metadata, and writes a structured
 * JSON knowledge graph to .understand/graph.json.
 *
 * Usage:
 *   pnpm understand            # from workspace root
 *   pnpm understand --summary  # print a human-readable summary only
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

interface PackageConfig {
  name: string;
  root: string;
  entryPoints: string[];
}

interface UnderstandConfig {
  name: string;
  description: string;
  output: string;
  packages: PackageConfig[];
  exclude: string[];
  language: string;
}

interface FileNode {
  path: string;
  sizeBytes: number;
  exports: string[];
  imports: string[];
}

interface PackageNode {
  name: string;
  root: string;
  files: FileNode[];
  totalFiles: number;
  totalSizeBytes: number;
}

interface KnowledgeGraph {
  generatedAt: string;
  config: { name: string; description: string };
  packages: PackageNode[];
  crossPackageImports: Array<{ from: string; to: string; count: number }>;
}

function loadConfig(): UnderstandConfig {
  const cfgPath = path.join(ROOT, "understand.config.json");
  if (!fs.existsSync(cfgPath)) {
    throw new Error(
      `understand.config.json not found at ${cfgPath}. Run from the workspace root.`
    );
  }
  return JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as UnderstandConfig;
}

function shouldExclude(filePath: string, excludePatterns: string[]): boolean {
  const rel = filePath.replace(/\\/g, "/");
  for (const pattern of excludePatterns) {
    const normalised = pattern.replace(/\*/g, "");
    if (
      rel.includes(normalised) ||
      rel.endsWith(pattern.replace(/\*\*/g, "").replace(/\*/g, ""))
    ) {
      return true;
    }
  }
  return false;
}

function walkDir(
  dir: string,
  exclude: string[],
  results: string[] = []
): string[] {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (shouldExclude(full, exclude)) continue;
    if (entry.isDirectory()) {
      walkDir(full, exclude, results);
    } else if (/\.(ts|tsx|js|jsx|mts|mjs)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

const EXPORT_RE =
  /^export\s+(?:(?:default\s+)?(?:function|class|const|let|var|type|interface|enum|abstract\s+class)\s+(\w+)|(?:\{([^}]+)\})|(\*))/gm;
const IMPORT_RE = /^import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm;

function extractExports(source: string): string[] {
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(source)) !== null) {
    if (m[1]) names.add(m[1]);
    if (m[2]) {
      for (const part of m[2].split(",")) {
        const trimmed = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (trimmed) names.add(trimmed);
      }
    }
    if (m[3]) names.add("* (re-export)");
  }
  return [...names].filter(Boolean);
}

function extractImports(source: string): string[] {
  const mods = new Set<string>();
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(source)) !== null) {
    mods.add(m[1]);
  }
  return [...mods];
}

function analysePackage(
  pkg: PackageConfig,
  exclude: string[]
): PackageNode {
  const rootAbs = path.join(ROOT, pkg.root);
  const files = walkDir(rootAbs, exclude);

  const fileNodes: FileNode[] = [];
  let totalSize = 0;

  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    totalSize += stat.size;
    let source = "";
    try {
      source = fs.readFileSync(filePath, "utf-8");
    } catch {
      // skip unreadable files
    }
    const relPath = path.relative(ROOT, filePath).replace(/\\/g, "/");
    fileNodes.push({
      path: relPath,
      sizeBytes: stat.size,
      exports: extractExports(source),
      imports: extractImports(source),
    });
  }

  return {
    name: pkg.name,
    root: pkg.root,
    files: fileNodes,
    totalFiles: fileNodes.length,
    totalSizeBytes: totalSize,
  };
}

function buildCrossPackageImports(
  packages: PackageNode[]
): KnowledgeGraph["crossPackageImports"] {
  const counter = new Map<string, number>();
  const pkgNames = new Set(packages.map((p) => p.name));

  for (const pkg of packages) {
    for (const file of pkg.files) {
      for (const imp of file.imports) {
        if (pkgNames.has(imp) && imp !== pkg.name) {
          const key = `${pkg.name} -> ${imp}`;
          counter.set(key, (counter.get(key) ?? 0) + 1);
        }
      }
    }
  }

  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => {
      const [from, to] = key.split(" -> ");
      return { from, to, count };
    });
}

function printSummary(graph: KnowledgeGraph): void {
  console.log(`\n=== ${graph.config.name} — Knowledge Graph Summary ===`);
  console.log(`Generated: ${graph.generatedAt}\n`);
  for (const pkg of graph.packages) {
    const kb = (pkg.totalSizeBytes / 1024).toFixed(1);
    console.log(`  ${pkg.name}`);
    console.log(`    Root    : ${pkg.root}`);
    console.log(`    Files   : ${pkg.totalFiles}  (${kb} KB)`);
    const exportCount = pkg.files.reduce(
      (s, f) => s + f.exports.length,
      0
    );
    console.log(`    Exports : ${exportCount}`);
  }
  if (graph.crossPackageImports.length > 0) {
    console.log("\n  Cross-package imports:");
    for (const { from, to, count } of graph.crossPackageImports) {
      console.log(`    ${from}  →  ${to}  (${count} file${count > 1 ? "s" : ""})`);
    }
  }
  console.log(`\nGraph written to: ${path.join(ROOT, ".understand/graph.json")}\n`);
}

async function main(): Promise<void> {
  const summaryOnly = process.argv.includes("--summary");
  const config = loadConfig();

  console.log(`Scanning ${config.packages.length} packages...`);

  const packageNodes = config.packages.map((pkg) => {
    process.stdout.write(`  ${pkg.name} ... `);
    const node = analysePackage(pkg, config.exclude);
    console.log(`${node.totalFiles} files`);
    return node;
  });

  const graph: KnowledgeGraph = {
    generatedAt: new Date().toISOString(),
    config: { name: config.name, description: config.description },
    packages: packageNodes,
    crossPackageImports: buildCrossPackageImports(packageNodes),
  };

  if (!summaryOnly) {
    const outPath = path.join(ROOT, config.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(graph, null, 2), "utf-8");
  }

  printSummary(graph);
}

main().catch((err) => {
  console.error("understand: error:", err.message);
  process.exit(1);
});
