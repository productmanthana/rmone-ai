import { useEffect, useMemo, useRef, useState } from "react";
import { getDepartments, getJobTitles, saveJobTitleCostRate, downloadRateCard, importRateCard, type JobTitleRow } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Download, Upload, Loader2 } from "lucide-react";

const BRAND_GREEN = "#6BA539";

type DeptRow = Record<string, unknown>;

function pickDeptId(d: DeptRow): number {
  return Number(d.Id ?? d.ID ?? d.DepartmentId ?? d.DepartmentID ?? 0);
}
function pickDeptName(d: DeptRow): string {
  return String(d.Name ?? d.DepartmentName ?? d.Title ?? d.ShortName ?? "—");
}

export default function RateCardPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const [depts, setDepts] = useState<DeptRow[]>([]);
  const [titles, setTitles] = useState<JobTitleRow[]>([]);
  const [deptId, setDeptId] = useState<number | null>(null);
  const [rates, setRates] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getDepartments(), getJobTitles()])
      .then(([d, t]) => {
        if (!alive) return;
        const drows = (d as DeptRow[]).filter(r => pickDeptId(r) > 0);
        setDepts(drows);
        setTitles(t);
        setDeptId(drows[0] ? pickDeptId(drows[0]) : null);
      })
      .catch((e) => toast({ title: "Failed to load", description: String(e), variant: "destructive" }))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [toast]);

  useEffect(() => { setRates({}); }, [deptId]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return titles
      .filter(t => !q || (t.JobTitleName ?? t.Title ?? "").toLowerCase().includes(q) || (t.RoleName ?? "").toLowerCase().includes(q))
      .sort((a, b) => (a.JobTitleName ?? a.Title).localeCompare(b.JobTitleName ?? b.Title));
  }, [titles, filter]);

  async function save(jobTitle: JobTitleRow) {
    if (!deptId) return;
    const raw = rates[jobTitle.ID] ?? "";
    const value = Number(raw);
    if (!raw || Number.isNaN(value) || value < 0) {
      toast({ title: "Enter a valid rate", description: "Cost rate must be a non-negative number.", variant: "destructive" });
      return;
    }
    setSavingId(jobTitle.ID);
    try {
      const r = await saveJobTitleCostRate({
        JobTitleId: jobTitle.ID,
        DepartmentId: deptId,
        EmpCostRate: value,
      });
      toast({ title: r?.success ? "Saved" : "Saved", description: `${jobTitle.JobTitleName ?? jobTitle.Title} → $${value.toFixed(2)}/hr` });
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadRateCard();
      toast({
        title: "Rate Card downloaded",
        description: "Open the file, fill in Division / Department columns if needed, edit the green rate columns, then upload it back.",
      });
    } catch (e) {
      toast({ title: "Download failed", description: String(e), variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const result = await importRateCard(file);
      const parts: string[] = [];
      if (result.created  > 0) parts.push(`${result.created} new role${result.created  !== 1 ? "s" : ""} created`);
      if (result.saved    > 0) parts.push(`${result.saved} rate${result.saved    !== 1 ? "s" : ""} updated`);
      if (result.skipped  > 0) parts.push(`${result.skipped} row${result.skipped  !== 1 ? "s" : ""} skipped`);
      const summary = parts.length ? parts.join(", ") + "." : "Nothing changed.";
      const errDesc = result.errors.length > 0
        ? `${summary} Errors: ${result.errors.slice(0, 3).join("; ")}${result.errors.length > 3 ? ` …and ${result.errors.length - 3} more` : ""}`
        : summary;
      toast({
        title: (result.saved > 0 || result.created > 0) ? "Import complete" : "Nothing changed",
        description: errDesc,
        variant: result.errors.length > 0 ? "destructive" : "default",
      });
      // Refresh the visible list so imported rates appear immediately —
      // importRateCard already busted the caches, so this fetch is fresh.
      if (result.saved > 0 || result.created > 0) {
        try {
          const t = await getJobTitles();
          setTitles(t);
          setRates({});
        } catch { /* list refresh is best-effort; caches are already busted */ }
      }
    } catch (e) {
      toast({ title: "Import failed", description: String(e), variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className={embedded ? "" : "p-6 max-w-5xl mx-auto"} style={{ color: "var(--rm-text)" }}>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-1">
        <div>
          {!embedded && <h1 className="text-[22px] font-semibold">Rate Card</h1>}
          <p className="text-[13px] mt-0.5" style={{ color: "var(--rm-text-muted)" }}>
            Set the standard hourly cost rate for each job title within a department.
            Saved values flow to project budgets the next time a member is added.
          </p>
        </div>

        {/* Download + Import buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors"
            style={{
              borderColor: "var(--rm-panel-border)",
              backgroundColor: "var(--rm-panel-soft)",
              color: "var(--rm-text)",
            }}
            title="Download all roles and current rates as Excel. Fill in Division / Department columns for filtering, edit rates, then upload back."
          >
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Download Rate Card
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors"
            style={{
              backgroundColor: BRAND_GREEN,
              color: "white",
              opacity: importing ? 0.7 : 1,
            }}
            title="Upload a filled-in Rate Card Excel to bulk-update all rates in one go."
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Import Rates
          </button>
        </div>
      </div>

      {/* How-to tip */}
      <div
        className="rounded-lg px-4 py-2.5 mb-5 text-[12px] leading-5"
        style={{
          backgroundColor: "var(--rm-green-soft)",
          border: "1px solid rgba(107,165,57,0.25)",
          color: "var(--rm-text-muted)",
        }}
      >
        <span style={{ color: BRAND_GREEN, fontWeight: 600 }}>Bulk editing:</span>{" "}
        Click <b>Download Rate Card</b> to get an Excel with all roles and current rates pre-filled.
        The file has two tabs — read the <b>Instructions</b> tab first. Fill in the optional
        <b> Division</b> and <b>Department</b> columns to filter and organise rows, edit the
        green rate columns (Billing / Labor / Cost), then click <b>Import Rates</b> to apply all
        changes in one go. Only rows where you enter a value are updated.
      </div>

      {/* Department filter + search */}
      <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: "var(--rm-panel)", border: "1px solid var(--rm-panel-border)" }}>
        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-[12px] uppercase tracking-wider" style={{ color: "var(--rm-text-muted)" }}>Department</label>
          <select
            value={deptId ?? ""}
            onChange={(e) => setDeptId(Number(e.target.value) || null)}
            className="rounded-md px-3 py-1.5 text-[13px] border"
            style={{ borderColor: "var(--rm-panel-border)", color: "var(--rm-text)", background: "var(--rm-panel-soft)", minWidth: 240 }}
            data-testid="rate-card-dept-select"
          >
            {depts.map((d) => {
              const id = pickDeptId(d);
              return <option key={id} value={id} style={{ backgroundColor: "var(--rm-panel)" }}>{pickDeptName(d)}</option>;
            })}
          </select>
          <input
            type="search"
            placeholder="Filter job titles…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-md px-3 py-1.5 text-[13px] border ml-auto"
            style={{ borderColor: "var(--rm-panel-border)", color: "var(--rm-text)", background: "var(--rm-panel-soft)", minWidth: 220 }}
            data-testid="rate-card-filter"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "var(--rm-panel)", border: "1px solid var(--rm-panel-border)" }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ backgroundColor: "var(--rm-panel-soft)", color: "var(--rm-text-muted)" }}>
              <th className="text-left px-4 py-2 font-medium">Job Title</th>
              <th className="text-left px-4 py-2 font-medium">Role</th>
              <th className="text-left px-4 py-2 font-medium">Type</th>
              <th className="text-right px-4 py-2 font-medium">Cost rate ($/hr)</th>
              <th className="px-4 py-2" style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center" style={{ color: "var(--rm-text-faint)" }}>Loading…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center" style={{ color: "var(--rm-text-faint)" }}>No job titles match.</td></tr>
            )}
            {filtered.map((t, i) => {
              const draft = rates[t.ID] ?? "";
              const busy = savingId === t.ID;
              return (
                <tr key={t.ID} style={{ borderTop: i === 0 ? "none" : "1px solid var(--rm-panel-border)" }}>
                  <td className="px-4 py-2.5">{t.JobTitleName ?? t.Title}</td>
                  <td className="px-4 py-2.5" style={{ color: "var(--rm-text-muted)" }}>{t.RoleName ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className="inline-block rounded px-2 py-0.5 text-[11px]"
                      style={{
                        color: t.JobType === "Billable" ? BRAND_GREEN : "#E87722",
                        backgroundColor: t.JobType === "Billable" ? "rgba(107,165,57,0.12)" : "rgba(232,119,34,0.12)",
                      }}
                    >
                      {t.JobType ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={draft}
                      onChange={(e) => setRates(prev => ({ ...prev, [t.ID]: e.target.value }))}
                      onBlur={() => { if (draft) save(t); }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      className="w-28 text-right rounded-md px-2 py-1 border"
                      style={{ borderColor: "var(--rm-panel-border)", color: "var(--rm-text)", background: "var(--rm-panel-soft)" }}
                      disabled={busy || !deptId}
                      data-testid={`rate-input-${t.ID}`}
                    />
                  </td>
                  <td className="px-4 py-2 text-right text-[11px]" style={{ color: "var(--rm-text-faint)" }}>
                    {busy ? "Saving…" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
