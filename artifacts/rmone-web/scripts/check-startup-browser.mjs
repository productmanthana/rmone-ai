import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeCacheDir = mkdtempSync(path.join(tmpdir(), "rmone-web-vite-smoke-"));
const port = Number(process.env.WEB_STARTUP_SMOKE_PORT || "41797");
const url = `http://127.0.0.1:${port}/login`;
const reactRuntimeError =
  /invalid hook call|more than one copy of react|multiple copies of react|duplicate react/i;

process.env.PORT = String(port);
process.env.BASE_PATH = "/";
process.env.NODE_ENV = "test";
delete process.env.REPL_ID;

let server;
let browser;
const browserMessages = [];
const reactRuntimeErrors = [];

function recordBrowserMessage(kind, text) {
  const line = `[${kind}] ${text}`;
  browserMessages.push(line);
  if (reactRuntimeError.test(text)) reactRuntimeErrors.push(line);
}

async function startServer(forceOptimizer) {
  const nextServer = await createServer({
    configFile: path.join(artifactDir, "vite.config.ts"),
    root: artifactDir,
    cacheDir: smokeCacheDir,
    clearScreen: false,
    logLevel: "error",
    optimizeDeps: { force: forceOptimizer },
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
    },
  });
  await nextServer.listen();
  return nextServer;
}

async function assertLoginLoaded(page, label) {
  await page.waitForSelector('[data-testid="img-login-logo"]', {
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => document.body?.innerText.includes("Welcome back"),
    { timeout: 30_000 },
  );
  if (reactRuntimeErrors.length > 0) {
    throw new Error(
      `${label} emitted a duplicate-React runtime error:\n${reactRuntimeErrors.join("\n")}`,
    );
  }
}

try {
  server = await startServer(true);

  browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: "shell",
    defaultViewport: { width: 1280, height: 900 },
  });
  const page = await browser.newPage();
  page.on("console", message => {
    recordBrowserMessage(`console:${message.type()}`, message.text());
  });
  page.on("pageerror", error => {
    recordBrowserMessage("pageerror", error.stack || error.message);
  });

  await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
  await assertLoginLoaded(page, "First startup");

  await server.close();
  server = undefined;
  server = await startServer(false);

  // Keep the same page, cookies, HTTP cache, and JS runtime context around the
  // server restart. This reproduces the workflow-restart path that previously
  // mixed optimizer generations and crashed inside TooltipProvider.
  await page.reload({ waitUntil: "networkidle0", timeout: 30_000 });
  await assertLoginLoaded(page, "Second startup");

  console.log("startup-browser: login remained healthy across two Vite startups");
} catch (error) {
  if (browserMessages.length > 0) {
    console.error(browserMessages.join("\n"));
  }
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  rmSync(smokeCacheDir, { recursive: true, force: true });
}