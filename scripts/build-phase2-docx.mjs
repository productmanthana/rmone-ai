import { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, ShadingType, PageBreak, LevelFormat } from "docx";
import fs from "node:fs";
import path from "node:path";

const ROOT = "exports/RMONE_Phase2_Response";
const IMG_DIR = path.join(ROOT, "cropped");
const OUT = path.join(ROOT, "RMONE_Phase2_Response.docx");

const NAVY = "1B2B38";
const GREEN = "6BA539";
const ORANGE = "E87722";
const RED = "C7311C";
const MUTED = "5C6B78";
const TEXT = "1F2A33";
const LIGHT_BG = "F4F6F8";
const FEEDBACK_BG = "F1F4F7";

const img = (file, w, h) => new ImageRun({
  data: fs.readFileSync(path.join(IMG_DIR, file)),
  transformation: { width: w, height: h },
  type: "png",
});

const t = (text, opts = {}) => new TextRun({ text, font: "Calibri", ...opts });

const p = (children, opts = {}) => new Paragraph({
  children: Array.isArray(children) ? children : [children],
  spacing: { after: 120, ...(opts.spacing || {}) },
  ...opts,
});

const h1 = (text) => new Paragraph({
  spacing: { before: 360, after: 120 },
  pageBreakBefore: false,
  keepNext: true,
  children: [new TextRun({ text, bold: true, size: 36, color: NAVY, font: "Calibri" })],
});

const h2 = (num, title) => new Paragraph({
  spacing: { before: 320, after: 80 },
  pageBreakBefore: false,
  keepNext: true,
  keepLines: true,
  children: [
    new TextRun({ text: `${num}  `, bold: true, size: 30, color: GREEN, font: "Calibri" }),
    new TextRun({ text: title, bold: true, size: 30, color: NAVY, font: "Calibri" }),
  ],
});

const h3 = (text) => new Paragraph({
  spacing: { before: 200, after: 80 },
  keepNext: true,
  children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 18, color: GREEN, font: "Calibri" })],
});

const subSection = (text) => new Paragraph({
  spacing: { before: 0, after: 200 },
  keepNext: true,
  children: [new TextRun({ text, italics: true, size: 20, color: MUTED, font: "Calibri" })],
});

const body = (text, opts = {}) => p(t(text, { size: 22, color: TEXT, ...opts }));

// Mixed-formatting paragraph: input is array of {text, bold?, italics?, color?}
const richBody = (parts) => p(parts.map(seg => t(seg.text, {
  size: 22,
  color: seg.color || TEXT,
  bold: !!seg.bold,
  italics: !!seg.italics,
})));

const feedbackBox = (label, txt) => {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders(),
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: FEEDBACK_BG, type: ShadingType.CLEAR, color: "auto" },
            margins: { top: 200, bottom: 200, left: 240, right: 240 },
            borders: leftAccent(NAVY),
            children: [
              new Paragraph({
                spacing: { after: 80 },
                children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 16, color: MUTED, font: "Calibri", characterSpacing: 30 })],
              }),
              new Paragraph({
                children: [new TextRun({ text: txt, size: 21, color: TEXT, font: "Calibri" })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
};

const noBorders = () => ({
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
});

const leftAccent = (color) => ({
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.SINGLE, size: 24, color },
});

const thinBorders = () => ({
  top: { style: BorderStyle.SINGLE, size: 4, color: "DDE2E7" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "DDE2E7" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "DDE2E7" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "DDE2E7" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "DDE2E7" },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "DDE2E7" },
});

// Two-column layout: caption + screenshot
const screenshotBlock = (file, captionLines = []) => {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders(),
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            margins: { top: 100, bottom: 100, left: 0, right: 0 },
            borders: noBorders(),
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 100 },
                children: [img(file, 300, 653)],
              }),
              ...captionLines.map(c => new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 0 },
                children: [new TextRun({ text: c, size: 16, color: MUTED, font: "Calibri", bold: true, characterSpacing: 30 })],
              })),
            ],
          }),
        ],
      }),
    ],
  });
};

const mappingTable = (rows) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: thinBorders(),
  rows: [
    new TableRow({
      tableHeader: true,
      children: rows[0].map(h => new TableCell({
        shading: { fill: FEEDBACK_BG, type: ShadingType.CLEAR, color: "auto" },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        children: [new Paragraph({ children: [new TextRun({ text: h.toUpperCase(), bold: true, size: 16, color: NAVY, font: "Calibri", characterSpacing: 20 })] })],
      })),
    }),
    ...rows.slice(1).map(r => new TableRow({
      children: r.map((cell, i) => new TableCell({
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        children: [new Paragraph({ children: typeof cell === "string"
          ? [new TextRun({ text: cell, size: 20, color: TEXT, font: "Calibri" })]
          : cell.map(seg => new TextRun({ text: seg.text, size: 20, color: seg.color || TEXT, bold: !!seg.bold, font: "Calibri" }))
        })],
      })),
    })),
  ],
});

const roleCell = (file, role, sub) => new TableCell({
  margins: { top: 160, bottom: 160, left: 80, right: 80 },
  borders: noBorders(),
  width: { size: 50, type: WidthType.PERCENTAGE },
  children: [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [img(file, 200, 435)] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: role, bold: true, size: 24, color: NAVY, font: "Calibri" })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: sub, size: 18, color: MUTED, font: "Calibri", italics: true })] }),
  ],
});

const emptyCell = () => new TableCell({
  margins: { top: 0, bottom: 0, left: 0, right: 0 },
  borders: noBorders(),
  width: { size: 50, type: WidthType.PERCENTAGE },
  children: [new Paragraph({ children: [new TextRun({ text: "" })] })],
});

const rolesGrid = () => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: noBorders(),
  rows: [
    new TableRow({ children: [
      roleCell("P5_Role_COO.png", "COO", "Operational Health"),
      roleCell("P5_Role_CFO.png", "CFO", "Financial Health"),
    ]}),
    new TableRow({ children: [
      roleCell("P5_Role_ResourceMgr.png", "Resource Manager", "Capacity Health"),
      roleCell("P5_Role_ProjectMgr.png", "Project Manager", "My Portfolio"),
    ]}),
    new TableRow({ children: [
      roleCell("P5_Role_Executive.png", "Executive", "Firm Health"),
      emptyCell(),
    ]}),
  ],
});

// ======== COVER ========
const cover = [
  new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: "OPERATIONAL INTELLIGENCE FOR AEC", bold: true, size: 18, color: GREEN, font: "Calibri", characterSpacing: 50 })],
  }),
  new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: "RM ONE — Phase 2 Mobile Review", bold: true, size: 48, color: NAVY, font: "Calibri" })],
  }),
  new Paragraph({
    spacing: { after: 240 },
    children: [new TextRun({ text: "Response & Delivered Mockups", bold: true, size: 36, color: NAVY, font: "Calibri" })],
  }),
  new Paragraph({
    spacing: { after: 320 },
    children: [new TextRun({ text: "Point-by-point response to the April 25 Phase 2 review, with the revised mockups corresponding to each priority recommendation.", size: 24, color: TEXT, font: "Calibri", italics: true })],
  }),
  new Paragraph({
    spacing: { after: 0 },
    children: [
      new TextRun({ text: "Date  ", bold: true, size: 20, color: MUTED, font: "Calibri" }),
      new TextRun({ text: "April 26, 2026     ", size: 20, color: TEXT, font: "Calibri" }),
      new TextRun({ text: "Round  ", bold: true, size: 20, color: MUTED, font: "Calibri" }),
      new TextRun({ text: "Phase 2, Iteration 2     ", size: 20, color: TEXT, font: "Calibri" }),
      new TextRun({ text: "Scope  ", bold: true, size: 20, color: MUTED, font: "Calibri" }),
      new TextRun({ text: "5 priority screens, 5 role variants", size: 20, color: TEXT, font: "Calibri" }),
    ],
  }),
];

// ======== Priority builder ========
const prioritySection = ({ num, title, sub, screenshot, captionLines, feedback, paragraphs, extra = [] }) => {
  return [
    h2(num, title),
    subSection(sub),
    screenshotBlock(screenshot, captionLines),
    feedbackBox("Client recommendation", feedback),
    h3("What we delivered"),
    ...paragraphs,
    ...extra,
  ];
};

const p1 = prioritySection({
  num: "P1",
  title: "Operational Command Center",
  sub: "Home tab · the COO's first-screen experience",
  screenshot: "P1_Operational_Command_Center.png",
  captionLines: ["HOME", "7-DAY HORIZON · PINNED CRITICAL"],
  feedback: 'Increase emphasis on Operational Health · Make the Risk Feed dominant above the fold · Add predictive language ("Projected", "Forecasted", "Within 30 days") · Tighten scan speed to under 10 seconds · More examples like "Move 4 FTE Boston → Phoenix".',
  paragraphs: [
    richBody([
      { text: "The header now leads with " },
      { text: "FORECAST WINDOW · NEXT 30 DAYS", bold: true },
      { text: " and a live indicator, framing every metric below as forward-looking rather than historical." },
    ]),
    richBody([
      { text: "The " },
      { text: "Operational Health gauge", bold: true },
      { text: " (82/100) is now the first card and is visually anchored as the primary indicator — sub-drivers (Staffing balance, Utilization stability, Proposal coverage, Delivery exposure) sit beside it for context but do not compete for attention." },
    ]),
    richBody([
      { text: "A " },
      { text: "Pinned Critical card", bold: true },
      { text: " (\"Phoenix office projected at 104% utilization · 7-day horizon\") now sits directly below the gauge with a red border and a green " },
      { text: "Resolve", bold: true },
      { text: " CTA — the most severe issue is impossible to miss." },
    ]),
    richBody([
      { text: "The " },
      { text: "Operational Risk Feed", bold: true },
      { text: " uses predictive phrasing throughout: \"3 projects projected under-resourced\", \"Likely Senior PM shortage · forecasted 2 reqs short\", \"Burnout risk\". Every item carries a horizon tag (30D / 45D) so the COO sees the time pressure at a glance." },
    ]),
    richBody([
      { text: "The " },
      { text: "Recommended Actions", bold: true },
      { text: " block is labelled \"Decision Support · 4\" and leads with the COO action you called out — " },
      { text: "Move 4 FTE Boston → Phoenix", bold: true },
      { text: " — followed by three more decisions of the same character (open requisitions, defer pursuits, re-schedule). Every action is one tap." },
    ]),
    h3("Scan-time test"),
    body("Reading top-to-bottom: health score → biggest threat → 3 forward risks → 4 decisions ready to take. A COO can absorb the state of the business in roughly six seconds without scrolling."),
  ],
});

const p2 = prioritySection({
  num: "P2",
  title: "Bloomberg-Style AI Brief — repositioned as Decision Support",
  sub: "AI tab · operational brief, not assistant chat",
  screenshot: "P2_Decision_Support_Brief.png",
  captionLines: ["SITREP · 12 LIVE SIGNALS · CONFIDENCE 87%"],
  feedback: 'Shorten further · Push from "AI assistant" to "decision support" · Make it specific (e.g. "Healthcare PM shortage projected in 45 days") · Expand the "draft for me" flow to staffing requests, proposals, exec summaries, client updates, forecast briefs.',
  paragraphs: [
    richBody([
      { text: "The product name on the screen is now " },
      { text: "Decision Support", bold: true },
      { text: " — the word \"Assistant\" has been removed entirely. The pill in the top-right reads " },
      { text: "LIVE · 12 SIGNALS", italics: true },
      { text: " to position the AI as a market terminal, not a chatbot." },
    ]),
    richBody([
      { text: "The SITREP headline is the exact specificity you asked for: " },
      { text: "Healthcare PM shortage projected in 45 days.", bold: true },
      { text: " with the substantiating data on a single sub-line — " },
      { text: "2 Sr PM reqs short · pursuit value $4.2M · close-by Jun 10.", italics: true },
      { text: " Three numbers, one decision." },
    ]),
    richBody([
      { text: "The Risk and Horizon tags (" },
      { text: "HIGH", bold: true, color: RED },
      { text: " · " },
      { text: "45D", bold: true, color: ORANGE },
      { text: ") are now top-right, military-brief style." },
    ]),
    richBody([
      { text: "The " },
      { text: "4 Recommended Actions", bold: true },
      { text: " are numbered and stripped to verbs: \"Shift Tom R. off PMM-167 · 8h/wk\", \"Defer pursuit · 14D\", \"Engage 3 contract PM candidates\", \"Open Sr PM req · close 45D\". Each has a one-tap green action chip (Apply / Defer / Engage / Open)." },
    ]),
    richBody([
      { text: "A " },
      { text: "Confidence bar (87%)", bold: true },
      { text: " sits directly under the actions so the user can weight the recommendation in one glance." },
    ]),
    h3('"Draft for me" expansion'),
    richBody([
      { text: "The \"Want me to draft the requisition?\" flow is now a " },
      { text: "5-output panel", bold: true },
      { text: " — Requisition, Staffing plan, Exec summary, Client update, Forecast brief — exactly the workflows you flagged. A \"More\" entry leaves room for the next wave (proposal narratives, change-order memos, etc.) without redesigning the surface." },
    ]),
  ],
});

const p3 = prioritySection({
  num: "P3",
  title: "App Launch Wow Moment — Live Pulse",
  sub: "Daily briefing · the screen the user opens to first thing in the morning",
  screenshot: "P3_Live_Pulse_Daily_Briefing.png",
  captionLines: ["LIVE PULSE", "WHAT CHANGED SINCE YESTERDAY"],
  feedback: "Increase contrast and visibility on Risks Flagged, Forecast Shift, and critical notifications · Pin the most severe issue larger at the top · Continue reinforcing urgency and operational timing.",
  paragraphs: [
    richBody([
      { text: "The most severe issue is now a " },
      { text: "full-width Pinned Critical hero card", bold: true },
      { text: " at the very top of the launch screen: " },
      { text: "Phoenix office projected at 104% utilization next week.", bold: true },
      { text: " with timing detail (\"Peak week of May 4 · 7 FTE overage · cascade risk on 3 active projects\") and a green " },
      { text: "Resolve now", bold: true },
      { text: " primary CTA. It is roughly 3× the visual weight of any other element on the screen." },
    ]),
    richBody([
      { text: "The " },
      { text: "Overnight Scan", bold: true },
      { text: " tile now uses high-contrast color coding for the three numbers you called out — Risks Flagged is rendered in " },
      { text: "red", bold: true, color: RED },
      { text: " with the +2 vs yesterday delta, Conflicts Resolved in " },
      { text: "green", bold: true, color: GREEN },
      { text: ", Forecast Shift in " },
      { text: "green", bold: true, color: GREEN },
      { text: " — so the daily trend is readable in under a second." },
    ]),
    richBody([
      { text: "The " },
      { text: "What changed since yesterday", bold: true },
      { text: " module is preserved as the second-most-important block; each row carries an arrow trend icon and a quantified delta (+4%, +$4.2M, −2, −8h/wk, +$2.1M) instead of generic descriptions." },
    ]),
    richBody([
      { text: "Critical Notifications below are color-tiered exactly the way the rest of the app is: " },
      { text: "CRITICAL", bold: true, color: RED },
      { text: " red, " },
      { text: "WARNING", bold: true, color: ORANGE },
      { text: " orange, " },
      { text: "INSIGHT", bold: true, color: GREEN },
      { text: " green — with timing chips (7D / 14D / 30D) on every row." },
    ]),
    richBody([
      { text: "A green full-width " },
      { text: "Open command center", bold: true },
      { text: " CTA closes the screen so the user always knows what the natural next step is after the briefing." },
    ]),
  ],
});

const p4 = prioritySection({
  num: "P4",
  title: "Visual Forecasting",
  sub: "Heatmap · capacity curves · scenario modelling",
  screenshot: "P4_Visual_Forecasting.png",
  captionLines: ["OFFICE HEATMAP · DEMAND VS CAPACITY · SCENARIO"],
  feedback: 'Continue simplifying chart density · Make overload conditions more visually obvious · Add explicit headlines above charts: "Peak overload week", "Hiring trigger month", "Resource failure point" · Elevate the Scenario "What happens if we win this pursuit?" functionality.',
  paragraphs: [
    richBody([
      { text: "Each of the three charts is now introduced by the exact headline you requested, in capitalised " },
      { text: "HEADLINE", bold: true },
      { text: " framing, with the answer rendered next to it in red so the conclusion is readable without parsing the chart:" },
    ]),
    mappingTable([
      ["Headline", "Answer surfaced inline"],
      [[{ text: "Peak overload week", bold: true }], [{ text: "W20 · Phoenix 115%", bold: true, color: RED }]],
      [[{ text: "Hiring trigger month", bold: true }], [{ text: "June · W22 · 2 Sr PM", bold: true, color: RED }]],
      [[{ text: "Resource failure point", bold: true }], [{ text: "W21 · Tom R. 150% across 3 projects", bold: true, color: RED }]],
    ]),
    new Paragraph({ spacing: { before: 240, after: 0 }, children: [new TextRun({ text: "", size: 2 })] }),
    richBody([
      { text: "The " },
      { text: "heatmap", bold: true },
      { text: " has been simplified to a single 3-tier scale (OK / Warn / Overload). Overload cells now display the actual number (108, 115) in white inside the red cell — the eye is drawn to the problem before the legend." },
    ]),
    richBody([
      { text: "The " },
      { text: "Demand vs Capacity", bold: true },
      { text: " curve is reduced to two lines (demand vs capacity) with a single annotated " },
      { text: "HIRE", bold: true, color: RED },
      { text: " marker placed exactly at the crossover point. No gridlines, no legend clutter." },
    ]),
    richBody([
      { text: "The " },
      { text: "collision view", bold: true },
      { text: " shows three project bars over time with a separate " },
      { text: "OVERLAP", bold: true },
      { text: " band underneath that turns red only at W21 — the moment of failure is unambiguous." },
    ]),
    h3("Scenario — elevated"),
    richBody([
      { text: "The Scenario module is now a dedicated panel at the bottom with a green " },
      { text: '"What if we win NYCHA?"', italics: true },
      { text: " headline and a +$8.2M impact tag. Two equal-weight buttons — " },
      { text: "Base case", bold: true },
      { text: " and " },
      { text: "Win pursuit", bold: true },
      { text: " — let an executive run the simulation in one tap. A short helper line explains what gets modelled (FTE, peak utilization, hire impact). This is the strategic differentiator you called out, surfaced as a first-class action rather than a buried feature." },
    ]),
  ],
});

const p5 = [
  h2("P5", "Role-Based Experiences"),
  subSection("One template, five role profiles · COO · CFO · Resource Manager · Project Manager · Executive"),
  feedbackBox("Client recommendation",
    "Keep role structures highly consistent visually · Only change risks, KPIs, actions, terminology · Avoid making role experiences feel like separate applications · The CFO screen is especially strong because it begins connecting Pipeline → Delivery → Margin → Cash Flow."
  ),
  h3("What we delivered"),
  richBody([
    { text: "All five roles render from a " },
    { text: "single template", bold: true },
    { text: ". The header, health gauge, risk feed, recommended-actions block, and bottom navigation are pixel-identical across roles. Only four things change: the role badge, the four sub-driver KPIs, the three risk feed items, and the four recommended actions." },
  ]),
  rolesGrid(),
  h3("CFO — Pipeline → Delivery → Margin → Cash Flow connected"),
  richBody([
    { text: "The CFO health card now reads in that exact order: " },
    { text: "Pipeline coverage 84 → Delivery margin 56 → Margin vs plan 67 → Cash collection 59", bold: true },
    { text: ". Every risk in the CFO feed is tagged to the pillar it threatens — " },
    { text: '"NYCHA Castle Hill margin −3.2% · Delivery"', italics: true },
    { text: ", " },
    { text: '"AR > 60 days at $4.1M · Cash flow"', italics: true },
    { text: ", " },
    { text: '"Houston burn +5% · Margin"', italics: true },
    { text: " — so the CFO sees not just the problem but which of the four financial pillars is at risk." },
  ]),
  h3("Visual consistency across roles"),
  mappingTable([
    ["Element", "Across all 5 roles"],
    ["Layout", "Identical: header → gauge → risk feed → actions → nav"],
    ["Color hierarchy", [{ text: "CRIT", bold: true, color: RED }, { text: " = true critical · " }, { text: "WARN", bold: true, color: ORANGE }, { text: " = warning · " }, { text: "OK / brand", bold: true, color: GREEN }]],
    ["Typography & spacing", "Same component library across all roles — no divergence"],
    ["What changes per role", "Role badge, 4 KPI sub-drivers, 3 risk items, 4 recommended actions, vocabulary"],
    ["Architecture", "Data-driven role config — adding a 6th role is one config entry, not a redesign"],
  ]),
];

const summary = [
  new Paragraph({
    spacing: { before: 480, after: 80 },
    keepNext: true,
    children: [new TextRun({ text: "STRATEGIC POSITIONING", bold: true, size: 18, color: GREEN, font: "Calibri", characterSpacing: 50 })],
  }),
  new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: "Operational Intelligence for AEC", bold: true, size: 36, color: NAVY, font: "Calibri" })],
  }),
  body("Every screen in this revision was built to support the strategic repositioning you called out — RM ONE is no longer \"resource management software\", it is the operational intelligence layer for the firm."),
  new Paragraph({ spacing: { before: 120, after: 80 },
    children: [new TextRun({ text: "•  ", bold: true, size: 22, color: GREEN, font: "Calibri" }),
               new TextRun({ text: "Proactive over reactive", bold: true, size: 22, color: NAVY, font: "Calibri" }),
               new TextRun({ text: " — every screen leads with what is about to happen in a defined horizon (7D / 30D / 45D), not what already happened.", size: 22, color: TEXT, font: "Calibri" })] }),
  new Paragraph({ spacing: { before: 80, after: 80 },
    children: [new TextRun({ text: "•  ", bold: true, size: 22, color: GREEN, font: "Calibri" }),
               new TextRun({ text: "Decision support over reporting", bold: true, size: 22, color: NAVY, font: "Calibri" }),
               new TextRun({ text: " — every risk is paired with a one-tap action; the AI is positioned as a SITREP terminal, not a chat assistant.", size: 22, color: TEXT, font: "Calibri" })] }),
  new Paragraph({ spacing: { before: 80, after: 80 },
    children: [new TextRun({ text: "•  ", bold: true, size: 22, color: GREEN, font: "Calibri" }),
               new TextRun({ text: "Executive scan speed", bold: true, size: 22, color: NAVY, font: "Calibri" }),
               new TextRun({ text: " — pinned critical, gauge, risk feed, and recommended actions all sit above the fold on every persona's home screen.", size: 22, color: TEXT, font: "Calibri" })] }),
  new Paragraph({ spacing: { before: 80, after: 80 },
    children: [new TextRun({ text: "•  ", bold: true, size: 22, color: GREEN, font: "Calibri" }),
               new TextRun({ text: "Consistent operational language", bold: true, size: 22, color: NAVY, font: "Calibri" }),
               new TextRun({ text: " — \"Projected\", \"Forecasted\", \"Within 30 days\", \"Peak week of\", \"Hiring trigger\" — used uniformly so the product feels like one intelligent system across personas.", size: 22, color: TEXT, font: "Calibri" })] }),
  new Paragraph({ spacing: { before: 80, after: 240 },
    children: [new TextRun({ text: "•  ", bold: true, size: 22, color: GREEN, font: "Calibri" }),
               new TextRun({ text: "Differentiation surfaces", bold: true, size: 22, color: NAVY, font: "Calibri" }),
               new TextRun({ text: " — Scenario modelling (\"What if we win NYCHA?\") and Role-based personalization are now first-class commercial demo moments.", size: 22, color: TEXT, font: "Calibri" })] }),
  new Paragraph({
    spacing: { before: 600, after: 0 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "RM ONE Phase 2 · Mobile Mockup Response · Prepared April 26, 2026", size: 18, color: MUTED, font: "Calibri", italics: true })],
  }),
  new Paragraph({
    spacing: { before: 60, after: 0 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "All five priority screens and all five role variants are interactive and available for live walkthrough on request.", size: 18, color: MUTED, font: "Calibri", italics: true })],
  }),
];

const doc = new Document({
  creator: "RM ONE Design Team",
  title: "RM ONE — Phase 2 Review Response",
  description: "Point-by-point response to the April 25 Phase 2 mobile review.",
  styles: {
    default: {
      document: {
        run: { font: "Calibri", size: 22, color: TEXT },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    children: [
      ...cover,
      h1("Priority-by-priority response"),
      ...p1,
      ...p2,
      ...p3,
      ...p4,
      ...p5,
      ...summary,
    ],
  }],
});

const buf = await Packer.toBuffer(doc);
fs.writeFileSync(OUT, buf);
console.log(`Wrote ${OUT} (${(buf.length / 1024).toFixed(1)} KB)`);
