# RM ONE — Analytics Center: Full Requirements Capture
(Everything the client asked for — nothing left out. Source: client email + Key Outcomes doc + LiRo/GEI analysis workbook + old-platform screenshot.)

## Product context
RM ONE ("Operational Intelligence") is a resource-management platform for large construction/engineering firms (LiRo, GEI). Dark navy UI (#253746) with green accent (#6BA539), font Inter. The client's OLD platform had an analytics hub: a grid of dashboard cards (Executive, Staff, Financial, Resource, Project, Recruitment, Utilization, Bench), each card a mini preview that opens a full dashboard. We are designing the RM ONE version of that hub plus every inner page.

## 0. MAIN HUB PAGE — "Analytics Center"
- One entry page with 9 dashboard cards in a grid, each card shows a LIVE mini-chart (not a static thumbnail) + title + one key number.
- Cards: Executive, Financial, Project, Staff, Resource, Utilization, Bench, Open Positions & Demand, Usage Analytics (admin-only badge).
- Permission-aware hint: Financial card marked "Financial access", Usage card marked "Admin".
- Tenant context: viewing as LiRo (tenant switcher hint for superadmin: LiRo / GEI).

## 1. FINANCIAL ANALYTICS (the client's 5 requested metrics — ANNUALIZED)
Client's exact ask: "financial health of the company, annualized numbers":
1. Contract Revenue (Backlog) — total value of approved contracts
2. Total Contracted Labor Hours & Dollars
3. Total Allocated Labor Hours & Dollars
4. Job Chargeable Cost
5. Non-Job Chargeable Cost
Notes that must be visible in the design:
- Annualization basis selector (Trailing 12 months / Fiscal YTD / Run-rate) — client hasn't chosen yet.
- Costs are PLANNED (from allocations × cost rates) — label clearly "Planned"; no timesheet actuals exist.
- Supporting views: backlog by sector/division, contracted vs allocated (hours and dollars), chargeable vs non-chargeable split, trend over months.
- Realistic anchor data (LiRo-scale): Backlog ≈ $148M, Contracted Labor ≈ 1.24M hrs / $96.5M, Allocated ≈ 1.08M hrs / $84.2M (87% coverage), Job Chargeable ≈ $71.9M, Non-Job Chargeable ≈ $12.3M (14.6%).

## 2. USAGE ANALYTICS (client's full wishlist — every item must appear)
REAL numbers from the client's own analysis workbook (Jun 15 – Jul 16, 2026, 5 weeks) — use these, not invented ones:
- Enabled 2,401 (LiRo 530 · GEI 1,871); Managers 465 (35 · 430); Active 160 (53 · 107); Adoption 6.7% (LiRo 10.0% · GEI 5.7%)
- Human transactions 15,429 (9,981 · 5,448); Page visits 10,381 (6,097 · 4,284); Total projects 10,364 (804 · 9,560)
- Cross-tenant layout: tabs All Tenants / LiRo / GEI; every KPI shows the per-tenant split
- Top features (LiRo · GEI page visits): ManagerViewGantt 521 · 3,472; WeeklyTeamTab 1,514 · 56; PMMProjects 1,512 · 17; RMM 986 · 132; least-used: Opportunity 0 · 11, PMM 0 · 3
- System events: LiRo 937 vs GEI 8,021 (nearly half of GEI activity is automated)
- Portfolio status: LiRo 623 active / 71 closed / 110 not-set; GEI 0 active / 1,091 closed / 8,469 not-set (data-quality signal)
Wishlist items:
- Enabled users, onboarded users, ACTIVE users, adoption %
- Usage by company (LiRo vs GEI), business unit, division, department, role
- Weekly AND monthly activity trends (WAU line)
- Login frequency; page visits per module
- Most used modules AND least used modules (least-used must show zeros)
- Transactions by type (allocations edited, hours saved, imports, records created…)
- Users/groups that may need training (low-engagement list)
- Human vs system/integration/admin activity split
- Usage linked to outcomes (e.g. "allocation edits → faster staffing") — mark as "Phase 2"
- Admin-only page.

## 3. OPEN POSITIONS & DEMAND (replaces old "Recruitment Analytics" — no hiring data exists)
- Open positions = demand rows with no person assigned
- By role (bar), by BU/division (bar/pie), aging buckets (how long open)
- Demand vs supply hours over coming weeks (line)
- Total unstaffed hours + most affected projects list
- Framing: "who do we need to hire and how urgently"

## 4. EXECUTIVE ANALYTICS
- Portfolio at a glance: active projects, pipeline value, win rate, backlog, staff deployed
- Records by status, projects by division, health indicators
(this page exists today — modernized card design consistent with the rest)

## 5. PROJECT ANALYTICS
- Projects by status/stage, by sector, by division; cycle time (created→closed); schedule health; overdue list

## 6. STAFF ANALYTICS
- Headcount by BU/division/department, roles mix, employment types, joiners/leavers style trend, top titles

## 7. RESOURCE ANALYTICS
- Allocation coverage, hours by phase, weekly allocated hours trend, top allocated roles/people, conflicts count

## 8. UTILIZATION ANALYTICS
- Company utilization %, by division, over/under-allocated people counts, threshold bands (target vs actual), heat list

## 9. BENCH ANALYTICS
- Bench count now + trend, bench by role/division, average bench duration, upcoming roll-offs (next 4 weeks), redeployment candidates

## Design mandates (all pages)
- RM ONE dark theme via ../analytics-center/_group.css tokens; Inter font; green #6BA539 as the primary accent; no emojis.
- Dense, executive-grade dashboards — every pixel earns its place; realistic data everywhere (never lorem ipsum).
- Each inner page carries a compact header: "Analytics Center / <Page name>", tenant "LiRo", and a date-range hint.
- Charts: use recharts (shadcn chart is pre-installed in the sandbox).
