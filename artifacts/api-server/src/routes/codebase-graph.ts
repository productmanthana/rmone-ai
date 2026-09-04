import { Router } from "express";
import { execSync } from "child_process";
import fs from "node:fs";
import path from "node:path";

const router = Router();

// pnpm runs the dev script from the package directory (artifacts/api-server),
// so process.cwd() === '<workspace>/artifacts/api-server'. Go up two levels.
const WORKSPACE_ROOT = path.resolve(process.cwd(), "..", "..");
const GRAPH_PATH = path.join(WORKSPACE_ROOT, ".understand", "graph.json");

function readGraph() {
  if (!fs.existsSync(GRAPH_PATH)) {
    try {
      execSync("pnpm understand", { cwd: WORKSPACE_ROOT, stdio: "pipe", timeout: 30_000 });
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(fs.readFileSync(GRAPH_PATH, "utf-8"));
  } catch {
    return null;
  }
}

router.get("/data", (_req, res) => {
  const graph = readGraph();
  if (!graph) {
    res.status(500).json({ error: "Failed to read or generate knowledge graph. Run `pnpm understand` from the workspace root." });
    return;
  }
  res.json(graph);
});

router.post("/regenerate", (_req, res) => {
  try {
    execSync("pnpm understand", { cwd: WORKSPACE_ROOT, stdio: "pipe", timeout: 60_000 });
    const graph = readGraph();
    if (!graph) {
      res.status(500).json({ error: "Regeneration ran but graph file could not be read." });
      return;
    }
    res.json({ success: true, graph });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? "Unknown error during regeneration." });
  }
});

export default router;
