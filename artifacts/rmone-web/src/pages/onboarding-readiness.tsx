import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, Gauge, RefreshCw, AlertTriangle, Loader2,
} from "lucide-react";
import { RmOneProcessing } from "@/components/CommandCentreLoader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { authHeaders } from "@/lib/api";

const API = "/api/onboarding";

type MetricStatus = "ok" | "warn" | "unavailable";

interface Metric {
  key: string;
  label: string;
  status: MetricStatus;
  value: number | null;
  total?: number | null;
  unit?: string;
  detail: string;
}

interface ReadinessResponse {
  tenantLabel: string;
  generatedAt: string;
  forecastConfidence: { score: number; breakdown: { label: string; deduction: number }[] };
  uploadedColumns?: Array<{ sheet: string; columns: Array<{ originalHeader: string; mappedTo: string }> }>;
  dataConfidence: {
    assumedTotal: number;
    byConfidence: Record<string, number>;
    note: string;
    estimatedVsValidated?: {
      estimatedCount: number;
      ratio: number | null;
      estimated: boolean;
      unavailable: boolean;
      note?: string;
    };
  };
  warnings: { code: string; label: string; reason: string }[];
  metrics: Metric[];
}

type HistoryItem = { tenantId: string; id: string };

interface AssumedRecordGroup {
  entityType: string;
  naturalKey: string;
  recordLabel: string;
  sheetName: string | null;
  fields: { fieldName: string; value: string | null; confidence?: string | null }[];
}

const ENTITY_LABELS: Record<string, string> = {
  person: "Team Member", company: "Client Company", contact: "Client Contact",
  project: "Project", opportunity: "Opportunity", assignment: "Assignment", record: "Record",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  client_provided:     "Client provided",
  system_defaulted:    "System defaulted",
  ai_inferred:         "AI inferred",
  estimated:           "Estimated",
  historical_derived:  "Historically derived",
};

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-500";
  return "text-red-600";
}

export default function OnboardingReadinessPage() {
  const [, navigate] = useLocation();

  const [clients, setClients] = useState<string[]>([]);
  const [tenant, setTenant] = useState("");
  const [data, setData] = useState<ReadinessResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [assumed, setAssumed] = useState<AssumedRecordGroup[]>([]);
  const [assumedOpen, setAssumedOpen] = useState(false);
  const [assumedLoading, setAssumedLoading] = useState(false);
  const [assumedSearch, setAssumedSearch] = useState("");
  const [assumedTier, setAssumedTier] = useState("all");

  const load = useCallback(async (t: string) => {
    if (!t.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/readiness?tenantId=${encodeURIComponent(t.trim())}`, { headers: authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any)?.error ?? `HTTP ${res.status}`);
      }
      const d = await res.json() as ReadinessResponse;
      setData(d);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);


  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/history`, { headers: authHeaders() });
        if (!res.ok) return;
        const d = await res.json() as { jobs?: HistoryItem[] } | HistoryItem[];
        const jobs = Array.isArray(d) ? d : (d.jobs ?? []);
        const names = Array.from(new Set(jobs.map(j => j.tenantId).filter(Boolean)));
        setClients(names);
        const params = new URLSearchParams(window.location.search);
        const fromUrl = params.get("tenant") ?? params.get("tenantId");
        const initial = fromUrl && names.includes(fromUrl) ? fromUrl : names[0];
        if (initial) setTenant(initial);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    if (tenant) load(tenant);
  }, [tenant, load]);

  const reviewAssumedValues = useCallback(async () => {
    setAssumedOpen(true);
    if (assumed.length > 0) return; // already loaded
    setAssumedLoading(true);
    try {
      const res = await fetch(
        `${API}/assumed?tenantId=${encodeURIComponent(tenant)}`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { records: AssumedRecordGroup[] };
      setAssumed(d.records ?? []);
    } catch {
      setAssumed([]);
    } finally {
      setAssumedLoading(false);
    }
  }, [tenant, assumed.length]);

  const score = data?.forecastConfidence.score ?? null;

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/import")}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Gauge className="w-6 h-6 text-[#6BA539]" />
            <div>
              <h1 className="text-xl font-semibold">Data Readiness</h1>
              <p className="text-sm text-muted-foreground">
                How complete and trustworthy each tenant's data is. Every number is measured from real data — gaps without a source are marked unavailable.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={tenant} onValueChange={setTenant}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select a client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" disabled={!tenant || loading} onClick={() => load(tenant)}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {!tenant && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          Select a client to view its data readiness.
        </CardContent></Card>
      )}

      {error && (
        <Card className="border-red-300">
          <CardContent className="py-6 text-red-600 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </CardContent>
        </Card>
      )}

      {loading && !data && (
        <RmOneProcessing
          label="Measuring data readiness…"
          sublabel="ANALYSING TENANT DATA"
          stages={[
            "Loading tenant record",
            "Checking project data",
            "Measuring team allocations",
            "Evaluating rate coverage",
            "Scoring forecast confidence",
          ]}
          stageIntervalMs={900}
          light
        />
      )}

      {data && (
        <div className="space-y-6">
          {/* Forecast confidence score */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gauge className="w-5 h-5" /> Forecast Confidence
              </CardTitle>
              <CardDescription>
                Based on which important columns were present in your uploaded file — missing key data groups reduce the score.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6">
                <div className={`text-5xl font-bold ${score !== null ? scoreColor(score) : ""}`}>
                  {score ?? "—"}<span className="text-2xl text-muted-foreground">/100</span>
                </div>
                <div className="flex-1">
                  <Progress value={score ?? 0} className="h-2" />
                  {data.forecastConfidence.breakdown.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                      {data.forecastConfidence.breakdown.map((b, i) => (
                        <li key={i} className="flex justify-between">
                          <span>{b.label}</span>
                          <span className="text-red-600">−{b.deduction}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-green-600">No deductions — data is fully measurable.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Warning chips */}
          {data.warnings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Active warnings</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {data.warnings.map(w => (
                  <Badge
                    key={w.code}
                    variant="outline"
                    className="border-yellow-400 bg-yellow-50 text-yellow-800 py-1.5 px-3"
                    title={w.reason}
                  >
                    <AlertTriangle className="w-3 h-3 mr-1.5" /> {w.label}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Data confidence breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Data Confidence Classification</CardTitle>
              <CardDescription>{data.dataConfidence.note}</CardDescription>
            </CardHeader>
            <CardContent>
              {data.dataConfidence.assumedTotal === 0 ? (
                <p className="text-sm text-green-600">No assumed values — all data came from the client upload.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {data.dataConfidence.assumedTotal} field values were system-filled. By confidence tier:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(data.dataConfidence.byConfidence).map(([tier, count]) => (
                      <Badge key={tier} variant="secondary" className="py-1 px-2.5">
                        {CONFIDENCE_LABELS[tier] ?? tier}: {count}
                      </Badge>
                    ))}
                  </div>
                  {data.dataConfidence.estimatedVsValidated && (() => {
                    const ev = data.dataConfidence.estimatedVsValidated!;
                    return (
                      <p className="text-sm text-muted-foreground pt-1">
                        Estimated vs validated:{" "}
                        {ev.unavailable || ev.ratio === null ? (
                          <span title={ev.note ?? "A full validated-vs-total ratio requires a client-provided field count, which is not stored."}>
                            N/A
                          </span>
                        ) : (
                          <span
                            className={ev.estimated ? "cursor-help underline decoration-dotted" : undefined}
                            title={ev.estimated ? (ev.note ?? "Estimated using the count of measured records as the denominator — not an exact validated total.") : undefined}
                          >
                            {Math.round(ev.ratio * 100)}% estimated{ev.estimated ? " *" : ""}
                          </span>
                        )}
                      </p>
                    );
                  })()}
                  <div className="pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5 border-sky-400/60 text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:border-sky-500/50 dark:hover:bg-sky-900/20"
                      onClick={reviewAssumedValues}
                    >
                      Review assumed values
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Uploaded Columns */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Uploaded Columns</CardTitle>
              <CardDescription>
                Columns detected in your uploaded file and how they were mapped to RM ONE fields.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!data.uploadedColumns || data.uploadedColumns.length === 0 ? (
                <p className="text-sm text-muted-foreground">No file has been uploaded yet for this tenant.</p>
              ) : (
                <div className="space-y-5">
                  {data.uploadedColumns.map(sheet => (
                    <div key={sheet.sheet}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                        {sheet.sheet}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                        {sheet.columns.map(col => (
                          <div key={col.originalHeader} className="flex items-center gap-2 text-sm">
                            <span className="text-foreground truncate flex-1">{col.originalHeader}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="text-[#6BA539] font-medium truncate flex-1">{col.mappedTo}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground text-right">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
      )}

      {/* ── Assumed values popup ─────────────────────────────────────────── */}
      <Dialog open={assumedOpen} onOpenChange={(o) => { setAssumedOpen(o); if (!o) { setAssumedSearch(""); setAssumedTier("all"); } }}>
        <DialogContent className="max-w-3xl w-full max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-500">
              <AlertTriangle className="w-4 h-4" /> System-filled (assumed) values
            </DialogTitle>
            <DialogDescription>
              These fields were blank in your file. The wizard filled each with a sensible default so the import could complete.
              Correct them by re-importing updated data on the Import Data tab.
            </DialogDescription>
          </DialogHeader>

          {assumedLoading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!assumedLoading && assumed.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">No assumed values recorded for this tenant.</p>
          )}

          {!assumedLoading && assumed.length > 0 && (() => {
            const tiers = Array.from(new Set(assumed.flatMap(r => r.fields.map(f => f.confidence ?? "system_defaulted")))).sort();
            const q = assumedSearch.trim().toLowerCase();
            const filtered = assumed
              .map(rec => ({
                ...rec,
                fields: rec.fields.filter(f => {
                  const tierOk = assumedTier === "all" || (f.confidence ?? "system_defaulted") === assumedTier;
                  const qOk = !q
                    || (rec.recordLabel || rec.naturalKey).toLowerCase().includes(q)
                    || f.fieldName.toLowerCase().includes(q)
                    || (f.value ?? "").toLowerCase().includes(q);
                  return tierOk && qOk;
                }),
              }))
              .filter(rec => rec.fields.length > 0);

            return (
              <div className="flex flex-col gap-2 overflow-hidden flex-1">
                <div className="flex flex-wrap items-center gap-2 border-b pb-2">
                  <input
                    type="text"
                    value={assumedSearch}
                    onChange={e => setAssumedSearch(e.target.value)}
                    placeholder="Search record, field or value…"
                    className="flex-1 min-w-[180px] h-8 rounded-md border bg-background px-2.5 text-xs"
                  />
                  <select
                    value={assumedTier}
                    onChange={e => setAssumedTier(e.target.value)}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="all">All tiers</option>
                    {tiers.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {filtered.reduce((n, r) => n + r.fields.length, 0)} value{filtered.reduce((n, r) => n + r.fields.length, 0) === 1 ? "" : "s"} across {filtered.length} record{filtered.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="overflow-auto flex-1 space-y-2.5 pr-1">
                  {filtered.length === 0 && (
                    <p className="text-sm text-muted-foreground py-6 text-center">No assumed values match your filter.</p>
                  )}
                  {filtered.map(rec => (
                    <div key={`${rec.entityType}::${rec.naturalKey}`} className="rounded-lg border bg-background px-3 py-2.5">
                      <div className="flex items-center gap-2 mb-1.5 text-sm">
                        <span className="font-medium text-foreground">{rec.recordLabel || rec.naturalKey}</span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground border rounded px-1.5 py-0.5">
                          {ENTITY_LABELS[rec.entityType] ?? rec.entityType}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {rec.fields.map(f => (
                          <div key={f.fieldName} className="flex items-center justify-between gap-2 rounded bg-amber-500/5 border border-amber-500/20 px-2.5 py-1 text-xs">
                            <span className="text-muted-foreground truncate shrink-0">{f.fieldName}</span>
                            <span className="font-medium text-foreground truncate text-right">{f.value ?? "—"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

    </div>
  );
}
