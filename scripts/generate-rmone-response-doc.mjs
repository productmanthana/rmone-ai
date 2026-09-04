import { Document, Packer, Paragraph, HeadingLevel, TextRun, ImageRun, AlignmentType, PageBreak, Footer, PageNumber, ShadingType } from "docx";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
process.chdir(ROOT);
const SHOTS_DIR = "attached_assets/screenshots";
const CROPPED_DIR = "exports/_cropped";
fs.mkdirSync(CROPPED_DIR, { recursive: true });

const file = (name) => {
  const suffix = `_mockup_preview_${name}.png`;
  const match = fs.readdirSync(SHOTS_DIR).find((entry) => entry.endsWith(suffix));
  if (!match) throw new Error(`Missing screenshot ending with ${suffix}`);
  return path.join(SHOTS_DIR, match);
};

const RAW = {
  p1: file("rmone-p1-command_Home"),
  p2: file("rmone-p2-ai_Brief"),
  p3: file("rmone-p3-snapshot_Today"),
  p4: file("rmone-p4-forecast_Heatmap"),
  coo: file("rmone-p5-nav_COO"),
  cfo: file("rmone-p5-nav_CFO"),
  rm: file("rmone-p5-nav_RM"),
  pm: file("rmone-p5-nav_PM"),
  exec: file("rmone-p5-nav_Exec"),
};

// Crop white background from each screenshot so the phone mockup fills the frame.
// Pre-compute aspect so MockupImage can stay synchronous.
const SHOTS = {};
const SHOTS_ASPECT = {};
for (const [k, src] of Object.entries(RAW)) {
  const dst = path.join(CROPPED_DIR, path.basename(src));
  await sharp(src)
    .trim({ background: { r: 255, g: 255, b: 255 }, threshold: 10 })
    .toFile(dst);
  const meta = await sharp(dst).metadata();
  SHOTS[k] = dst;
  SHOTS_ASPECT[k] = meta.height / meta.width;
}

const NAVY = "1B2B38";
const NAVY_DEEP = "0F1B25";
const GREEN = "6BA539";
const ORANGE = "E87722";
const WHITE = "FFFFFF";
const MUTED = "8FA3B3";

const H1 = (text, color = ORANGE) =>
  new Paragraph({
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, size: 36, color })],
  });

const H2 = (text, color = GREEN) =>
  new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, size: 26, color })],
  });

const P = (text, opts = {}) =>
  new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text, size: 22, color: opts.color ?? "1F2A33" })],
  });

const Bullet = (text) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 22, color: "1F2A33" })],
  });

const Quote = (text) =>
  new Paragraph({
    spacing: { before: 80, after: 120 },
    indent: { left: 360 },
    shading: { type: ShadingType.CLEAR, color: "auto", fill: "F2F4F6" },
    children: [new TextRun({ text, italics: true, size: 22, color: "30404C" })],
  });

const Tag = (label, color) =>
  new Paragraph({
    spacing: { before: 60, after: 80 },
    children: [
      new TextRun({
        text: ` ${label} `,
        bold: true,
        size: 18,
        color: WHITE,
        shading: { type: ShadingType.CLEAR, color: "auto", fill: color },
      }),
    ],
  });

const MockupImage = (key, { width = 360 } = {}) => {
  const relPath = SHOTS[key];
  const aspect = SHOTS_ASPECT[key];
  const buf = fs.readFileSync(relPath);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
    children: [
      new ImageRun({
        data: buf,
        transformation: { width, height: Math.round(width * aspect) },
        type: "png",
      }),
    ],
  });
};

const Caption = (text) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text, italics: true, size: 18, color: MUTED })],
  });

// ---------- TITLE PAGE ----------
const titlePage = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 2400, after: 240 },
    children: [new TextRun({ text: "RM ONE", bold: true, size: 72, color: GREEN })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: "Mobile App — Response to Status Review", bold: true, size: 40, color: NAVY })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
    children: [new TextRun({ text: "Five Priority Improvements — Delivered as Mobile Mockups", size: 24, color: MUTED })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: "April 25, 2026", size: 22, color: NAVY })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: "Prepared in response to: RM ONE Mobile App Status Review · April 24, 2026", size: 20, color: MUTED })],
  }),
  new Paragraph({ children: [new PageBreak()] }),
];

// ---------- COVER NOTE ----------
const coverNote = [
  H1("Cover Note", ORANGE),
  P("Thank you for the detailed status review. We took every priority you flagged and turned it into a working mobile mockup so you can see — not just read — how RM ONE Mobile answers each one."),
  P("This document walks through all five priorities in the same order you presented them. Under each priority you will find: (1) what you asked for, in your words, (2) what we built and how it addresses the request, and (3) a screenshot of the live mockup on a phone-sized canvas."),
  P("Every screen uses the RM ONE brand palette (navy, green, orange) and follows the executive-first principles you outlined: scan-first layout, AI-driven risk surfaces, recommended actions you can act on in one tap, and zero ChatGPT-style paragraphs."),
  H2("What is included", GREEN),
  Bullet("Priority 1 — Operational Command Center home screen"),
  Bullet("Priority 2 — Bloomberg-style AI brief format"),
  Bullet("Priority 3 — App-launch Daily Briefing (the 60-second wow moment)"),
  Bullet("Priority 4 — Visual Forecasting screen with utilization heatmaps, demand vs. capacity, resource collisions, and scenario toggles"),
  Bullet("Priority 5 — Five role-based home screens: COO, CFO, Resource Manager, Project Manager, and Executive"),
  P(""),
  P("We are ready to walk through any of these live, iterate on copy or visuals, and graduate the approved screens into the production mobile app."),
  new Paragraph({ children: [new PageBreak()] }),
];

// ---------- PRIORITY SECTIONS ----------
const p1 = [
  H1("Priority 1 — Executive Dashboard \u2192 Operational Command Center"),
  H2("What you asked for"),
  Quote("Transform the home/dashboard into an AEC Operational Command Center. The first screen should instantly answer: what is happening, what is at risk, what needs action, and what will impact profitability. Replace passive metrics with active intelligence: an Operational Risk Feed, a Forecasted Operational Health Score with sub-drivers, and Recommended Actions that turn RM ONE into operational decision software."),
  H2("What we delivered"),
  P("The Home screen has been rebuilt around four labeled zones (A, B, C, D) that map 1:1 to your request:"),
  Bullet("A — Active intelligence header (Good morning + role tag) replaces the old utilization-percentage greeting."),
  Bullet("B — Operational Risk Feed at the top: live, AI-generated bullets such as \u201C3 projects under-resourced \u00B7 30 days,\u201D \u201CPhoenix utilization projected 104%,\u201D and \u201C2 PMs approaching burnout.\u201D"),
  Bullet("C — Forecasted Operational Health gauge (82/100) with the four sub-drivers you named: staffing balance, utilization stability, proposal coverage, project delivery exposure."),
  Bullet("D — Recommended Actions panel with one-tap buttons: Apply (move resources), Defer (delay pursuits), Hire (open requisition), Shift (reschedule)."),
  P("The result is the \u201Cdecision software\u201D feel you described: every element on the home screen either flags a risk, scores it, or offers an action."),
  MockupImage("p1"),
  Caption("Priority 1 — Operational Command Center home screen"),
  new Paragraph({ children: [new PageBreak()] }),
];

const p2 = [
  H1("Priority 2 — AI Responses \u2192 Bloomberg-Style Brief"),
  H2("What you asked for"),
  Quote("AI responses still feel conversational and consultant-style. Executives want compressed operational intelligence \u2014 brief facts with limited consultation. Standardize the response format (Summary, Risk Level, Time Horizon, Recommended Actions, Confidence). Add visual status tags and one-tap actions."),
  H2("What we delivered"),
  P("We built a dedicated AI response card that enforces the exact five-part structure you specified. No paragraphs, no consultant-speak."),
  Bullet("Summary headline + Risk tag (HIGH/MED/LOW) on the same row \u2014 scannable in under 2 seconds."),
  Bullet("Time Horizon stamped right under the summary (e.g. \u201C45 days\u201D)."),
  Bullet("Recommended Actions as a numbered, tappable list (Shift Tom R., Delay healthcare pursuit by 2 weeks, Engage contract PM, Open requisition)."),
  Bullet("Confidence shown as both a percentage and a green progress bar."),
  Bullet("Four one-tap action buttons under the brief: View impacted, Find replacement, Open staffing, Email summary."),
  Bullet("AI follow-up prompt (\u201CWant me to draft the requisition?\u201D) demonstrates the \u201Cexecutive assistant\u201D loop you described."),
  P("Every email-style action in the app follows the same pattern you required: Edit / Cancel / Send before anything goes out."),
  MockupImage("p2"),
  Caption("Priority 2 — Standardized AI brief with visual status tags and one-tap actions"),
  new Paragraph({ children: [new PageBreak()] }),
];

const p3 = [
  H1("Priority 3 — App-Launch \u2018Wow Moment\u2019 \u2192 Daily Briefing"),
  H2("What you asked for"),
  Quote("Best enterprise products reveal value immediately. Create a \u2018holy shit this knows my business\u2019 moment in under 60 seconds. AI summary on launch, dynamic \u2018What changed since yesterday?\u2019, and Smart Notifications."),
  H2("What we delivered"),
  P("This is the screen the user sees the moment the app opens \u2014 before they tap anything. It collapses your three asks into one scannable surface."),
  Bullet("RM ONE AI \u00B7 LIVE PULSE banner with three KPIs: Risks Flagged, Conflicts Resolved, Forecast Shift. Updated 3 seconds ago."),
  Bullet("Operational Snapshot tags: Staffing, Overload, Hiring, Forecast \u2014 the AI categories you listed."),
  Bullet("Smart Notifications stack: Critical / Warning / Insight \u2014 mirrors the proposal-conflict, PM-utilization, and forecast-revenue alerts in your spec."),
  Bullet("\u2018What changed since yesterday\u2019 panel: Utilization +4%, Forecast backlog +$4.2M, Staffing conflicts \u22122, PM utilization \u22128h/wk, Proposal pipeline +$2.1M."),
  Bullet("Single \u2018Open dashboard\u2019 CTA at the bottom \u2014 the user is one tap away from the Command Center."),
  P("Result: the value of the platform is visible in the first 5 seconds, not after the user explores menus."),
  MockupImage("p3"),
  Caption("Priority 3 — App-launch Daily Briefing (the 60-second wow moment)"),
  new Paragraph({ children: [new PageBreak()] }),
];

const p4 = [
  H1("Priority 4 — Visual Forecasting"),
  H2("What you asked for"),
  Quote("AEC leaders think visually, operationally, spatially, timeline-oriented. Add utilization heatmaps, forecast curves, resource-collision visuals, and scenario visualization (\u2018What happens if we win this pursuit?\u2019)."),
  H2("What we delivered"),
  P("A purpose-built Forecast screen with four visual zones \u2014 covering every visualization you named:"),
  Bullet("Office utilization heatmap \u2014 8 weeks \u00D7 7 offices, color-coded across five thresholds (<70 / 70\u201385 / 85\u201395 / 95\u2013105 / >105%). Phoenix overload jumps off the screen."),
  Bullet("Demand vs. Capacity forecast curve \u2014 demand line crossing the capacity cap line over the 8-week horizon."),
  Bullet("Resource-collision view (Tom R.) \u2014 three projects stacked across W18\u2013W25 with an Overlap row at the bottom flagging the 150% peak in W21."),
  Bullet("Scenario toggle \u2014 \u2018Base case\u2019 vs. \u2018Win NYCHA +$8.2M\u2019. One tap re-renders the heatmap and the forecast curve so executives see the operational impact of winning a pursuit."),
  P("Tabs at the top let the user pivot the same data by Office / Role / Discipline \u2014 the three lenses you flagged."),
  MockupImage("p4"),
  Caption("Priority 4 — Visual Forecasting (heatmap, demand vs. capacity, collision, scenario toggle)"),
  new Paragraph({ children: [new PageBreak()] }),
];

const p5Intro = [
  H1("Priority 5 — Navigation Simplification + Role-Based Experiences"),
  H2("What you asked for"),
  Quote("Reduce primary navigation (Home, AI, Projects, People, Alerts). Use progressive disclosure. Create role-based experiences \u2014 the same app should feel different depending on whether the user is a COO, CFO, Resource Manager, Project Manager, or Executive."),
  H2("What we delivered"),
  P("First, we locked the primary nav to exactly the five tabs you named: Home, AI, Projects, People, Alerts. No bloat, no ERP-style menus."),
  P("Second, we built five separate role-based home screens. Same five-tab nav, same Operational Risk Feed + Health gauge + Recommended Actions structure \u2014 but every metric, risk item, and action is rewritten for the role. Each role sees what only that role cares about, in the same scan order."),
  P("The five mockups follow on the next pages."),
  new Paragraph({ children: [new PageBreak()] }),
];

const roleSection = (title, subtitle, asks, key) => [
  H2(title),
  P(subtitle, { color: MUTED }),
  ...asks.map((a) => Bullet(a)),
  MockupImage(key, { width: 320 }),
  Caption(title),
  new Paragraph({ children: [new PageBreak()] }),
];

const p5Roles = [
  ...roleSection(
    "COO — Chief Operating Officer",
    "Operational Health 82/100. Sees firm-wide utilization, burnout, and resource flow.",
    [
      "Risks: 3 projects under-resourced \u00B7 30d, Phoenix 104%, 2 PMs approaching burnout.",
      "Actions: Move 4 FTE Boston \u2192 Phoenix (Apply), Defer 3 proposals 2 wks (Defer), Open 2 senior PM reqs (Hire), Shift Tom R. off OPM-25-000089 (Shift).",
    ],
    "coo"
  ),
  ...roleSection(
    "CFO — Chief Financial Officer",
    "Margin Health 74/100. Sees margin, AR aging, burn vs. plan, and capex.",
    [
      "Risks: NYCHA Castle Hill margin \u22123.2%, AR > 60 days at $4.1M, Houston burn +5% vs plan.",
      "Actions: Re-baseline NYCHA Castle Hill (Open), Push 4 AR escalations (Send), Approve $2.1M change order (Approve), Defer $480K Q2 capex to Q3 (Defer).",
    ],
    "cfo"
  ),
  ...roleSection(
    "Resource Manager",
    "Capacity Health 68/100. Sees bench, overload, requisitions, and time-to-fill.",
    [
      "Risks: Phoenix overload W19\u2013W21, 3 senior PM gaps in Healthcare by June 1, Ana D. at 87h/wk for 3rd week.",
      "Actions: Move Tom R. off OPM-25-000089 (Apply), Open 2 Sr. PM reqs Healthcare (Open), Pull 1 PM Boston \u2192 Phoenix (Shift), Cap Ana D. at 50h/wk for 2 wks (Cap).",
    ],
    "rm"
  ),
  ...roleSection(
    "Project Manager",
    "My Portfolio 86/100. Sees on-track projects, RFIs, schedule, and approvals.",
    [
      "Risks: PMM-25-000167 RFI overdue 4d (sub-grade waterproofing), OPM-25-000089 schedule slip 4d (steel delivery), 2 approvals due Friday ($812K).",
      "Actions: Reply to 7 outstanding RFIs (Open), Submit Change Order #14 \u2014 Phoenix (Send), Confirm subcontractor for Castle Hill (Confirm), Reschedule steel pour to May 14 (Update).",
    ],
    "pm"
  ),
  ...roleSection(
    "Executive",
    "Firm Health 79/100. Sees pipeline, win rate, hire velocity, and client NPS.",
    [
      "Risks: Q3 pipeline gap \u2014 $14M short (Healthcare + Education), win rate dropped to 31%, 2 key leadership hires delayed.",
      "Actions: Approve FY26 hire plan \u2014 18 roles (Approve), Review Q3 pipeline pursuit list (Open), Sign Phoenix office lease renewal (Sign), Reset Q3 win-rate target to 35% (Set).",
    ],
    "exec"
  ),
];

// ---------- CLOSING ----------
const closing = [
  H1("Closing", ORANGE),
  P("Every priority you raised is reflected on a screen in this document, using your exact language for risks, actions, and KPIs wherever possible. We also held the line on the rules you set: pure RM ONE brand colors only (no red, no blue), no emojis anywhere, every email surface shows Edit / Cancel / Send before anything is sent, and the contract value field is never substituted for the labor contract amount."),
  P("Recommended next steps:"),
  Bullet("Walk through the five priority screens together on a 30-minute call."),
  Bullet("Mark which mockups are approved as-is, which need copy/visual tweaks, and which need a second variant."),
  Bullet("Graduate approved mockups into the production mobile app."),
  P(""),
  P("We are ready to start as soon as you give the word."),
];

// ---------- BUILD DOC ----------
const doc = new Document({
  creator: "RM ONE Mobile Team",
  title: "RM ONE Mobile — Response to Status Review",
  description: "Five Priority Improvements — delivered as mobile mockups",
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 22 } },
    },
  },
  sections: [
    {
      properties: {},
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "RM ONE Mobile \u2014 Response to Status Review \u00B7 April 25, 2026 \u00B7 Page ", size: 18, color: MUTED }),
                new TextRun({ children: [PageNumber.CURRENT], size: 18, color: MUTED }),
              ],
            }),
          ],
        }),
      },
      children: [
        ...titlePage,
        ...coverNote,
        ...p1,
        ...p2,
        ...p3,
        ...p4,
        ...p5Intro,
        ...p5Roles,
        ...closing,
      ],
    },
  ],
});

const out = "exports/RMONE_Mobile_Response_4_25_26.docx";
const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(out, buffer);
console.log("Wrote", out, "(" + buffer.length + " bytes)");
