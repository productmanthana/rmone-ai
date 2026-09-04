import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
process.chdir(ROOT);

const OUT = "exports/RMONE_Mobile_Technical_Documentation.pdf";
fs.mkdirSync("exports", { recursive: true });

// ---------- BRAND PALETTE ----------
const NAVY = "#1B2B38";
const NAVY_DEEP = "#0F1B25";
const CARD = "#2E4557";
const SLATE = "#3A4F60";
const GREEN = "#6BA539";
const GREEN_LIGHT = "#A9C23F";
const ORANGE = "#E87722";
const ORANGE_LIGHT = "#FF9425";
const WHITE = "#FFFFFF";
const MUTED = "#8FA3B3";
const INK = "#1F2A33";
const PAPER = "#FFFFFF";

const PAGE = { w: 612, h: 792, margin: 48 };
const CONTENT_W = PAGE.w - PAGE.margin * 2;

const doc = new PDFDocument({
  size: "LETTER",
  margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
  bufferPages: true,
  info: {
    Title: "RM ONE Mobile — Technical Documentation",
    Author: "RM ONE Mobile Team",
    Subject: "Architecture, Tech Stack, AI Chat Flow, and Feature Schematics",
    CreationDate: new Date("2026-04-25"),
  },
});
doc.pipe(fs.createWriteStream(OUT));

// ---------- HELPERS ----------
const pageNew = () => doc.addPage();

const title = (text, color = ORANGE, size = 22) => {
  doc.fillColor(color).font("Helvetica-Bold").fontSize(size).text(text, { align: "left" });
  doc.moveDown(0.3);
};

const h2 = (text, color = GREEN) => {
  doc.moveDown(0.4);
  doc.fillColor(color).font("Helvetica-Bold").fontSize(13).text(text);
  doc.moveDown(0.15);
};

const h3 = (text) => {
  doc.moveDown(0.2);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text(text);
  doc.moveDown(0.1);
};

const body = (text, opts = {}) => {
  doc.fillColor(opts.color ?? INK).font("Helvetica").fontSize(opts.size ?? 10).text(text, { align: opts.align ?? "left", lineGap: 2 });
};

const bullets = (items) => {
  doc.font("Helvetica").fontSize(10).fillColor(INK);
  for (const it of items) {
    doc.text("\u2022  " + it, { indent: 8, lineGap: 2, align: "left" });
  }
};

const rule = (color = "#E1E6EA") => {
  const y = doc.y + 4;
  doc.save().lineWidth(0.5).strokeColor(color).moveTo(PAGE.margin, y).lineTo(PAGE.w - PAGE.margin, y).stroke().restore();
  doc.moveDown(0.6);
};

const tag = (text, fill, color = WHITE) => {
  // Inline-ish tag drawn at current x/y as a small badge
  const w = doc.widthOfString(text, { font: "Helvetica-Bold", size: 8 }) + 10;
  const h = 12;
  const x = doc.x;
  const y = doc.y;
  doc.save().roundedRect(x, y, w, h, 3).fill(fill).restore();
  doc.fillColor(color).font("Helvetica-Bold").fontSize(8).text(text, x + 5, y + 2.5, { width: w - 10, align: "center" });
  doc.x = x + w + 6;
  doc.y = y;
};

// Reset cursor to left margin after inline drawing
const resetCursor = () => {
  doc.x = PAGE.margin;
  doc.moveDown(1);
};

// ----- Schematic primitives (boxes, arrows) -----
const fillBox = (x, y, w, h, { fill = CARD, stroke = SLATE, radius = 6 } = {}) => {
  doc.save().roundedRect(x, y, w, h, radius).fillAndStroke(fill, stroke).restore();
};

const labelBox = (x, y, w, h, lines, opts = {}) => {
  fillBox(x, y, w, h, opts);
  const titleColor = opts.titleColor ?? WHITE;
  const subColor = opts.subColor ?? MUTED;
  const titleSize = opts.titleSize ?? 9;
  const subSize = opts.subSize ?? 7.5;
  let cy = y + 8;
  doc.fillColor(titleColor).font("Helvetica-Bold").fontSize(titleSize).text(lines[0], x + 8, cy, { width: w - 16, align: "center" });
  cy += titleSize + 3;
  for (let i = 1; i < lines.length; i++) {
    doc.fillColor(subColor).font("Helvetica").fontSize(subSize).text(lines[i], x + 8, cy, { width: w - 16, align: "center" });
    cy += subSize + 2;
  }
};

const arrow = (x1, y1, x2, y2, { color = ORANGE, label, dashed = false, labelColor } = {}) => {
  doc.save().lineWidth(1.2).strokeColor(color);
  if (dashed) doc.dash(3, { space: 3 });
  doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
  doc.undash();
  // arrowhead
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const ah = 6;
  doc.moveTo(x2, y2)
    .lineTo(x2 - ah * Math.cos(angle - Math.PI / 7), y2 - ah * Math.sin(angle - Math.PI / 7))
    .lineTo(x2 - ah * Math.cos(angle + Math.PI / 7), y2 - ah * Math.sin(angle + Math.PI / 7))
    .closePath()
    .fillAndStroke(color, color);
  doc.restore();
  if (label) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    doc.fillColor(labelColor ?? color).font("Helvetica-Bold").fontSize(7).text(label, mx - 60, my - 10, { width: 120, align: "center" });
  }
};

// ---------- PAGE 1 — TITLE ----------
const drawTitlePage = () => {
  // Full-bleed navy background
  doc.save().rect(0, 0, PAGE.w, PAGE.h).fill(NAVY).restore();
  // Accent bar
  doc.save().rect(0, 220, PAGE.w, 4).fill(GREEN).restore();
  doc.save().rect(0, 228, 240, 2).fill(ORANGE).restore();

  doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(56).text("RM ONE", PAGE.margin, 130, { align: "left" });
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(28).text("Mobile App", PAGE.margin, 200);
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(28).text("Technical Documentation", PAGE.margin, 240);

  doc.fillColor(MUTED).font("Helvetica").fontSize(12).text(
    "Architecture, Tech Stack, AI Chat Flow,\nand Feature Schematics",
    PAGE.margin, 290, { lineGap: 4 }
  );

  // Bottom block
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(11).text("Version 1.0", PAGE.margin, PAGE.h - 130);
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text("Issued April 25, 2026", PAGE.margin, PAGE.h - 112);
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
    "Audience: engineering, product, and executive sponsors\nScope: production mobile client, API orchestration server, and AI chat subsystem",
    PAGE.margin, PAGE.h - 90, { lineGap: 3 }
  );
};

drawTitlePage();

// ---------- PAGE 2 — TABLE OF CONTENTS ----------
pageNew();
title("Contents");
rule();
const toc = [
  ["1.", "Executive Overview", "3"],
  ["2.", "System Architecture", "4"],
  ["3.", "Technology Stack", "5"],
  ["4.", "Mobile App Feature Catalog", "6"],
  ["5.", "AI Chat Subsystem (deep dive)", "9"],
  ["6.", "API Server Endpoints", "12"],
  ["7.", "Tool / Function-Calling Catalog", "13"],
  ["8.", "Data Flow per Screen", "14"],
  ["9.", "Security, Caching, and Reliability", "15"],
];
// Render TOC with absolute positioning so wrapping/continuation never collapses
let tocY = doc.y;
const tocLineH = 22;
for (const [num, label, page] of toc) {
  doc.fillColor(ORANGE).font("Helvetica-Bold").fontSize(11).text(num, PAGE.margin, tocY, { width: 26, lineBreak: false });
  doc.fillColor(INK).font("Helvetica").fontSize(11).text(label, PAGE.margin + 30, tocY, { width: CONTENT_W - 90, lineBreak: false });
  doc.fillColor(MUTED).font("Helvetica").fontSize(11).text("p. " + page, PAGE.margin, tocY, { width: CONTENT_W, align: "right", lineBreak: false });
  // dotted leader
  doc.save().lineWidth(0.5).strokeColor("#D6DBDF").dash(1.5, { space: 2 });
  const labelW = doc.widthOfString(label);
  const dotsX1 = PAGE.margin + 36 + labelW;
  const pageStr = "p. " + page;
  const pageW = doc.widthOfString(pageStr);
  const dotsX2 = PAGE.margin + CONTENT_W - pageW - 6;
  if (dotsX2 > dotsX1) {
    doc.moveTo(dotsX1, tocY + 9).lineTo(dotsX2, tocY + 9).stroke();
  }
  doc.undash().restore();
  tocY += tocLineH;
}
doc.x = PAGE.margin;
doc.y = tocY + 8;

// ---------- PAGE 3 — EXECUTIVE OVERVIEW ----------
pageNew();
title("1. Executive Overview");
rule();
body(
  "RM ONE Mobile is a production iOS / Android client that gives executives, resource managers, and project managers real-time visibility into the firm's projects, opportunities, leads, companies, and workforce capacity. It connects to the existing RM ONE platform through a thin orchestration server and adds an AI command layer powered by commercial-grade large language models."
);
doc.moveDown(0.3);
body(
  "The system has three runtime tiers. The mobile client is a React Native (Expo) application. The API server is a Node.js / Express orchestration layer that authenticates against RM ONE, proxies and flattens module data, and hosts the AI chat endpoint. The AI subsystem uses proprietary OpenAI models (GPT-4o, GPT-4o-mini, gpt-4o-mini-transcribe) with a two-step Routing-then-Execution pattern and a 27-tool function-calling catalog that lets the model read and write live RM ONE data."
);
h2("Key capabilities");
bullets([
  "Authenticated mobile access to Projects (PMM), Opportunities (OPM), Leads (LEM), and Companies (COM).",
  "Resource roster with real-time utilization and bench / overload health.",
  "Project-detail drill-down with team, schedule, and financial value.",
  "AI chat command center with text + voice (Whisper) input and one-tap actions.",
  "Schedule editing, team assignment, weekly-allocation editing, and email send-through-AI.",
  "Stale-While-Revalidate (SWR) client cache backed by AsyncStorage for low-latency UX on flaky networks.",
]);
h2("What is on the roadmap");
bullets([
  "Operational Command Center home screen and Forecasted Operational Health score.",
  "Bloomberg-style standardized AI brief (Summary / Risk / Time horizon / Actions / Confidence).",
  "App-launch Daily Briefing with What-Changed-Since-Yesterday deltas.",
  "Visual Forecasting screen (utilization heatmap, demand-vs-capacity curve, resource-collision view, scenario toggles).",
  "Five role-based home screens: COO, CFO, Resource Manager, Project Manager, Executive.",
]);

// ---------- PAGE 4 — SYSTEM ARCHITECTURE DIAGRAM ----------
pageNew();
title("2. System Architecture");
rule();
body(
  "Three runtime tiers connect over HTTPS. The mobile client never talks directly to RM ONE or to the LLM provider \u2014 every call is mediated by the API server, which holds tenant credentials, attaches session cookies, normalizes record shapes, and enforces the AI tool contract."
);
doc.moveDown(0.6);

// Diagram canvas
const D = { x: PAGE.margin, y: doc.y, w: CONTENT_W, h: 360 };
fillBox(D.x, D.y, D.w, D.h, { fill: NAVY_DEEP, stroke: SLATE });

// Layout 3 columns x rows
const colW = 150;
const colGap = (D.w - colW * 3) / 4;
const cx1 = D.x + colGap;
const cx2 = cx1 + colW + colGap;
const cx3 = cx2 + colW + colGap;

// Mobile client
labelBox(cx1, D.y + 30, colW, 90, [
  "Mobile Client",
  "React Native + Expo SDK 54",
  "Expo Router file-based nav",
  "SWR cache + AsyncStorage",
  "Custom SVG dashboards",
], { fill: CARD, stroke: GREEN });

// API server (center)
labelBox(cx2, D.y + 30, colW, 90, [
  "API Server",
  "Node.js + Express",
  "Auth proxy + session store",
  "Record flattening",
  "AI orchestration",
], { fill: CARD, stroke: ORANGE });

// External backends (right column - stacked)
labelBox(cx3, D.y + 25, colW, 60, [
  "RM ONE Platform",
  "gc.rmone.com",
  "Module records + tasks",
], { fill: CARD, stroke: GREEN_LIGHT });

labelBox(cx3, D.y + 95, colW, 60, [
  "OpenAI",
  "GPT-4o / GPT-4o-mini",
  "Whisper (voice)",
], { fill: CARD, stroke: ORANGE_LIGHT });

labelBox(cx3, D.y + 165, colW, 60, [
  "AgentMail",
  "Outbound email",
  "Inbox polling",
], { fill: CARD, stroke: GREEN });

labelBox(cx3, D.y + 235, colW, 60, [
  "Session Store",
  "In-memory token map",
  "Per-process",
], { fill: CARD, stroke: ORANGE });

// Arrows: mobile -> api
arrow(cx1 + colW, D.y + 60, cx2, D.y + 60, { label: "HTTPS / JSON" });
arrow(cx2, D.y + 90, cx1 + colW, D.y + 90, { label: "SSE stream", color: GREEN, dashed: true });

// API -> external
arrow(cx2 + colW, D.y + 55, cx3, D.y + 55, { label: "REST proxy", color: GREEN });
arrow(cx2 + colW, D.y + 125, cx3, D.y + 125, { label: "chat + tool calls", color: ORANGE });
arrow(cx2 + colW, D.y + 195, cx3, D.y + 195, { label: "send / poll", color: GREEN });
arrow(cx2 + colW, D.y + 265, cx3, D.y + 265, { label: "set / get", color: ORANGE });

// Bottom legend
doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(
  "Solid arrow = request   |   Dashed arrow = streaming response",
  D.x, D.y + D.h - 16, { width: D.w, align: "center" }
);

// Move cursor below diagram
doc.y = D.y + D.h + 10;
doc.x = PAGE.margin;
body(
  "The API server is the single point of policy. It is the only tier that knows the RM ONE tenant credentials, the only tier that talks to the LLM, and the only tier that can mutate RM ONE records. The mobile client receives sanitized JSON and a streaming SSE response on the chat channel."
);

// ---------- PAGE 5 — TECH STACK ----------
pageNew();
title("3. Technology Stack");
rule();
body("All components are commercial / proprietary-grade. Open-source frameworks are used where they are industry standard; managed proprietary services are used for AI, voice transcription, and email.");

const stackTable = [
  ["Layer", "Technology", "Role"],
  ["Mobile UI", "React Native + Expo SDK 54", "Cross-platform iOS / Android client"],
  ["Mobile nav", "Expo Router (file-based)", "Tab + stack navigation"],
  ["Mobile data", "Custom SWR client + AsyncStorage", "Stale-while-revalidate cache"],
  ["Charts", "react-native-svg + custom components", "Gauges, heatmaps, dashboards"],
  ["Maps", "react-native-maps", "Project geolocation"],
  ["Haptics", "expo-haptics", "Tap feedback"],
  ["API server", "Node.js + Express", "Orchestration + auth proxy"],
  ["Session store", "In-memory token map (per-process)", "Tracks RM ONE auth sessions"],
  ["AI \u2014 reasoning", "OpenAI GPT-4o (proprietary)", "Tool-using execution model"],
  ["AI \u2014 routing", "OpenAI GPT-4o-mini (proprietary)", "Intent + context router"],
  ["AI \u2014 voice", "OpenAI gpt-4o-mini-transcribe (proprietary)", "Speech-to-text"],
  ["Email", "AgentMail (via /api/chat/inbox)", "Outbound + inbox poll"],
  ["Upstream", "RM ONE platform (gc.rmone.com)", "Source of record"],
];

const tableX = PAGE.margin;
let tableY = doc.y + 6;
const colWs = [85, 200, 230];
const rowH = 22;
for (let i = 0; i < stackTable.length; i++) {
  const row = stackTable[i];
  const isHeader = i === 0;
  const fill = isHeader ? NAVY : i % 2 === 0 ? "#F5F7F9" : "#FFFFFF";
  doc.save().rect(tableX, tableY, colWs[0] + colWs[1] + colWs[2], rowH).fill(fill).restore();
  let cx = tableX;
  for (let c = 0; c < row.length; c++) {
    doc.fillColor(isHeader ? WHITE : INK).font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(9)
      .text(row[c], cx + 6, tableY + 6, { width: colWs[c] - 12, align: "left" });
    cx += colWs[c];
  }
  tableY += rowH;
}
doc.y = tableY + 8;
doc.x = PAGE.margin;
body(
  "Every external dependency that the system relies on for intelligence \u2014 reasoning, routing, voice transcription \u2014 is a proprietary commercial model. There are no open-source LLMs in the runtime path."
);

// ---------- PAGE 6 — MOBILE APP FEATURE CATALOG (overview) ----------
pageNew();
title("4. Mobile App Feature Catalog");
rule();
body("Four bottom tabs (Home, Pipeline, Resources, AI Chat) plus Login and a Project Detail stack screen. Each screen has a single primary data source and a small number of secondary calls. Diagrams below show the call shape; deep details are in section 8.");
const screens = [
  ["Login", "Tenant / username / password against RM ONE", "POST /api/rmone/token"],
  ["Home (tab)", "Active projects, pipeline value, project map, inbox card", "GET /api/rmone/projects + /api/chat/inbox"],
  ["Pipeline (tab)", "PMM / OPM / LEM / COM list with filters and drill-down", "GET /api/rmone/records/:module"],
  ["Project Detail", "Status, team, financial value, schedule, location, edits", "GET /api/rmone/project/:id, POST smart-update"],
  ["Resources (tab)", "Roster + utilization, bench / healthy / overload buckets", "GET /api/rmone/resource-allocations"],
  ["AI Chat (tab)", "Text + voice command center; renders interactive widgets", "POST /api/chat/message + /api/transcribe"],
  ["Profile (hidden)", "User profile, sign-out, push token registration", "GET /api/rmone/profile"],
  ["RFP (hidden)", "RFP upload + parsing helper surface", "POST /api/transcribe (audio notes)"],
];
const headerFill = NAVY;
let ty = doc.y + 6;
const cWs = [95, 245, 175];
const rH = 26;
const headerRow = ["Screen", "What it does", "Primary endpoint"];
doc.save().rect(PAGE.margin, ty, cWs[0] + cWs[1] + cWs[2], rH).fill(headerFill).restore();
let cx = PAGE.margin;
for (let c = 0; c < headerRow.length; c++) {
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(9).text(headerRow[c], cx + 6, ty + 8, { width: cWs[c] - 12 });
  cx += cWs[c];
}
ty += rH;
for (let i = 0; i < screens.length; i++) {
  const fill = i % 2 === 0 ? "#F5F7F9" : "#FFFFFF";
  doc.save().rect(PAGE.margin, ty, cWs[0] + cWs[1] + cWs[2], rH).fill(fill).restore();
  let cxr = PAGE.margin;
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text(screens[i][0], cxr + 6, ty + 8, { width: cWs[0] - 12 });
  cxr += cWs[0];
  doc.fillColor(INK).font("Helvetica").fontSize(9).text(screens[i][1], cxr + 6, ty + 6, { width: cWs[1] - 12, lineGap: 1 });
  cxr += cWs[1];
  doc.fillColor(ORANGE).font("Helvetica-Oblique").fontSize(8.5).text(screens[i][2], cxr + 6, ty + 8, { width: cWs[2] - 12 });
  ty += rH;
}
doc.y = ty + 6;
doc.x = PAGE.margin;

// ---------- PAGE 7 — Mobile screen schematic: Home + Resources ----------
pageNew();
title("Screen schematic — Home Dashboard", ORANGE, 16);
rule();
body("Home is the executive landing surface. It assembles three cards from two endpoints, plus a polling inbox channel.");
doc.moveDown(0.4);
{
  const dx = PAGE.margin, dy = doc.y, dw = CONTENT_W, dh = 230;
  fillBox(dx, dy, dw, dh, { fill: NAVY_DEEP });
  // Mobile screen box
  labelBox(dx + 18, dy + 20, 130, 190, [
    "Home Dashboard",
    "(tabs)/index.tsx",
    "",
    "Active projects card",
    "Pipeline value card",
    "Inbox / notifications",
  ], { fill: CARD, stroke: GREEN, titleSize: 10 });
  // API
  labelBox(dx + 200, dy + 30, 140, 60, ["API Server", "/api/rmone/projects", "GET"], { fill: CARD, stroke: ORANGE });
  labelBox(dx + 200, dy + 110, 140, 60, ["API Server", "/api/chat/inbox", "GET (poll)"], { fill: CARD, stroke: ORANGE });
  // Backend
  labelBox(dx + 380, dy + 30, 140, 60, ["RM ONE", "/api/rmmapi/GetProjectDetails"], { fill: CARD, stroke: GREEN_LIGHT });
  labelBox(dx + 380, dy + 110, 140, 60, ["AgentMail", "Inbox API"], { fill: CARD, stroke: GREEN_LIGHT });
  // Arrows
  arrow(dx + 148, dy + 70, dx + 200, dy + 60, { label: "fetch" });
  arrow(dx + 148, dy + 150, dx + 200, dy + 140, { label: "poll" });
  arrow(dx + 340, dy + 60, dx + 380, dy + 60, { color: GREEN });
  arrow(dx + 340, dy + 140, dx + 380, dy + 140, { color: GREEN });
  doc.y = dy + dh + 12;
  doc.x = PAGE.margin;
}

title("Screen schematic — Resources / Roster", ORANGE, 16);
rule();
body("Resources renders the firm's full roster with computed utilization. The API server aggregates raw allocations into a single denormalized list for the client.");
doc.moveDown(0.4);
{
  const dx = PAGE.margin, dy = doc.y, dw = CONTENT_W, dh = 200;
  fillBox(dx, dy, dw, dh, { fill: NAVY_DEEP });
  labelBox(dx + 18, dy + 30, 130, 140, [
    "Resources",
    "(tabs)/resources.tsx",
    "",
    "Roster list",
    "Bench / healthy / overload",
    "Per-person drill-down",
  ], { fill: CARD, stroke: GREEN });
  labelBox(dx + 200, dy + 60, 160, 60, ["API Server", "GET /api/rmone/", "resource-allocations"], { fill: CARD, stroke: ORANGE });
  labelBox(dx + 400, dy + 30, 130, 60, ["RM ONE", "/api/module/", "GetProjectAllocations"], { fill: CARD, stroke: GREEN_LIGHT });
  labelBox(dx + 400, dy + 110, 130, 60, ["RM ONE", "/api/rmone/", "task-data"], { fill: CARD, stroke: GREEN_LIGHT });
  arrow(dx + 148, dy + 90, dx + 200, dy + 90);
  arrow(dx + 360, dy + 70, dx + 400, dy + 60, { color: GREEN });
  arrow(dx + 360, dy + 110, dx + 400, dy + 140, { color: GREEN });
  doc.y = dy + dh + 4;
  doc.x = PAGE.margin;
}

// ---------- PAGE 8 — Pipeline + Project Detail ----------
pageNew();
title("Screen schematic — Pipeline (PMM / OPM / LEM / COM)", ORANGE, 16);
rule();
body("A single tabbed list backed by one parameterized endpoint. Filters are applied client-side over the SWR-cached payload to keep interactions instant.");
doc.moveDown(0.4);
{
  const dx = PAGE.margin, dy = doc.y, dw = CONTENT_W, dh = 200;
  fillBox(dx, dy, dw, dh, { fill: NAVY_DEEP });
  labelBox(dx + 18, dy + 20, 130, 160, [
    "Pipeline",
    "(tabs)/projects.tsx",
    "",
    "Tabs: PMM / OPM /",
    "LEM / COM",
    "Filter + sort + search",
  ], { fill: CARD, stroke: GREEN });
  labelBox(dx + 200, dy + 60, 160, 60, ["API Server", "GET /api/rmone/", "records/:module"], { fill: CARD, stroke: ORANGE });
  labelBox(dx + 400, dy + 60, 130, 60, ["RM ONE", "/api/module/", "Records/{module}"], { fill: CARD, stroke: GREEN_LIGHT });
  arrow(dx + 148, dy + 90, dx + 200, dy + 90, { label: "?module=PMM" });
  arrow(dx + 360, dy + 90, dx + 400, dy + 90, { color: GREEN });
  doc.y = dy + dh + 12;
  doc.x = PAGE.margin;
}

title("Screen schematic — Project Detail", ORANGE, 16);
rule();
body("Drill-down for any module record. Reads through a record-level cache and falls back to upstream on miss.");
doc.moveDown(0.4);
{
  const dx = PAGE.margin, dy = doc.y, dw = CONTENT_W, dh = 220;
  fillBox(dx, dy, dw, dh, { fill: NAVY_DEEP });
  labelBox(dx + 18, dy + 30, 130, 160, [
    "Project Detail",
    "project/[id].tsx",
    "",
    "Header + status",
    "Team",
    "Financials + value",
    "Schedule",
    "Map pin",
  ], { fill: CARD, stroke: GREEN });
  labelBox(dx + 200, dy + 30, 160, 60, ["API Server", "GET /api/rmone/", "project/:id"], { fill: CARD, stroke: ORANGE });
  labelBox(dx + 200, dy + 110, 160, 60, ["API Server", "POST /api/rmone/", "smart-update"], { fill: CARD, stroke: ORANGE });
  labelBox(dx + 400, dy + 70, 130, 60, ["RM ONE", "module Records +", "field updates"], { fill: CARD, stroke: GREEN_LIGHT });
  arrow(dx + 148, dy + 60, dx + 200, dy + 60, { label: "fetch" });
  arrow(dx + 148, dy + 140, dx + 200, dy + 140, { label: "edit field", color: ORANGE });
  arrow(dx + 360, dy + 60, dx + 400, dy + 90, { color: GREEN });
  arrow(dx + 360, dy + 140, dx + 400, dy + 110, { color: ORANGE });
  doc.y = dy + dh + 4;
  doc.x = PAGE.margin;
}

// ---------- PAGE 9, 10, 11 — AI CHAT (THE CENTERPIECE) ----------
pageNew();
title("5. AI Chat Subsystem");
rule();
body(
  "The AI chat is the most sophisticated subsystem in RM ONE Mobile. A single user message triggers a two-step LLM pipeline (a routing pass followed by an execution pass), runs against a 27-tool function-calling catalog, streams its response to the device over Server-Sent Events, and renders inline interactive widgets via a tagged-text protocol. All models are proprietary OpenAI services."
);
h2("Goals of the design");
bullets([
  "Always answer with live RM ONE data \u2014 no stale mock answers.",
  "Keep the model on a short leash: routing pass decides what context to inject before the execution pass runs.",
  "Let the model take action, not just describe it (assign people, edit allocations, send email).",
  "Stream tokens immediately for perceived speed; render structured widgets when the model emits tags.",
  "Persist conversation state with a sliding window + rolling summary so context stays cheap.",
]);
h2("End-to-end flow (high level)");
bullets([
  "1. User types a question (or speaks it; voice is transcribed by OpenAI gpt-4o-mini-transcribe first).",
  "2. Mobile app POSTs to /api/chat/message with the message and conversation id.",
  "3. API server runs the Routing LLM (gpt-4o-mini) to pick which datasets to inject (roster, contacts, profiles, thresholds).",
  "4. API server builds a system prompt with the chosen context and the available execution tools.",
  "5. Execution LLM (gpt-4o) generates a streaming reply, calling tools in a loop as needed.",
  "6. Each tool call hits the RM ONE API (or AgentMail) through the API server's flatten / normalize layer.",
  "7. The execution LLM emits text + bracketed tags. Tags are routed to React Native widget components.",
  "8. The mobile app appends text incrementally and renders widgets as their JSON arrives.",
]);

// ---- AI Chat Sequence Diagram ----
pageNew();
title("AI Chat \u2014 sequence diagram", ORANGE, 16);
rule();
body("Lanes: User, Mobile App, API Server, OpenAI, RM ONE / Tools. Time flows top to bottom. Numbers correspond to the steps on the previous page.");
doc.moveDown(0.4);

{
  const dx = PAGE.margin, dy = doc.y, dw = CONTENT_W, dh = 480;
  fillBox(dx, dy, dw, dh, { fill: NAVY_DEEP });

  const lanes = ["User", "Mobile App", "API Server", "OpenAI", "RM ONE / Tools"];
  const laneColors = [GREEN, GREEN_LIGHT, ORANGE, ORANGE_LIGHT, GREEN];
  const laneW = dw / lanes.length;
  // Lane headers + vertical lifelines
  for (let i = 0; i < lanes.length; i++) {
    const lx = dx + i * laneW;
    doc.save().rect(lx + 6, dy + 12, laneW - 12, 24).fill(CARD).restore();
    doc.fillColor(laneColors[i]).font("Helvetica-Bold").fontSize(9).text(lanes[i], lx + 6, dy + 18, { width: laneW - 12, align: "center" });
    // lifeline
    doc.save().lineWidth(0.6).strokeColor("#3A4F60").dash(2, { space: 2 })
      .moveTo(lx + laneW / 2, dy + 40).lineTo(lx + laneW / 2, dy + dh - 16).stroke().undash().restore();
  }
  // Helper for an arrow from lane a -> lane b at y
  const laneX = (i) => dx + i * laneW + laneW / 2;
  const seq = (a, b, y, label, color = ORANGE, dashed = false) => {
    const x1 = laneX(a) + (a < b ? 4 : -4);
    const x2 = laneX(b) - (a < b ? 4 : -4);
    arrow(x1, y, x2, y, { label, color, dashed });
  };
  let y = dy + 70;
  const step = 30;
  seq(0, 1, y, "1. type or tap mic", GREEN); y += step;
  seq(1, 2, y, "2. POST /api/chat/message", ORANGE); y += step;
  seq(2, 3, y, "3. Routing call (gpt-4o-mini)", ORANGE_LIGHT); y += step;
  seq(3, 2, y, "    return: inject_roster, inject_thresholds...", ORANGE_LIGHT, true); y += step;
  seq(2, 4, y, "4a. fetch roster / thresholds", GREEN); y += step;
  seq(4, 2, y, "       roster JSON", GREEN, true); y += step;
  seq(2, 3, y, "5. Execution call (gpt-4o) + tools", ORANGE_LIGHT); y += step;
  seq(3, 2, y, "    tool_call: get_project_details", ORANGE_LIGHT, true); y += step;
  seq(2, 4, y, "6. proxy to RM ONE", GREEN); y += step;
  seq(4, 2, y, "       project JSON", GREEN, true); y += step;
  seq(2, 3, y, "    tool_result back to model", ORANGE_LIGHT); y += step;
  seq(3, 2, y, "7. token stream + tags", ORANGE_LIGHT, true); y += step;
  seq(2, 1, y, "       SSE: data: {...}", ORANGE, true); y += step;
  seq(1, 0, y, "8. render text + widgets", GREEN, true);
  doc.y = dy + dh + 4;
  doc.x = PAGE.margin;
}

// ---- AI Chat: Tagged streaming protocol ----
pageNew();
title("AI Chat \u2014 tagged streaming protocol", ORANGE, 16);
rule();
body(
  "The execution model can emit plain text or special bracketed tags. Tags are detected by parseBlocks() in chat.tsx and routed to dedicated React Native widgets. This lets the model return a UI, not just words, while the response is still streaming."
);
const tags = [
  ["[ROSTER_TABLE]", "Renders the full personnel roster with utilization bars"],
  ["[PMM_TABLE]", "Renders a Projects (PMM) table with status / value columns"],
  ["[OPP_TABLE] / [OPP_TABLE_2]", "Renders an Opportunities (OPM) table (two layouts)"],
  ["[WEEKLY_ALLOC:person|project|name|prefill=...]", "Opens the interactive hour-by-hour weekly allocation editor"],
  ["[ALLOC_FORM:person|project|hours]", "Inline allocation form with editable hours"],
  ["[SELECT_PROJECT:ids]", "Renders a row of project pick buttons for follow-up commands"],
  ["[BUTTONS:YES,NO] / [BUTTONS:YES_SEND,EDIT,CANCEL]", "Confirm row, e.g. before send-email or staffing change"],
  ["[SCHEDULE_TABLE:projectId]", "Renders the project schedule (phases + dates)"],
  ["[LIFECYCLE_PICKER:projectId]", "Picker for moving a project across lifecycle stages"],
  ["[HEALTH_GAUGE:value]", "Animated gauge for project / portfolio health"],
  ["[PROJECT_DATES:projectId]", "Editable start / end / milestone dates card"],
  ["[CHART:bar] ... [/CHART]", "Inline bar chart driven by JSON between the tags"],
  ["[TIMELINE] ... [/TIMELINE]", "Inline event timeline"],
  ["[UPDATE_SUCCESS:msg] / [UPDATE_FAIL:msg]", "Toast-style success / failure card after a write"],
  ["[PERSON_PROFILE]", "Inline person profile card (name, title, projects, util.)"],
];
const tagsHeader = ["Tag", "Widget rendered"];
let ty2 = doc.y + 6;
const tcW = [220, 295];
const trH = 22;
doc.save().rect(PAGE.margin, ty2, tcW[0] + tcW[1], trH).fill(NAVY).restore();
doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(9).text(tagsHeader[0], PAGE.margin + 6, ty2 + 7, { width: tcW[0] - 12 });
doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(9).text(tagsHeader[1], PAGE.margin + 6 + tcW[0], ty2 + 7, { width: tcW[1] - 12 });
ty2 += trH;
for (let i = 0; i < tags.length; i++) {
  const fill = i % 2 === 0 ? "#F5F7F9" : "#FFFFFF";
  doc.save().rect(PAGE.margin, ty2, tcW[0] + tcW[1], trH).fill(fill).restore();
  doc.fillColor(ORANGE).font("Courier-Bold").fontSize(9).text(tags[i][0], PAGE.margin + 6, ty2 + 7, { width: tcW[0] - 12 });
  doc.fillColor(INK).font("Helvetica").fontSize(9).text(tags[i][1], PAGE.margin + 6 + tcW[0], ty2 + 7, { width: tcW[1] - 12 });
  ty2 += trH;
}
doc.y = ty2 + 10;
doc.x = PAGE.margin;

h2("Memory layer");
bullets([
  "Sliding window: most recent N turns kept verbatim.",
  "Rolling summary: older turns compressed by a summarizer call so context stays under budget.",
  "Per-conversation state held in the API server process, keyed by conversation id.",
  "Routing pass sees only the latest message + summary; execution pass sees window + summary + injected datasets.",
]);

h2("Voice path");
bullets([
  "Mic tap triggers a recording on the device (expo-av).",
  "Audio is uploaded to POST /api/transcribe.",
  "API server forwards to OpenAI gpt-4o-mini-transcribe, returns the transcript.",
  "Transcript is fed into the same /api/chat/message pipeline as a typed message.",
]);

// ---------- PAGE 12 — API ENDPOINTS ----------
pageNew();
title("6. API Server Endpoints");
rule();
body("Every mobile feature funnels through the API server. Endpoints below are grouped by responsibility. The server holds tenant credentials and never exposes raw RM ONE responses without normalization.");
const eps = [
  ["POST /api/rmone/token", "Auth: tenant + username + password \u2192 RM ONE session"],
  ["POST /api/rmone/logout", "Sign out and invalidate session token"],
  ["GET  /api/rmone/profile", "Current user profile"],
  ["GET  /api/rmone/projects", "Project list assigned to the current user"],
  ["GET  /api/rmone/records/:module", "Generic module list (PMM / OPM / LEM / COM)"],
  ["GET  /api/rmone/project/:id", "Single record drill-down with cache fallback"],
  ["PUT  /api/rmone/project", "Update a project record"],
  ["POST /api/rmone/smart-update", "Field-level update on any module record"],
  ["POST /api/rmone/schedule", "Cascading multi-phase schedule edit"],
  ["GET  /api/rmone/resource-allocations", "Roster + computed utilization buckets"],
  ["GET  /api/rmone/allocations", "Raw allocation rows for a project / person"],
  ["GET  /api/rmone/task-data", "Task-level allocation data"],
  ["POST /api/rmone/assign-resource", "Assign a person to a project"],
  ["GET  /api/rmone/bench-resources", "People with available capacity"],
  ["POST /api/rmone/hours-allocation", "Set weekly hours for a person on a project"],
  ["POST /api/rmone/debug-log", "Centralized client log capture"],
  ["POST /api/chat/message", "AI chat \u2014 returns SSE stream of tokens + tags"],
  ["GET  /api/chat/inbox", "AgentMail inbox poll"],
  ["GET  /api/chat/inbox/:messageId", "Read a single inbox message"],
  ["DELETE /api/chat/inbox/:messageId", "Delete an inbox message"],
  ["POST /api/chat/notify-team", "Send a team notification through AgentMail"],
  ["GET  /api/chat/roster", "Roster used by AI context injection"],
  ["POST /api/chat/push-token", "Register Expo push token for the device"],
  ["POST /api/transcribe", "Voice-to-text via gpt-4o-mini-transcribe"],
];
const eHead = ["Endpoint", "Purpose"];
let ey = doc.y + 4;
const eW = [225, 290];
const eH = 17;
doc.save().rect(PAGE.margin, ey, eW[0] + eW[1], eH).fill(NAVY).restore();
doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8.5).text(eHead[0], PAGE.margin + 6, ey + 5, { width: eW[0] - 12, lineBreak: false });
doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8.5).text(eHead[1], PAGE.margin + 6 + eW[0], ey + 5, { width: eW[1] - 12, lineBreak: false });
ey += eH;
for (let i = 0; i < eps.length; i++) {
  const fill = i % 2 === 0 ? "#F5F7F9" : "#FFFFFF";
  doc.save().rect(PAGE.margin, ey, eW[0] + eW[1], eH).fill(fill).restore();
  doc.fillColor(ORANGE).font("Courier-Bold").fontSize(7.8).text(eps[i][0], PAGE.margin + 6, ey + 5, { width: eW[0] - 12, lineBreak: false });
  doc.fillColor(INK).font("Helvetica").fontSize(8.5).text(eps[i][1], PAGE.margin + 6 + eW[0], ey + 5, { width: eW[1] - 12, lineBreak: false });
  ey += eH;
}
doc.y = ey + 8;
doc.x = PAGE.margin;

// ---------- PAGE 13 — TOOL CATALOG ----------
pageNew();
title("7. Tool / Function-Calling Catalog");
rule();
body("These are the functions the execution LLM is allowed to call. Each tool is a typed schema. The model picks one or more per turn; the API server executes them, normalizes the result, and feeds it back into the model loop.");
const tools = [
  ["Routing", "inject_available_roster", "Force roster context into next turn"],
  ["Routing", "inject_threshold_resources", "Force burnout / overload context"],
  ["Routing", "load_contacts", "Inject company / person contact set"],
  ["Routing", "lookup_person_profile", "Inject single-person profile + history"],
  ["Discovery", "search_projects", "Free-text search across modules"],
  ["Discovery", "list_active_projects", "List currently-active projects"],
  ["Discovery", "get_project_details", "Full record + allocations for one project"],
  ["Discovery", "get_awarded_opportunities", "Won OPM records"],
  ["Discovery", "get_opportunities_by_status", "OPM filtered by status"],
  ["Discovery", "get_lead_conversions", "LEM \u2192 OPM conversion data"],
  ["Discovery", "get_workforce_summary", "Headcount / utilization summary"],
  ["Discovery", "get_contacts", "Contact records with filters"],
  ["Discovery", "get_resource_demands", "Forecasted resource demand"],
  ["Discovery", "get_bench_resources", "People with available capacity"],
  ["Discovery", "get_weekly_utilization", "Capacity / load by week per person"],
  ["Discovery", "find_staff_for_project", "Suggest staff for a project / role"],
  ["Discovery", "list_all_lifecycles", "List lifecycle stages per module"],
  ["Action", "execute_update", "Edit a project field (dates, status, value)"],
  ["Action", "update_schedule_phases", "Cascading multi-phase schedule edit"],
  ["Action", "edit_phase_hours", "Edit hours on a single phase"],
  ["Action", "assign_person", "Add a team member to a project"],
  ["Action", "remove_team_member", "Remove a team member from a project"],
  ["Action", "edit_weekly_allocation", "Open hour-by-hour allocation widget"],
  ["Action", "update_allocations", "Bulk update of allocations"],
  ["Action", "update_contact_info", "Update a contact's profile"],
  ["Comms", "send_email", "Compose + send via AgentMail (Edit/Cancel/Send)"],
  ["Comms", "check_inbox", "Read latest inbox threads"],
];
const tHead = ["Group", "Tool", "What it does"];
let cy = doc.y + 4;
const tW = [62, 165, 288];
const tH = 16;
doc.save().rect(PAGE.margin, cy, tW[0] + tW[1] + tW[2], tH).fill(NAVY).restore();
let cxh = PAGE.margin;
for (let c = 0; c < tHead.length; c++) {
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8.5).text(tHead[c], cxh + 6, cy + 4.5, { width: tW[c] - 12, lineBreak: false });
  cxh += tW[c];
}
cy += tH;
for (let i = 0; i < tools.length; i++) {
  const fill = i % 2 === 0 ? "#F5F7F9" : "#FFFFFF";
  doc.save().rect(PAGE.margin, cy, tW[0] + tW[1] + tW[2], tH).fill(fill).restore();
  let cxr = PAGE.margin;
  const grp = tools[i][0];
  const grpFill = grp === "Action" ? ORANGE : grp === "Comms" ? GREEN : grp === "Routing" ? SLATE : GREEN_LIGHT;
  doc.save().roundedRect(cxr + 5, cy + 3.5, tW[0] - 14, 10, 2.5).fill(grpFill).restore();
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(6.5).text(grp.toUpperCase(), cxr + 5, cy + 5, { width: tW[0] - 14, align: "center", lineBreak: false });
  cxr += tW[0];
  doc.fillColor(ORANGE).font("Courier-Bold").fontSize(7.8).text(tools[i][1], cxr + 6, cy + 4.5, { width: tW[1] - 12, lineBreak: false });
  cxr += tW[1];
  doc.fillColor(INK).font("Helvetica").fontSize(8.5).text(tools[i][2], cxr + 6, cy + 4.5, { width: tW[2] - 12, lineBreak: false });
  cy += tH;
}
doc.y = cy + 8;
doc.x = PAGE.margin;

body("Action tools are gated. The execution LLM must surface a confirm card via [BUTTONS:YES,NO] or [BUTTONS:YES_SEND,EDIT,CANCEL] before any mutating tool fires. The user must tap the confirm button on the device for the change to be committed upstream.");

// ---------- PAGE 14 — DATA FLOW PER SCREEN (compact diagrams) ----------
pageNew();
title("8. Data Flow per Screen");
rule();
body("Compact view of the network shape behind every screen, in one place.");
const flows = [
  ["Login", "POST /api/rmone/token", "RM ONE auth"],
  ["Home", "GET /api/rmone/projects + GET /api/chat/inbox", "RM ONE + AgentMail (via API)"],
  ["Pipeline", "GET /api/rmone/records/:module", "RM ONE module API"],
  ["Project Detail", "GET /api/rmone/project/:id, POST /api/rmone/smart-update", "RM ONE record + field write"],
  ["Resources", "GET /api/rmone/resource-allocations + /allocations + /task-data", "RM ONE allocations + tasks (aggregated)"],
  ["AI Chat", "POST /api/chat/message (SSE), POST /api/transcribe", "OpenAI GPT-4o + tools + gpt-4o-mini-transcribe"],
  ["Profile", "GET /api/rmone/profile, POST /api/chat/push-token", "RM ONE profile + Expo push registration"],
  ["RFP (helper)", "POST /api/transcribe", "Voice notes for RFP context"],
];
const fHead = ["Screen", "Endpoints used", "Backing service(s)"];
let fy = doc.y + 6;
const fW = [95, 235, 185];
const fH = 30;
doc.save().rect(PAGE.margin, fy, fW[0] + fW[1] + fW[2], fH).fill(NAVY).restore();
let fxh = PAGE.margin;
for (let c = 0; c < fHead.length; c++) {
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(9).text(fHead[c], fxh + 6, fy + 11, { width: fW[c] - 12 });
  fxh += fW[c];
}
fy += fH;
for (let i = 0; i < flows.length; i++) {
  const fill = i % 2 === 0 ? "#F5F7F9" : "#FFFFFF";
  doc.save().rect(PAGE.margin, fy, fW[0] + fW[1] + fW[2], fH).fill(fill).restore();
  let fxr = PAGE.margin;
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text(flows[i][0], fxr + 6, fy + 11, { width: fW[0] - 12 });
  fxr += fW[0];
  doc.fillColor(ORANGE).font("Courier").fontSize(8.5).text(flows[i][1], fxr + 6, fy + 8, { width: fW[1] - 12, lineGap: 1 });
  fxr += fW[1];
  doc.fillColor(INK).font("Helvetica").fontSize(9).text(flows[i][2], fxr + 6, fy + 11, { width: fW[2] - 12 });
  fy += fH;
}
doc.y = fy + 10;
doc.x = PAGE.margin;

// ---------- PAGE 15 — Security / caching / reliability ----------
pageNew();
title("9. Security, Caching, and Reliability");
rule();
h2("Security");
bullets([
  "Tenant credentials are stored on the API server only. The mobile client never holds RM ONE secrets.",
  "Sessions are minted on POST /api/rmone/token and tracked in an in-memory token map per process.",
  "All upstream traffic uses HTTPS. Tokens are attached server-side per request.",
  "Mutating tools require a user-confirmed [BUTTONS:...] tap before they fire.",
]);
h2("Caching");
bullets([
  "Stale-While-Revalidate (SWR) on the mobile client: stale value rendered immediately, fresh value swapped in on response.",
  "AsyncStorage backs the cache so the app opens to last-known data when offline.",
  "Per-record fallback cache on the API server smooths transient RM ONE errors on /api/rmone/project/:id.",
]);
h2("Reliability");
bullets([
  "Streaming chat survives mid-response disconnects \u2014 the client reconnects with the conversation id and replays the partial.",
  "Server-side rolling summary keeps long conversations under context budget without loss of intent.",
  "Centralized POST /api/debug-log captures client-side errors with conversation id for support triage.",
]);

h2("Closing");
body(
  "Every component above is shipping code. The screens, endpoints, and tools described in this document map 1:1 to the source. The forward-looking improvements (Operational Command Center, Bloomberg-style AI brief, app-launch Daily Briefing, Visual Forecasting, role-based homes) are designed against this same architecture \u2014 they reuse the existing chat pipeline, the existing tool catalog, and the existing endpoint shape, so the path from mockup to production is short."
);

// ---------- PAGE FOOTERS ----------
const range = doc.bufferedPageRange();
const totalPages = range.count;
for (let i = range.start; i < range.start + totalPages; i++) {
  doc.switchToPage(i);
  // Skip footer on the title page
  if (i === 0) continue;
  const footerStr = `RM ONE Mobile \u2014 Technical Documentation   \u00B7   April 25, 2026   \u00B7   Page ${i + 1} of ${totalPages}`;
  // Draw footer as raw vector text to bypass any flow / pagination logic
  doc.fillColor(MUTED).font("Helvetica").fontSize(8);
  const tw = doc.widthOfString(footerStr);
  const tx = PAGE.margin + (CONTENT_W - tw) / 2;
  doc.text(footerStr, tx, PAGE.h - 28, { lineBreak: false, width: tw + 4, height: 12 });
}
doc.flushPages();

doc.end();
console.log("Wrote", OUT);
