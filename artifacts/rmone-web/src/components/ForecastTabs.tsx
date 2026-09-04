// ─────────────────────────────────────────────────────────────────────────────
// ForecastTabs — one "Actuals vs Forecast" destination with three tabs.
//
// The three forecast surfaces (per-project graph, hours & costs report,
// executive portfolio) used to be three separate top-nav entries. They are now
// ONE nav destination; this strip switches between them by navigating to the
// original routes, so every historical deep link (e.g. /actuals-forecast?ticket=…
// from the executive popup's "Full report" link) keeps working unchanged and
// each tab remains its own lazy build chunk (wrapped via App.tsx's lazyPage).
//
// Tab clicks navigate to the BARE path on purpose — query params like ?ticket=
// belong to the tab they were minted for and must not leak into a sibling tab.
// ─────────────────────────────────────────────────────────────────────────────
import { Suspense, type ReactNode } from "react";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";

export type ForecastTabKey = "graph" | "report" | "portfolio";

const TABS: { key: ForecastTabKey; path: string; label: string; sub: string }[] = [
  { key: "graph",     path: "/actuals-forecast",   label: "Project Graph",       sub: "One project over time" },
  { key: "report",    path: "/forecast-report",    label: "Forecast Report",     sub: "Hours & costs by project" },
  { key: "portfolio", path: "/executive-forecast", label: "Executive Portfolio", sub: "All projects at a glance" },
];

export default function ForecastTabs({ tab, children }: { tab: ForecastTabKey; children: ReactNode }) {
  return (
    <div>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "14px 24px 0" }}>
        <div
          role="tablist"
          aria-label="Actuals vs Forecast views"
          style={{ display: "flex", gap: 2, borderBottom: "1px solid hsl(var(--border))", flexWrap: "wrap" }}
        >
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <Link
                key={t.key}
                href={t.path}
                role="tab"
                aria-selected={active}
                title={t.sub}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "9px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                  borderBottom: active ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
      {/* Inner Suspense boundary: each tab is its own lazy chunk, and without
          this the nearest boundary sits ABOVE the route switch in App.tsx —
          a loading chunk would unmount the strip itself. With it, the tabs
          stay visible (and clickable) while a tab's chunk downloads; the
          outer boundary remains as a safety net. */}
      <Suspense
        fallback={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "80px 0",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            <Loader2 size={22} className="animate-spin" aria-label="Loading view" />
          </div>
        }
      >
        {children}
      </Suspense>
    </div>
  );
}
