# WOW-STYLE.md — Mission Control rollout guide (chosen by client)

The client chose the "Mission Control" direction (see ExecutiveWowMission.tsx — the style SOURCE OF TRUTH)
with three refinements that OVERRIDE anything else:

1. **Variety between cards/pages** — do NOT repeat the same card treatment everywhere. Each page leads with a
   DIFFERENT hero device (assigned below). Within a page, mix treatments: glass stat cards, radial gauges,
   ranked lists, ticker strips, progress bars — not a uniform grid of identical panels.
2. **Plain language for non-technical people** — every section carries a one-line plain-English takeaway
   (e.g. "We have 9.6 months of signed work in the bank"). Labels avoid jargon; where a technical term is
   unavoidable, add a quiet subtitle explaining it. Numbers are BIG and readable.
3. **FEWER charts** — max 2-3 charts per page, only where a trend/comparison genuinely needs one.
   Everything else becomes big stat cards, gauges, ranked lists with inline bars, or callout strips.
   NEVER drop data the client asked for — when a chart is removed, its data stays as numbers/lists.

## Style kit (from ExecutiveWowMission.tsx — reuse these patterns)
- Dark navy world via ./_group.css tokens, root className "rmone-analytics min-h-screen". Green #6BA539 leads.
- Hero band: one oversized gradient-clipped numeral (60-80px) with a soft glowing gradient area chart behind/underneath.
- Radial SVG arc gauges with glow tips + big center number for % metrics.
- Glass panels: layered rgba gradients, 1px green→transparent gradient borders, soft shadows, faint radial vignette background.
- Ticker strip: thin row of micro-stats with ▲▼ delta chips (green/orange).
- Charts (the few kept): gradient fills fading to transparent, glow on the line, value labels. recharts + inline SVG only, no new deps.
- Inter, uppercase 10px labels, tabular-nums, NO emojis. 1440px wide; taller than 900px is fine.

## Per-page hero device (variety mandate)
- Hub: NO charts. Status ticker + one glowing headline stat + page-link glass tiles, each tile a different micro-treatment (mini gauge / delta chip / spark).
- ExecutiveAnalytics: refined Mission hero (backlog $148.2M + 3 gauges) but trim to ≤3 charts; funnel becomes a chunky labeled step bar; coverage stats = plain-language callout cards.
- FinancialAnalytics: hero = the client's 5 metrics as large varied stat cards (one accent-gradient card); ONE supporting trend chart. Keep annualization selector + "Planned" labels + all 5 metrics.
- UsageAnalytics: hero = big adoption gauge (6.7%) + tenant tabs (All/LiRo/GEI); keep LiRo-vs-GEI weekly trend chart + top-features paired bars; everything else = stat rows/lists. KEEP ALL REAL NUMBERS (2,401 / 465 / 160 / 15,429 / 10,381 / 10,364, portfolio status, system-vs-human insight, partial-week note).
- OpenPositionsDemand: hero = "55 open positions · ≈$1.64M at risk" callout with urgency ring; keep demand-vs-supply as THE chart; 3/6/9-month outlook table + win scenarios stay (they are tables, not charts).
- ProjectAnalytics: hero = schedule-health arc gauge; ranked at-risk project list with inline bars; ≤2 charts.
- StaffAnalytics: hero = big staff-deployed numeral with glowing spark; org distribution as ranked list; ≤2 charts.
- ResourceAnalytics: hero = ONE capacity-vs-demand glowing chart as the centerpiece; rest = plain callouts.
- UtilizationAnalytics: hero = utilization gauge against benchmark bands (A&E median ~61%, all-staff 60-65%, technical 75-90% — keep these); ≤2 charts.
- BenchAnalytics: hero = bench % gauge + "who is free next" ranked list; ≤1-2 charts.

## Rules
- Edit each page file IN PLACE (frames already point at them). Do not rename files or exports.
- Keep every client-required data point (see REQUIREMENTS.md). Same numbers as today.
- Verify each page using the configured mockup preview host at `/__mockup/preview/analytics-center/<Component>` — full render, no clipping, no console errors.
