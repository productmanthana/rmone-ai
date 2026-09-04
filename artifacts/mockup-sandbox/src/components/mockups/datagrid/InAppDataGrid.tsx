import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";

// ── Template columns (the "pre-template") ─────────────────────────────────
const COLUMNS = [
  { key: "projectTitle", label: "Project Title",   w: 220 },
  { key: "company",      label: "Company",          w: 160 },
  { key: "status",       label: "Status",            w: 110 },
  { key: "bu",           label: "Business Unit",    w: 140 },
  { key: "pm",           label: "Project Manager",  w: 160 },
  { key: "startDate",    label: "Start Date",       w: 110 },
  { key: "endDate",      label: "End Date",          w: 110 },
  { key: "value",        label: "Contract Value",   w: 130 },
];

const SKIP = "__skip__";

type Row    = Record<string, string>;
type ColKey = typeof COLUMNS[number]["key"] | typeof SKIP;

const STATUS_OPTIONS = ["Active", "On Hold", "Complete", "Pending", "Cancelled"];
const STATUS_COLORS: Record<string, string> = {
  Active:    "bg-green-100 text-green-700",
  "On Hold": "bg-yellow-100 text-yellow-700",
  Complete:  "bg-blue-100 text-blue-700",
  Pending:   "bg-gray-100 text-gray-600",
  Cancelled: "bg-red-100 text-red-600",
};

// ── Synonym-based auto-mapping ─────────────────────────────────────────────
const SYNONYMS: Record<string, string[]> = {
  projectTitle: ["project title","project name","name","title","project","job name","job title"],
  company:      ["company","client","company name","client name","organization","organisation","firm","owner","customer"],
  status:       ["status","project status","state","phase"],
  bu:           ["business unit","bu","division","department","dept","practice","studio","sector","unit"],
  pm:           ["project manager","pm","manager","project lead","lead","responsible","project officer","pm name"],
  startDate:    ["start date","start","begin date","commencement","kick off","kickoff","date start","from"],
  endDate:      ["end date","end","finish date","completion date","due date","completion","finish","target end","to"],
  value:        ["contract value","value","amount","contract amount","budget","fee","contract fee","total","price"],
};

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function autoMap(header: string): ColKey {
  const n = norm(header);
  for (const [key, syns] of Object.entries(SYNONYMS)) {
    if (syns.some(s => {
      const sn = norm(s);
      return sn === n || n.includes(sn) || sn.includes(n);
    })) return key;
  }
  return SKIP;
}

// ── Pre-loaded template rows (sample data) ────────────────────────────────
const TEMPLATE_ROWS: Row[] = [
  { projectTitle:"Downtown Rail Extension — Phase 2", company:"Metro Transit Authority",    status:"Active",  bu:"Civil & Transit",   pm:"Lisa Chen",    startDate:"2024-03-01", endDate:"2026-09-30", value:"$48,500,000"  },
  { projectTitle:"Surgical Wing Expansion",            company:"City General Hospital",      status:"Active",  bu:"Healthcare Studio", pm:"Tom Williams", startDate:"2024-06-15", endDate:"2025-12-31", value:"$22,750,000"  },
  { projectTitle:"Riverside Civic Centre Renovation",  company:"Riverside Municipality",     status:"On Hold", bu:"Civic & Culture",   pm:"James Norton", startDate:"2024-01-10", endDate:"2025-06-30", value:"$9,200,000"   },
  { projectTitle:"Harborview Mixed-Use Tower",         company:"Harborview Development LLC", status:"Active",  bu:"Commercial RE",     pm:"Tom Williams", startDate:"2023-11-01", endDate:"2026-03-31", value:"$134,000,000" },
  { projectTitle:"Tier-4 Data Centre Build",           company:"NexGen Cloud Corp",          status:"Pending", bu:"Technology",        pm:"Priya Sharma", startDate:"2025-01-15", endDate:"2026-08-31", value:"$67,300,000"  },
  { projectTitle:"Highway 9 Bridge Replacement",       company:"State DOT",                  status:"Active",  bu:"Civil & Transit",   pm:"Priya Sharma", startDate:"2024-09-01", endDate:"2027-04-30", value:"$31,800,000"  },
];

// ── Cell ──────────────────────────────────────────────────────────────────
function Cell({ value, colKey, isEditing, onStartEdit, onCommit, colW }: {
  value: string; colKey: string; isEditing: boolean;
  onStartEdit: () => void; onCommit: (v: string) => void; colW: number;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  const handleFocus = useCallback(() => {
    onStartEdit(); setDraft(value);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [value, onStartEdit]);

  if (isEditing && colKey === "status") {
    return (
      <td className="border border-blue-400 ring-2 ring-blue-300 ring-inset p-0" style={{ width: colW, minWidth: colW }}>
        <select ref={inputRef as React.RefObject<HTMLSelectElement>} autoFocus
          className="w-full h-full px-2 py-1 text-xs bg-white outline-none"
          value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => onCommit(draft)}>
          {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
        </select>
      </td>
    );
  }
  if (isEditing) {
    return (
      <td className="border border-blue-400 ring-2 ring-blue-300 ring-inset p-0" style={{ width: colW, minWidth: colW }}>
        <input ref={inputRef as React.RefObject<HTMLInputElement>} autoFocus
          className="w-full h-full px-2 py-1 text-xs bg-white outline-none"
          value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => onCommit(draft)}
          onKeyDown={e => { if (e.key==="Enter"||e.key==="Tab") onCommit(draft); if (e.key==="Escape") onCommit(value); }} />
      </td>
    );
  }
  const badge = colKey === "status" ? STATUS_COLORS[value] : null;
  return (
    <td className="border border-gray-200 px-2 py-1 text-xs cursor-cell hover:bg-blue-50 select-none"
      style={{ width: colW, minWidth: colW, maxWidth: colW }}
      onDoubleClick={handleFocus} onClick={handleFocus}>
      {badge
        ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge}`}>{value}</span>
        : <span className="truncate block">{value}</span>}
    </td>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
type ParsedFile = { name: string; headers: string[]; dataRows: Record<string,string>[] };
type Mode = "grid" | "mapping";
type Toast = { msg: string; ok: boolean };

export function InAppDataGrid() {
  const [rows,     setRows]    = useState<Row[]>(TEMPLATE_ROWS);
  const [editing,  setEditing] = useState<{ row: number; col: string } | null>(null);
  const [selected, setSelected]= useState<Set<number>>(new Set());
  const [saved,    setSaved]   = useState(false);
  const [toast,    setToast]   = useState<Toast | null>(null);
  const [uploading,setUploading]= useState(false);

  // ── Mapping wizard state
  const [mode,      setMode]     = useState<Mode>("grid");
  const [parsed,    setParsed]   = useState<ParsedFile | null>(null);
  const [mappings,  setMappings] = useState<Record<string, ColKey>>({});

  const fileRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Grid helpers ──────────────────────────────────────────────────────
  const handleCommit = (ri: number, ck: string, val: string) => {
    setRows(prev => prev.map((r,i) => i===ri ? { ...r, [ck]: val } : r));
    setEditing(null);
  };
  const addRow = () => {
    setRows(prev => [...prev, { projectTitle:"", company:"", status:"Pending", bu:"", pm:"", startDate:"", endDate:"", value:"" }]);
    setEditing({ row: rows.length, col: "projectTitle" });
  };
  const deleteSelected = () => {
    if (!selected.size) return;
    setRows(prev => prev.filter((_,i) => !selected.has(i)));
    setSelected(new Set());
  };
  const toggleSelect = (i: number) => setSelected(prev => {
    const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s;
  });
  const handleSave = () => { setSaved(true); showToast("Changes saved to database"); };
  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
      "Project Title": r.projectTitle, "Company": r.company, "Status": r.status,
      "Business Unit": r.bu, "Project Manager": r.pm,
      "Start Date": r.startDate, "End Date": r.endDate, "Contract Value": r.value,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Projects");
    XLSX.writeFile(wb, "projects_export.xlsx");
    showToast("Exported to Excel");
  };

  // ── File upload → mapping wizard ──────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf, { type: "array", cellText: true, cellDates: true });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string,unknown>>(ws, { defval: "", raw: false });
      if (!raw.length) { showToast("File is empty — nothing to import", false); return; }

      const headers  = Object.keys(raw[0]);
      const dataRows = raw.map(r => {
        const out: Record<string,string> = {};
        for (const h of headers) out[h] = String(r[h] ?? "").trim();
        return out;
      });

      // Auto-map each header
      const initMap: Record<string, ColKey> = {};
      for (const h of headers) initMap[h] = autoMap(h);

      setParsed({ name: file.name, headers, dataRows });
      setMappings(initMap);
      setMode("mapping");
    } catch {
      showToast("Could not read file — use .xlsx, .xls or .csv", false);
    } finally {
      setUploading(false);
    }
  };

  // ── Confirm mapping → fill grid ───────────────────────────────────────
  const confirmImport = () => {
    if (!parsed) return;
    const newRows: Row[] = parsed.dataRows.map(dr => {
      const row: Row = { projectTitle:"", company:"", status:"Pending", bu:"", pm:"", startDate:"", endDate:"", value:"" };
      for (const [h, key] of Object.entries(mappings)) {
        if (key !== SKIP) row[key] = dr[h] ?? "";
      }
      return row;
    });
    setRows(newRows);
    setSelected(new Set());
    setSaved(false);
    setMode("grid");
    const mapped   = Object.values(mappings).filter(v => v !== SKIP).length;
    const skipped  = Object.values(mappings).filter(v => v === SKIP).length;
    showToast(`${newRows.length} rows imported · ${mapped} column${mapped!==1?"s":""} mapped${skipped ? ` · ${skipped} skipped` : ""}`);
  };

  // ── Mapping wizard view ───────────────────────────────────────────────
  if (mode === "mapping" && parsed) {
    const previewRows = parsed.dataRows.slice(0, 3);
    const usedKeys    = Object.values(mappings).filter(v => v !== SKIP);
    const dupKeys     = usedKeys.filter((k, i) => usedKeys.indexOf(k) !== i);

    return (
      <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-indigo-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <div>
              <span className="font-semibold text-gray-800 text-sm">Map columns</span>
              <span className="text-gray-400 text-xs ml-2">— {parsed.name}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setMode("grid")}
              className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition">
              Cancel
            </button>
            <button
              onClick={confirmImport}
              disabled={dupKeys.length > 0}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 transition font-medium shadow-sm disabled:opacity-40"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Import {parsed.dataRows.length} rows
            </button>
          </div>
        </div>

        {/* Instruction */}
        <div className="px-6 py-3 bg-indigo-50 border-b border-indigo-100 text-xs text-indigo-700 flex items-start gap-2">
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            We auto-matched each column in <strong>{parsed.name}</strong> to a template field.
            Review the mapping below — change any that look wrong, or mark columns you don't need as <em>Skip</em>.
            Sample values from your file are shown to help you decide.
          </span>
        </div>

        {/* Mapping table */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {dupKeys.length > 0 && (
            <div className="mb-3 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Some template fields are mapped more than once. Each field can only be used once — please adjust the duplicates.
            </div>
          )}

          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            {/* Column header row */}
            <div className="grid grid-cols-[2fr_3fr_2fr] text-xs font-semibold text-gray-500 bg-gray-50 border-b border-gray-200 px-4 py-2.5 gap-4">
              <span>Your file column</span>
              <span>Sample values from your file</span>
              <span>Maps to (template field)</span>
            </div>

            {parsed.headers.map((h, hi) => {
              const mapped = mappings[h] ?? SKIP;
              const samples = previewRows.map(r => r[h]).filter(Boolean);
              const isDup   = mapped !== SKIP && usedKeys.filter(k => k === mapped).length > 1;
              const isSkipped = mapped === SKIP;

              return (
                <div
                  key={h}
                  className={`grid grid-cols-[2fr_3fr_2fr] items-center gap-4 px-4 py-3 text-xs border-b border-gray-100 last:border-b-0 transition-colors
                    ${isDup     ? "bg-red-50"    : ""}
                    ${isSkipped ? "opacity-50"   : ""}
                    ${!isDup && !isSkipped && hi % 2 === 0 ? "bg-white" : !isDup && !isSkipped ? "bg-gray-50/50" : ""}`}
                >
                  {/* File column name */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                    <span className="font-medium text-gray-700 truncate">{h}</span>
                  </div>

                  {/* Sample values */}
                  <div className="min-w-0">
                    {samples.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {samples.slice(0, 3).map((s, si) => (
                          <span key={si} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] truncate max-w-[120px]">
                            {s}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-300 italic">no sample data</span>
                    )}
                  </div>

                  {/* Mapping dropdown */}
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                    <select
                      value={mapped}
                      onChange={e => setMappings(prev => ({ ...prev, [h]: e.target.value as ColKey }))}
                      className={`flex-1 text-xs border rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-indigo-300 transition
                        ${isDup ? "border-red-400 bg-red-50" : isSkipped ? "border-dashed border-gray-300 text-gray-400 bg-gray-50" : "border-indigo-200 bg-indigo-50 text-indigo-700 font-medium"}`}
                    >
                      <option value={SKIP}>— Skip this column —</option>
                      <option disabled>──────────────</option>
                      {COLUMNS.map(c => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          <div className="mt-3 text-xs text-gray-500 flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-indigo-400" />
              {Object.values(mappings).filter(v => v !== SKIP).length} columns mapped
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-gray-300" />
              {Object.values(mappings).filter(v => v === SKIP).length} skipped
            </span>
            <span className="ml-auto">{parsed.dataRows.length} rows will be imported</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Grid view ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />

      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-indigo-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 6h18M3 14h18M3 18h18" />
            </svg>
          </div>
          <span className="font-semibold text-gray-800 text-sm">Projects</span>
          <span className="text-gray-400 text-xs">/ Data Editor</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Excel
          </button>
          <button onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 transition font-medium shadow-sm">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Save Changes
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border-b border-gray-100 px-6 py-2 flex items-center gap-3">
        <button onClick={addRow}
          className="flex items-center gap-1.5 px-3 py-1 text-xs text-indigo-600 border border-indigo-200 bg-indigo-50 rounded hover:bg-indigo-100 transition font-medium">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Row
        </button>

        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-1 text-xs text-emerald-700 border border-emerald-300 bg-emerald-50 rounded hover:bg-emerald-100 transition font-medium disabled:opacity-50">
          {uploading ? (
            <>
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reading…
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload File
            </>
          )}
        </button>

        {selected.size > 0 && (
          <button onClick={deleteSelected}
            className="flex items-center gap-1.5 px-3 py-1 text-xs text-red-600 border border-red-200 bg-red-50 rounded hover:bg-red-100 transition font-medium">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete {selected.size} row{selected.size > 1 ? "s" : ""}
          </button>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs text-gray-400">
          <span>Double-click any cell to edit</span>
          <span className="text-gray-300">·</span>
          <span>{rows.length} rows</span>
          {saved && <span className="text-green-600 font-medium">· Saved</span>}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-auto">
          <table className="border-collapse text-xs" style={{ tableLayout:"fixed", width: COLUMNS.reduce((a,c)=>a+c.w,0)+40 }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-10 min-w-10 border border-gray-200 px-2 py-2 text-center">
                  <input type="checkbox" className="w-3 h-3 accent-indigo-600"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={() => setSelected(selected.size===rows.length ? new Set() : new Set(rows.map((_,i)=>i)))} />
                </th>
                {COLUMNS.map(col => (
                  <th key={col.key}
                    className="border border-gray-200 px-2 py-2 text-left text-xs font-semibold text-gray-600 bg-gray-50 truncate"
                    style={{ width: col.w, minWidth: col.w }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className={`group transition-colors ${selected.has(ri) ? "bg-indigo-50" : "hover:bg-gray-50"}`}>
                  <td className="border border-gray-200 px-2 py-1 text-center w-10 min-w-10">
                    <input type="checkbox" className="w-3 h-3 accent-indigo-600"
                      checked={selected.has(ri)} onChange={() => toggleSelect(ri)} />
                  </td>
                  {COLUMNS.map(col => (
                    <Cell key={col.key} value={row[col.key]??""} colKey={col.key} colW={col.w}
                      isEditing={editing?.row===ri && editing?.col===col.key}
                      onStartEdit={() => setEditing({ row:ri, col:col.key })}
                      onCommit={val => handleCommit(ri, col.key, val)} />
                  ))}
                </tr>
              ))}
              <tr className="border-t border-dashed border-gray-200">
                <td colSpan={COLUMNS.length+1} className="px-4 py-2">
                  <button onClick={addRow}
                    className="text-xs text-gray-400 hover:text-indigo-500 flex items-center gap-1 transition">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Click to add a row…
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center gap-6 text-xs text-gray-500 flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-blue-50 border border-blue-300 rounded" />
            <span>Cell being edited</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-indigo-50 border border-gray-200 rounded" />
            <span>Selected row</span>
          </div>
          <div className="flex items-center gap-1.5 text-emerald-600">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>Upload File to map and import your own data</span>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 text-white text-xs px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2 z-50 animate-in fade-in slide-in-from-bottom-2 max-w-sm ${toast.ok ? "bg-gray-900" : "bg-red-700"}`}>
          {toast.ok
            ? <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            : <svg className="w-4 h-4 text-red-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
