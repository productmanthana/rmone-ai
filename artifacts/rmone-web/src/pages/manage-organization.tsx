import React, { createContext, useContext, useMemo, useState, useEffect, useRef, useCallback } from "react";
import { RmOneProcessing } from "@/components/CommandCentreLoader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDivisions, getDepartments, getBusinessUnits,
  createDivision, createBusinessUnit, createDepartment,
  updateDivision, deleteDivision,
  renameBusinessUnit, deleteBusinessUnit,
  updateDepartment, deleteDepartment,
  cleanupOrganization,
  getRoleBillingRates, createRole, deleteRole,
  getJobTitles, createJobTitle,
  bulkUploadOrg,
  getOrgProvenance, traceOrgEntity,
  bustCache, authHeaders, getStoredUser,
  type OrgConflict, type RoleBillingRate, type JobTitleRow,
  type OrgEntityType, type OrgProvenanceEntry,
} from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ROLE_CATALOG } from "@/lib/roleCatalog";
import { STANDARD_JOB_TITLES } from "@/lib/standardTitles";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Building2, Briefcase, Loader2, Plus, Pencil, Trash2, Check, X,
  UserCog, Tag, Layers, GraduationCap, Download, Upload, ChevronDown, ChevronUp, Lock,
  Table2, Search, FileText, UserCheck,
} from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { getBusinessRules, loadBusinessRules } from "@/lib/businessRules";
import OfficesPage from "@/pages/offices";
import { isBridgeDivision, resolveDivisionForSave } from "@/lib/orgHierarchy";
import { Z } from "@/lib/zLayers";

// ── Helpers ────────────────────────────────────────────────────────────────────
function extractErrMsg(e: unknown): string {
  const raw = (e as Error)?.message ?? String(e);
  // Strip leading HTTP status code: "502: {...}" or "502: plain text"
  const body = raw.replace(/^\d{3}:\s*/, "");
  try {
    const parsed = JSON.parse(body);
    const msg: string = parsed.error ?? parsed.message ?? body;
    // Strip leading "Error: " prefix for cleaner display
    return msg.replace(/^Error:\s*/i, "");
  } catch { return body || "Something went wrong." }
}

// ── Types ──────────────────────────────────────────────────────────────────────
type BusinessUnitRow = { ID: number | string; Title: string; ShortName?: string | null };
type DivisionRow     = { ID: number | string; Title: string; ShortName?: string | null; BusinessUnitIdLookup?: string | null };
type DepartmentRow   = { ID: string; Title: string; DivisionIdLookup?: string | null };

const UNASSIGNED = "__none__";

// Human-readable source line for an org-provenance record (grid + node tooltips).
const provLabel = (p: OrgProvenanceEntry): string => {
  const date = p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "";
  if (p.source === "import")     return `Import file "${p.fileName || "unknown"}"${date ? ` — ${date}` : ""}`;
  if (p.source === "traced")     return `Found in "${p.fileName || "unknown"}" (searched on request)`;
  if (p.source === "org-upload") return `Organization page upload${p.fileName ? ` "${p.fileName}"` : ""}${date ? ` — ${date}` : ""}`;
  if (p.source === "manual")     return `Added manually${p.createdBy ? ` by ${p.createdBy}` : ""}${date ? ` — ${date}` : ""}`;
  return p.source;
};

const BU_COLORS = [
  "#6366f1","#10b981","#f59e0b","#ec4899",
  "#06b6d4","#8b5cf6","#f97316","#14b8a6","#ef4444",
];

// ── Theme tokens — follow the app light/dark theme via --rm-* CSS vars.
// Fallbacks are the original light-theme values, so the page renders
// identically in light mode and flips to navy surfaces in dark mode.
const BG     = "var(--rm-bg, #f8fafc)";
const PANEL  = "var(--rm-panel, #ffffff)";
const BORDER = "var(--rm-panel-border, #e2e8f0)";
const BORDER2= "var(--rm-panel-border, #cbd5e1)";
const TEXT   = "var(--rm-text, #1e293b)";
const MUTED  = "var(--rm-text-muted, #64748b)";
const SUBTLE = "var(--rm-text-faint, #94a3b8)";
const CANCEL = "var(--rm-panel-soft, #f1f5f9)";
const INPBG  = "var(--rm-panel-soft, #f8fafc)";
const EDITBG = "var(--rm-panel, #ffffff)";

// ── Instant hover tooltip wrapper ───────────────────────────────────────────
const ChipTip = ({ label, bg, children }: { label:string; bg:string; children:React.ReactNode }) => {
  const [show, setShow] = React.useState(false);
  return (
    <div style={{ position:"relative", display:"inline-flex" }}
      onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}>
      {children}
      {show && (
        <div style={{ position:"absolute", bottom:"calc(100% + 4px)", left:"50%", transform:"translateX(-50%)",
          background:bg, color:"#fff", fontSize:9, fontWeight:700, padding:"2px 7px", borderRadius:4,
          whiteSpace:"nowrap", zIndex:20, pointerEvents:"none", letterSpacing:"0.03em" }}>
          {label}
          <div style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)",
            width:0, height:0, borderLeft:"4px solid transparent", borderRight:"4px solid transparent",
            borderTop:`4px solid ${bg}` }}/>
        </div>
      )}
    </div>
  );
};

type EditState =
  | { type:"bu";   id:string; name:string }
  | { type:"div";  id:string; name:string; buId:string; originalBuId:string }
  | { type:"dept"; id:string; name:string; divId:string; originalDivId:string }
  | null;
type ConfirmDelete = { kind:"bu"|"div"|"dept"|"role"; id:string; label:string; divId?:string } | null;
type InlineAdd     = { type:"bu"; name:string } | { type:"div"; buId:string; name:string } | { type:"dept"; divId:string; buId?:string; name:string } | { type:"role"; deptId:string; name:string } | { type:"title"; deptId:string; name:string; roleId?:string; newRoleName?:string } | null;
type AddPanel      = "bu"|"div"|"dept"|"role"|"title"|null;

// ── Shared context ─────────────────────────────────────────────────────────────
interface OrgCtxType {
  editing: EditState;       setEditing: (e:EditState)=>void;
  editBusy: boolean;        commitEdit: ()=>Promise<void>;
  confirmDelete: ConfirmDelete; setConfirmDelete: (d:ConfirmDelete)=>void;
  pendingDelete: ConfirmDelete; setPendingDelete: (d:ConfirmDelete)=>void;
  deleteBusy: boolean;      commitDelete: ()=>Promise<void>;
  inlineAdd: InlineAdd;     setInlineAdd: (a:InlineAdd)=>void;
  inlineAddBusy: boolean;   commitInlineAdd: ()=>Promise<void>;
  divList: DivisionRow[];   buList: BusinessUnitRow[];  deptList: DepartmentRow[];
  showDivs: boolean; showDepts: boolean; showRoles: boolean; showTitles: boolean;
  /** Division tier enabled in hierarchy settings — false = BU→Dept partial chart */
  hierDivOn: boolean;
  deptsByDiv: Map<string,DepartmentRow[]>;
  divsByBu:   Map<string,DivisionRow[]>;
  jtByDeptId: Map<string,JobTitleRow[]>;
  roleById: Map<string,string>;
  roleRateById: Map<string,number|null>;
  setAddPanel: (p:AddPanel)=>void;
  /** Source + why-blank lines for a chart node's hover tooltip */
  hoverInfoFor: (type: OrgEntityType, name: string) => string[];
  /** Opens the Data Grid overlay; pass type+name to highlight that entity in red */
  openGrid: (type?: string, name?: string) => void;
  /** Opens the raw file viewer for a specific uploadId+fileName (for secondary provenance buttons) */
  openGridForUpload: (uploadId: string, fileName: string, highlightTerm?: string) => void;
  /** Job-title provenance keyed by title name (lowercase) — used to show secondary source buttons */
  jtProvByName: Map<string, import("@/lib/api").OrgProvenanceEntry>;
  /** All org provenance keyed by "entityType|name" — lets child nodes look up their own uploadId */
  orgProvByKey: Map<string, import("@/lib/api").OrgProvenanceEntry>;
}
const OrgCtx = createContext<OrgCtxType>(null!);
const useOrg = () => useContext(OrgCtx);

// ── Pure visual primitives (stable, defined outside parent) ────────────────────

const VLine = ({ color, h=20 }: { color:string; h?:number }) => (
  <div style={{ display:"flex", justifyContent:"center", height:h }}>
    <div style={{ width:2, height:"100%", background:color+"60" }} />
  </div>
);

const HBar = ({ color, children }: { color:string; children:React.ReactNode }) => (
  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", width:"100%" }}>
    <div style={{ width:2, height:14, background:color+"60" }} />
    <div style={{ width:"calc(100% - 40px)", height:2, background:color+"40" }} />
    <div style={{ display:"flex", flexWrap:"wrap", justifyContent:"center", gap:20, rowGap:24, alignItems:"flex-start" }}>{children}</div>
  </div>
);

// NodeBox — stable outside the parent; manages its own hover state safely.
// The outer wrapper covers both the tile AND the action buttons so the mouse
// never leaves the hover zone when moving down to click "+ Add dept" etc.
type NodeAction = { label: string; color?: string; onClick: () => void };
const NodeBox = ({ label, color, icon:Icon, size="md", onEdit, onDelete, actions=[], muted=false, typeLabel, hoverLines, onShowInGrid, extraGridActions=[] }: {
  label:string; color:string; icon:React.ElementType;
  size?:"lg"|"md"|"sm"|"xs"; onEdit?:()=>void; onDelete?:()=>void;
  actions?: NodeAction[]; muted?:boolean; typeLabel?:string;
  /** Lines shown in the hover tooltip (source attribution + why-blank note) */
  hoverLines?: string[];
  /** Called when user clicks the primary "View data grid" button */
  onShowInGrid?: () => void;
  /** Additional source-file buttons — shown when job titles etc. came from a different file */
  extraGridActions?: { label: string; onClick: () => void }[];
}) => {
  const [hovered, setHovered] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const handleMouseEnter = () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); setHovered(true); };
  const handleMouseLeave = () => { leaveTimer.current = setTimeout(() => setHovered(false), 160); };
  const pad   = size==="lg"?"14px 24px":size==="sm"?"6px 12px":size==="xs"?"3px 8px":"9px 16px";
  const iSize = size==="lg"?18:size==="sm"?13:size==="xs"?11:15;
  const fSize = size==="lg"?15:size==="sm"?11:size==="xs"?10:12;

  return (
    // Hover wrapper — 160ms leave delay lets mouse cross gap into tooltip without dismissing
    <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}
      style={{ position:"relative", display:"flex", flexDirection:"column", alignItems:"center", gap:0 }}>
      {/* Tooltip anchored to the RIGHT of the node — avoids top/bottom clipping */}
      {hovered && hoverLines && hoverLines.length > 0 && (
        <div style={{
            position:"absolute", top:"50%", left:"calc(100% + 10px)",
            transform:"translateY(-50%)",
            zIndex:60, width:240, textAlign:"left",
            background:PANEL, border:`1px solid ${BORDER2}`, borderRadius:8,
            padding:"9px 11px 12px", boxShadow:"0 6px 20px rgba(0,0,0,0.28)",
          }}>
          {hoverLines.map((l, i) => (
            <div key={i} style={{ fontSize:10.5, lineHeight:1.5, whiteSpace:"normal", color: i===0 ? TEXT : MUTED, marginTop: i===0 ? 0 : 4 }}>{l}</div>
          ))}
          {onShowInGrid && (
            <button
              onMouseDown={(e)=>{e.preventDefault();e.stopPropagation();onShowInGrid();}}
              style={{ marginTop:8, display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:6, fontSize:10.5, fontWeight:600, cursor:"pointer", border:"1.5px solid #6366f140", background:"transparent", color:"#818cf8" }}>
              <Table2 size={11}/> View data grid
            </button>
          )}
          {extraGridActions.map((a, i) => (
            <button key={i}
              onMouseDown={(e)=>{e.preventDefault();e.stopPropagation();a.onClick();}}
              style={{ marginTop:5, display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:6, fontSize:10.5, fontWeight:600, cursor:"pointer", border:"1.5px solid #f9731640", background:"transparent", color:"#fb923c" }}>
              <Table2 size={11}/> {a.label}
            </button>
          ))}
        </div>
      )}
      <div
        onClick={onShowInGrid ? (e) => { e.stopPropagation(); onShowInGrid(); } : undefined}
        style={{
          padding:pad, borderRadius:10,
          border:`2px solid ${muted?color+"25":color+"60"}`,
          background:muted?CANCEL:color+"12", cursor:onShowInGrid?"pointer":"default",
          display:"flex", alignItems:"center", gap:4, position:"relative",
          minWidth:size==="lg"?170:size==="sm"?90:size==="xs"?72:110,
          maxWidth:size==="lg"?380:size==="sm"?200:size==="xs"?150:280,
          boxShadow:hovered?`0 2px 10px ${color}22`:"0 1px 4px rgba(0,0,0,0.05)",
          transition:"box-shadow 0.15s, border-color 0.15s",
        }}>
        <Icon size={iSize} style={{ color:muted?color+"90":color, flexShrink:0 }} />
        <span style={{ fontSize:fSize, fontWeight:700, color:muted?MUTED:TEXT, wordBreak:"break-word" }}>{label}</span>
      </div>
      {/* Edit/Delete row — outside the tile so they never push the label text */}
      <div style={{ display:"flex", gap:4, marginTop:3, justifyContent:"center", opacity:(hovered&&(onEdit||onDelete))?1:0, pointerEvents:(hovered&&(onEdit||onDelete))?"auto":"none", transition:"opacity 0.12s" }}>
        {onEdit && (
          <button onMouseDown={(e)=>{e.preventDefault();e.stopPropagation();onEdit?.();}} style={{ display:"flex", alignItems:"center", gap:3, background:CANCEL, border:`1px solid ${BORDER}`, borderRadius:5, padding:"2px 8px", cursor:"pointer", color:MUTED, fontSize:9.5, fontWeight:600, lineHeight:1 }} title="Rename">
            <Pencil size={9}/> Rename
          </button>
        )}
        {onDelete && (
          <button onMouseDown={(e)=>{e.preventDefault();e.stopPropagation();onDelete?.();}} style={{ display:"flex", alignItems:"center", gap:3, background:"rgba(239,68,68,0.10)", border:"1px solid rgba(239,68,68,0.35)", borderRadius:5, padding:"2px 8px", cursor:"pointer", color:"#ef4444", fontSize:9.5, fontWeight:600, lineHeight:1 }} title="Delete">
            <Trash2 size={9}/> Delete
          </button>
        )}
      </div>
      {/* Type badge — always visible so users know BU vs Division vs Department */}
      {typeLabel && (
        <div style={{ marginTop:3, fontSize:8, fontWeight:700, color:color, background:color+"15", border:`1px solid ${color}30`, borderRadius:10, padding:"1px 7px", letterSpacing:"0.08em", textTransform:"uppercase", alignSelf:"center", whiteSpace:"nowrap" }}>
          {typeLabel}
        </div>
      )}
      {/* Always in DOM — no layout shift; opacity/pointerEvents toggled so hover zone stays stable */}
      {actions.length>0 && (
        <div style={{ display:"flex", gap:4, marginTop:4, flexWrap:"wrap", justifyContent:"center", opacity:hovered?1:0, pointerEvents:hovered?"auto":"none", transition:"opacity 0.12s" }}>
          {actions.map(a=>(
            <button key={a.label}
              onMouseDown={(e)=>{e.preventDefault();e.stopPropagation();a.onClick();}}
              style={{ background:"transparent", border:`1px dashed ${(a.color??color)+"60"}`, borderRadius:6, padding:"2px 10px", cursor:"pointer", fontSize:10, color:a.color??color, display:"flex", alignItems:"center", gap:3, whiteSpace:"nowrap" }}>
              <Plus size={9}/>{a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── RawFileViewer ─────────────────────────────────────────────────────────────
// Shows the actual uploaded Excel/CSV with ALL original columns; rows where any
// cell contains the highlight term (the clicked entity name) are tinted red and
// the first match is auto-scrolled into view.
type RawSheetRow = (string | number | boolean | null)[];
interface ParsedRawSheet { name: string; headers: string[]; rows: RawSheetRow[]; matchIdxs: Set<number>; }

const RawFileViewer = ({ fileName, highlightTerm, file, loading, onClose }: {
  fileName: string; highlightTerm: string;
  file: ArrayBuffer | null; loading: boolean;
  onClose: () => void;
}) => {
  const [activeSheet, setActiveSheet] = useState(0);
  const [sheets, setSheets] = useState<ParsedRawSheet[]>([]);
  const firstMatchRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (!file) { setSheets([]); return; }
    let cancelled = false;
    const term = highlightTerm.trim().toLowerCase();
    void import("xlsx").then(xlsx => {
      if (cancelled) return;
      try {
        const wb = xlsx.read(file, { type: "array", cellDates: false });
        const parsed: ParsedRawSheet[] = wb.SheetNames.map((sheetName: string) => {
          const ws = wb.Sheets[sheetName];
          const raw: RawSheetRow[] = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null }) as RawSheetRow[];
          if (!raw.length) return { name: sheetName, headers: [], rows: [], matchIdxs: new Set<number>() };
          const headers = (raw[0] as RawSheetRow).map(h => String(h ?? ""));
          const rows = raw.slice(1) as RawSheetRow[];
          const matchIdxs = new Set<number>();
          if (term) rows.forEach((row, i) => {
            if (row.some(cell => cell != null && String(cell).toLowerCase().includes(term))) matchIdxs.add(i);
          });
          return { name: sheetName, headers, rows, matchIdxs };
        });
        const firstHit = parsed.findIndex(s => s.matchIdxs.size > 0);
        setActiveSheet(Math.max(0, firstHit));
        setSheets(parsed);
      } catch { /* corrupt file — show empty */ }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [file, highlightTerm]);

  useEffect(() => {
    if (firstMatchRef.current) {
      setTimeout(() => firstMatchRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
    }
  }, [sheets, activeSheet]);

  const sheet = sheets[activeSheet];
  const term = highlightTerm.trim().toLowerCase();

  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.55)", zIndex:Z.GRID_POPUP, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(2px)", padding:16 }}>
      <div style={{ background:"hsl(var(--background))", borderRadius:16, width:"min(1320px,100%)", maxHeight:"min(880px,calc(100vh - 32px))", display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:"0 20px 60px rgba(15,23,42,0.25)" }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 24px 12px", borderBottom:`1px solid ${BORDER2}`, gap:12, flexShrink:0 }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <FileText size={14} style={{ color:"#60a5fa", flexShrink:0 }}/>
              <span style={{ fontSize:14, fontWeight:700, color:TEXT }}>{fileName}</span>
            </div>
            <div style={{ fontSize:11, color:MUTED, marginTop:3 }}>
              Rows containing <span style={{ fontWeight:700, color:TEXT }}>"{highlightTerm}"</span> are <span style={{ color:"#ef4444", fontWeight:700 }}>highlighted red</span> — these are the rows in your file that set this value.
            </div>
          </div>
          <button onMouseDown={e => { e.stopPropagation(); onClose(); }}
            style={{ background:"transparent", border:"none", cursor:"pointer", color:MUTED, padding:4, borderRadius:6, flexShrink:0 }} title="Close">
            <X size={18}/>
          </button>
        </div>
        {/* Sheet tabs */}
        {sheets.length > 1 && (
          <div style={{ display:"flex", gap:2, padding:"8px 16px 0", borderBottom:`1px solid ${BORDER}`, flexShrink:0, overflowX:"auto" }}>
            {sheets.map((s, i) => (
              <button key={s.name} onClick={() => setActiveSheet(i)}
                style={{ padding:"5px 14px", borderRadius:"8px 8px 0 0", fontSize:11, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap",
                  background: i===activeSheet ? "hsl(var(--background))" : CANCEL,
                  border: i===activeSheet ? `1.5px solid ${BORDER2}` : `1px solid transparent`,
                  borderBottom: i===activeSheet ? `1.5px solid hsl(var(--background))` : `1px solid ${BORDER}`,
                  color: i===activeSheet ? TEXT : MUTED, position:"relative", top:1 }}>
                {s.name}
                {s.matchIdxs.size > 0 && <span style={{ marginLeft:5, color:"#ef4444", fontSize:9, fontWeight:700 }}>●</span>}
              </button>
            ))}
          </div>
        )}
        {/* Body */}
        <div style={{ flex:1, overflow:"auto" }}>
          {(loading || (!file && !sheet)) && (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:220, gap:8, color:MUTED }}>
              <Loader2 size={16} className="animate-spin"/> Loading file…
            </div>
          )}
          {!loading && !sheet && file && (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:220, color:SUBTLE, fontSize:13 }}>
              Empty or unreadable file.
            </div>
          )}
          {sheet && (
            <table style={{ width:"100%", borderCollapse:"separate", borderSpacing:0, fontSize:12 }}>
              <thead>
                <tr>
                  <th style={{ position:"sticky", top:0, left:0, background:"hsl(var(--background))", padding:"8px 10px", borderBottom:`1.5px solid ${BORDER2}`, borderRight:`1px solid ${BORDER}`, fontSize:10, fontWeight:700, color:MUTED, whiteSpace:"nowrap", zIndex:3 }}>#</th>
                  {sheet.headers.map((h, ci) => (
                    <th key={ci} style={{ position:"sticky", top:0, background:"hsl(var(--background))", padding:"8px 14px", borderBottom:`1.5px solid ${BORDER2}`, fontSize:10, fontWeight:700, color:MUTED, textAlign:"left", whiteSpace:"nowrap", zIndex:2 }}>
                      {h || <span style={{color:SUBTLE}}>(blank)</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.length === 0 && (
                  <tr><td colSpan={sheet.headers.length + 1} style={{ padding:"22px 12px", color:SUBTLE, textAlign:"center" }}>No data rows in this sheet.</td></tr>
                )}
                {sheet.rows.map((row, ri) => {
                  const isMatch = sheet.matchIdxs.has(ri);
                  const isFirstMatch = isMatch && [...sheet.matchIdxs].find(x => x === ri) === [...sheet.matchIdxs][0];
                  return (
                    <tr key={ri}
                      ref={isFirstMatch ? (el => { firstMatchRef.current = el; }) : undefined}
                      style={{
                        background: isMatch ? "#ef444422" : ri % 2 === 0 ? "transparent" : `${CANCEL}80`,
                        outline: isMatch ? "1.5px solid #ef444445" : "none",
                        outlineOffset: "-1px",
                      }}>
                      <td style={{ padding:"5px 10px", borderBottom:`1px solid ${BORDER}`, borderRight:`1px solid ${BORDER}`, color:SUBTLE, fontSize:10, fontWeight:600, whiteSpace:"nowrap", position:"sticky", left:0, background: isMatch ? "#ef444422" : ri % 2 === 0 ? "hsl(var(--background))" : "hsl(var(--background))" }}>
                        {ri + 1}
                      </td>
                      {sheet.headers.map((_, ci) => {
                        const cell = row[ci];
                        const cellStr = cell != null ? String(cell) : "";
                        const isHit = term && cellStr.toLowerCase().includes(term);
                        return (
                          <td key={ci} style={{ padding:"5px 14px", borderBottom:`1px solid ${BORDER}`, whiteSpace:"nowrap", maxWidth:260, overflow:"hidden", textOverflow:"ellipsis",
                            color: isHit ? "#ef4444" : cell != null ? TEXT : SUBTLE,
                            fontWeight: isHit ? 700 : 400 }}>
                            {cellStr || ""}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {/* Footer */}
        {sheet && (
          <div style={{ padding:"9px 24px", borderTop:`1px solid ${BORDER}`, fontSize:11, color:MUTED, flexShrink:0, display:"flex", gap:20, alignItems:"center" }}>
            <span>{sheet.rows.length} row{sheet.rows.length===1?"":"s"} total</span>
            {sheet.matchIdxs.size > 0
              ? <span style={{ color:"#ef4444", fontWeight:600 }}>{sheet.matchIdxs.size} row{sheet.matchIdxs.size===1?"":"s"} match "{highlightTerm}"</span>
              : term ? <span style={{ color:SUBTLE }}>No rows match "{highlightTerm}" in this sheet</span> : null}
          </div>
        )}
      </div>
    </div>
  );
};

// ── DeptBlock ─────────────────────────────────────────────────────────────────
const DeptBlock = ({ dep, color }: { dep:DepartmentRow; color:string }) => {
  const { editing, setEditing, commitEdit, editBusy, confirmDelete, setConfirmDelete, pendingDelete, setPendingDelete, deleteBusy, commitDelete, setInlineAdd, divList, showRoles, showTitles, jtByDeptId, roleById, roleRateById, hierDivOn, hoverInfoFor, openGrid, jtProvByName, openGridForUpload, orgProvByKey } = useOrg();
  const id = String(dep.ID);
  const isEditingThis = editing?.type==="dept" && editing.id===id;
  const isConfirm     = confirmDelete?.kind==="dept" && confirmDelete.id===id;
  const isPending     = pendingDelete?.kind==="dept" && pendingDelete.id===id;

  const deptTitles = jtByDeptId.get(id) ?? [];

  // Collect distinct source files for job titles in this dept that differ from
  // the dept's own source file — each unique file gets a secondary "View roles
  // file" button in the tooltip so admins can see both origin files at once.
  const jtExtraGridActions = useMemo(() => {
    const deptProv = orgProvByKey.get(`department|${dep.Title.trim().toLowerCase()}`);
    const deptUploadId = deptProv?.uploadId ?? null;
    const seen = new Map<string, { uploadId: string; fileName: string }>();
    for (const jt of deptTitles) {
      const jtProv = jtProvByName.get((jt.Title || jt.JobTitleName || "").trim().toLowerCase());
      if (!jtProv?.uploadId || !jtProv.fileName) continue;
      // Only add a secondary button when this job title's source file differs
      // from the dept node's own source file.
      if (jtProv.uploadId === deptUploadId) continue;
      if (!seen.has(jtProv.uploadId)) seen.set(jtProv.uploadId, { uploadId: jtProv.uploadId, fileName: jtProv.fileName });
    }
    return Array.from(seen.values());
  }, [dep.Title, deptTitles, jtProvByName, orgProvByKey]);

  const byRole = useMemo(()=>{
    const m = new Map<string,JobTitleRow[]>();
    // Normalize RoleId to lowercase so GUID case differences (UNIQUEIDENTIFIER vs NVARCHAR storage) don't break lookup.
    // Use || instead of ?? so empty-string RoleId also falls into UNASSIGNED.
    for (const jt of deptTitles) { const k=(jt.RoleId&&jt.RoleId.toLowerCase())||UNASSIGNED; m.set(k,[...(m.get(k)??[]),jt]); }
    return m;
  }, [deptTitles]);
  const linkedRoles = [...byRole.keys()].filter(k=>k!==UNASSIGNED);
  const unlinkedJTs = byRole.get(UNASSIGNED)??[];

  if (isPending) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5, padding:"8px 12px", background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.25)", borderRadius:8, minWidth:120 }}>
      <span style={{ fontSize:10, color:"#94a3b8" }}>Queued for deletion…</span>
      <div style={{ width:"100%", height:3, borderRadius:2, background:"rgba(239,68,68,0.15)", overflow:"hidden" }}>
        <div style={{ height:"100%", width:"40%", borderRadius:2, background:"#ef4444", animation:"org-progress-slide 1s ease-in-out infinite" }}/>
      </div>
    </div>
  );

  if (isConfirm) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, padding:"8px 12px", background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.4)", borderRadius:8 }}>
      <span style={{ fontSize:11, color:"var(--rm-ink-red, #dc2626)" }}>Delete "{dep.Title}"?</span>
      <div style={{ display:"flex", gap:6 }}>
        <button onClick={()=>void commitDelete()} disabled={deleteBusy} style={{ background:"#ef4444", border:"none", borderRadius:5, padding:"3px 10px", fontSize:10, color:"#fff", cursor:"pointer" }}>{deleteBusy?<Loader2 size={10}/>:"Delete"}</button>
        <button onClick={()=>setConfirmDelete(null)} style={{ background:CANCEL, border:`1px solid ${BORDER}`, borderRadius:5, padding:"3px 10px", fontSize:10, color:MUTED, cursor:"pointer" }}>Cancel</button>
      </div>
    </div>
  );

  if (isEditingThis && editing?.type==="dept") return (
    <div style={{ background:EDITBG, border:`1.5px solid ${color}60`, borderRadius:10, padding:"10px 12px", display:"flex", flexDirection:"column", gap:6, minWidth:180, boxShadow:"0 2px 8px rgba(0,0,0,0.08)" }}>
      <Input className="h-7 text-xs" value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})} onKeyDown={e=>{if(e.key==="Enter")void commitEdit();if(e.key==="Escape")setEditing(null);}} autoFocus />
      {/* Division tier hidden → keep the dept's current (bridge) division untouched */}
      {hierDivOn && (
        <Select value={editing.divId||UNASSIGNED} onValueChange={v=>setEditing({...editing,divId:v===UNASSIGNED?"":v})}>
          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="No division"/></SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>No division</SelectItem>
            {divList.map(d=><SelectItem key={String(d.ID)} value={String(d.ID)}>{d.Title}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <div style={{ display:"flex", gap:6 }}>
        <button onClick={()=>void commitEdit()} disabled={editBusy} style={{ background:color, border:"none", borderRadius:5, padding:"3px 12px", fontSize:10, color:"#fff", cursor:"pointer" }}>{editBusy?<Loader2 size={10}/>:<><Check size={10}/> Save</>}</button>
        <button onClick={()=>setEditing(null)} style={{ background:CANCEL, border:`1px solid ${BORDER}`, borderRadius:5, padding:"3px 10px", fontSize:10, color:MUTED, cursor:"pointer" }}>Cancel</button>
      </div>
    </div>
  );

  const hasChildren = (showRoles||showTitles) && deptTitles.length>0;
  return (
    <div style={{
      display:"flex", flexDirection:"column", alignItems:"center",
      ...(hasChildren ? {
        border:`1px solid ${color}25`,
        borderRadius:10,
        background:color+"08",
        padding:"8px 10px 10px",
      } : {}),
    }}>
      <NodeBox label={dep.Title} color={color} icon={Briefcase} size="sm" typeLabel="Department"
        hoverLines={hoverInfoFor("department", dep.Title)} onShowInGrid={() => openGrid("department", dep.Title)}
        extraGridActions={jtExtraGridActions.map(a => ({
          label: `View roles file — "${a.fileName}"`,
          onClick: () => openGridForUpload(a.uploadId, a.fileName, dep.Title),
        }))}
        onEdit={()=>{const divid=dep.DivisionIdLookup?String(dep.DivisionIdLookup):"";setEditing({type:"dept",id,name:dep.Title,divId:divid,originalDivId:divid});}}
        onDelete={()=>{const payload={kind:"dept" as const,id,label:dep.Title,divId:dep.DivisionIdLookup?String(dep.DivisionIdLookup):undefined};if(deleteBusy){setPendingDelete(payload);}else{setConfirmDelete(payload);}}}
        actions={[
          { label:"Add role",  color:"#8b5cf6", onClick:()=>setInlineAdd({type:"role",  deptId:id, name:""}) },
          { label:"Add title", color:"#f97316", onClick:()=>setInlineAdd({type:"title", deptId:id, name:""}) },
        ]}
      />
      {hasChildren && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginTop:4 }}>
          <VLine color={color} h={10} />
          <div style={{ display:"flex", flexDirection:"row", flexWrap:"wrap", gap:4, justifyContent:"center", alignItems:"flex-start", maxWidth:220 }}>
            {showRoles && linkedRoles.map(roleId=>{
              const roleName = (roleById.get(roleId) ?? "").toLowerCase();
              const allTitles = byRole.get(roleId) ?? [];
              // If the only linked title has the same name as the role it's the
              // auto-created placeholder — suppress it so the role doesn't appear twice.
              const visibleTitles = showTitles
                ? (allTitles.length === 1 && (allTitles[0].Title||allTitles[0].JobTitleName||"").toLowerCase() === roleName ? [] : allTitles)
                : [];
              return (
                <div key={roleId} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                  <ChipTip label="Role" bg="#7c3aed">
                    <div style={{ padding:"3px 10px", borderRadius:20, background:color+"15", border:`1px solid ${color}40`, fontSize:10, color:"var(--rm-ink-violet, #7c3aed)", display:"flex", alignItems:"center", gap:4, cursor:"default" }}>
                      <UserCog size={9}/>{roleById.get(roleId)??roleId}
                      {roleRateById.get(roleId) != null && (
                        <span style={{ fontSize:8, color:"#16a34a", fontWeight:600 }}>(${(roleRateById.get(roleId) as number).toFixed(2)}/hr)</span>
                      )}
                    </div>
                  </ChipTip>
                  {visibleTitles.map(jt=>(
                    <ChipTip key={jt.ID} label="Job Title" bg="#ea580c">
                      <div style={{ padding:"2px 8px", borderRadius:12, background:"rgba(249,115,22,0.12)", border:"1px solid rgba(249,115,22,0.4)", fontSize:9, color:"var(--rm-ink-orange, #ea580c)", display:"flex", alignItems:"center", gap:3, cursor:"default" }}>
                        <Tag size={8}/>{jt.Title||jt.JobTitleName}
                      </div>
                    </ChipTip>
                  ))}
                </div>
              );
            })}
            {showTitles && unlinkedJTs.map(jt=>(
              <ChipTip key={jt.ID} label="Job Title" bg="#ea580c">
                <div style={{ padding:"2px 8px", borderRadius:12, background:"rgba(249,115,22,0.12)", border:"1px solid rgba(249,115,22,0.4)", fontSize:9, color:"var(--rm-ink-orange, #ea580c)", display:"flex", alignItems:"center", gap:3, cursor:"default" }}>
                  <Tag size={8}/>{jt.Title||jt.JobTitleName}
                </div>
              </ChipTip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── DivBlock ──────────────────────────────────────────────────────────────────
const DivBlock = ({ div, color }: { div:DivisionRow; color:string }) => {
  const { editing, setEditing, commitEdit, editBusy, confirmDelete, setConfirmDelete, pendingDelete, setPendingDelete, deleteBusy, commitDelete, setInlineAdd, buList, showDepts, deptsByDiv, hoverInfoFor, openGrid } = useOrg();
  const { toast } = useToast();
  const id = String(div.ID);
  const depts = deptsByDiv.get(id) ?? [];
  const isEditingThis = editing?.type==="div" && editing.id===id;
  const isConfirm     = confirmDelete?.kind==="div" && confirmDelete.id===id;
  const isPending     = pendingDelete?.kind==="div" && pendingDelete.id===id;

  if (isPending) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5, padding:"8px 14px", background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.25)", borderRadius:8, minWidth:130 }}>
      <span style={{ fontSize:10, color:"#94a3b8" }}>Queued for deletion…</span>
      <div style={{ width:"100%", height:3, borderRadius:2, background:"rgba(239,68,68,0.15)", overflow:"hidden" }}>
        <div style={{ height:"100%", width:"40%", borderRadius:2, background:"#ef4444", animation:"org-progress-slide 1s ease-in-out infinite" }}/>
      </div>
    </div>
  );

  if (isConfirm) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, padding:"8px 12px", background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.4)", borderRadius:8 }}>
      <span style={{ fontSize:11, color:"var(--rm-ink-red, #dc2626)" }}>Delete "{div.Title}"?</span>
      <div style={{ display:"flex", gap:6 }}>
        <button onClick={()=>void commitDelete()} disabled={deleteBusy} style={{ background:"#ef4444", border:"none", borderRadius:5, padding:"3px 10px", fontSize:10, color:"#fff", cursor:"pointer" }}>{deleteBusy?<Loader2 size={10}/>:"Delete"}</button>
        <button onClick={()=>setConfirmDelete(null)} style={{ background:CANCEL, border:`1px solid ${BORDER}`, borderRadius:5, padding:"3px 10px", fontSize:10, color:MUTED, cursor:"pointer" }}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
      <VLine color={color} />
      {isEditingThis && editing?.type==="div" ? (
        <div style={{ background:EDITBG, border:`1.5px solid ${color}60`, borderRadius:10, padding:"10px 12px", display:"flex", flexDirection:"column", gap:6, minWidth:180, boxShadow:"0 2px 8px rgba(0,0,0,0.08)" }}>
          <Input className="h-7 text-xs" value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})} onKeyDown={e=>{if(e.key==="Enter")void commitEdit();if(e.key==="Escape")setEditing(null);}} autoFocus />
          <Select value={editing.buId||UNASSIGNED} onValueChange={v=>setEditing({...editing,buId:v===UNASSIGNED?"":v})}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="No BU"/></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>No business unit</SelectItem>
              {buList.map(b=><SelectItem key={String(b.ID)} value={String(b.ID)}>{b.Title}</SelectItem>)}
            </SelectContent>
          </Select>
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={()=>void commitEdit()} disabled={editBusy} style={{ background:color, border:"none", borderRadius:5, padding:"3px 12px", fontSize:10, color:"#fff", cursor:"pointer" }}>{editBusy?<Loader2 size={10}/>:<><Check size={10}/> Save</>}</button>
            <button onClick={()=>setEditing(null)} style={{ background:CANCEL, border:`1px solid ${BORDER}`, borderRadius:5, padding:"3px 10px", fontSize:10, color:MUTED, cursor:"pointer" }}>Cancel</button>
          </div>
        </div>
      ) : (
        <NodeBox label={div.Title} color={color} icon={Layers} size="md" typeLabel="Division"
          hoverLines={hoverInfoFor("division", div.Title)} onShowInGrid={() => openGrid("division", div.Title)}
          onEdit={()=>{const buid=div.BusinessUnitIdLookup?String(div.BusinessUnitIdLookup):"";setEditing({type:"div",id,name:div.Title,buId:buid,originalBuId:buid});}}
          onDelete={()=>{
            if(depts.length>0){
              toast({title:"Remove departments first",description:`"${div.Title}" has ${depts.length} department${depts.length===1?"":"s"}. Delete ${depts.length===1?"it":"them"} before deleting this division.`,variant:"destructive"});
              return;
            }
            const payload={kind:"div" as const,id,label:div.Title};
            if(deleteBusy){setPendingDelete(payload);}else{setConfirmDelete(payload);}
          }}
          actions={showDepts?[{ label:"Add dept", onClick:()=>setInlineAdd({type:"dept",divId:id,name:""}) }]:[]}
        />
      )}
      {showDepts && (
        <>
          {depts.length>0 ? (
            depts.length===1 ? (
              <DeptBlock dep={depts[0]} color={color} />
            ) : (
              <HBar color={color}>
                {depts.map(dep=><DeptBlock key={String(dep.ID)} dep={dep} color={color}/>)}
              </HBar>
            )
          ) : null}
        </>
      )}
    </div>
  );
};

// ── BUBlock ───────────────────────────────────────────────────────────────────
const BUBlock = ({ bu, color }: { bu:BusinessUnitRow; color:string }) => {
  const { editing, setEditing, commitEdit, editBusy, confirmDelete, setConfirmDelete, pendingDelete, setPendingDelete, deleteBusy, commitDelete, setInlineAdd, showDivs, divsByBu, showDepts, deptsByDiv, hierDivOn, hoverInfoFor, openGrid } = useOrg();
  const { toast } = useToast();
  const id = String(bu.ID);
  const divs = divsByBu.get(id) ?? [];
  // Division tier hidden → the division level is skipped and this BU's
  // departments (from ALL its divisions, hidden bridges included) render
  // directly underneath the BU node.
  const buDepts = hierDivOn ? [] : divs.flatMap(d => deptsByDiv.get(String(d.ID)) ?? []);
  const isEditingThis = editing?.type==="bu" && editing.id===id;
  const isConfirm     = confirmDelete?.kind==="bu" && confirmDelete.id===id;
  const isPending     = pendingDelete?.kind==="bu" && pendingDelete.id===id;

  if (isPending) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5, padding:"10px 18px", background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.25)", borderRadius:10, minWidth:140 }}>
      <span style={{ fontSize:11, color:"#94a3b8" }}>Queued for deletion…</span>
      <div style={{ width:"100%", height:3, borderRadius:2, background:"rgba(239,68,68,0.15)", overflow:"hidden" }}>
        <div style={{ height:"100%", width:"40%", borderRadius:2, background:"#ef4444", animation:"org-progress-slide 1s ease-in-out infinite" }}/>
      </div>
    </div>
  );

  if (isConfirm) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, padding:"10px 16px", background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.4)", borderRadius:10 }}>
      <span style={{ fontSize:12, color:"var(--rm-ink-red, #dc2626)" }}>Delete "{bu.Title}"?</span>
      <div style={{ display:"flex", gap:6 }}>
        <button onClick={()=>void commitDelete()} disabled={deleteBusy} style={{ background:"#ef4444", border:"none", borderRadius:5, padding:"4px 12px", fontSize:11, color:"#fff", cursor:"pointer" }}>{deleteBusy?<Loader2 size={11}/>:"Delete"}</button>
        <button onClick={()=>setConfirmDelete(null)} style={{ background:CANCEL, border:`1px solid ${BORDER}`, borderRadius:5, padding:"4px 10px", fontSize:11, color:MUTED, cursor:"pointer" }}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
      {isEditingThis && editing?.type==="bu" ? (
        <div style={{ background:EDITBG, border:`1.5px solid ${color}60`, borderRadius:10, padding:"10px 12px", display:"flex", flexDirection:"column", gap:6, minWidth:180, boxShadow:"0 2px 8px rgba(0,0,0,0.08)" }}>
          <Input className="h-7 text-xs" value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})} onKeyDown={e=>{if(e.key==="Enter")void commitEdit();if(e.key==="Escape")setEditing(null);}} autoFocus />
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={()=>void commitEdit()} disabled={editBusy} style={{ background:color, border:"none", borderRadius:5, padding:"3px 12px", fontSize:10, color:"#fff", cursor:"pointer" }}>{editBusy?<Loader2 size={10}/>:<><Check size={10}/> Save</>}</button>
            <button onClick={()=>setEditing(null)} style={{ background:CANCEL, border:`1px solid ${BORDER}`, borderRadius:5, padding:"3px 10px", fontSize:10, color:MUTED, cursor:"pointer" }}>Cancel</button>
          </div>
        </div>
      ) : (
        <NodeBox label={bu.Title} color={color} icon={Building2} size="md" typeLabel="Business Unit"
          hoverLines={hoverInfoFor("bu", bu.Title)} onShowInGrid={() => openGrid("bu", bu.Title)}
          onEdit={()=>setEditing({type:"bu",id,name:bu.Title})}
          onDelete={()=>{
            if(hierDivOn && divs.length>0){
              toast({title:"Remove divisions first",description:`"${bu.Title}" has ${divs.length} division${divs.length===1?"":"s"}. Delete ${divs.length===1?"it":"them"} before deleting this business unit.`,variant:"destructive"});
              return;
            }
            if(!hierDivOn && buDepts.length>0){
              toast({title:"Remove departments first",description:`"${bu.Title}" has ${buDepts.length} department${buDepts.length===1?"":"s"}. Delete ${buDepts.length===1?"it":"them"} before deleting this business unit.`,variant:"destructive"});
              return;
            }
            if(!hierDivOn && divs.length>0){
              toast({title:"Can't delete yet",description:`"${bu.Title}" still has linked division data from the hidden Division tier. Re-enable the Division tier in Hierarchy settings to manage it first.`,variant:"destructive"});
              return;
            }
            const payload={kind:"bu" as const,id,label:bu.Title};
            if(deleteBusy){setPendingDelete(payload);}else{setConfirmDelete(payload);}
          }}
          actions={hierDivOn
            ? (showDivs?[{ label:"Add division", onClick:()=>setInlineAdd({type:"div",buId:id,name:""}) }]:[])
            : (showDepts?[{ label:"Add dept", onClick:()=>setInlineAdd({type:"dept",divId:"",buId:id,name:""}) }]:[])}
        />
      )}
      {hierDivOn ? (showDivs && (
        <>
          {divs.length>0 ? (
            divs.length===1 ? (
              <DivBlock div={divs[0]} color={color}/>
            ) : (
              <HBar color={color}>
                {divs.map(div=><DivBlock key={String(div.ID)} div={div} color={color}/>)}
              </HBar>
            )
          ) : null}
        </>
      )) : (showDepts && buDepts.length>0 ? (
        buDepts.length===1 ? (
          <DeptBlock dep={buDepts[0]} color={color}/>
        ) : (
          <HBar color={color}>
            {buDepts.map(dep=><DeptBlock key={String(dep.ID)} dep={dep} color={color}/>)}
          </HBar>
        )
      ) : null)}
    </div>
  );
};

// ── AddPanelContent ───────────────────────────────────────────────────────────
interface AddPanelProps {
  addPanel: AddPanel; setAddPanel:(p:AddPanel)=>void;
  buList: BusinessUnitRow[]; divList: DivisionRow[]; deptList: DepartmentRow[];
  roleList: RoleBillingRate[]; divisionsForDeptBu: DivisionRow[];
  buName:string; setBuName:(s:string)=>void; buBusy:boolean; addBusinessUnit:()=>void;
  divName:string; setDivName:(s:string)=>void; divBuId:string; setDivBuId:(s:string)=>void; divBusy:boolean; addDivision:()=>void;
  deptName:string; setDeptName:(s:string)=>void; deptBuId:string; setDeptBuId:(s:string)=>void; deptDivId:string; setDeptDivId:(s:string)=>void; deptBusy:boolean; addDepartment:()=>void;
  roleName:string; setRoleName:(s:string)=>void; roleBusy:boolean; addRole:()=>void;
  jtName:string; setJtName:(s:string)=>void; jtRoleId:string; setJtRoleId:(s:string)=>void; jtDeptId:string; setJtDeptId:(s:string)=>void; jtBusy:boolean; addJobTitle:()=>void;
}

const AddPanelContent = ({ addPanel, setAddPanel, buList, divList, deptList, roleList, divisionsForDeptBu, buName, setBuName, buBusy, addBusinessUnit, divName, setDivName, divBuId, setDivBuId, divBusy, addDivision, deptName, setDeptName, deptBuId, setDeptBuId, deptDivId, setDeptDivId, deptBusy, addDepartment, roleName, setRoleName, roleBusy, addRole, jtName, setJtName, jtRoleId, setJtRoleId, jtDeptId, setJtDeptId, jtBusy, addJobTitle }: AddPanelProps) => {
  if (!addPanel) return null;

  const field = (id:string, label:string, children:React.ReactNode) => (
    <div key={id} style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <label style={{ fontSize:11, fontWeight:600, color:MUTED }}>{label}</label>
      {children}
    </div>
  );
  const inp = (value:string, set:(v:string)=>void, ph:string, listId?:string) => (
    <input value={value} onChange={e=>set(e.target.value)} placeholder={ph} list={listId}
      style={{ background:INPBG, border:`1px solid ${BORDER}`, borderRadius:6, padding:"6px 10px", fontSize:12, color:TEXT, outline:"none", width:"100%" }} />
  );
  const sel = (value:string, set:(v:string)=>void, items:{id:string;label:string}[], placeholder:string) => (
    <Select value={value||UNASSIGNED} onValueChange={v=>set(v===UNASSIGNED?"":v)}>
      <SelectTrigger style={{ background:INPBG, border:`1px solid ${BORDER}`, borderRadius:6, fontSize:12, color:value?TEXT:MUTED }}>
        <SelectValue placeholder={placeholder}/>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>{placeholder}</SelectItem>
        {items.map(it=><SelectItem key={it.id} value={it.id}>{it.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const panels: Record<NonNullable<AddPanel>, { title:string; icon:React.ElementType; color:string; fields:React.ReactNode; onSubmit:()=>void; busy:boolean; disabled:boolean }> = {
    bu:    { title:"Add Business Unit", icon:Building2,    color:"#6366f1", onSubmit:addBusinessUnit, busy:buBusy,   disabled:!buName.trim(),   fields:<>{field("n","Name",inp(buName,setBuName,"e.g. Engineering"))}</> },
    div:   { title:"Add Division",      icon:Layers,       color:"#10b981", onSubmit:addDivision,    busy:divBusy,  disabled:!divName.trim()||!divBuId, fields:<>{field("n","Name",inp(divName,setDivName,"Division name"))}{field("b","Business Unit",sel(divBuId,setDivBuId,buList.map(b=>({id:String(b.ID),label:b.Title})),"Select BU"))}</> },
    dept:  { title:"Add Department",    icon:Briefcase,    color:"#f59e0b", onSubmit:addDepartment,  busy:deptBusy, disabled:!deptName.trim()||!deptDivId, fields:<>{field("n","Name",inp(deptName,setDeptName,"Department name"))}{field("b","Business Unit",sel(deptBuId,setDeptBuId,[{id:UNASSIGNED,label:"Unassigned"},...buList.map(b=>({id:String(b.ID),label:b.Title}))],"Select BU (optional)"))}{field("d","Division",sel(deptDivId,setDeptDivId,divisionsForDeptBu.map(d=>({id:String(d.ID),label:d.Title})),"Select Division"))}</> },
    role:  { title:"Add Role",          icon:UserCog,      color:"#8b5cf6", onSubmit:addRole,        busy:roleBusy, disabled:!roleName.trim(),  fields:<>{field("n","Role name",inp(roleName,setRoleName,"e.g. Senior Engineer"))}</> },
    title: { title:"Add Job Title",     icon:GraduationCap,color:"#f97316", onSubmit:addJobTitle,   busy:jtBusy,   disabled:!jtName.trim()||!jtRoleId,    fields:<>{field("n","Title name",<>{inp(jtName,setJtName,"e.g. Sr. Electrical Engineer","std-job-title-suggestions")}<datalist id="std-job-title-suggestions">{STANDARD_JOB_TITLES.map(t=><option key={t} value={t}/>)}</datalist></>)}{field("d","Department (optional)",sel(jtDeptId,setJtDeptId,deptList.map(d=>({id:String(d.ID),label:d.Title})),"No department"))}{field("r","Role *",sel(jtRoleId,setJtRoleId,roleList.map(r=>({id:r.id,label:r.name})),"— Select a role (required) —"))}</> },
  };

  const p = panels[addPanel];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
        <p.icon size={15} style={{ color:p.color }}/>
        <span style={{ fontSize:13, fontWeight:700, color:TEXT }}>{p.title}</span>
        <button onClick={()=>setAddPanel(null)} style={{ marginLeft:"auto", background:"transparent", border:"none", cursor:"pointer", color:MUTED }}><X size={14}/></button>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>{p.fields}</div>
      <button onClick={()=>void p.onSubmit()} disabled={p.busy||p.disabled}
        style={{ background:p.color, border:"none", borderRadius:7, padding:"8px 0", fontSize:12, fontWeight:700, color:"#fff", cursor:p.disabled||p.busy?"not-allowed":"pointer", opacity:p.disabled?0.5:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
        {p.busy?<Loader2 size={13} className="animate-spin"/>:<Plus size={13}/>} Add
      </button>
    </div>
  );
};

// ── InlineAddModal — centered popup for all quick-add forms ───────────────────
const ADD_META: Record<"bu"|"div"|"dept"|"role"|"title", { title:string; icon:React.ElementType; color:string; ph:string }> = {
  bu:    { title:"Add Business Unit", icon:Building2,     color:"#6366f1", ph:"e.g. Engineering" },
  div:   { title:"Add Division",      icon:Layers,        color:"#10b981", ph:"Division name" },
  dept:  { title:"Add Department",    icon:Briefcase,     color:"#f59e0b", ph:"Department name" },
  role:  { title:"Add Role",          icon:UserCog,       color:"#8b5cf6", ph:"e.g. Senior Engineer" },
  title: { title:"Add Job Title",     icon:GraduationCap, color:"#f97316", ph:"e.g. Sr. Electrical Engineer" },
};

const InlineAddModal = () => {
  const { inlineAdd, setInlineAdd, commitInlineAdd, inlineAddBusy, buList, divList, deptList, roleById } = useOrg();
  const [rolePickerOpen, setRolePickerOpen] = useState(false);

  // Close on Escape — hook must run unconditionally (before the null return)
  useEffect(() => {
    if (!inlineAdd) { setRolePickerOpen(false); return; }
    // Ignore Escape presses already handled by an open dropdown (Radix calls preventDefault)
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) setInlineAdd(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!inlineAdd]);

  if (!inlineAdd) return null;
  const meta = ADD_META[inlineAdd.type];
  const Icon = meta.icon;

  // Context line — what the new item will be attached under
  let parentLabel: string | null = null;
  if (inlineAdd.type === "div" && inlineAdd.buId) {
    const t = buList.find(b => String(b.ID) === inlineAdd.buId)?.Title;
    if (t) parentLabel = `Business Unit · ${t}`;
  } else if (inlineAdd.type === "dept" && inlineAdd.divId) {
    const t = divList.find(d => String(d.ID) === inlineAdd.divId)?.Title;
    if (t) parentLabel = `Division · ${t}`;
  } else if (inlineAdd.type === "dept" && inlineAdd.buId) {
    // Division tier hidden — the dept attaches under the BU (via its hidden bridge)
    const t = buList.find(b => String(b.ID) === inlineAdd.buId)?.Title;
    if (t) parentLabel = `Business Unit · ${t}`;
  } else if ((inlineAdd.type === "role" || inlineAdd.type === "title") && inlineAdd.deptId) {
    const t = deptList.find(d => String(d.ID) === inlineAdd.deptId)?.Title;
    if (t) parentLabel = `Department · ${t}`;
  }

  const roleValid = inlineAdd.type !== "title" ||
    (!!inlineAdd.roleId && (inlineAdd.roleId !== "__new__" || !!(inlineAdd.newRoleName ?? "").trim()));
  const canSubmit = !!inlineAdd.name.trim() && roleValid && !inlineAddBusy;

  // Same list as the Billing Rates screen: every tenant role PLUS the common-role
  // catalogue (deduped case-insensitively). Catalogue picks get a "new:" value and
  // are created on the fly when the job title is saved (createRole is idempotent).
  const existingRoleNames = new Set([...roleById.values()].map(n => n.trim().toLowerCase()));
  const roleOptions: { value: string; label: string; isNew?: boolean }[] = [
    ...[...roleById.entries()].map(([rid, rname]) => ({ value: rid, label: rname })),
    ...ROLE_CATALOG
      .filter(n => !existingRoleNames.has(n.trim().toLowerCase()))
      .map(n => ({ value: `new:${n.trim()}`, label: n.trim(), isNew: true })),
  ].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div onMouseDown={()=>setInlineAdd(null)}
      style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.55)", backdropFilter:"blur(2px)", zIndex:Z.MODAL, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onMouseDown={e=>e.stopPropagation()}
        style={{ background:PANEL, border:`1px solid ${BORDER}`, borderTop:`3px solid ${meta.color}`, borderRadius:14, width:380, maxWidth:"100%", padding:"20px 22px", boxShadow:"0 20px 60px rgba(0,0,0,0.35)", display:"flex", flexDirection:"column", gap:14 }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:34, height:34, borderRadius:9, background:meta.color+"18", border:`1px solid ${meta.color}40`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <Icon size={16} style={{ color:meta.color }}/>
          </div>
          <div style={{ display:"flex", flexDirection:"column", minWidth:0 }}>
            <span style={{ fontSize:14, fontWeight:800, color:TEXT }}>{meta.title}</span>
            {parentLabel && <span style={{ fontSize:10, color:MUTED, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{parentLabel}</span>}
          </div>
          <button onClick={()=>setInlineAdd(null)} style={{ marginLeft:"auto", background:"transparent", border:"none", cursor:"pointer", color:MUTED, padding:4, lineHeight:0 }}><X size={15}/></button>
        </div>
        {/* Name field */}
        <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
          <label style={{ fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:"0.06em" }}>Name</label>
          <input autoFocus placeholder={meta.ph} value={inlineAdd.name} disabled={inlineAddBusy}
            onChange={e=>setInlineAdd({...inlineAdd, name:e.target.value})}
            onKeyDown={e=>{ if(e.key==="Enter" && canSubmit) void commitInlineAdd(); }}
            style={{ background:INPBG, border:`1.5px solid ${meta.color}50`, borderRadius:8, padding:"8px 12px", fontSize:13, color:TEXT, outline:"none", width:"100%", boxSizing:"border-box" }} />
        </div>
        {/* Role picker — job titles only */}
        {inlineAdd.type==="title" && (
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
              <label style={{ fontSize:10, fontWeight:700, color:"#ef4444", textTransform:"uppercase", letterSpacing:"0.06em" }}>Role *</label>
              <span style={{ fontSize:9, color:SUBTLE }}>required to enable billing &amp; allocation</span>
            </div>
            <Popover open={rolePickerOpen} onOpenChange={setRolePickerOpen}>
              <PopoverTrigger asChild>
                <button type="button" disabled={inlineAddBusy}
                  style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, background:INPBG, border:`1.5px solid ${inlineAdd.roleId?meta.color+"50":"#ef4444"}`, borderRadius:8, padding:"0 10px", height:36, fontSize:12, fontWeight:600, color: inlineAdd.roleId ? TEXT : "#ef4444", cursor:"pointer", width:"100%", textAlign:"left" }}>
                  <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {inlineAdd.roleId==="__new__"
                      ? "＋ Create new role…"
                      : (roleOptions.find(o=>o.value===inlineAdd.roleId)?.label ?? "— Select a role (required) —")}
                  </span>
                  <ChevronDown size={14} style={{ flexShrink:0, opacity:0.6 }}/>
                </button>
              </PopoverTrigger>
              {/* Searchable combobox — white popup with black text in both themes, capped
                  height gives a scrollbar. z must beat the modal overlay's zIndex:Z.MODAL. */}
              <PopoverContent className="z-[1100] w-[336px] p-0 bg-white text-slate-900 border-slate-200" align="start">
                <Command className="bg-white text-slate-900">
                  <CommandInput placeholder="Search roles…" className="text-slate-900 placeholder:text-slate-400"/>
                  <CommandList className="max-h-56 overflow-y-auto">
                    <CommandEmpty className="py-3 text-center text-xs text-slate-500">No matching role.</CommandEmpty>
                    <CommandItem value="＋ Create new role…"
                      className="font-semibold text-violet-600 data-[selected=true]:bg-slate-100 data-[selected=true]:text-violet-700 cursor-pointer"
                      onSelect={()=>{ setInlineAdd({...inlineAdd, roleId:"__new__", newRoleName:inlineAdd.newRoleName??""}); setRolePickerOpen(false); }}>
                      ＋ Create new role…
                    </CommandItem>
                    {roleOptions.map(o=>(
                      // value gets the unique id appended so same-named roles don't
                      // collide in cmdk's selection model; users search by the label part.
                      <CommandItem key={o.value} value={`${o.label} ${o.value}`}
                        className="text-slate-900 data-[selected=true]:bg-slate-100 data-[selected=true]:text-slate-900 cursor-pointer"
                        onSelect={()=>{ setInlineAdd({...inlineAdd, roleId:o.value, newRoleName:undefined}); setRolePickerOpen(false); }}>
                        <Check size={13} className={`mr-1.5 flex-shrink-0 ${inlineAdd.roleId===o.value ? "opacity-100 text-emerald-600" : "opacity-0"}`}/>
                        {o.label}
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {inlineAdd.roleId==="__new__" && (
              <input autoFocus placeholder="New role name" value={inlineAdd.newRoleName??""} disabled={inlineAddBusy}
                onChange={e=>setInlineAdd({...inlineAdd, newRoleName:e.target.value})}
                onKeyDown={e=>{ if(e.key==="Enter" && canSubmit) void commitInlineAdd(); }}
                style={{ fontSize:12, fontWeight:600, color:"#8b5cf6", border:"1.5px solid rgba(139,92,246,0.5)", borderRadius:8, padding:"7px 10px", outline:"none", background:INPBG, width:"100%", boxSizing:"border-box" }} />
            )}
          </div>
        )}
        {/* Footer */}
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:2 }}>
          <button onClick={()=>setInlineAdd(null)}
            style={{ background:CANCEL, border:`1px solid ${BORDER}`, borderRadius:8, padding:"7px 16px", fontSize:12, fontWeight:600, color:MUTED, cursor:"pointer" }}>Cancel</button>
          <button onClick={()=>{ if(canSubmit) void commitInlineAdd(); }} disabled={!canSubmit}
            style={{ background:canSubmit?meta.color:"rgba(148,163,184,0.4)", border:"none", borderRadius:8, padding:"7px 18px", fontSize:12, fontWeight:700, color:"#fff", cursor:canSubmit?"pointer":"not-allowed", display:"flex", alignItems:"center", gap:6 }}>
            {inlineAddBusy?<Loader2 size={12} className="animate-spin"/>:<Plus size={12}/>} Add
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ManageOrganizationPage({ embedded = false, tenantId }: { embedded?: boolean; tenantId?: string | null } = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const keys = [["divisions"],["businessUnits"],["departments"],["role-billing-rates-v2"],["job-titles"]];
    const handler = () => keys.forEach(k => queryClient.invalidateQueries({ queryKey: k }));
    window.addEventListener("rmone:bustCache", handler);
    return () => window.removeEventListener("rmone:bustCache", handler);
  }, [queryClient]);

  // ── Offices popup (add office + pick staff) ──
  const [officesOpen, setOfficesOpen] = useState(false);
  // Org data grid — flat table of every BU/Division/Department with source
  // attribution ("which file added this") and plain-language blank-reason notes.
  const [gridOpen, setGridOpen] = useState(false);
  const [gridFilter, setGridFilter] = useState("");
  const [focusedEntity, setFocusedEntity] = useState<{type:string;name:string}|null>(null);
  const focusedRowRef = useRef<HTMLTableRowElement|null>(null);
  const [traceBusy, setTraceBusy] = useState<string | null>(null);
  // Raw file viewer — shows the actual uploaded Excel with highlighted rows.
  const [fileViewState, setFileViewState] = useState<{uploadId:string;fileName:string;highlightTerm:string}|null>(null);
  const [fileViewFile, setFileViewFile] = useState<ArrayBuffer|null>(null);
  const [fileViewLoading, setFileViewLoading] = useState(false);

  // ── Org hierarchy panel ──
  const [hierOpen,     setHierOpen]     = useState(true);
  const [hierSaving,   setHierSaving]   = useState(false);
  const [hierSavedAt,  setHierSavedAt]  = useState<number>(0);
  const rules = getBusinessRules();
  const [hierBU,       setHierBU]       = useState(rules.showBusinessUnit);
  const [hierDiv,      setHierDiv]      = useState(rules.showDivision);
  const [hierDept,     setHierDept]     = useState(rules.showDepartment);
  // Load authoritative values from server on mount
  useEffect(() => {
    const tid = getStoredUser()?.tenant ?? "";
    const url = tid ? `/api/onboarding/settings?tenantId=${encodeURIComponent(tid)}` : "/api/onboarding/settings";
    fetch(url, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.effective) return;
        const e = d.effective;
        if (typeof e.showBusinessUnit === "boolean") setHierBU(e.showBusinessUnit);
        if (typeof e.showDivision     === "boolean") setHierDiv(e.showDivision);
        if (typeof e.showDepartment   === "boolean") setHierDept(e.showDepartment);
      })
      .catch(() => {});
  }, []);
  const saveHier = async (showBU: boolean, showDiv: boolean, showDept: boolean) => {
    setHierSaving(true);
    try {
      const tenantId = getStoredUser()?.tenant ?? "";
      const tidParam = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
      const base = await fetch(`/api/onboarding/settings${tidParam}`, { headers: authHeaders() })
        .then(r => r.ok ? r.json() : null).catch(() => null);
      const settings = { ...(base?.effective ?? {}), showBusinessUnit: showBU, showDivision: showDiv, showDepartment: showDept };
      const r = await fetch("/api/onboarding/settings", {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, settings }),
      });
      if (!r.ok) throw new Error(await r.text());
      setHierSavedAt(Date.now());
      setTimeout(() => setHierSavedAt(0), 3000);
      await loadBusinessRules();
    } catch {
      toast({ title: "Couldn't save hierarchy settings", variant: "destructive" });
    } finally {
      setHierSaving(false);
    }
  };

  const { data: divisions,    isLoading: divLoading  } = useQuery({ queryKey:["divisions"],             queryFn:()=>getDivisions(),       staleTime:30_000 });
  const { data: businessUnits,isLoading: buLoading   } = useQuery({ queryKey:["businessUnits"],         queryFn:()=>getBusinessUnits(),   staleTime:30_000 });
  const { data: departments,  isLoading: deptLoading } = useQuery({ queryKey:["departments"],           queryFn:()=>getDepartments(),     staleTime:30_000 });
  const { data: rolesPayload                         } = useQuery({ queryKey:["role-billing-rates-v2"], queryFn:()=>getRoleBillingRates(), staleTime:30_000 });
  const { data: jobTitles                            } = useQuery({ queryKey:["job-titles"],            queryFn:()=>getJobTitles(),       staleTime:30_000 });

  // Offices moved to their own page (/offices) — they're a flat location
  // list, not part of the BU→Division→Department hierarchy shown here.

  // ── Add form state ──
  const [buName,   setBuName]   = useState(""); const [buBusy,   setBuBusy]   = useState(false);
  const [divName,  setDivName]  = useState(""); const [divBuId,  setDivBuId]  = useState(""); const [divBusy, setDivBusy] = useState(false);
  const [deptName, setDeptName] = useState(""); const [deptBuId, setDeptBuId] = useState(""); const [deptDivId, setDeptDivId] = useState(""); const [deptBusy, setDeptBusy] = useState(false);
  const [roleName, setRoleName] = useState(""); const [roleBusy, setRoleBusy] = useState(false);
  const [jtName,   setJtName]   = useState(""); const [jtRoleId, setJtRoleId] = useState(""); const [jtDeptId, setJtDeptId] = useState(""); const [jtBusy, setJtBusy] = useState(false);

  const [editing,       setEditing]       = useState<EditState>(null);
  const [editBusy,      setEditBusy]      = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDelete>(null);
  const [pendingDelete, setPendingDelete] = useState<ConfirmDelete>(null);
  const [deleteBusy,    setDeleteBusy]    = useState(false);

  // When a delete finishes and there was a queued item, auto-open its confirmation.
  React.useEffect(() => {
    if (!deleteBusy && pendingDelete) {
      setConfirmDelete(pendingDelete);
      setPendingDelete(null);
    }
  }, [deleteBusy, pendingDelete]);
  const [cleanupBusy,   setCleanupBusy]   = useState(false);
  const [addPanel,      setAddPanel]      = useState<AddPanel>(null);
  const [inlineAdd,     setInlineAdd]     = useState<InlineAdd>(null);
  const [inlineAddBusy, setInlineAddBusy] = useState(false);
  const [showDivs,   setShowDivs]   = useState(true);
  const [showDepts,  setShowDepts]  = useState(true);
  const [showRoles,  setShowRoles]  = useState(true);
  const [showTitles, setShowTitles] = useState(true);
  const [uploadBusy, setUploadBusy] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [orgConflicts,      setOrgConflicts]      = useState<OrgConflict[]>([]);
  const [orgDivChoices,     setOrgDivChoices]     = useState<Record<string, string>>({});
  const [pendingUploadRows, setPendingUploadRows] = useState<Array<Record<string, string>>>([]);
  const [pendingUploadFileName, setPendingUploadFileName] = useState("");
  // Synchronous re-entry guards: Enter key-repeat / double-clicks can fire the
  // commit handlers multiple times before React re-renders and applies the busy
  // state — creating duplicate rows server-side. Refs update instantly.
  const inlineAddSubmitRef = useRef(false);
  const deleteSubmitRef = useRef(false);

  const sortByTitle = <T extends { Title: string }>(arr: T[]): T[] =>
    [...arr].sort((a, b) => a.Title.localeCompare(b.Title));

  // Case-insensitive dedup: prefer the Title-cased entry over a lowercase duplicate.
  // Sorts uppercase-first so "Construction" beats "construction", then deduplicates.
  const dedupByTitle = <T extends { Title: string }>(arr: T[]): T[] => {
    const seen = new Set<string>();
    return [...arr]
      .sort((a, b) => {
        const aUp = a.Title.charCodeAt(0) < 97;
        const bUp = b.Title.charCodeAt(0) < 97;
        if (aUp !== bUp) return aUp ? -1 : 1;
        return a.Title.localeCompare(b.Title);
      })
      .filter(item => {
        const key = item.Title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  const buList  = sortByTitle((businessUnits ?? []) as BusinessUnitRow[]);
  const divList = sortByTitle((divisions     ?? []) as DivisionRow[]);

  // knownDivIds — current-tenant division IDs as strings, used by both deptList
  // dedup and deptsByDiv routing.  Must be computed before deptList.
  const knownDivIds = useMemo(() => new Set(divList.map(d => String(d.ID))), [divList]);

  // BU id → Title map, needed to recognise hidden "bridge" divisions (they
  // mirror their BU's name when the Division tier is toggled off).
  const buTitleById = useMemo(() => new Map(buList.map(b => [String(b.ID), b.Title] as const)), [buList]);

  // Smart dedup. A department name may legitimately exist under several DIFFERENT
  // divisions (the create path scopes uniqueness to name+division), so we must NOT
  // collapse by title alone — doing so drops a freshly-added "Construction under
  // Interiors" in favour of an existing "Construction under Commercial" the moment
  // the list refetches (the placement "reverts"). We only remove genuinely
  // redundant rows:
  //   • exact duplicates (same title + same valid division) — keep one
  //   • an orphaned / foreign-division row when a properly-linked row of the same
  //     title already exists (leftover import junk that would otherwise show twice)
  const deptList = useMemo(() => {
    const raw = sortByTitle((departments ?? []) as DepartmentRow[]);
    const isValid = (d: DepartmentRow) => {
      const id = d.DivisionIdLookup ? String(d.DivisionIdLookup) : "";
      return !!id && knownDivIds.has(id);
    };
    // Titles that have at least one properly-linked row.
    const titlesWithValidDiv = new Set<string>();
    for (const d of raw) if (isValid(d)) titlesWithValidDiv.add(d.Title.toLowerCase());
    const best = new Map<string, DepartmentRow>();
    for (const d of raw) {
      const title = d.Title.toLowerCase();
      const valid = isValid(d);
      // Drop an orphan/foreign-division row only when a valid-division row of the
      // same title exists; a lone orphan is still shown (as unassigned).
      if (!valid && titlesWithValidDiv.has(title)) continue;
      // Distinct valid divisions each keep their own row; all orphans of one title
      // collapse into a single unassigned entry.
      const key = valid ? `${title}|${String(d.DivisionIdLookup)}` : `${title}|__orphan__`;
      if (!best.has(key)) best.set(key, d);
    }
    return [...best.values()].sort((a, b) => a.Title.localeCompare(b.Title));
  }, [departments, knownDivIds]);

  const roleList = [...(rolesPayload?.rates ?? []) as RoleBillingRate[]].sort((a,b)=>a.name.localeCompare(b.name));
  const jtList   = (jobTitles ?? []) as JobTitleRow[];

  const divisionsForDeptBu = useMemo(()=>{
    if (!deptBuId) return [] as DivisionRow[];
    if (deptBuId===UNASSIGNED) return divList.filter(d=>!d.BusinessUnitIdLookup);
    return divList.filter(d=>String(d.BusinessUnitIdLookup??"")===deptBuId);
  },[divList,deptBuId]);

  const loading = divLoading || buLoading || deptLoading;

  const deptsByDiv = useMemo(()=>{
    const m = new Map<string,DepartmentRow[]>();
    for (const d of deptList) {
      const divIdStr = d.DivisionIdLookup ? String(d.DivisionIdLookup) : "";
      const k = (divIdStr && knownDivIds.has(divIdStr)) ? divIdStr : UNASSIGNED;
      m.set(k,[...(m.get(k)??[]),d]);
    }
    return m;
  },[deptList, knownDivIds]);

  const divsByBu = useMemo(()=>{
    const m = new Map<string,DivisionRow[]>();
    for (const d of divList) { const k=d.BusinessUnitIdLookup?String(d.BusinessUnitIdLookup):UNASSIGNED; m.set(k,[...(m.get(k)??[]),d]); }
    return m;
  },[divList]);

  const jtByDeptId = useMemo(()=>{
    const m = new Map<string,JobTitleRow[]>();
    for (const jt of jtList) { const k=jt.DepartmentId?String(jt.DepartmentId):UNASSIGNED; m.set(k,[...(m.get(k)??[]),jt]); }
    return m;
  },[jtList]);

  // Lowercase keys so GUID case differences (UNIQUEIDENTIFIER vs NVARCHAR) don't break lookups.
  const roleById = useMemo(()=>new Map(roleList.map(r=>[r.id.toLowerCase(),r.name])),[roleList]);
  const roleRateById = useMemo(()=>new Map(roleList.map(r=>[r.id.toLowerCase(), r.billingRate ?? r.defaultRate ?? null])),[roleList]);
  const isPlaceholder = (t: string) => /^unassigned$/i.test(t.trim());
  const orphanDepts    = (deptsByDiv.get(UNASSIGNED)??[]).filter(d => !isPlaceholder(d.Title));
  const unassignedDivs = (divsByBu.get(UNASSIGNED)??[])
    .filter(d => !isPlaceholder(d.Title) && !isBridgeDivision(d.Title, "", buTitleById));
  // Division tier hidden → unlinked real divisions aren't rendered as nodes;
  // surface their departments in the Unassigned Departments strip (plus any
  // depts hanging off the tenant-wide bridge) so they stay reachable.
  const orphanDeptsDisplay = hierDiv
    ? orphanDepts
    : [
        ...orphanDepts,
        ...(divsByBu.get(UNASSIGNED) ?? [])
          .filter(d => !isPlaceholder(d.Title))
          .flatMap(d => deptsByDiv.get(String(d.ID)) ?? []),
      ];

  // ── Org data grid: provenance + flat rows ──────────────────────────────────
  // Loaded eagerly — chart node tooltips show the source on hover, not just the
  // grid overlay. Provenance is first-seen source attribution recorded
  // server-side (imports, manual adds, org uploads, traces).
  // NOTE: deliberately NOT passing the superadmin tenant override here — every
  // other query on this page (divisions/BUs/departments and all edits) runs
  // against the logged-in tenant, so a scoped provenance fetch would attach the
  // wrong company's sources to these entities.
  const { data: provData, refetch: refetchProv } = useQuery({
    queryKey: ["org-provenance"],
    queryFn: () => getOrgProvenance(),
    staleTime: 60_000,
  });
  const provByKey = useMemo(() => {
    const m = new Map<string, OrgProvenanceEntry>();
    for (const p of (provData ?? [])) m.set(`${p.entityType}|${p.entityName.trim().toLowerCase()}`, p);
    return m;
  }, [provData]);

  /** Job-title provenance keyed by title name (lowercase) — separate map so
   *  department nodes can detect when their child titles came from a different file. */
  const jtProvByName = useMemo(() => {
    const m = new Map<string, OrgProvenanceEntry>();
    for (const p of (provData ?? [])) {
      if (p.entityType === "job_title") m.set(p.entityName.trim().toLowerCase(), p);
    }
    return m;
  }, [provData]);

  type OrgGridRow = { type: OrgEntityType; typeLabel: string; name: string; bu: string; div: string; note: string };
  const orgRows = useMemo<OrgGridRow[]>(() => {
    const rows: OrgGridRow[] = [];
    for (const b of buList) {
      rows.push({ type: "bu", typeLabel: "Business Unit", name: b.Title, bu: "", div: "", note: "" });
    }
    for (const d of divList) {
      // Bridge divisions are hidden plumbing (they mirror a BU when the Division
      // tier is off) — exclude them here exactly like the chart does.
      if (isPlaceholder(d.Title) || isBridgeDivision(d.Title, String(d.BusinessUnitIdLookup ?? ""), buTitleById)) continue;
      const buName = d.BusinessUnitIdLookup ? (buTitleById.get(String(d.BusinessUnitIdLookup)) ?? "") : "";
      rows.push({
        type: "division", typeLabel: "Division", name: d.Title, bu: buName, div: "",
        note: buName ? "" : "No Business Unit value came with this division — that's why it shows under \"Unassigned Divisions\" on the chart.",
      });
    }
    const divRowById = new Map(divList.map(d => [String(d.ID), d] as const));
    for (const dp of deptList) {
      if (isPlaceholder(dp.Title)) continue;
      const divId = dp.DivisionIdLookup ? String(dp.DivisionIdLookup) : "";
      const dv = divId ? divRowById.get(divId) : undefined;
      const bridge = dv ? isBridgeDivision(dv.Title, String(dv.BusinessUnitIdLookup ?? ""), buTitleById) : false;
      const buName = dv?.BusinessUnitIdLookup ? (buTitleById.get(String(dv.BusinessUnitIdLookup)) ?? "") : "";
      let note = "";
      if (!divId) note = "No Division value came with this department, so it isn't linked to a division (it shows as unassigned).";
      else if (!dv) note = "Linked to a division that no longer exists — re-link it or delete it.";
      else if (bridge) note = "Linked straight to its Business Unit (the Division tier is turned off for this company).";
      rows.push({ type: "department", typeLabel: "Department", name: dp.Title, bu: buName, div: dv && !bridge ? dv.Title : "", note });
    }
    return rows;
  }, [buList, divList, deptList, buTitleById]);

  const gridRows = useMemo<OrgGridRow[]>(() => {
    const f = gridFilter.trim().toLowerCase();
    if (!f) return orgRows;
    return orgRows.filter(r =>
      r.name.toLowerCase().includes(f) || r.bu.toLowerCase().includes(f) ||
      r.div.toLowerCase().includes(f) || r.typeLabel.toLowerCase().includes(f));
  }, [orgRows, gridFilter]);

  // First-wins lookup so node tooltips can reuse the same why-blank notes.
  const orgRowByKey = useMemo(() => {
    const m = new Map<string, OrgGridRow>();
    for (const r of orgRows) {
      const k = `${r.type}|${r.name.trim().toLowerCase()}`;
      if (!m.has(k)) m.set(k, r);
    }
    return m;
  }, [orgRows]);

  // "Find source" — scans this company's previously uploaded import files for
  // the name (oldest first, server-bounded) and persists a hit as "traced".
  const handleTrace = async (row: { type: OrgEntityType; name: string }) => {
    const key = `${row.type}|${row.name.toLowerCase()}`;
    if (traceBusy) return;
    setTraceBusy(key);
    try {
      const res = await traceOrgEntity(row.name, row.type);
      if (res.found) {
        const where = res.matches[0] ? ` (sheet "${res.matches[0].sheet}", column "${res.matches[0].column}")` : "";
        toast({ title: "Source found", description: `"${row.name}" first appears in "${res.fileName}"${where}.` });
        await refetchProv();
      } else if (res.complete) {
        toast({ title: "Not in any uploaded file", description: `"${row.name}" wasn't found in any of the ${res.scannedFiles} stored import file${res.scannedFiles === 1 ? "" : "s"} — it was likely typed in manually before tracking started.` });
      } else {
        toast({ title: "Not found in the files we could check", description: `"${row.name}" wasn't in the ${res.scannedFiles} file${res.scannedFiles === 1 ? "" : "s"} checked, but ${res.skippedFiles} file${res.skippedFiles === 1 ? "" : "s"} couldn't be checked (too many, too large, or unreadable) — it may still be in one of those.` });
      }
    } catch (e) {
      toast({ title: "Search failed", description: (e as Error)?.message || "Something went wrong.", variant: "destructive" });
    } finally {
      setTraceBusy(null);
    }
  };

  // Tooltip lines for chart nodes — source attribution + why-blank note.
  const hoverInfoFor = useCallback((type: OrgEntityType, name: string): string[] => {
    const key = `${type}|${name.trim().toLowerCase()}`;
    const prov = provByKey.get(key);
    const lines: string[] = [
      prov ? `Source: ${provLabel(prov)}` : "Source not recorded — added before tracking started.",
    ];
    const note = orgRowByKey.get(key)?.note;
    if (note) lines.push(note);
    return lines;
  }, [provByKey, orgRowByKey]);

  // Opens the Data Grid overlay; highlights the clicked entity row in red and scrolls to it.
  // Fetches the raw uploaded file blob and opens the file viewer with the
  // clicked entity's name as the highlight term.
  const loadFileForView = useCallback(async (uploadId: string, fileName: string, highlightTerm: string) => {
    setFileViewLoading(true);
    setFileViewFile(null);
    setFileViewState({ uploadId, fileName, highlightTerm });
    try {
      const res = await fetch(`/api/onboarding/file/${uploadId}`, { headers: authHeaders() as Record<string,string> });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFileViewFile(await res.arrayBuffer());
    } catch (e) {
      toast({ title: "Could not load file", description: extractErrMsg(e), variant: "destructive" });
      setFileViewState(null);
    } finally {
      setFileViewLoading(false);
    }
  }, [toast]);

  /** Opens the raw file viewer for a specific uploadId + fileName directly
   *  (used by secondary "View roles file" buttons on department nodes when
   *  job titles came from a different import than the node itself). */
  const openGridForUpload = useCallback((uploadId: string, fileName: string, highlightTerm?: string) => {
    void loadFileForView(uploadId, fileName, highlightTerm ?? "");
  }, [loadFileForView]);

  // Opens the Data Grid overlay. When the clicked entity has a known source
  // file (uploadId in provenance), shows the raw Excel with matching rows
  // highlighted red. Falls back to the derived org-entity table otherwise.
  const openGrid = useCallback((type?: string, name?: string) => {
    setGridFilter("");
    setFocusedEntity(type && name ? { type, name } : null);
    if (type && name) {
      const key = `${type}|${name.trim().toLowerCase()}`;
      const prov = provByKey.get(key);
      if (prov?.uploadId && prov.fileName) {
        void loadFileForView(prov.uploadId, prov.fileName, name);
        return;
      }
    }
    setGridOpen(true);
    if (type && name) {
      setTimeout(() => focusedRowRef.current?.scrollIntoView({ block:"center", behavior:"smooth" }), 80);
    }
  }, [provByKey, loadFileForView, setGridFilter, setGridOpen, setFocusedEntity]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  // Cross-level name uniqueness check — prevents same name across BU / Division / Department.
  // skipType is only used when RENAMING so the item doesn't conflict with its own current name.
  // targetDivId: when set, department uniqueness is scoped to that division only
  //   (same name is allowed under a different division).
  const checkNameConflict = (name: string, skipTypes?: readonly ("bu"|"div"|"dept")[], targetDivId?: string): string|null => {
    const skip = new Set(skipTypes ?? []);
    const n = name.trim().toLowerCase();
    if(!n) return null;
    if(!skip.has("bu")   && (businessUnits as BusinessUnitRow[]|undefined??[]).some(b=>b.Title.toLowerCase()===n))  return "Business Unit";
    if(!skip.has("div")  && (divisions    as DivisionRow[]   |undefined??[]).some(d=>d.Title.toLowerCase()===n && !isBridgeDivision(d.Title, String(d.BusinessUnitIdLookup??""), buTitleById)))  return "Division";
    if(!skip.has("dept")) {
      const depts = (departments as DepartmentRow[]|undefined??[]);
      const conflict = targetDivId
        ? depts.some(d => d.Title.toLowerCase()===n && String(d.DivisionIdLookup||"")===targetDivId)
        : depts.some(d => d.Title.toLowerCase()===n);
      if(conflict) return "Department";
    }
    return null;
  };
  // Wrapper for CREATE (no division scoping) — used for BU and Division creates
  const checkNameConflictCreate = (name: string): string|null => checkNameConflict(name, []);

  const addBusinessUnit = async () => {
    const clean=buName.trim(); if(!clean)return;
    const conflict = checkNameConflictCreate(clean);
    if(conflict){ toast({title:"Name already exists",description:`"${clean}" is already used as a ${conflict}. Choose a different name.`,variant:"destructive"}); return; }
    setBuBusy(true);
    try { await createBusinessUnit(clean); await queryClient.invalidateQueries({queryKey:["businessUnits"]}); bustCache(); setBuName(""); setAddPanel(null); toast({title:"Added",description:`"${clean}" created.`}); }
    catch(e){ toast({title:"Couldn't add",description:(e as Error)?.message||"Failed.",variant:"destructive"}); }
    finally{ setBuBusy(false); }
  };
  const addDivision = async () => {
    const clean=divName.trim(); if(!clean||!divBuId)return;
    const conflict = checkNameConflictCreate(clean);
    if(conflict){ toast({title:"Name already exists",description:`"${clean}" is already used as a ${conflict}. Choose a different name.`,variant:"destructive"}); return; }
    setDivBusy(true);
    try { await createDivision(clean,divBuId); await queryClient.invalidateQueries({queryKey:["divisions"]}); bustCache(); setDivName(""); setDivBuId(""); setAddPanel(null); toast({title:"Added",description:`"${clean}" added.`}); }
    catch(e){ toast({title:"Couldn't add",description:(e as Error)?.message||"Failed.",variant:"destructive"}); }
    finally{ setDivBusy(false); }
  };
  const addDepartment = async () => {
    const clean=deptName.trim(); if(!clean||!deptDivId)return;
    // No client-side name conflict check for departments — the server is idempotent
    // (returns the existing row when a same-named dept already exists under the same division)
    // and users may use any casing they like.
    setDeptBusy(true);
    try { await createDepartment(clean,deptDivId); bustCache(); await queryClient.refetchQueries({queryKey:["departments"]}); setDeptName(""); setDeptBuId(""); setDeptDivId(""); setAddPanel(null); toast({title:"Added",description:`"${clean}" added.`}); }
    catch(e){ toast({title:"Couldn't add",description:(e as Error)?.message||"Failed.",variant:"destructive"}); }
    finally{ setDeptBusy(false); }
  };
  const addRole = async () => {
    const clean=roleName.trim(); if(!clean)return; setRoleBusy(true);
    try { await createRole(clean); await queryClient.invalidateQueries({queryKey:["role-billing-rates-v2"]}); bustCache(); setRoleName(""); setAddPanel(null); toast({title:"Added",description:`Role "${clean}" created.`}); }
    catch(e){ toast({title:"Couldn't add",description:(e as Error)?.message||"Failed.",variant:"destructive"}); }
    finally{ setRoleBusy(false); }
  };
  const addJobTitle = async () => {
    const clean=jtName.trim(); if(!clean)return; setJtBusy(true);
    try { await createJobTitle(clean,jtDeptId||undefined,jtRoleId||undefined); await queryClient.invalidateQueries({queryKey:["job-titles"]}); bustCache(); setJtName(""); setJtRoleId(""); setJtDeptId(""); setAddPanel(null); toast({title:"Added",description:`Job title "${clean}" created.`}); }
    catch(e){ toast({title:"Couldn't add",description:(e as Error)?.message||"Failed.",variant:"destructive"}); }
    finally{ setJtBusy(false); }
  };
  const commitEdit = async () => {
    if(!editing)return;
    const cleanName = editing.name.trim();
    if(!cleanName) return;
    // Skip the item's own type so it doesn't conflict with its current name;
    // still blocks if the new name matches something at another level.
    const editSkip = editing.type==="bu"?["bu"] as const: editing.type==="div"?["div"] as const: editing.type==="dept"?["dept"] as const: undefined;
    const conflict = editSkip ? checkNameConflict(cleanName, editSkip) : null;
    if(conflict){ toast({title:"Name already exists", description:`"${cleanName}" is already used as a ${conflict}. Choose a different name.`, variant:"destructive"}); return; }
    setEditBusy(true);
    try {
      if(editing.type==="bu"){ await renameBusinessUnit(editing.id,cleanName); await queryClient.refetchQueries({queryKey:["businessUnits"]}); bustCache(); toast({title:"Renamed",description:`Renamed to "${cleanName}".`}); }
      else if(editing.type==="div"){ const changed=editing.buId!==editing.originalBuId; await updateDivision(editing.id,cleanName,changed?(editing.buId||null):undefined); await queryClient.refetchQueries({queryKey:["divisions"]}); bustCache(); toast({title:"Updated"}); }
      else if(editing.type==="dept"){ const changed=editing.divId!==editing.originalDivId; await updateDepartment(editing.id,cleanName,changed?(editing.divId||null):undefined); await queryClient.refetchQueries({queryKey:["departments"]}); bustCache(); toast({title:"Updated"}); }
      setEditing(null);
    } catch(e){ toast({title:"Couldn't save",description:(e as Error)?.message||"Failed.",variant:"destructive"}); }
    finally{ setEditBusy(false); }
  };
  const commitDelete = async () => {
    if(!confirmDelete) return;
    if(deleteSubmitRef.current) return; // re-entry guard — see ref declaration
    const snap = confirmDelete;

    deleteSubmitRef.current = true;
    setDeleteBusy(true);

    // Optimistic: remove from cache and dismiss the popup immediately so the
    // node vanishes the moment the user confirms — no frozen spinner waiting.
    // If the API call fails we refetch to restore the item.
    if(snap.kind==="bu") {
      queryClient.setQueryData<unknown[]>(["businessUnits"], (old=[]) =>
        (old as {ID:unknown}[]).filter(r=>String(r.ID)!==snap.id));
    } else if(snap.kind==="div") {
      queryClient.setQueryData<unknown[]>(["divisions"], (old=[]) =>
        (old as {ID:unknown}[]).filter(r=>String(r.ID)!==snap.id));
    } else if(snap.kind==="dept") {
      queryClient.setQueryData<unknown[]>(["departments"], (old=[]) =>
        (old as {ID:unknown}[]).filter(r=>String(r.ID)!==snap.id));
    }
    setConfirmDelete(null); // close popup right away

    try {
      if(snap.kind==="bu") {
        await deleteBusinessUnit(snap.id, snap.label);
        await queryClient.refetchQueries({queryKey:["businessUnits"]});
      } else if(snap.kind==="div") {
        await deleteDivision(snap.id, snap.label);
        await queryClient.refetchQueries({queryKey:["divisions"]});
      } else if(snap.kind==="dept") {
        await deleteDepartment(snap.id, snap.label, snap.divId);
        await queryClient.refetchQueries({queryKey:["departments"]});
      } else if(snap.kind==="role") {
        await deleteRole(snap.id);
        await queryClient.invalidateQueries({queryKey:["role-billing-rates-v2"]});
      }
      bustCache();
      toast({title:"Deleted", description:`"${snap.label}" removed.`});
    } catch(e){
      toast({title:"Couldn't delete", description: extractErrMsg(e), variant:"destructive"});
      // Restore: refetch so the item reappears if the server rejected the delete.
      bustCache();
      void queryClient.refetchQueries({queryKey:["businessUnits"]});
      void queryClient.refetchQueries({queryKey:["divisions"]});
      void queryClient.refetchQueries({queryKey:["departments"]});
    } finally {
      deleteSubmitRef.current = false;
      setDeleteBusy(false);
    }
  };
  const commitCleanup = async () => {
    setCleanupBusy(true);
    try {
      const {deleted}=await cleanupOrganization();
      const total=deleted.departments+deleted.divisions+deleted.businessUnits;
      await Promise.all([queryClient.invalidateQueries({queryKey:["businessUnits"]}),queryClient.invalidateQueries({queryKey:["divisions"]}),queryClient.invalidateQueries({queryKey:["departments"]})]);
      bustCache(); toast({title:total>0?`Removed ${total} unused`:"Nothing to remove",description:total>0?`${deleted.businessUnits} BU, ${deleted.divisions} div, ${deleted.departments} dept.`:"All entries have staff."});
    } catch(e){ toast({title:"Cleanup failed",variant:"destructive"}); }
    finally{ setCleanupBusy(false); }
  };

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const rules = getBusinessRules();

    // Only include tiers that are currently enabled — mirrors what the forms show
    type Col = { header: string; samples: string[] };
    const allCols: Col[] = [
      { header: "Business Unit",      samples: ["Buildings",      "Buildings",            "Civil & Transit",    "Higher Education",  "Leadership"]  },
      { header: "Division",           samples: ["Architecture",   "Commercial",           "Engineering",        "Academic",          "Leadership"]  },
      { header: "Department",         samples: ["Design",         "Business Development", "Structural",         "Project Management","Management"]  },
      { header: "Role",               samples: ["Architect",      "Business Dev",         "Engineer",           "Project Manager",   "Principal"]   },
      { header: "Job Title",          samples: ["Lead Architect",  "Business Dev Manager","Structural Engineer","Senior PM",        "Principal"]   },
    ];
    const activeCols = allCols.filter(c =>
      c.header === "Division"      ? rules.showDivision :
      c.header === "Business Unit" ? rules.showBusinessUnit :
      c.header === "Department"    ? rules.showDepartment   :
      true                                               // Role + Job Title always included
    );

    const headers = activeCols.map(c => c.header);
    const samples = activeCols[0].samples.map((_, rowIdx) =>
      activeCols.map(c => c.samples[rowIdx])
    );

    const ws = XLSX.utils.aoa_to_sheet([headers, ...samples]);
    ws["!cols"] = headers.map(() => ({ wch: 24 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Organization");
    XLSX.writeFile(wb, "org_structure_template.xlsx");
  };

  const applyOrgUploadResult = async (result: Awaited<ReturnType<typeof bulkUploadOrg>>) => {
    if (result.needsDisambiguation && result.conflicts?.length) {
      setOrgConflicts(result.conflicts);
      setOrgDivChoices({});
      return;
    }
    const { counts, errors } = result;
    const total = counts.bus + counts.divs + counts.depts + counts.roles + counts.jobTitles;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["businessUnits"] }),
      queryClient.invalidateQueries({ queryKey: ["divisions"] }),
      queryClient.invalidateQueries({ queryKey: ["departments"] }),
      queryClient.invalidateQueries({ queryKey: ["role-billing-rates-v2"] }),
      queryClient.invalidateQueries({ queryKey: ["job-titles"] }),
    ]);
    bustCache();
    const parts = [
      counts.bus       && `${counts.bus} BU`,
      counts.divs      && `${counts.divs} division${counts.divs !== 1 ? "s" : ""}`,
      counts.depts     && `${counts.depts} dept${counts.depts !== 1 ? "s" : ""}`,
      counts.roles     && `${counts.roles} role${counts.roles !== 1 ? "s" : ""}`,
      counts.jobTitles && `${counts.jobTitles} job title${counts.jobTitles !== 1 ? "s" : ""}`,
    ].filter(Boolean).join(", ");
    toast({
      title: total > 0 ? "Organization imported" : "Nothing new to add",
      description: total > 0 ? `Created: ${parts}${errors.length ? ` · ${errors.length} error(s)` : ""}` : undefined,
      variant: errors.length && total === 0 ? "destructive" : "default",
    });
    if (errors.length) console.warn("[org-upload] row errors:", errors);
  };

  const handleOrgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadBusy(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
      const normalise = (k: string) => k.trim().toLowerCase().replace(/\s+/g, "_");
      const rows = raw.map(r => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) out[normalise(k)] = String(v ?? "").trim();
        return out;
      }).filter(r => Object.values(r).some(v => v));
      if (rows.length === 0) {
        toast({ title: "Empty file", description: "No data rows found.", variant: "destructive" });
        return;
      }
      setPendingUploadRows(rows);
      setPendingUploadFileName(file.name);
      const result = await bulkUploadOrg(rows, undefined, file.name);
      await applyOrgUploadResult(result);
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error)?.message || "Something went wrong.", variant: "destructive" });
    } finally {
      setUploadBusy(false);
    }
  };

  const submitOrgWithHints = async () => {
    setUploadBusy(true);
    try {
      const result = await bulkUploadOrg(pendingUploadRows, orgDivChoices, pendingUploadFileName || undefined);
      setOrgConflicts([]);
      setPendingUploadRows([]);
      setPendingUploadFileName("");
      setOrgDivChoices({});
      await applyOrgUploadResult(result);
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error)?.message || "Something went wrong.", variant: "destructive" });
    } finally {
      setUploadBusy(false);
    }
  };
  const commitInlineAdd = async () => {
    if(!inlineAdd) return;
    if(inlineAddSubmitRef.current) return; // re-entry guard — see ref declaration
    const snap = inlineAdd;
    const clean = snap.name.trim();
    if(!clean) return;

    // BU and Division names must be unique across all entity types.
    // Departments have no client-side conflict check — the server is idempotent and users may use any casing.
    if(snap.type==="bu"||snap.type==="div"){
      const conflict = checkNameConflict(clean, []);
      if(conflict){
        toast({title:"Name already exists", description:`"${clean}" is already used as a ${conflict}. Choose a different name.`, variant:"destructive"});
        return;
      }
    }
    inlineAddSubmitRef.current = true;
    setInlineAddBusy(true);

    // Optimistic: inject a temp row into the cache so the node appears immediately
    const tempId = Date.now();
    const tempRoleId = String(tempId) + "_role";
    if(snap.type==="bu"){
      const prev = queryClient.getQueryData<BusinessUnitRow[]>(["businessUnits"]) ?? [];
      queryClient.setQueryData(["businessUnits"], [...prev, { ID:tempId, Title:clean }]);
    } else if(snap.type==="div"){
      const prev = queryClient.getQueryData<DivisionRow[]>(["divisions"]) ?? [];
      queryClient.setQueryData(["divisions"], [...prev, { ID:tempId, Title:clean, BusinessUnitIdLookup:snap.buId||null }]);
    } else if(snap.type==="dept"){
      const prev = queryClient.getQueryData<DepartmentRow[]>(["departments"]) ?? [];
      queryClient.setQueryData(["departments"], [...prev, { ID:String(tempId), Title:clean, DivisionIdLookup:snap.divId||null }]);
    } else if(snap.type==="role"){
      // A role alone is invisible — it only appears as a grouping header when it has job titles.
      // Optimistically inject both a temp role and a temp job title so the node shows immediately.
      // The query stores { rates: RoleBillingRate[], hasDeptRates: boolean } — preserve that shape.
      const prevPayload = queryClient.getQueryData<{rates:RoleBillingRate[];hasDeptRates:boolean}>(["role-billing-rates-v2"]);
      const prevRoles = prevPayload?.rates ?? [];
      queryClient.setQueryData(["role-billing-rates-v2"], { ...(prevPayload??{}), rates:[...prevRoles, { id:tempRoleId, name:clean }] });
      const prevJTs = queryClient.getQueryData<JobTitleRow[]>(["job-titles"]) ?? [];
      queryClient.setQueryData(["job-titles"], [...prevJTs, { ID:tempId, Title:clean, JobTitleName:clean, RoleId:tempRoleId, DepartmentId:snap.deptId||undefined } as JobTitleRow]);
      setShowRoles(true);   // reveal the Roles layer so the new node is visible
      setShowTitles(true);  // reveal Titles too so the linked title shows
    } else if(snap.type==="title"){
      const prevJTs = queryClient.getQueryData<JobTitleRow[]>(["job-titles"]) ?? [];
      // Sentinel role values ("__new__" / "new:<name>") aren't real role IDs — omit them
      // from the optimistic row so the tree never renders the raw sentinel string.
      const optimisticRoleId = snap.roleId && snap.roleId!=="__new__" && !snap.roleId.startsWith("new:") ? snap.roleId : undefined;
      queryClient.setQueryData(["job-titles"], [...prevJTs, { ID:tempId, Title:clean, JobTitleName:clean, RoleId:optimisticRoleId, DepartmentId:snap.deptId||undefined } as JobTitleRow]);
      setShowTitles(true);
      if(snap.roleId) setShowRoles(true); // reveal Roles layer if this title is linked to a role
    }

    setInlineAdd(null); // close form instantly — node is already visible above

    try {
      if(snap.type==="bu")    { await createBusinessUnit(clean);                                   await queryClient.invalidateQueries({queryKey:["businessUnits"]}); bustCache(); }
      else if(snap.type==="div")   { await createDivision(clean, snap.buId||undefined);            await queryClient.invalidateQueries({queryKey:["divisions"]}); bustCache(); }
      else if(snap.type==="dept")  {
        // Division tier hidden → no division was picked; attach the dept to the
        // BU's hidden bridge division (find-or-create, server-side idempotent).
        const targetDivId = snap.divId || await resolveDivisionForSave("", snap.buId);
        await createDepartment(clean, targetDivId||undefined);
        // bustCache FIRST so the api.ts in-memory cache is cleared before React Query re-fetches.
        // Calling invalidateQueries first causes the re-fetch to fire before the cache is cleared
        // and it picks up the old stale result.
        bustCache();
        await queryClient.refetchQueries({queryKey:["departments"]});
      }
      else if(snap.type==="role")  {
        // Create the role then a same-named job title linked to this dept — so it's visible in the chart
        const role = await createRole(clean);
        await createJobTitle(clean, snap.deptId||undefined, role.id);
        // Use invalidateQueries (not refetchQueries) so React Query marks data stale and
        // actually hits the server — refetchQueries skips the call when staleTime is still fresh
        // (setQueryData was called moments ago, marking data "fresh" for 30s).
        await Promise.all([
          queryClient.invalidateQueries({queryKey:["role-billing-rates-v2"]}),
          queryClient.invalidateQueries({queryKey:["job-titles"]}),
        ]);
        bustCache();
      }
      else if(snap.type==="title") {
        let resolvedRoleId = snap.roleId && snap.roleId!=="__new__" && !snap.roleId.startsWith("new:") ? snap.roleId : undefined;
        if(snap.roleId==="__new__" && snap.newRoleName?.trim()){
          const newRole = await createRole(snap.newRoleName.trim());
          resolvedRoleId = newRole.id;
          await queryClient.invalidateQueries({queryKey:["role-billing-rates-v2"]});
        } else if(snap.roleId?.startsWith("new:")){
          // Catalogue role picked in the modal — create it on the fly (idempotent:
          // createRole returns the existing role if the name already exists).
          const newRole = await createRole(snap.roleId.slice(4));
          resolvedRoleId = newRole.id;
          await queryClient.invalidateQueries({queryKey:["role-billing-rates-v2"]});
        }
        await createJobTitle(clean, snap.deptId||undefined, resolvedRoleId);
        await queryClient.refetchQueries({queryKey:["job-titles"]});
        bustCache();
      }
    } catch(e){
      // Rollback the optimistic entry on failure
      if(snap.type==="bu")   await queryClient.refetchQueries({queryKey:["businessUnits"]});
      else if(snap.type==="div")  await queryClient.refetchQueries({queryKey:["divisions"]});
      else if(snap.type==="dept") await queryClient.refetchQueries({queryKey:["departments"]});
      else if(snap.type==="role") { await queryClient.refetchQueries({queryKey:["role-billing-rates-v2"]}); await queryClient.refetchQueries({queryKey:["job-titles"]}); }
      else if(snap.type==="title") await queryClient.refetchQueries({queryKey:["job-titles"]});
      toast({title:"Couldn't add", description:(e as Error)?.message||"Failed.", variant:"destructive"});
    } finally {
      inlineAddSubmitRef.current = false;
      setInlineAddBusy(false);
    }
  };

  const hasAnyOrg = buList.length>0 || (hierDiv && unassignedDivs.length>0) || orphanDeptsDisplay.length>0;

  const levels = [
    ...(hierDiv ? [{key:"divs",  label:"Divisions",   active:showDivs,   set:setShowDivs}] : []),
    {key:"depts", label:"Departments", active:showDepts,  set:setShowDepts},
    {key:"roles", label:"Roles",       active:showRoles,  set:setShowRoles},
    {key:"titles",label:"Job Titles",  active:showTitles, set:setShowTitles},
  ];
  const addButtons = [
    {key:"bu" as AddPanel, label:"+ Add New BU Structure", color:"#6366f1"},
  ];

  // Context value
  const ctxValue = useMemo(()=>({
    editing, setEditing, editBusy, commitEdit,
    confirmDelete, setConfirmDelete, pendingDelete, setPendingDelete, deleteBusy, commitDelete,
    inlineAdd, setInlineAdd, inlineAddBusy, commitInlineAdd,
    divList, buList, deptList, showDivs, showDepts, showRoles, showTitles,
    hierDivOn: hierDiv,
    deptsByDiv, jtByDeptId, roleById, roleRateById,
    divsByBu, setAddPanel, hoverInfoFor, openGrid, openGridForUpload, jtProvByName, orgProvByKey: provByKey,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }),[editing,editBusy,confirmDelete,pendingDelete,deleteBusy,inlineAdd,inlineAddBusy,divList,buList,deptList,showDivs,showDepts,showRoles,showTitles,hierDiv,deptsByDiv,jtByDeptId,roleById,roleRateById,divsByBu,setAddPanel,hoverInfoFor,openGrid,openGridForUpload,jtProvByName,provByKey]);

  return (
    <OrgCtx.Provider value={ctxValue}>
      <div style={{ display:"flex", flexDirection:"column", height:embedded?"100%":"100vh", background:BG, fontFamily:"'Inter',system-ui,sans-serif", overflow:"hidden" }}>

        {/* ── Toolbar ── */}
        <div style={{ padding:embedded?"8px 20px":"14px 24px", borderBottom:`1px solid ${BORDER}`, display:"flex", alignItems:"center", justifyContent:"space-between", background:PANEL, flexShrink:0, flexWrap:"wrap", gap:10 }}>
          {/* ── Left: title + colour legend ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {!embedded && (
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#6366f1", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:2 }}>Organization</div>
                <div style={{ fontSize:17, fontWeight:800, color:TEXT }}>Company Structure</div>
              </div>
            )}
            {/* ── Colour legend ── */}
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              {[
                {label:"Business Unit", color:"#6366f1"},
                {label:"Division",      color:"#10b981"},
                {label:"Department",    color:"#f59e0b"},
                {label:"Role",          color:"#8b5cf6"},
                {label:"Job Title",     color:"#f97316"},
              ].filter(item=>item.label!=="Division"||hierDiv).map(item=>(
                <div key={item.label} style={{ display:"flex", alignItems:"center", gap:3 }}>
                  <div style={{ width:7, height:7, borderRadius:"50%", background:item.color, flexShrink:0 }}/>
                  <span style={{ fontSize:10, color:MUTED, fontWeight:500, whiteSpace:"nowrap" }}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right: action buttons ── */}
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>

            {/* ── Offices popup — add offices + pick their staff ── */}
            <button onClick={()=>setOfficesOpen(true)} style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 11px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", border:"1.5px solid #0ea5e940", background:"transparent", color:"#0ea5e9", transition:"all 0.15s" }}>
              <Building2 size={12}/> Offices
            </button>
            {officesOpen && (
              <div
                onMouseDown={e => { if (e.target === e.currentTarget) setOfficesOpen(false); }}
                style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.55)", zIndex:Z.GRID_POPUP, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(2px)", padding:16 }}>
                <div style={{ background:"hsl(var(--background))", borderRadius:16, width:"min(960px, 100%)", maxHeight:"min(760px, calc(100vh - 48px))", display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:"0 20px 60px rgba(15,23,42,0.25)" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", padding:"10px 14px 0" }}>
                    <button onClick={()=>setOfficesOpen(false)} title="Close"
                      style={{ display:"flex", background:"none", border:"none", cursor:"pointer", color:MUTED, padding:6 }}>
                      <X size={17}/>
                    </button>
                  </div>
                  <div style={{ flex:1, overflowY:"auto", padding:"0 24px" }}>
                    <OfficesPage embedded tenantId={tenantId} />
                  </div>
                </div>
              </div>
            )}

            {/* ── Org data grid ── */}
            <button onClick={()=>setGridOpen(true)} style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 11px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", border:"1.5px solid #94a3b840", background:"transparent", color:MUTED, transition:"all 0.15s" }}>
              <Table2 size={12}/> Data Grid
            </button>
            {/* Raw file viewer — shown when a node with a known source file is clicked */}
            {(fileViewState || fileViewLoading) && (
              <RawFileViewer
                fileName={fileViewState?.fileName ?? ""}
                highlightTerm={fileViewState?.highlightTerm ?? ""}
                file={fileViewFile}
                loading={fileViewLoading}
                onClose={() => { setFileViewState(null); setFileViewFile(null); setFileViewLoading(false); }}
              />
            )}
            {gridOpen && (
              <div
                onMouseDown={e => { if (e.target === e.currentTarget) { setGridOpen(false); setFocusedEntity(null); } }}
                style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.55)", zIndex:Z.GRID_POPUP, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(2px)", padding:16 }}>
                <div style={{ background:"hsl(var(--background))", borderRadius:16, width:"min(1150px, 100%)", maxHeight:"min(780px, calc(100vh - 48px))", display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:"0 20px 60px rgba(15,23,42,0.25)" }}>
                  {/* Header */}
                  <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", padding:"18px 24px 12px", gap:12 }}>
                    <div>
                      <div style={{ fontSize:15, fontWeight:700, color:TEXT, letterSpacing:"-0.01em" }}>Organization data</div>
                      <div style={{ fontSize:11.5, color:MUTED, marginTop:3, lineHeight:1.5 }}>
                        Every Business Unit, Division and Department — where each one came from, and why some links are blank. Entities added before tracking started show <b style={{color:"#f87171"}}>Not recorded</b>.
                      </div>
                    </div>
                    <button onClick={()=>{ setGridOpen(false); setFocusedEntity(null); }} title="Close"
                      style={{ display:"flex", background:"none", border:"none", cursor:"pointer", color:MUTED, padding:6, flexShrink:0 }}>
                      <X size={17}/>
                    </button>
                  </div>
                  {/* Filter */}
                  <div style={{ padding:"0 24px 10px", display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ position:"relative", flex:"0 1 320px" }}>
                      <Search size={13} style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", color:SUBTLE }}/>
                      <input
                        value={gridFilter}
                        onChange={e=>setGridFilter(e.target.value)}
                        placeholder="Filter by name, BU, division…"
                        style={{ width:"100%", padding:"6px 10px 6px 28px", borderRadius:7, border:`1.5px solid ${BORDER2}`, background:PANEL, color:TEXT, fontSize:12, outline:"none" }}/>
                    </div>
                    <span style={{ fontSize:11, color:SUBTLE }}>{gridRows.length} row{gridRows.length===1?"":"s"}</span>
                  </div>
                  {/* Table */}
                  <div style={{ flex:1, overflow:"auto", padding:"0 24px 20px" }}>
                    <table style={{ width:"100%", borderCollapse:"separate", borderSpacing:0, fontSize:12 }}>
                      <thead>
                        <tr>
                          {["Type","Name","Business Unit","Division","Source","Notes"].map(h => (
                            <th key={h} style={{ position:"sticky", top:0, background:"hsl(var(--background))", textAlign:"left", padding:"8px 10px", borderBottom:`1.5px solid ${BORDER2}`, fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:MUTED, whiteSpace:"nowrap", zIndex:1 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {gridRows.length === 0 && (
                          <tr><td colSpan={6} style={{ padding:"22px 10px", color:SUBTLE, textAlign:"center" }}>
                            {loading ? "Loading…" : gridFilter ? "Nothing matches the filter." : "No organization data yet."}
                          </td></tr>
                        )}
                        {gridRows.map((r) => {
                          const key = `${r.type}|${r.name.trim().toLowerCase()}`;
                          const prov = provByKey.get(key);
                          const busy = traceBusy === key;
                          const typeColor = r.type === "bu" ? "#6366f1" : r.type === "division" ? "#10b981" : "#f59e0b";
                          const focusedKey = focusedEntity ? `${focusedEntity.type}|${focusedEntity.name.trim().toLowerCase()}` : null;
                          const isFocused = key === focusedKey;
                          return (
                            <tr key={key}
                              ref={isFocused ? (el => { focusedRowRef.current = el; }) : undefined}
                              style={{ background: isFocused ? "#ef444430" : !prov ? "#ef444408" : "transparent",
                                       outline: isFocused ? "2px solid #ef4444" : "none",
                                       outlineOffset: "-1px" }}>
                              <td style={{ padding:"7px 10px", borderBottom:`1px solid ${BORDER}`, whiteSpace:"nowrap" }}>
                                <span style={{ fontSize:10, fontWeight:700, color:typeColor, background:typeColor+"14", padding:"2px 8px", borderRadius:999 }}>{r.typeLabel}</span>
                              </td>
                              <td style={{ padding:"7px 10px", borderBottom:`1px solid ${BORDER}`, fontWeight:600, color:TEXT }}>{r.name}</td>
                              <td style={{ padding:"7px 10px", borderBottom:`1px solid ${BORDER}`, color:r.bu?TEXT:SUBTLE }}>{r.type==="bu" ? "—" : (r.bu || "blank")}</td>
                              <td style={{ padding:"7px 10px", borderBottom:`1px solid ${BORDER}`, color:r.div?TEXT:SUBTLE }}>{r.type!=="department" ? "—" : (r.div || "blank")}</td>
                              <td style={{ padding:"7px 10px", borderBottom:`1px solid ${BORDER}`, maxWidth:280 }}>
                                {prov && prov.source !== "manual" && prov.fileName ? (
                                  <div>
                                    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                                      <FileText size={12} style={{ color:"#60a5fa", flexShrink:0 }} />
                                      <span style={{ fontSize:12, fontWeight:600, color:TEXT }}>{prov.fileName}</span>
                                    </div>
                                    {prov.createdAt && <div style={{ fontSize:10, color:SUBTLE, marginTop:2 }}>{new Date(prov.createdAt).toLocaleDateString()}</div>}
                                  </div>
                                ) : prov && prov.source === "manual" ? (
                                  <span style={{ fontSize:12, color:TEXT }}>Added manually{prov.createdBy ? ` — ${prov.createdBy}` : ""}</span>
                                ) : (
                                  <span style={{ fontSize:12, fontWeight:600, color:"#f87171" }}>Not recorded</span>
                                )}
                              </td>
                              <td style={{ padding:"7px 10px", borderBottom:`1px solid ${BORDER}`, color:MUTED, maxWidth:300, lineHeight:1.45 }}>{r.note || ""}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── Template download ── */}
            <button onClick={()=>void downloadTemplate()} style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 11px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", border:"1.5px solid #94a3b840", background:"transparent", color:MUTED, transition:"all 0.15s" }}>
              <Download size={12}/> Template
            </button>

            {/* ── Bulk upload ── */}
            <input ref={uploadRef} type="file" accept=".xlsx,.xls,.csv" style={{ display:"none" }} onChange={handleOrgUpload}/>
            <button onClick={()=>uploadRef.current?.click()} disabled={uploadBusy} style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 11px", borderRadius:6, fontSize:11, fontWeight:600, cursor:uploadBusy?"not-allowed":"pointer", border:"1.5px solid #10b98140", background:"transparent", color:uploadBusy?"#94a3b8":"#10b981", transition:"all 0.15s" }}>
              {uploadBusy ? <Loader2 size={12} className="animate-spin"/> : <Upload size={12}/>}
              {uploadBusy ? "Importing…" : "Upload"}
            </button>

            {/* ── Disambiguation dialog ── */}
            {orgConflicts.length > 0 && (() => {
              const PALETTE = ["#6366f1","#10b981","#f59e0b","#ec4899","#0ea5e9","#8b5cf6","#f97316","#14b8a6"];
              const BU_PALETTE = ["#6366f1","#0ea5e9","#10b981","#f59e0b","#ec4899","#8b5cf6","#f97316","#14b8a6"];
              const allChosen = !orgConflicts.some(c => !orgDivChoices[c.divLower]);
              return (
                <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.55)", zIndex:Z.POPUP, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(2px)" }}>
                  <div style={{ background:"#ffffff", borderRadius:16, overflow:"hidden", maxWidth:460, width:"calc(100% - 32px)", boxShadow:"0 20px 60px rgba(15,23,42,0.18), 0 4px 16px rgba(15,23,42,0.10)" }}>

                    {/* Gradient header */}
                    <div style={{ background:"linear-gradient(135deg,#6366f1 0%,#10b981 100%)", padding:"18px 24px 16px" }}>
                      <p style={{ fontSize:14, fontWeight:700, color:"#fff", marginBottom:3, letterSpacing:"-0.01em" }}>Assign divisions to Business Units</p>
                      <p style={{ fontSize:11, color:"rgba(255,255,255,0.78)", lineHeight:1.5 }}>
                        The same division name appears under multiple Business Units in your file. Select one for each below.
                      </p>
                    </div>

                    {/* Conflicts */}
                    <div style={{ padding:"20px 24px 0", display:"flex", flexDirection:"column", gap:18 }}>
                      {orgConflicts.map((conflict, ci) => {
                        const divColor = PALETTE[ci % PALETTE.length];
                        return (
                          <div key={conflict.divLower}>
                            {ci > 0 && <div style={{ height:1, background:"#f1f5f9", marginBottom:18 }}/>}
                            {/* Division pill */}
                            <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:10 }}>
                              <span style={{ padding:"2px 10px", borderRadius:20, background:divColor+"18", border:`1.5px solid ${divColor}50`, fontSize:11, fontWeight:700, color:divColor, letterSpacing:"0.01em" }}>
                                {conflict.divName}
                              </span>
                              <span style={{ fontSize:11, color:"#94a3b8" }}>— select a Business Unit</span>
                            </div>
                            {/* BU option cards */}
                            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                              {conflict.busInFile.map((bu, bi) => {
                                const selected = orgDivChoices[conflict.divLower] === bu;
                                const buColor = BU_PALETTE[(bi * 3 + ci + 1) % BU_PALETTE.length];
                                return (
                                  <button
                                    key={bu}
                                    type="button"
                                    onClick={() => setOrgDivChoices(prev => ({ ...prev, [conflict.divLower]: bu }))}
                                    style={{
                                      display:"flex", alignItems:"center", gap:10,
                                      padding:"10px 14px", borderRadius:9, cursor:"pointer",
                                      border: selected ? `2px solid ${buColor}` : "2px solid #e2e8f0",
                                      background: selected ? buColor+"14" : "#f8fafc",
                                      textAlign:"left", width:"100%", transition:"border-color 0.12s, background 0.12s",
                                    }}
                                  >
                                    <div style={{
                                      width:16, height:16, borderRadius:"50%", flexShrink:0,
                                      border: selected ? `5px solid ${buColor}` : "2px solid #cbd5e1",
                                      background:"#fff", transition:"border 0.12s",
                                    }}/>
                                    <span style={{ fontSize:12, fontWeight: selected ? 600 : 400, color: selected ? buColor : "#334155" }}>
                                      {bu}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Footer */}
                    <div style={{ display:"flex", gap:8, padding:"16px 24px 20px", marginTop:16, justifyContent:"flex-end", borderTop:"1px solid #f1f5f9" }}>
                      <button
                        onClick={() => { setOrgConflicts([]); setPendingUploadRows([]); setOrgDivChoices({}); }}
                        style={{ padding:"7px 16px", borderRadius:8, fontSize:12, fontWeight:500, cursor:"pointer", border:"1.5px solid #e2e8f0", background:"#fff", color:"#64748b" }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void submitOrgWithHints()}
                        disabled={uploadBusy || !allChosen}
                        style={{
                          padding:"7px 18px", borderRadius:8, fontSize:12, fontWeight:600,
                          cursor:(uploadBusy || !allChosen) ? "not-allowed" : "pointer",
                          background: allChosen ? "linear-gradient(135deg,#6366f1,#10b981)" : "#c7d2fe",
                          border:"none", color:"#fff", display:"flex", alignItems:"center", gap:6,
                        }}
                      >
                        {uploadBusy ? <><Loader2 size={11} className="animate-spin"/> Importing…</> : "Confirm & import"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {addButtons.map(ab=>{
              const isBU = ab.key==="bu";
              const buActive = isBU && inlineAdd?.type==="bu";
              const panelActive = !isBU && addPanel===ab.key;
              const active = isBU ? buActive : panelActive;
              return (
                <button key={ab.key} onClick={()=>{
                  if(isBU){ setInlineAdd(buActive?null:{type:"bu",name:""}); }
                  else { setAddPanel(panelActive?null:ab.key as AddPanel); }
                }} style={{ padding:"4px 11px", borderRadius:6, fontSize:11, fontWeight:700, cursor:"pointer", border:`1.5px solid ${active?ab.color:ab.color+"40"}`, background:active?ab.color+"15":"transparent", color:active?ab.color:ab.color+"bb", transition:"all 0.15s" }}>
                  {ab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Organization Hierarchy panel ── */}
        <div style={{ borderBottom: `1px solid ${BORDER}`, flexShrink: 0, background: PANEL }}>
          {/* Header row — always visible */}
          <button
            onClick={() => setHierOpen(v => !v)}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 24px", background: "none", border: "none", cursor: "pointer",
              color: TEXT,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Layers size={14} color="#6366f1" />
              <span style={{ fontSize: 12, fontWeight: 700, color: TEXT, letterSpacing: 0.2 }}>Organization Hierarchy</span>
              <span style={{ fontSize: 10, color: MUTED, fontWeight: 500 }}>
                — choose which tiers appear on forms
              </span>
            </div>
            {hierOpen ? <ChevronUp size={13} color={MUTED} /> : <ChevronDown size={13} color={MUTED} />}
          </button>

          {/* Full-width saving progress bar */}
          <div style={{
            height: hierSaving ? 36 : (Date.now() - hierSavedAt < 3000 ? 30 : 0),
            overflow: "hidden",
            transition: "height 0.25s ease",
            margin: "0 24px 6px",
          }}>
            {hierSaving ? (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "7px 12px", borderRadius: 8,
                background: "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(99,102,241,0.06))",
                border: "1px solid rgba(99,102,241,0.25)",
              }}>
                <Loader2 size={13} className="animate-spin" style={{ color: "#6366F1", flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "#6366F1", flexShrink: 0 }}>Saving changes…</span>
                <div style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: "rgba(99,102,241,0.15)", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: "45%", borderRadius: 3,
                    background: "linear-gradient(90deg, #6366F1, #818CF8)",
                    animation: "org-progress-slide 1.1s ease-in-out infinite",
                  }} />
                </div>
              </div>
            ) : Date.now() - hierSavedAt < 3000 ? (
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 12px", borderRadius: 8,
                background: "linear-gradient(135deg, rgba(34,197,94,0.1), rgba(34,197,94,0.05))",
                border: "1px solid rgba(34,197,94,0.25)",
              }}>
                <Check size={13} style={{ color: "#22C55E", flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "#22C55E" }}>Changes saved</span>
              </div>
            ) : null}
          </div>

          {/* Collapsible tier diagram */}
          {hierOpen && (
            <div style={{ padding: "0 24px 14px", display: "flex", gap: 0, alignItems: "stretch" }}>

              {/* Tier 1 — Business Unit */}
              {(() => {
                const on = hierBU;
                const recentlySaved = Date.now() - hierSavedAt < 3000;
                return (
                  <div style={{
                    flex: 1, borderRadius: 10, border: `2px solid ${on ? "#6366F1" : BORDER}`,
                    backgroundColor: on ? "rgba(99,102,241,0.07)" : "rgba(255,255,255,0.02)",
                    padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6,
                    opacity: on ? 1 : 0.5, transition: "all 0.2s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: on ? "#6366F1" : MUTED, textTransform: "uppercase", letterSpacing: 0.6 }}>Tier 1</span>
                      {hasAnyOrg ? (
                        <span title="Locked — your organization already has data. Tier visibility can only be set before any data is added." style={{ display:"flex", alignItems:"center", gap:4, fontSize:10, fontWeight:700, color:MUTED, background:CANCEL, borderRadius:5, padding:"2px 7px", border:`1px solid ${BORDER}` }}>
                          <Lock size={10}/> Locked
                        </span>
                      ) : (
                        <Switch checked={on} disabled={hierSaving} onCheckedChange={v => { setHierBU(v); void saveHier(v, hierDiv, hierDept); }} />
                      )}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: on ? TEXT : MUTED }}>Business Unit</div>
                    <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.4 }}>{on ? "Shown on all create & edit forms" : "Hidden from all forms"}</div>
                    <div style={{ marginTop: 4, height: 20, display: "flex", alignItems: "center", gap: 4 }}>
                      {recentlySaved && !hierSaving && (
                        <><Check size={10} style={{ color: "#22C55E" }} /><span style={{ fontSize: 10, color: "#22C55E", fontWeight: 600 }}>Saved</span></>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: "flex", alignItems: "center", padding: "0 8px", color: MUTED, fontSize: 16, flexShrink: 0 }}>→</div>

              {/* Tier 2 — Division */}
              {(() => {
                const on = hierDiv;
                const recentlySaved = Date.now() - hierSavedAt < 3000;
                return (
                  <div style={{
                    flex: 1, borderRadius: 10, border: `2px solid ${on ? "#22C55E" : BORDER}`,
                    backgroundColor: on ? "rgba(34,197,94,0.07)" : "rgba(255,255,255,0.02)",
                    padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6,
                    opacity: on ? 1 : 0.5, transition: "all 0.2s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: on ? "#22C55E" : MUTED, textTransform: "uppercase", letterSpacing: 0.6 }}>Tier 2</span>
                      {hasAnyOrg ? (
                        <span title="Locked — your organization already has data. Tier visibility can only be set before any data is added." style={{ display:"flex", alignItems:"center", gap:4, fontSize:10, fontWeight:700, color:MUTED, background:CANCEL, borderRadius:5, padding:"2px 7px", border:`1px solid ${BORDER}` }}>
                          <Lock size={10}/> Locked
                        </span>
                      ) : (
                        <Switch checked={on} disabled={hierSaving} onCheckedChange={v => { setHierDiv(v); void saveHier(hierBU, v, hierDept); }} />
                      )}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: on ? TEXT : MUTED }}>Division</div>
                    <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.4 }}>{on ? "Core of assignments & billing" : "Hidden — linked automatically behind the scenes"}</div>
                    <div style={{ marginTop: 4, height: 20, display: "flex", alignItems: "center", gap: 4 }}>
                      {recentlySaved && !hierSaving && (
                        <><Check size={10} style={{ color: "#22C55E" }} /><span style={{ fontSize: 10, color: "#22C55E", fontWeight: 600 }}>Saved</span></>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: "flex", alignItems: "center", padding: "0 8px", color: MUTED, fontSize: 16, flexShrink: 0 }}>→</div>

              {/* Tier 3 — Department */}
              {(() => {
                const on = hierDept;
                const recentlySaved = Date.now() - hierSavedAt < 3000;
                return (
                  <div style={{
                    flex: 1, borderRadius: 10, border: `2px solid ${on ? "#F59E0B" : BORDER}`,
                    backgroundColor: on ? "rgba(245,158,11,0.07)" : "rgba(255,255,255,0.02)",
                    padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6,
                    opacity: on ? 1 : 0.5, transition: "all 0.2s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: on ? "#F59E0B" : MUTED, textTransform: "uppercase", letterSpacing: 0.6 }}>Tier 3</span>
                      {hasAnyOrg ? (
                        <span title="Locked — your organization already has data. Tier visibility can only be set before any data is added." style={{ display:"flex", alignItems:"center", gap:4, fontSize:10, fontWeight:700, color:MUTED, background:CANCEL, borderRadius:5, padding:"2px 7px", border:`1px solid ${BORDER}` }}>
                          <Lock size={10}/> Locked
                        </span>
                      ) : (
                        <Switch checked={on} disabled={hierSaving} onCheckedChange={v => { setHierDept(v); void saveHier(hierBU, hierDiv, v); }} />
                      )}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: on ? TEXT : MUTED }}>Department</div>
                    <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.4 }}>{on ? "Shown on all create & edit forms" : "Hidden from all forms"}</div>
                    <div style={{ marginTop: 4, height: 20, display: "flex", alignItems: "center", gap: 4 }}>
                      {recentlySaved && !hierSaving && (
                        <><Check size={10} style={{ color: "#22C55E" }} /><span style={{ fontSize: 10, color: "#22C55E", fontWeight: 600 }}>Saved</span></>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

          {/* ── Chart ── */}
          <div style={{ flex:1, overflowX:"auto", overflowY:"auto", padding: embedded ? "12px 12px 32px" : "20px 20px 40px" }}>
            {loading ? (
              <RmOneProcessing label="Loading organization…" sublabel="FETCHING STRUCTURE" light />
            ) : !hasAnyOrg ? (
              <div style={{ textAlign:"center", paddingTop:80, color:MUTED }}>
                <Building2 size={36} style={{ opacity:0.3, margin:"0 auto 12px" }}/>
                <p style={{ fontSize:14, marginBottom:6 }}>No organization yet</p>
                <p style={{ fontSize:12 }}>Click <button onClick={() => setInlineAdd({type:"bu",name:""})} style={{ background:"none", border:"none", padding:0, cursor:"pointer", color:"#6366f1", fontWeight:700, fontSize:"inherit" }}>+ Add New BU Structure</button> in the toolbar to add your first business unit.</p>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:48 }}>

                {/* One independent tree per BU — no central root */}
                {buList.length>0 && (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:20, alignItems:"flex-start" }}>
                    {(() => {
                      // Pre-compute size for each BU: large = 2+ depts or 2+ divs
                      const buSizes = buList.map(bu => {
                        const buDivs = divsByBu.get(String(bu.ID)) ?? [];
                        const totalDepts = buDivs.reduce((s, d) => s + (deptsByDiv.get(String(d.ID)) ?? []).length, 0);
                        return totalDepts >= 2 || buDivs.length >= 2;
                      });
                      // A small BU that ends up alone on its row (no sibling) also spans full
                      const spansMap = buSizes.map((large, i) => {
                        if (large) return true;
                        // count consecutive small BUs in this row-slot
                        const prevLarge = i === 0 || buSizes[i - 1];
                        const nextLarge = i === buSizes.length - 1 || buSizes[i + 1];
                        // alone if previous slot was a large (or start) AND next slot is large (or end)
                        return prevLarge && nextLarge;
                      });
                      return buList.map((bu, i) => {
                        const color = BU_COLORS[i % BU_COLORS.length];
                        return (
                          <div key={String(bu.ID)} style={{
                            borderRadius: 16,
                            border: `1.5px solid ${color}35`,
                            background: `${color}07`,
                            boxShadow: `0 0 0 4px ${color}0d, 0 6px 28px ${color}18`,
                            padding: "22px 20px 28px",
                            transition: "box-shadow 0.2s",
                            gridColumn: spansMap[i] ? "1 / -1" : undefined,
                          }}>
                            <BUBlock bu={bu} color={color}/>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}

                {hierDiv && unassignedDivs.length>0 && (
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:8 }}>
                    <div style={{ padding:"3px 12px", borderRadius:20, background:CANCEL, border:`1px solid ${BORDER}`, fontSize:10, color:MUTED }}>Unassigned Divisions</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:32, alignItems:"flex-start" }}>
                      {unassignedDivs.map(div=><DivBlock key={String(div.ID)} div={div} color="#94a3b8"/>)}
                    </div>
                  </div>
                )}

                {orphanDeptsDisplay.length>0 && (
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:8 }}>
                    <div style={{ padding:"3px 12px", borderRadius:20, background:CANCEL, border:`1px solid ${BORDER}`, fontSize:10, color:MUTED }}>Unassigned Departments</div>
                    <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                      {orphanDeptsDisplay.map(dep=><DeptBlock key={String(dep.ID)} dep={dep} color="#94a3b8"/>)}
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>

          {/* ── Add panel ── */}
          {addPanel && (
            <div style={{ width:288, background:PANEL, borderLeft:`1px solid ${BORDER}`, padding:"24px 16px", flexShrink:0, overflowY:"auto" }}>
              <AddPanelContent
                addPanel={addPanel} setAddPanel={setAddPanel}
                buList={buList} divList={divList} deptList={deptList} roleList={roleList} divisionsForDeptBu={divisionsForDeptBu}
                buName={buName} setBuName={setBuName} buBusy={buBusy} addBusinessUnit={addBusinessUnit}
                divName={divName} setDivName={setDivName} divBuId={divBuId} setDivBuId={setDivBuId} divBusy={divBusy} addDivision={addDivision}
                deptName={deptName} setDeptName={setDeptName} deptBuId={deptBuId} setDeptBuId={setDeptBuId} deptDivId={deptDivId} setDeptDivId={setDeptDivId} deptBusy={deptBusy} addDepartment={addDepartment}
                roleName={roleName} setRoleName={setRoleName} roleBusy={roleBusy} addRole={addRole}
                jtName={jtName} setJtName={setJtName} jtRoleId={jtRoleId} setJtRoleId={setJtRoleId} jtDeptId={jtDeptId} setJtDeptId={setJtDeptId} jtBusy={jtBusy} addJobTitle={addJobTitle}
              />
            </div>
          )}
        </div>

        {/* ── Legend ── */}
        <div style={{ padding:"8px 24px", borderTop:`1px solid ${BORDER}`, display:"flex", gap:20, alignItems:"center", background:PANEL, flexShrink:0 }}>
          {[
            {icon:Building2,    label:"Business Unit",color:"#6366f1"},
            {icon:Layers,       label:"Division",     color:"#10b981"},
            {icon:Briefcase,    label:"Department",   color:"#f59e0b"},
            {icon:UserCog,      label:"Role",         color:"#8b5cf6"},
            {icon:GraduationCap,label:"Job Title",    color:"#f97316"},
          ].filter(item=>item.label!=="Division"||hierDiv).map(item=>(
            <div key={item.label} style={{ display:"flex", alignItems:"center", gap:5 }}>
              <item.icon size={11} style={{ color:item.color }}/>
              <span style={{ fontSize:10, color:MUTED }}>{item.label}</span>
            </div>
          ))}
          <span style={{ marginLeft:"auto", fontSize:10, color:SUBTLE }}>Hover any node to rename or delete</span>
        </div>
      </div>
      <InlineAddModal />
    </OrgCtx.Provider>
  );
}
