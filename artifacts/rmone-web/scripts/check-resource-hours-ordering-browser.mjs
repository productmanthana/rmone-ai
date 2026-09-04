import { fileURLToPath } from "node:url";
import path from "node:path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.PORT ||= "41793";
process.env.BASE_PATH ||= "/";
process.env.NODE_ENV = "test";
// The editor-only metadata transform annotates React fragments and is not part
// of the shipped app. Disable it so this regression runs the production JSX.
delete process.env.REPL_ID;

let server;
let browser;
const browserMessages = [];

try {
  server = await createServer({
    configFile: path.join(artifactDir, "vite.config.ts"),
    root: artifactDir,
    clearScreen: false,
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: Number(process.env.PORT),
      strictPort: true,
    },
  });
  await server.listen();

  browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: "shell",
    defaultViewport: { width: 1440, height: 1100 },
  });
  const page = await browser.newPage();
  // Keep this regression independent of the calendar date on the machine
  // running it. Resources and the fixture both derive their selected quarter
  // after this hook runs, before any application module is evaluated.
  await page.evaluateOnNewDocument((fixedEpoch) => {
    const NativeDate = Date;
    class FixedDate extends NativeDate {
      constructor(...args) {
        super(...(args.length > 0 ? args : [fixedEpoch]));
      }
      static now() {
        return fixedEpoch;
      }
    }
    globalThis.Date = FixedDate;
  }, Date.parse("2031-05-14T12:00:00.000Z"));
  page.on("console", message => {
    browserMessages.push(`[console:${message.type()}] ${message.text()}`);
  });
  page.on("pageerror", error => {
    browserMessages.push(`[pageerror] ${error.stack || error.message}`);
  });

  await page.goto(
    `http://127.0.0.1:${process.env.PORT}/resource-hours-ordering.html`,
    { waitUntil: "networkidle0", timeout: 30_000 },
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.testStatus === "passed" ||
      document.documentElement.dataset.testStatus === "failed",
    { timeout: 30_000 },
  );

  const result = await page.evaluate(() => ({
    status: document.documentElement.dataset.testStatus,
    detail: document.documentElement.dataset.testDetail,
  }));
  if (result.status !== "passed") {
    throw new Error(result.detail || "Resources response-ordering browser test failed");
  }
  console.log("resource-hours-ordering-browser: all assertions passed");
} catch (error) {
  if (browserMessages.length > 0) {
    console.error(browserMessages.join("\n"));
  }
  throw error;
} finally {
  await browser?.close();
  await server?.close();
}