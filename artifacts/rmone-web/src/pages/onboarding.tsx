import { useState, useCallback, useEffect, useRef, useTransition, type ComponentType } from "react";
import { useLocation } from "wouter";
import {
  Upload, CheckCircle2, AlertTriangle, XCircle, ArrowRight,
  Download, History, X, Save, BookOpen, Trash2, Check,
  ChevronDown, ChevronUp, Users, Building2, Loader2,
  FolderKanban, ClipboardList, Tags, HelpCircle, Sparkles, Settings2,
  Database, Gauge, FileDown, Ban, TriangleAlert, CircleDot, DollarSign,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandInput, CommandList, CommandItem,
  CommandEmpty, CommandGroup, CommandSeparator,
} from "@/components/ui/command";
import SynonymsManager from "@/components/synonyms-manager";
import { InlineDataGrid } from "@/components/InlineDataGrid";

import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/useAuth";
import { authHeaders, downloadRateCard, importRateCard, activeImportKey, tenantScopedKey } from "@/lib/api";
import { uploadFileSmart } from "@/lib/chunkedUpload";
import { useQuery } from "@tanstack/react-query";
import { isSuperAdmin } from "@/lib/roleResolver";
import { AddStaffModal } from "@/components/AddStaffModal";

const API          = "/api/onboarding";
const SKIP         = "__skip__";
const KEEP         = "__keep__";

const ALL_TEMPLATE_MODULES = [
  { mod: "team",          label: "Resources (People)", desc: "People, roles, departments and divisions"              },
  { mod: "leads",         label: "Leads",            desc: "Early-stage inquiries and prospects"                   },
  { mod: "opportunities", label: "Opportunities",    desc: "Sales pipeline and potential projects"                 },
  { mod: "clients",       label: "Projects",         desc: "Projects, opportunities and client companies"          },
  { mod: "demand",        label: "Open Positions",   desc: "Unfilled resource demand and hiring requests"          },
  { mod: "assignments",   label: "Assignments",      desc: "Who is allocated to which project and at what %"       },
  { mod: "companies",     label: "Companies",        desc: "CRM company and client account records"                },
] as const;

// Module cards shown on the upload page — one per data category.
// tabType: how the pipeline classifies this sheet.
// recordType: forces PMM vs OPM vs Lead within "clients" tabs (null = auto).
const MODULE_CARDS = [
  { id: "team",          label: "Resources (People)", icon: "Users",         desc: "People, roles & departments",        tabType: "team"        as const, recordType: null,                  templateMod: "team",          accent: "green",  multiTab: false },
  { id: "leads",         label: "Leads",          icon: "Tags",          desc: "Early-stage inquiries & prospects",  tabType: "clients"     as const, recordType: "Lead"        as const, templateMod: "leads",         accent: "amber",  multiTab: false },
  { id: "opportunities", label: "Opportunities",  icon: "ClipboardList", desc: "Opportunities + team assignments",   tabType: "clients"     as const, recordType: "Opportunity" as const, templateMod: "opportunities", accent: "purple", multiTab: true  },
  { id: "projects",      label: "Projects",       icon: "FolderKanban",  desc: "Projects + team assignments",       tabType: "clients"     as const, recordType: "Project"     as const, templateMod: "clients",       accent: "blue",   multiTab: true  },
] as const;
// Tenant-scoped BY CONSTRUCTION: saved mapping profiles describe one
// company's spreadsheet layout — an un-scoped key offered them to every
// other company on the same browser. Legacy bare key purged in bustCache().
const PROFILES_KEY = () => tenantScopedKey("rmone_mapping_profiles");

/* ── Types ───────────────────────────────────────────────────────────── */
interface ColAnalysis {
  col:       string;
  canonical: string | null;
  matchType: "exact" | "synonym" | "llm" | "unknown";
}
const SUGGESTED_TYPE_LABEL: Record<string, { friendly: string; rename: string }> = {
  team:        { friendly: "staff / team member",  rename: "Team Members"       },
  clients:     { friendly: "project / client",      rename: "Projects"           },
  assignments: { friendly: "assignment / schedule", rename: "Assignments"        },
};

const RENAME_OPTIONS = "Team Members, Projects, Opportunities, Leads, Assignments, Open Positions, or Companies";

// Canonical fields surfaced in the dropdown for each tab type when the user
// manually overrides a tab whose name wasn't auto-detected.
const TAB_TYPE_PICKER_OPTIONS: { value: "team"|"clients"|"assignments"; label: string; desc: string }[] = [
  { value: "team",        label: "Team Members",      desc: "staff, roles, departments"     },
  { value: "clients",     label: "Projects & Clients", desc: "projects, opportunities"       },
  { value: "assignments", label: "Assignments",        desc: "who is assigned to each project" },
];

// Destination "slots" for the "Confirm what each tab contains" grid. Each slot
// maps a user-chosen category to the pipeline's tabType + (for client tabs) the
// record type, so any uploaded tab — regardless of its name — is routed to the
// right place without renaming tabs or re-uploading.
const SHEET_SLOT_OPTIONS: {
  key: string;
  label: string;
  tabType: "team" | "clients" | "assignments";
  recordType?: "Project" | "Opportunity" | "Lead";
}[] = [
  { key: "project",     label: "Projects",      tabType: "clients",     recordType: "Project"     },
  { key: "opportunity", label: "Opportunities", tabType: "clients",     recordType: "Opportunity" },
  { key: "lead",        label: "Leads",         tabType: "clients",     recordType: "Lead"        },
  { key: "team",        label: "Team Members",  tabType: "team"                                   },
  { key: "assignments", label: "Assignments",   tabType: "assignments"                            },
];

interface SchemaIncompatibility {
  field:        string;
  table:        "PMM" | "Opportunity";
  schemaType:   string;
  pipelineType: string;
  reason:       string;
}
interface SheetPreview {
  sheetName:                string;
  tableName:                string | null;
  columns:                  string[];
  totalRows:                number;
  validation:               { matched: string[]; unknown: string[]; missingRequired: string[]; suggestions?: Record<string, string> } | null;
  simplifiedType:           "team" | "clients" | "assignments" | null;
  suggestedType?:           "team" | "clients" | "assignments" | null;
  simplifiedAnalysis:       ColAnalysis[] | null;
  canonicalFields:          string[] | null;
  fieldLabels?:             Record<string, string> | null;
  fieldHints?:              Record<string, string> | null;
  templateOrder?:           string[] | null;
  samples?:                 Record<string, string[]> | null;
  typeCounts?:              Record<string, number>   | null;
  previewRows?:             Record<string, string>[]  | null;
  schemaIncompatibilities?: SchemaIncompatibility[]  | null;
}
interface UploadResponse {
  uploadId: string;
  tenantId: string;
  fileName: string;
  sheets:   SheetPreview[];
  existingClient?: { status: string; fileName: string; createdAt: string } | null;
}

// Localized timestamp, or "" if the value is missing/unparseable (avoids "Invalid Date").
function fmtDate(value?: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

// How a recurring upload should be applied to a client that already exists.
type ImportMode = "create" | "update" | "add" | "replace";
interface MappingProfile {
  id: string; name: string; createdAt: string;
  mappings: Record<string, Record<string, string>>;
}
interface ValidationIssue {
  id: string; field: string; label: string;
  type: "blank_rows" | "unknown_value";
  blankCount?: number;
  unknownValues?: string[];
  knownValues: string[];
  affectedSheets: string[];
}
type FieldFix = { valueMap: Record<string, string>; defaultForBlank: string };
type ValidationFixes = Record<string, FieldFix>;

/* ── Searchable field picker ──────────────────────────────────────────
   Replaces flat Select dropdowns in the column mapping section.
   • Filters available fields as the user types
   • Shows an "AI suggestion" row when typed text has no exact match —
     selecting it maps the column AND auto-saves the synonym so future
     uploads auto-detect the column without any manual step. */
function FieldSearchCombobox({
  value,
  fields,
  labelOf,
  isTaken,
  onSelect,
  colName,
  tabType,
  sampleValues,
  onAiSuggest,
  showSkip = true,
  triggerCls = "",
}: {
  value: string;
  fields: string[];
  labelOf: (f: string) => string;
  isTaken: (f: string) => boolean;
  onSelect: (val: string) => void;
  colName: string;
  tabType?: string;
  sampleValues?: string[];
  onAiSuggest?: (alias: string, canonical: string) => void;
  showSkip?: boolean;
  triggerCls?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [llmSuggestion, setLlmSuggestion] = useState<string | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const lastSearchRef = useRef("");

  const norm = (s: string) => s.toLowerCase().replace(/[_\s\-]/g, "");
  const q = norm(search);

  // Reset LLM suggestion whenever the search term changes
  useEffect(() => {
    if (search !== lastSearchRef.current) {
      lastSearchRef.current = search;
      setLlmSuggestion(null);
      setLlmError(null);
    }
  }, [search]);

  const filtered = q.length === 0
    ? fields
    : fields.filter(f => norm(labelOf(f)).includes(q) || norm(f).includes(q));

  const hasNoMatch = filtered.length === 0 && q.length >= 2;

  // Ask the backend LLM to suggest the best canonical field for the typed term
  const askLlm = async () => {
    if (!hasNoMatch || llmLoading || llmSuggestion) return;
    setLlmLoading(true);
    setLlmError(null);
    try {
      const res = await fetch("/api/onboarding/suggest-field", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          alias: search.trim(),
          tabType: tabType ?? "clients",
          canonicalFields: fields,
          sampleValues: sampleValues ?? [],
        }),
      });
      const data = await res.json();
      setLlmSuggestion(data.canonical ?? null);
      if (!data.canonical) setLlmError("AI couldn't find a match — try a different search term.");
    } catch {
      setLlmError("Request failed — check your connection.");
    } finally {
      setLlmLoading(false);
    }
  };

  // Trigger display
  let triggerContent: React.ReactNode;
  if (value === SKIP) {
    triggerContent = <span className="text-muted-foreground italic text-xs truncate">— Skip this column —</span>;
  } else if (value === KEEP) {
    triggerContent = (
      <span className="text-blue-600 dark:text-blue-400 text-xs flex items-center gap-1 min-w-0">
        <Check className="w-3 h-3 shrink-0" />
        <span className="truncate">Saved as "{colName}"</span>
      </span>
    );
  } else if (value) {
    triggerContent = <span className="truncate text-xs">{labelOf(value)}</span>;
  } else {
    triggerContent = <span className="text-muted-foreground text-xs truncate">Map to field or skip…</span>;
  }

  return (
    <Popover open={open} onOpenChange={v => { setOpen(v); if (!v) setSearch(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex items-center justify-between gap-1 h-8 px-2.5 border border-input rounded-md bg-background hover:bg-accent/40 transition-colors min-w-0 text-left focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${triggerCls}`}
        >
          <span className="truncate flex-1">{triggerContent}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={4} className="p-0 w-64">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search fields…"
            value={search}
            onValueChange={setSearch}
            className="h-8 text-xs"
          />
          <CommandList className="max-h-56">
            {showSkip && (
              <CommandItem
                value="__skip__"
                onSelect={() => { onSelect(SKIP); setOpen(false); setSearch(""); }}
                className="text-xs text-muted-foreground italic"
              >
                — Skip this column —
              </CommandItem>
            )}
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map(f => (
                  <CommandItem
                    key={f}
                    value={f}
                    disabled={isTaken(f)}
                    onSelect={() => {
                      if (!isTaken(f)) { onSelect(f); setOpen(false); setSearch(""); }
                    }}
                    className="text-xs"
                  >
                    <span className="flex-1">{labelOf(f)}</span>
                    {isTaken(f) && (
                      <span className="text-[10px] text-muted-foreground ml-2 shrink-0">in use</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {hasNoMatch && !llmSuggestion && !llmLoading && !llmError && (
              <>
                <CommandEmpty className="text-xs py-2">No matching field found.</CommandEmpty>
                <div className="px-2 pb-2">
                  <button
                    type="button"
                    onClick={askLlm}
                    className="w-full flex items-center justify-center gap-1.5 text-xs text-violet-600 dark:text-violet-400 border border-violet-300 dark:border-violet-700 rounded px-2 py-1.5 hover:bg-violet-50 dark:hover:bg-violet-950 transition-colors"
                  >
                    <Sparkles className="w-3 h-3" />
                    Ask AI to match "{search.trim()}"
                  </button>
                </div>
              </>
            )}
            {hasNoMatch && llmLoading && (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                <Sparkles className="w-3 h-3 animate-pulse text-violet-500" />
                AI is thinking…
              </div>
            )}
            {hasNoMatch && llmError && !llmSuggestion && (
              <div className="px-3 py-3 text-xs text-muted-foreground">{llmError}</div>
            )}
            {llmSuggestion && hasNoMatch && (
              <>
                <CommandSeparator />
                <CommandGroup heading="AI suggestion">
                  <CommandItem
                    value={`__ai__${llmSuggestion}`}
                    onSelect={() => {
                      onSelect(llmSuggestion);
                      setOpen(false);
                      setSearch("");
                      setLlmSuggestion(null);
                      if (tabType && onAiSuggest) onAiSuggest(colName, llmSuggestion);
                    }}
                    className="text-xs"
                  >
                    <Sparkles className="w-3 h-3 text-violet-500 shrink-0" />
                    <span>
                      Map as <span className="font-semibold">{labelOf(llmSuggestion)}</span>
                      <span className="text-muted-foreground ml-1">+ remember</span>
                    </span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ── Sheet data preview (first 10 rows) ──────────────────────────────── */
function SheetDataPreview({ sheet }: { sheet: SheetPreview }) {
  const [open, setOpen] = useState(true);
  const rows = sheet.previewRows;
  if (!rows || rows.length === 0) return null;
  const cols = sheet.columns.filter(c => !/pass\s*word|passwd|pwd|secret/i.test(c));
  // Use per-column analysis to decide which headers are truly unresolved.
  // validation.unknown includes LLM/synonym matches that have a canonical,
  // so those would wrongly turn orange; simplifiedAnalysis is precise.
  const unknownSet = new Set(
    (sheet.simplifiedAnalysis ?? [])
      .filter(a => a.matchType === "unknown")
      .map(a => a.col)
  );
  return (
    <div className="rounded-lg border border-border overflow-hidden text-xs">
      <button
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
        onClick={() => setOpen(v => !v)}
      >
        <span className="font-medium text-muted-foreground">
          Preview data — first {rows.length} of {sheet.totalRows} {sheet.totalRows === 1 ? "row" : "rows"}
        </span>
        <span className="text-muted-foreground">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-muted/60">
                {cols.map(c => {
                  const isUnknown = unknownSet.has(c);
                  return (
                    <th
                      key={c}
                      title={isUnknown ? "Not yet mapped — tell us what this column contains below" : undefined}
                      className={`px-3 py-1.5 text-left font-semibold whitespace-nowrap border-b border-border ${
                        isUnknown
                          ? "text-amber-600 dark:text-amber-400 bg-amber-500/8"
                          : "text-muted-foreground"
                      }`}
                    >
                      <span className="flex items-center gap-1">
                        {c}
                        {isUnknown && (
                          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold leading-none text-[9px]">?</span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                  {cols.map(c => (
                    <td key={c} className="px-3 py-1.5 text-muted-foreground whitespace-nowrap border-b border-border max-w-[200px] truncate" title={row[c]}>
                      {row[c] || <span className="italic opacity-40">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Validation helpers ──────────────────────────────────────────────── */
function buildFieldOverrides(fixes: ValidationFixes) {
  const out: Record<string, { valueMap?: Record<string,string>; defaultForBlank?: string }> = {};
  for (const [field, fix] of Object.entries(fixes)) {
    const vm  = Object.fromEntries(Object.entries(fix.valueMap ?? {}).filter(([,v]) => !!v));
    const dbf = fix.defaultForBlank ?? "";
    if (Object.keys(vm).length > 0 || dbf) {
      out[field] = { ...(Object.keys(vm).length ? { valueMap: vm } : {}), ...(dbf ? { defaultForBlank: dbf } : {}) };
    }
  }
  return out;
}

function ValidationPanel({
  issues, fixes, onFixes, validating, onCheck,
}: {
  issues: ValidationIssue[] | null;
  fixes: ValidationFixes;
  onFixes: (f: ValidationFixes) => void;
  validating: boolean;
  onCheck: () => void;
}) {
  const setFix = (field: string, patch: Partial<FieldFix>) => {
    const existing: FieldFix = fixes[field] ?? { valueMap: {}, defaultForBlank: "" };
    onFixes({ ...fixes, [field]: { ...existing, ...patch } });
  };
  const setValueMap = (field: string, from: string, to: string) =>
    setFix(field, { valueMap: { ...(fixes[field]?.valueMap ?? {}), [from]: to } });

  const allResolved = (issues ?? []).every(issue => {
    const fix = fixes[issue.field];
    if (issue.type === "blank_rows") return !!fix?.defaultForBlank;
    if (issue.type === "unknown_value") return (issue.unknownValues ?? []).every(uv => fix?.valueMap?.[uv]);
    return true;
  });

  return (
    <div className="space-y-2">
      <button
        className="w-full flex items-center justify-center gap-2 rounded-lg border border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5 text-sm font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors disabled:opacity-60"
        onClick={onCheck}
        disabled={validating}
      >
        {validating
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking your data…</>
          : issues === null
          ? <><span className="text-base">🔍</span> Validate data before importing</>
          : <><CheckCircle2 className="w-3.5 h-3.5" /> Re-check data</>
        }
      </button>

      {issues !== null && issues.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          All data looks good — no issues found.
        </div>
      )}

      {issues !== null && issues.length > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 overflow-hidden text-sm">
          <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950/30 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="font-medium text-amber-800 dark:text-amber-300">
              {issues.length} {issues.length === 1 ? "issue" : "issues"} found
              {allResolved ? " — all resolved" : " — resolve below to apply fixes automatically"}
            </span>
          </div>
          <div className="divide-y divide-border">
            {issues.map(issue => (
              <div key={issue.id} className="px-3 py-3 space-y-2 bg-background">
                <p className="text-sm font-medium">
                  <span className="text-foreground">{issue.label}</span>
                  {issue.type === "blank_rows" && (
                    <span className="text-muted-foreground font-normal"> — {issue.blankCount} row{issue.blankCount !== 1 ? "s" : ""} have no value</span>
                  )}
                  {issue.type === "unknown_value" && (
                    <span className="text-muted-foreground font-normal"> — {issue.unknownValues?.length} unrecognised value{(issue.unknownValues?.length ?? 0) !== 1 ? "s" : ""}</span>
                  )}
                </p>
                {issue.type === "blank_rows" && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground shrink-0">Apply default:</span>
                    {issue.knownValues.length > 0 ? (
                      <Select value={fixes[issue.field]?.defaultForBlank ?? ""} onValueChange={v => setFix(issue.field, { defaultForBlank: v })}>
                        <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Choose a default…" /></SelectTrigger>
                        <SelectContent>
                          {issue.knownValues.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                          <SelectItem value="__skip__">Skip rows with no {issue.label}</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        className="h-7 text-xs flex-1"
                        placeholder={`Type a ${issue.label} name, or leave blank to skip`}
                        value={fixes[issue.field]?.defaultForBlank ?? ""}
                        onChange={e => setFix(issue.field, { defaultForBlank: e.target.value })}
                      />
                    )}
                  </div>
                )}
                {issue.type === "unknown_value" && (
                  <div className="space-y-1.5">
                    {issue.unknownValues?.map(uv => (
                      <div key={uv} className="flex items-center gap-2">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded shrink-0 max-w-[130px] truncate" title={uv}>"{uv}"</code>
                        <span className="text-xs text-muted-foreground shrink-0">→</span>
                        <Select value={fixes[issue.field]?.valueMap?.[uv] ?? ""} onValueChange={v => setValueMap(issue.field, uv, v)}>
                          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Map to…" /></SelectTrigger>
                          <SelectContent>
                            {issue.knownValues.map(kv => <SelectItem key={kv} value={kv}>{kv}</SelectItem>)}
                            <SelectItem value="__create__">Auto-create "{uv}"</SelectItem>
                            <SelectItem value="__skip__">Skip rows with this value</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Simplified tab detection ────────────────────────────────────────── */
// The backend classifies every sheet into a simplified tab type — by NAME, or
// for client files that use their own tab names, by CONTENT. The frontend trusts
// that classification (simplifiedType / simplifiedAnalysis) instead of matching
// hardcoded template names, so arbitrary tab names still flow through this path.
function isSimplifiedUpload(sheets: SheetPreview[]): boolean {
  return sheets.some(s => s.simplifiedType != null || s.simplifiedAnalysis != null);
}

function getSimplifiedSummary(sheets: SheetPreview[]) {
  let teamRows = 0, clientRows = 0, assignRows = 0;
  for (const s of sheets) {
    if (s.simplifiedType === "team")        teamRows   += s.totalRows;
    if (s.simplifiedType === "clients")     clientRows += s.totalRows;
    if (s.simplifiedType === "assignments") assignRows += s.totalRows;
  }
  return { teamRows, clientRows, assignRows };
}

/* ── Plain-English field destinations (for inline mapping examples) ──── */
// Maps each RM ONE field to a short, jargon-free description of where the data
// lands. Used to render a live "what this becomes — e.g. …" line under every
// mapping row, with REAL sample values from the user's file.
const FIELD_EXPLAIN: Record<string, string> = {
  // Team / people
  FullName:    "This is the person's name, shown everywhere they appear in RM ONE — on lists, schedules and reports.",
  UserName:    "This is the email address the person uses to log in. If you don't give a separate contact email, RM ONE also uses this address to reach them.",
  Email:       "This is the email address used to contact the person.",
  Division:    "This puts the person into one of the main parts of your business — the biggest grouping, sitting above smaller teams. Everyone you give the same name to is automatically placed in the same group, so you only set each one up once.",
  Department:  "This is the smaller team the person belongs to. RM ONE automatically files that team under the right main part of your business.",
  Role:        "This is the type of job the person does. Everyone with the same job type shares one role rather than each person having their own.",
  JobTitle:    "This is the person's job title.",
  BillingRate: "This is the hourly rate you charge clients, and it's tied to the job type — not to each individual. So everyone with the same job type is charged at this rate. If you need people charged differently, give them different job types.",
  EmpLaborRate:"This is the internal hourly pay rate, tied to the job type rather than to each individual.",
  EmpCostRate: "This is what one hour of this job type costs your business, tied to the job type rather than to each individual.",
  UserRole:    "This sets how much the person can do inside RM ONE — for example a full administrator, a manager, or a standard user.",
  Manager:     "This sets who the person reports to. RM ONE links them to their manager using the manager's login email, so that email must match exactly.",
  IsManager:   "This marks whether the person manages other people.",
  Password:    "This is the temporary password the person uses the very first time they log in.",
  StartDate:   "This is the date the person joined.",
  EndDate:     "This is the date the person left, or is due to leave.",
  // Clients / projects
  CompanyName:              "This is the client company the work is for.",
  ContactName:              "This is the main person you deal with at the client company.",
  ClientRep:                "This is the person on your team who owns the relationship with this client.",
  CRMHealth:                "This is a health rating for the client relationship — for example Green, Amber, or Red.",
  ProjectTitle:             "This is the name of the project, or of the potential deal you're trying to win.",
  Project:                  "This is the name of the project, or of the potential deal you're trying to win.",
  Type:                     "This marks whether the row is a confirmed project you're delivering, or an opportunity you're still chasing.",
  MarketSector:             "This is the industry the client works in.",
  ContractValue:            "This is how much the project is worth, in money.",
  ContractLimit:            "This is the maximum allowed contract value — the cap the project must not exceed.",
  ApproxContractValue:      "This is roughly how much the potential deal is worth, in money.",
  ContractType:             "This is the kind of agreement for the work — for example fixed price, or time and materials.",
  ChanceOfSuccessChoice:    "This is how likely you think you are to win the opportunity.",
  Status:                   "This shows where the project currently stands.",
  CRMOpportunityStatusChoice: "This is the stage the opportunity is at in your pipeline.",
  SectorChoice:             "This is the internal sector or vertical this project sits under in your business.",
  CRMBusinessUnitChoice:    "This is the business unit the project belongs to — the top-level grouping above division.",
  GrossMargin:              "This is the gross margin target for the project.",
  ProjectType:              "This is the type of project — for example capital, service, or maintenance.",
  ServiceType:              "This is the service line or delivery type this project falls under.",
  RequestCategory:          "This is the request category for the project.",
  ProjectTag:               "This is a free-text tag or label you can use to group and filter projects.",
  Category:                 "This is the project category used for grouping and reporting.",
  // Assignments
  Resource:           "This is the team member being booked onto the work. RM ONE matches them to your team list using their login email, so it must match exactly.",
  PctAllocation:      "This is how much of the person's working time goes to this work, written as a percentage.",
  AllocationHour:     "This is the number of hours planned for the person on this work.",
  AllocationType:     "This marks whether the booking is confirmed (a hard booking) or still tentative (a soft booking).",
  AllocationStartDate:"This is the date the person's booking starts.",
  AllocationEndDate:  "This is the date the person's booking ends.",
};

// Targets whose values are credentials — never echo their sample values back,
// even if the user manually remaps a column to one of these AFTER upload (the
// backend only redacts based on the originally-detected column).
const SENSITIVE_FIELDS = new Set(["Password"]);

// Build a plain-English sentence describing what a mapped column does, followed
// by REAL example values from the user's file so they can confirm the meaning.
function explainTarget(field: string, friendlyLabel: string, samples?: string[]): string {
  const note = FIELD_EXPLAIN[field] ?? `This column is saved as the ${friendlyLabel} field.`;
  if (SENSITIVE_FIELDS.has(field)) return note; // never echo example values for secrets
  const egs  = (samples ?? []).slice(0, 2).filter(Boolean);
  return egs.length
    ? `${note} For example, from your file: ${egs.map(v => `"${v}"`).join(", ")}.`
    : note;
}

/* ── Friendly names ──────────────────────────────────────────────────── */
const FRIENDLY_TABLE: Record<string, string> = {
  CompanyDivisions:  "Divisions",
  Department:        "Departments",
  Roles:             "Roles",
  Jobtitle:          "Job Titles",
  AspNetUsers:       "Team Members",
  ResourceWorkItems: "Work Items",
  CRMCompany:        "Client Companies",
  CRMContact:        "Client Contacts",
  PMM:               "Projects",
  Opportunity:       "Opportunities",
  ResourceAllocation:"Resource Assignments",
  Config_ConfigurationVariable: "Configuration",
};

const FRIENDLY_FIELD: Record<string, string> = {
  Title:                        "Name / Title",
  Name:                         "Full Name",
  UserName:                     "Login Email",
  Email:                        "Email Address",
  PasswordHash:                 "Password",
  Password:                     "Password",
  UGITStartDate:                "Start Date",
  UGITEndDate:                  "End Date",
  DepartmentLookup:             "Department",
  DivisionLookup:               "Division",
  DivisionIdLookup:             "Division",
  JobTitleLookup:               "Job Title",
  CRMCompanyLookup:             "Client Company",
  CRMContactLookup:             "Client Contact",
  ResourceWorkItemLookup:       "Team Member",
  PointOfContact:               "Contact Name",
  ERPJobID:                     "Job / Reference ID",
  ContractValue:                "Contract Value",
  ContractLimit:                "Contract Limit",
  ApproxContractValue:          "Approx Contract Value",
  ContractType:                 "Contract Type",
  Status:                       "Status",
  StatusChoice:                 "Status",
  CRMOpportunityStatusChoice:   "Stage / Status",
  SectorChoice:                 "Project Sector",
  CRMBusinessUnitChoice:        "Business Unit",
  ChanceOfSuccessChoice:        "Chance of Success",
  GrossMargin:                  "Gross Margin",
  ClientRep:                    "Client Rep",
  CRMHealth:                    "CRM Health",
  ProjectType:                  "Project Type",
  ServiceType:                  "Service Type",
  RequestCategory:              "Request Category",
  ProjectTag:                   "Project Tag",
  Category:                     "Category",
  TargetStartDate:              "Start Date",
  TargetCompletionDate:         "End Date / Completion Date",
  AllocationStartDate:          "Assignment Start Date",
  AllocationEndDate:            "Assignment End Date",
  PctAllocation:                "Allocation %",
  BillingRate:                  "Billing Rate",
  AllocationType:               "Assignment Type",
  ClientMarketSector:           "Market Sector",
};

function friendlyField(f: string) {
  return FRIENDLY_FIELD[f] ? `${FRIENDLY_FIELD[f]} (${f})` : f;
}

/* ── Local storage helpers ───────────────────────────────────────────── */
function loadProfiles(): MappingProfile[] {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY()) ?? "[]"); }
  catch { return []; }
}
function saveProfiles(p: MappingProfile[]) {
  localStorage.setItem(PROFILES_KEY(), JSON.stringify(p));
}

/* ── Sheet status ────────────────────────────────────────────────────── */
function sheetStatus(
  sheet: SheetPreview,
  mappings: Record<string, string>,
): "ready" | "needs-mapping" | "no-match" {
  if (!sheet.tableName) return "no-match";
  if ((sheet.validation?.missingRequired?.length ?? 0) > 0) return "needs-mapping";
  const unmapped = (sheet.validation?.unknown ?? []).filter(c => !mappings[c]);
  return unmapped.length === 0 ? "ready" : "needs-mapping";
}

/* ── Component ───────────────────────────────────────────────────────── */
const DRAFT_KEY = "rmone_onboarding_draft";
function loadDraft(): { clientName?: string; uploadResult?: UploadResponse; columnMappings?: Record<string, Record<string, string>>; tabOverrides?: Record<string, "team"|"clients"|"assignments"> } {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}"); } catch { return {}; }
}
function saveDraft(patch: Partial<{ clientName: string; uploadResult: UploadResponse | null; columnMappings: Record<string, Record<string, string>>; tabOverrides: Record<string, "team"|"clients"|"assignments"> }>) {
  try {
    const prev = loadDraft();
    const next = { ...prev, ...patch };
    if (next.uploadResult === null) { delete (next as Record<string, unknown>).uploadResult; }
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  } catch { /* quota exceeded — silently skip */ }
}
function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
}

export default function OnboardingPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [, navigate] = useLocation();
  const { toast }    = useToast();
  const { user }     = useAuth();
  const superAdmin   = isSuperAdmin(user?.username, user?.tenant);

  const _draft = loadDraft();

  const [clientName, setClientName]                     = useState(_draft.clientName ?? "");
  const [tenantCheck, setTenantCheck]                   = useState<{
    checking: boolean;
    taken: boolean;
    conflict?: { status: string; fileName: string; createdAt: string; uploadId?: string };
  }>({ checking: false, taken: false });
  const [uploadResult, setUploadResult]                 = useState<UploadResponse | null>(_draft.uploadResult ?? null);
  const [extraUploadIds, setExtraUploadIds]             = useState<string[]>([]);
  const [extraFileNames, setExtraFileNames]             = useState<string[]>([]);
  const [gapFillUploading, setGapFillUploading]         = useState<Record<string, boolean>>({});
  const [filledGaps, setFilledGaps]                     = useState<Record<string, string>>({});
  // Per-upload tab+record type info, keyed by uploadId. Ensures each uploaded
  // file is routed to its own data category regardless of sheet name collisions.
  const [uploadTabTypes, setUploadTabTypes] = useState<Record<string, { tabType: "team"|"clients"|"assignments"; recordType?: "Project"|"Opportunity"|"Lead"; sheetNames: string[] }>>({});
  const [addStaffOpen, setAddStaffOpen]                 = useState(false);
  const [gridOpenCard, setGridOpenCard]                 = useState<string|null>(null);
  const gapFillInputRef  = useRef<HTMLInputElement>(null);

  const pendingGapRef    = useRef<{ id: string; templateModule: string } | null>(null);
  const [running, setRunning]                           = useState(false);
  const [orgRelinkWarnings, setOrgRelinkWarnings]       = useState<string[]>([]);
  // Issues where a division name exists under MULTIPLE BUs — user must pick which to update.
  const [orgAmbiguousIssues, setOrgAmbiguousIssues]     = useState<Array<{
    divLower: string;
    message:  string;
    targetBU: string;
    existingBUs: Array<{ buTitle: string; divId: string }>;
  }>>([]);
  // User choices for each ambiguous division: divLower → "create" | divId
  const [divisionChoices, setDivisionChoices]           = useState<Record<string, string>>({});
  const [schema, setSchema]                             = useState<Record<string, string[]>>({});
  const [columnMappings, setColumnMappings]             = useState<Record<string, Record<string, string>>>(_draft.columnMappings ?? {});
  const [expandedSheets, setExpandedSheets]             = useState<Set<string>>(new Set());
  const [expandedAutoMapped, setExpandedAutoMapped]     = useState<Set<string>>(new Set());
  const autoExpandedUploadRef = useRef<string | null>(null);
  const [simplifiedMappingConfirmed, setSimplifiedMappingConfirmed] = useState(false);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[] | null>(null);
  const [validationFixes, setValidationFixes]   = useState<ValidationFixes>({});
  const [validating, setValidating]             = useState(false);
  const [savedSynonyms, setSavedSynonyms]       = useState<Set<string>>(new Set());
  const [savingsynonym, setSavingSynonym]        = useState<string | null>(null);
  const [userTabOverrides, setUserTabOverrides]   = useState<Record<string, "team"|"clients"|"assignments">>(_draft.tabOverrides ?? {});
  const [reanalyzedSheets, setReanalyzedSheets]   = useState<Record<string, Partial<SheetPreview>>>({});
  const [reanalyzingSheet, setReanalyzingSheet]   = useState<string | null>(null);

  // Merge-only imports (Aug 2026): there is no apply-mode choice any more.
  // Existing clients always run "update" (add new + update matched, never
  // remove); only a brand-new client runs "create".
  // True after we auto-applied a previously-saved column mapping for this client.
  const [templateApplied, setTemplateApplied]           = useState(false);

  // Saved profiles
  const [profiles, setProfiles]     = useState<MappingProfile[]>(loadProfiles);
  const [savingName, setSavingName] = useState("");
  const [showSaveUI, setShowSaveUI] = useState(false);
  const [savedId, setSavedId]       = useState<string | null>(null);

  // Module-card upload tracking
  const [moduleUploads, setModuleUploads] = useState<Record<string, {
    uploadId: string; fileName: string; rowCount: number; sheetNames: string[];
  }>>({});
  const [recordTypeOverrides, setRecordTypeOverrides] = useState<Record<string, "Project" | "Opportunity" | "Lead">>({});
  const [moduleUploading, setModuleUploading] = useState<Record<string, boolean>>({});
  const [rateCardUploading, setRateCardUploading] = useState(false);
  const [rateCardDone, setRateCardDone]           = useState(false);
  const rateCardInputRef  = useRef<HTMLInputElement>(null);
  // One hidden file-input per module card
  const moduleInputRefs   = useRef<Record<string, HTMLInputElement | null>>({});
  const pendingModuleRef  = useRef<string | null>(null);
  const importSectionRef  = useRef<HTMLDivElement>(null);

  // Per-module DB row counts — null while loading, fetched after upload.
  // Used to filter which modules the gap panel surfaces as "Fill template" items.
  const [moduleCounts, setModuleCounts] = useState<Record<string, number> | null>(null);

  // DB field-level gap items fetched from the readiness endpoint after upload.
  // These mirror what the Data Readiness page shows but live in the gap panel too.
  const [dbFieldGaps, setDbFieldGaps] = useState<GapItem[]>([]);

  // Gap review — gaps the user has explicitly marked as "not applicable"
  // for this tenant. Persisted in localStorage so they survive page refreshes.
  const [naGaps, setNaGaps] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(tenantScopedKey("rmone_na_gaps")) ?? "[]";
      return new Set<string>(JSON.parse(raw));
    } catch { return new Set<string>(); }
  });
  function markGapNA(id: string) {
    setNaGaps(prev => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem(tenantScopedKey("rmone_na_gaps"), JSON.stringify([...next])); } catch {}
      return next;
    });
  }
  function unmarkGapNA(id: string) {
    setNaGaps(prev => {
      const next = new Set(prev);
      next.delete(id);
      try { localStorage.setItem(tenantScopedKey("rmone_na_gaps"), JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  /* ── DB status ───────────────────────────────────────────────────── */
  const { data: dbStatus } = useQuery({
    queryKey: ["onboarding-db-status"],
    queryFn:  () => fetch(`${API}/db-status`).then(r => r.json()),
    refetchInterval: 30_000,
  });
  const dbConnected = dbStatus?.db?.connected === true;

  /* ── Persist draft to sessionStorage so a page refresh doesn't lose work ── */
  useEffect(() => { saveDraft({ clientName }); }, [clientName]);
  useEffect(() => { saveDraft({ uploadResult }); }, [uploadResult]);

  /* ── Auto-apply suggestedType: when the server guesses a tab's type,
     trigger reanalysis automatically without requiring the user to use
     the dropdown at all. Uses a ref so we only fire once per uploadId. */
  const autoAppliedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!uploadResult) return;
    const ALL_TYPES = ["assignments", "team", "clients"] as const;

    for (const sheet of uploadResult.sheets) {
      if (sheet.simplifiedType) continue; // server already identified it

      // Pass 1: known type (server-suggested or user previously chose)
      const knownType = sheet.suggestedType ?? userTabOverrides[sheet.sheetName] ?? null;
      if (knownType) {
        const key = `${uploadResult.uploadId}:${sheet.sheetName}`;
        if (autoAppliedRef.current.has(key)) continue;
        autoAppliedRef.current.add(key);
        if (!userTabOverrides[sheet.sheetName]) {
          setUserTabOverrides(prev => ({ ...prev, [sheet.sheetName]: knownType }));
        }
        setExpandedSheets(prev => new Set([...prev, sheet.sheetName]));
        setReanalyzingSheet(sheet.sheetName);
        fetch("/api/onboarding/reanalyze-sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ columns: sheet.columns, tabType: knownType, samples: sheet.samples ?? {}, uploadId: uploadResult.uploadId, sheetName: sheet.sheetName }),
        })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (!data) return;
            setReanalyzedSheets(prev => ({ ...prev, [sheet.sheetName]: data }));
            const sugg = (data as Partial<SheetPreview>).validation?.suggestions ?? {};
            if (Object.keys(sugg).length) {
              setColumnMappings(prev => ({
                ...prev,
                [sheet.sheetName]: { ...sugg, ...(prev[sheet.sheetName] ?? {}) },
              }));
            }
          })
          .finally(() => setReanalyzingSheet(null));
        continue;
      }

      // Pass 2: unknown type — try all three in parallel and pick the best fit
      // (most columns matched). This eliminates the manual "select a type" picker
      // for any sheet the server couldn't auto-detect by name alone.
      if (!sheet.columns?.length) continue;
      const autoKey = `auto:${uploadResult.uploadId}:${sheet.sheetName}`;
      if (autoAppliedRef.current.has(autoKey)) continue;
      autoAppliedRef.current.add(autoKey);
      setExpandedSheets(prev => new Set([...prev, sheet.sheetName]));
      setReanalyzingSheet(sheet.sheetName);
      Promise.all(
        ALL_TYPES.map(async t => {
          const r = await fetch("/api/onboarding/reanalyze-sheet", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ columns: sheet.columns, tabType: t, samples: sheet.samples ?? {}, uploadId: uploadResult.uploadId, sheetName: sheet.sheetName }),
          });
          if (!r.ok) return { t, matched: 0, data: null as unknown };
          const d = await r.json();
          return { t, matched: (d.validation?.matched?.length ?? 0) as number, data: d };
        }),
      )
        .then(results => {
          const best = [...results].sort((a, b) => b.matched - a.matched)[0];
          if (best && best.matched > 0 && best.data) {
            setUserTabOverrides(prev => ({ ...prev, [sheet.sheetName]: best.t }));
            setReanalyzedSheets(prev => ({ ...prev, [sheet.sheetName]: best.data as Partial<SheetPreview> }));
            const sugg = (best.data as Partial<SheetPreview>).validation?.suggestions ?? {};
            if (Object.keys(sugg).length) {
              setColumnMappings(prev => ({
                ...prev,
                [sheet.sheetName]: { ...sugg, ...(prev[sheet.sheetName] ?? {}) },
              }));
            }
          }
        })
        .finally(() => setReanalyzingSheet(null));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadResult]);

  // Auto-expand any sheet that needs mapping when a new upload result arrives
  useEffect(() => {
    if (!uploadResult) return;
    if (autoExpandedUploadRef.current === uploadResult.uploadId) return;
    autoExpandedUploadRef.current = uploadResult.uploadId;
    const toExpand = uploadResult.sheets
      .filter(s => !s.tableName || (s.validation?.unknown?.length ?? 0) > 0)
      .map(s => s.sheetName);
    if (toExpand.length > 0) {
      setExpandedSheets(prev => new Set([...prev, ...toExpand]));
    }
  }, [uploadResult]);

  useEffect(() => { saveDraft({ columnMappings }); }, [columnMappings]);
  useEffect(() => { saveDraft({ tabOverrides: userTabOverrides }); }, [userTabOverrides]);

  /* ── Pre-fill client when arriving from the history "Re-import" menu ──
     (The legacy ?mode= param is ignored: merge-only uploads always update.) */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tenant");
    if (t) setClientName(t);
  }, []);

  /* ── Fetch schema when file is uploaded ─────────────────────────── */
  useEffect(() => {
    if (!uploadResult) return;
    fetch(`${API}/schema`).then(r => r.json()).then(d => setSchema(d.schema ?? {})).catch(() => {});
  }, [uploadResult]);

  /* ── Pre-fill tenant name for non-superadmin users ──────────────── */
  // Always derive from the JWT tenant — never from a stale draft. A non-superadmin
  // cannot change their company name, so if the tenant field changed (e.g. a
  // different user logged in while the old session's draft was still in localStorage),
  // the JWT value must win over whatever the draft stored.
  useEffect(() => {
    if (!superAdmin && user?.tenant) {
      setClientName(user.tenant.replace(/_/g, " "));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [superAdmin, user?.tenant]);

  /* ── Live check: is this company name already taken? ────────────── */
  useEffect(() => {
    const name = clientName.trim();
    if (!name || uploadResult) { setTenantCheck({ checking: false, taken: false }); return; }
    setTenantCheck(s => ({ ...s, checking: true }));
    const t = setTimeout(async () => {
      try {
        const tid = name.replace(/\s+/g, "_");
        const r = await fetch(`${API}/check-tenant?tenantId=${encodeURIComponent(tid)}`, { headers: authHeaders() });
        const d = await r.json();
        setTenantCheck({ checking: false, taken: !d.available && !!d.conflict, conflict: d.conflict });
      } catch {
        setTenantCheck({ checking: false, taken: false });
      }
    }, 450);
    return () => clearTimeout(t);
  }, [clientName, uploadResult]);

  /* ── Poll check-tenant while page is open (catches imports started on
        another tab or by an admin) — runs every 8 s when no file is staged ── */
  useEffect(() => {
    const name = clientName.trim();
    if (!name || uploadResult) return;
    const poll = async () => {
      try {
        const tid = name.replace(/\s+/g, "_");
        const r = await fetch(`${API}/check-tenant?tenantId=${encodeURIComponent(tid)}`, { headers: authHeaders() });
        const d = await r.json();
        setTenantCheck({ checking: false, taken: !d.available && !!d.conflict, conflict: d.conflict });
      } catch { /* ignore — stale state is fine */ }
    };
    const id = setInterval(poll, 8_000);
    return () => clearInterval(id);
  }, [clientName, uploadResult]);

  /* ── Auto-expand sheets that need mapping ───────────────────────── */
  useEffect(() => {
    if (!uploadResult) return;
    const needs = new Set(
      uploadResult.sheets
        .filter(s => (s.validation?.unknown?.length ?? 0) > 0)
        .map(s => s.sheetName),
    );
    setExpandedSheets(needs);
  }, [uploadResult]);

  /* ── Auto-initialise synonym mappings from server analysis ──────── */
  useEffect(() => {
    if (!uploadResult) return;
    setColumnMappings(prev => {
      const next = { ...prev };
      for (const sheet of uploadResult.sheets) {
        const analysis = sheet.simplifiedAnalysis ?? [];
        if (analysis.length === 0) continue;
        const sheetMap = { ...(next[sheet.sheetName] ?? {}) };

        // Track which RM ONE fields are already spoken for so we never auto-assign
        // the same field to two columns (the "(in use)" conflict seen when the AI
        // guesses, e.g. both "Description" and "Internal Id" → Project Title).
        // Priority: existing template/manual choice > exact > synonym > AI guess.
        // Any match that would DUPLICATE an already-claimed field — and every
        // unrecognised extra column — falls back to "keep in our database", so the
        // column is stored and matched to the record instead of being mis-mapped
        // to a wrong/duplicate RM ONE field. A saved template / manual edit always
        // wins because we never overwrite a column already present in sheetMap.
        const claimed = new Set<string>();
        for (const v of Object.values(sheetMap)) if (v && v !== KEEP && v !== SKIP) claimed.add(v);
        for (const a of analysis) {
          if (a.matchType === "exact" && a.canonical) {
            claimed.add(a.canonical);
            // If a previous upload forced this column to KEEP/SKIP (because it was
            // unrecognised then), clear that stale override so it now shows as matched.
            if (sheetMap[a.col] === KEEP || sheetMap[a.col] === SKIP) delete sheetMap[a.col];
          }
        }

        const fill = (a: ColAnalysis) => {
          // Clear stale KEEP/SKIP for synonym/llm matches too — same problem as exact
          if ((sheetMap[a.col] === KEEP || sheetMap[a.col] === SKIP) && a.canonical) delete sheetMap[a.col];
          if (a.col in sheetMap) return; // template/manual already decided this column
          if (a.canonical && !claimed.has(a.canonical)) {
            sheetMap[a.col] = a.canonical;
            claimed.add(a.canonical);
          }
          // If canonical is already claimed by another column, leave this
          // column blank — user sees the conflict explanation and decides.
        };

        // Canonical fields for this tab type — column names that ARE canonical
        // must never be forced to KEEP even if a stale cached analysis says
        // "unknown" (the analysis may be from a session before the field was
        // added to the recognised list).
        const canonicalSet = new Set<string>(sheet.canonicalFields ?? []);
        for (const a of analysis) if (a.matchType === "synonym") fill(a);
        for (const a of analysis) if (a.matchType === "llm")     fill(a);
        // Unknown columns are intentionally left blank — the user decides in
        // step 2 whether to map, save, or skip. We never auto-KEEP anymore.
        // Also clear any stale KEEP that a previous upload/draft wrote for an
        // unknown column — on a fresh upload those decisions must start blank.
        for (const a of analysis) {
          if (a.matchType === "unknown" && sheetMap[a.col] === KEEP) {
            delete sheetMap[a.col];
          }
        }

        next[sheet.sheetName] = sheetMap;
      }
      return next;
    });
  }, [uploadResult]);

  /* ── Fetch per-module DB counts after upload ─────────────────────────
     Used to filter the gap panel so only genuinely empty modules get a
     "Fill template" button (matching the Data Readiness page behaviour). */
  useEffect(() => {
    if (!uploadResult) { setModuleCounts(null); return; }
    const tid = uploadResult.tenantId ?? clientName.trim();
    if (!tid) return;
    fetch(`${API}/module-counts?tenantId=${encodeURIComponent(tid)}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setModuleCounts(d); })
      .catch(() => {});
  }, [uploadResult, clientName]);

  /* ── Fetch field-level gap metrics from the readiness endpoint ────────
     Populates dbFieldGaps so the gap panel shows the same field-level
     issues (missing Division, Job Title, rates, etc.) as the Readiness
     page — not just the module-presence gaps from module-counts. */
  useEffect(() => {
    if (!uploadResult) { setDbFieldGaps([]); return; }
    const tid = uploadResult.tenantId ?? clientName.trim();
    if (!tid) return;

    const FIELD_METRIC_INFO: Record<string, { module: string; label: string; impact: string }> = {
      unassigned_projects: {
        module: "clients",
        label:  "Projects missing a Division",
        impact: "Projects without a Division can't be grouped in reports or filtered by business unit.",
      },
      orphaned_people: {
        module: "team",
        label:  "Staff missing Job Title or Office",
        impact: "Staff without a Job Title or Office are excluded from capacity planning and org structure reports.",
      },
      people_no_allocation: {
        module: "assignments",
        label:  "Staff with no active assignment",
        impact: "Unallocated staff show as 100% available, overstating capacity and distorting utilisation reports.",
      },
      allocations_with_cost_rate: {
        module: "assignments",
        label:  "Assignments missing a labor cost rate",
        impact: "Without cost rates, margin analysis and labor-cost reports will show $0.",
      },
      allocations_with_billing_rate: {
        module: "assignments",
        label:  "Assignments missing a billing rate",
        impact: "Without billing rates, revenue tracking and client billing reports will be incomplete.",
      },
    };

    fetch(`${API}/readiness?tenantId=${encodeURIComponent(tid)}`, { headers: authHeaders() as Record<string, string> })
      .then(r => r.ok ? r.json() : null)
      .then((d: { metrics?: { key: string; status: string; value: number | null; total?: number | null }[] } | null) => {
        if (!d) return;
        const items: GapItem[] = [];
        for (const m of d.metrics ?? []) {
          if (m.status !== "warn") continue;
          const def = FIELD_METRIC_INFO[m.key];
          if (!def) continue;
          // Append a count badge to the label when we can derive how many records are affected
          const missing = (m.total != null && m.value != null) ? m.total - m.value : null;
          const countBadge = missing != null && missing > 0 ? ` (${missing})` : "";
          items.push({
            id:              `metric:${m.key}`,
            level:           "field",
            label:           def.label + countBadge,
            impact:          def.impact,
            templateModule:  def.module,
            metricKey:       m.key,
            downloadTenantId: tid,
          });
        }
        setDbFieldGaps(items);
      })
      .catch(() => {});
  }, [uploadResult, clientName]);

  /* ── Reconcile duplicate field assignments ──────────────────────────
     A saved client template (or a stale one from an earlier import) is
     merged AFTER the auto-init dedup and can re-introduce a duplicate —
     e.g. an old template maps "Description" → Project Title while the
     current file also has a real "Project Name" → Project Title. Users
     can never create a duplicate by hand (the dropdown disables fields
     already in use), so any duplicate here is an auto/template artifact.
     Keep the highest-confidence column (exact > synonym > AI) for each
     field and demote the rest to "keep in our database". Runs on every
     columnMappings change but no-ops (returns prev) once clean, so it
     settles in one pass. */
  useEffect(() => {
    if (!uploadResult) return;
    const rank: Record<string, number> = { exact: 3, synonym: 2, llm: 1 };
    setColumnMappings(prev => {
      let changed = false;
      const next = { ...prev };
      for (const sheet of uploadResult.sheets) {
        const analysis = sheet.simplifiedAnalysis ?? [];
        const baseMap = next[sheet.sheetName] ?? {};
        const fieldLabels = sheet.fieldLabels ?? {};
        // Two canonicals can share one visible field (e.g. "ProjectTitle" and its
        // alias "Project" both read "Project Title"), so we must collide columns by
        // their LABEL, not the raw canonical — otherwise Description → "Project" and
        // Project Name → "ProjectTitle" look distinct here yet both render as
        // "Project Title (in use)" to the user.
        const labelOf = (f: string) => fieldLabels[f] ?? f;
        const matchTypeByCol = new Map<string, string>();
        // Effective field each column claims: an explicit (template/manual) choice
        // wins; otherwise a matched column implicitly claims its detected canonical.
        // Crucially, exact matches are NOT written into the map by auto-init, so we
        // MUST fold in this implicit claim or a stale template (e.g. Description →
        // Project Title) won't be seen to collide with the real exact match.
        const claimByCol = new Map<string, string>();
        for (const a of analysis) {
          matchTypeByCol.set(a.col, a.matchType);
          const m = baseMap[a.col];
          if (m === KEEP || m === SKIP) continue;
          const field = m ? m : (a.matchType !== "unknown" ? a.canonical ?? null : null);
          if (field) claimByCol.set(a.col, field);
        }
        for (const [col, val] of Object.entries(baseMap)) {
          if (!val || val === KEEP || val === SKIP) continue;
          if (!claimByCol.has(col)) claimByCol.set(col, val);
        }
        const byField = new Map<string, string[]>();
        for (const [col, field] of claimByCol) {
          const key = labelOf(field);
          (byField.get(key) ?? byField.set(key, []).get(key)!).push(col);
        }
        let newMap: Record<string, string> | null = null;
        for (const cols of byField.values()) {
          if (cols.length < 2) continue;
          const winner = [...cols].sort(
            (a, b) => (rank[matchTypeByCol.get(b) ?? ""] ?? 0) - (rank[matchTypeByCol.get(a) ?? ""] ?? 0),
          )[0];
          for (const c of cols) {
            if (c === winner) continue;
            // Never demote an exact-match column — it IS the canonical field,
            // so a label collision with another canonical can never be genuine.
            if (matchTypeByCol.get(c) === "exact") continue;
            // Only act if the column actually has a mapping — if it's already
            // blank (not in baseMap), deleting it would be a no-op but still
            // create a new object reference and mark changed=true, causing an
            // infinite re-render loop.
            if (!(c in (newMap ?? baseMap))) continue;
            newMap = newMap ?? { ...baseMap };
            delete newMap[c]; // leave blank — user decides, not auto-KEEP
          }
        }
        if (newMap) { next[sheet.sheetName] = newMap; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [columnMappings, uploadResult]);

  /* ── Reset mapping confirmation on every genuinely new upload ────── */
  // Belt-and-suspenders: onDrop already calls setSimplifiedMappingConfirmed(false)
  // synchronously before the await, but certain navigation paths (browser back,
  // SPA layout persistence) can leave stale `true` state from a previous session.
  // Track the last seen uploadId and reset confirmation whenever a different file
  // arrives, so the user always sees step 2 for a fresh upload.
  const lastUploadIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!uploadResult) return;
    if (uploadResult.uploadId !== lastUploadIdRef.current) {
      lastUploadIdRef.current = uploadResult.uploadId;
      setSimplifiedMappingConfirmed(false);
    }
  }, [uploadResult]);

  /* ── Upload ─────────────────────────────────────────────────────── */

  const handleGapFillFile = useCallback(async (files: File[]) => {
    const pending = pendingGapRef.current;
    if (!pending || !files.length) return;
    const { id: gapId, templateModule } = pending;
    setGapFillUploading(prev => ({ ...prev, [gapId]: true }));
    try {
      const tenantId = uploadResult?.tenantId ?? clientName.trim().replace(/\s+/g, "_");

      // Upload every selected file
      const gapUploads = await Promise.all(files.map(async f => {
        const upRes = await uploadFileSmart({ url: `${API}/upload`, file: f, extra: { tenantId }, headers: authHeaders() });
        const upData = await upRes.json();
        if (!upRes.ok) throw new Error(upData.error ?? `Upload failed for ${f.name}`);
        return upData as { uploadId: string; sheets: Array<{ simplifiedType?: string; totalRows: number }> };
      }));


      // Queue gap fills — they'll be imported together when the user clicks "Import into RM ONE".
      // If re-uploading a gap that was already queued, swap out the old uploadId.
      const prevUploadId = filledGaps[gapId];
      setExtraUploadIds(prev => {
        const without = prevUploadId ? prev.filter(id => id !== prevUploadId) : prev;
        return [...without, ...gapUploads.map(u => u.uploadId)];
      });
      setFilledGaps(prev => ({ ...prev, [gapId]: gapUploads[0].uploadId }));
      // Derive the tab type from the gap id ("module:team", "field:assignments:…", etc.)
      const gapTabType: "team"|"clients"|"assignments" =
        gapId.includes("team") ? "team" : gapId.includes("assignments") ? "assignments" : "clients";
      for (const u of gapUploads) {
        const sNames = ((u as any).sheets as Array<{ sheetName: string }> | undefined)?.map(s => s.sheetName) ?? [];
        setUploadTabTypes(prev => ({ ...prev, [u.uploadId]: { tabType: gapTabType, sheetNames: sNames } }));
      }
      toast({ title: "Ready to import", description: "Fill more gaps or click 'Import into RM ONE' when you're done." });
    } catch (e: any) {
      toast({ title: "Wrong file", description: String(e.message ?? e), variant: "destructive" });
    } finally {
      setGapFillUploading(prev => ({ ...prev, [gapId]: false }));
    }
  }, [uploadResult, clientName, filledGaps, toast]);

  /* ── Module-card upload handler ─────────────────────────────────────
     Called when the user selects a file via a module card's hidden input.
     Uploads to /upload, forces the tab + record type, queues the uploadId. */
  const handleModuleUpload = useCallback(async (file: File, cardId: string) => {
    const card = MODULE_CARDS.find(c => c.id === cardId);
    if (!card) return;
    setModuleUploading(prev => ({ ...prev, [cardId]: true }));
    try {
      const tenantId = uploadResult?.tenantId ?? clientName.trim().replace(/\s+/g, "_");
      if (!tenantId) { toast({ title: "Enter company name first", variant: "destructive" }); return; }
      // Multi-tab cards (Projects, Opportunities) bundle a "Team Assignments" tab
      // alongside the main sheet. Don't force a single tabType — let the server
      // auto-detect each tab. Single-tab cards still get a forcedTabType for
      // accurate column analysis regardless of what the sheet is named.
      const res = await uploadFileSmart({
        url: `${API}/upload`,
        file,
        extra: {
          tenantId,
          ...(!card.multiTab ? { forcedTabType: card.tabType } : {}),
          ...(card.recordType ? { forcedRecordType: card.recordType } : {}),
        },
        headers: authHeaders(),
      });
      const data = await res.json() as UploadResponse;
      if (!res.ok) throw new Error((data as any).error ?? "Upload failed");

      const sheetNames = data.sheets.map(s => s.sheetName);
      const rowCount   = data.sheets.reduce((a, s) => a + s.totalRows, 0);

      setModuleUploads(prev => ({
        ...prev,
        [cardId]: { uploadId: data.uploadId, fileName: file.name, rowCount, sheetNames },
      }));

      // Auto-set tabType overrides. For multi-tab cards (Projects/Opps) the
      // server auto-detects each sheet; we only commit an override when the
      // server already classified it (simplifiedType set), or the sheet name
      // unambiguously signals "assignments". Sheets the server couldn't classify
      // (e.g. a "Schedule" tab that doesn't match any pattern) are left without
      // an override so the "Confirm what each tab contains" grid shows
      // "— select type —", prompting the user to assign them explicitly.
      setUserTabOverrides(prev => {
        const next = { ...prev };
        for (const sheet of data.sheets) {
          const { sheetName: name } = sheet;
          const isAsgSheet = card.multiTab && name.toLowerCase().includes("assignment");
          if (isAsgSheet) {
            next[name] = "assignments";
          } else if (!card.multiTab) {
            // Single-tab card: the server was forced to one type, use it.
            next[name] = card.tabType;
          } else if (sheet.simplifiedType) {
            // Multi-tab: only mirror the server's own classification.
            next[name] = sheet.simplifiedType;
          }
          // Otherwise: leave unset — grid will show "— select type —"
        }
        return next;
      });

      // Auto-set record type override for Project / Opportunity / Lead cards.
      // Only set it when the tab was already classified as "clients" by the
      // server (or forced for single-tab cards); skip unrecognised sheets.
      if (card.recordType) {
        setRecordTypeOverrides(prev => {
          const next = { ...prev };
          for (const sheet of data.sheets) {
            const { sheetName: name } = sheet;
            const isAsgSheet = card.multiTab && name.toLowerCase().includes("assignment");
            if (isAsgSheet) continue;
            const hasClientType = !card.multiTab || sheet.simplifiedType === "clients";
            if (hasClientType) next[name] = card.recordType!;
          }
          return next;
        });
      }

      // Store per-uploadId routing so submission can isolate each file's
      // tab type regardless of sheet name collisions across uploads.
      setUploadTabTypes(prev => ({
        ...prev,
        [data.uploadId]: { tabType: card.tabType, recordType: card.recordType ?? undefined, sheetNames },
      }));

      // First module upload becomes the primary uploadResult
      if (!uploadResult) {
        setUploadResult(data);
      } else {
        setExtraUploadIds(prev => [...prev, data.uploadId]);
        setExtraFileNames(prev => [...prev, file.name]);
      }

      toast({ title: `${card.label} ready ✓`, description: `${rowCount} record${rowCount !== 1 ? "s" : ""} will be imported.` });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setModuleUploading(prev => ({ ...prev, [cardId]: false }));
    }
  }, [uploadResult, clientName, toast]);

  /* ── Sheet-type slot helpers (the "Confirm what each tab contains" grid) ── */
  // Current slot key for a sheet: a user override wins, else the server's
  // detected type, else the standard-format table name.
  const slotForSheet = (sheet: SheetPreview): string => {
    const tab = userTabOverrides[sheet.sheetName];
    const rec = recordTypeOverrides[sheet.sheetName];
    const t = tab
      ?? sheet.simplifiedType
      ?? (sheet.tableName === "Opportunity" || sheet.tableName === "PMM" ? "clients" : null);
    if (t === "team")        return "team";
    if (t === "assignments") return "assignments";
    if (t === "clients") {
      const r = rec
        ?? (sheet.tableName === "Opportunity" ? "Opportunity"
          : sheet.tableName === "PMM"         ? "Project" : null);
      if (r === "Opportunity") return "opportunity";
      if (r === "Lead")        return "lead";
      return "project";
    }
    return "";
  };

  // Assign a sheet to a slot: set the tab/record overrides and re-run column
  // analysis for the new type so the mapping below reflects the correct fields.
  const assignSheetSlot = async (sheetName: string, key: string) => {
    const opt = SHEET_SLOT_OPTIONS.find(o => o.key === key);
    if (!opt) return;
    const orig = uploadResult?.sheets.find(s => s.sheetName === sheetName);
    if (!orig) return;
    // No-op if the sheet is already assigned to this slot — avoids a needless
    // reanalysis round-trip and the flicker/race that comes with it.
    if (slotForSheet(orig) === key) return;
    setUserTabOverrides(prev => ({ ...prev, [sheetName]: opt.tabType }));
    setRecordTypeOverrides(prev => {
      const next = { ...prev };
      if (opt.recordType) next[sheetName] = opt.recordType;
      else delete next[sheetName];
      return next;
    });
    // Drop any prior reanalysis for this sheet so effectiveSheets doesn't merge
    // stale server data (from a previous slot choice) while the new call runs.
    setReanalyzedSheets(prev => {
      if (!(sheetName in prev)) return prev;
      const next = { ...prev };
      delete next[sheetName];
      return next;
    });
    setSimplifiedMappingConfirmed(false);
    setExpandedSheets(prev => new Set([...prev, sheetName]));
    setReanalyzingSheet(sheetName);
    try {
      const resp = await fetch("/api/onboarding/reanalyze-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          columns:  orig.columns,
          tabType:  opt.tabType,
          samples:  orig.samples ?? {},
          uploadId: uploadResult?.uploadId,
          sheetName,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setReanalyzedSheets(prev => ({ ...prev, [sheetName]: data }));
        const sugg = (data as Partial<SheetPreview>).validation?.suggestions ?? {};
        if (Object.keys(sugg).length) {
          setColumnMappings(prev => ({
            ...prev,
            [sheetName]: { ...sugg, ...(prev[sheetName] ?? {}) },
          }));
        }
      }
    } finally {
      setReanalyzingSheet(null);
    }
  };

  /* ── Mapping helpers ────────────────────────────────────────────── */
  const setMapping = (sheetName: string, col: string, val: string) => {
    setColumnMappings(prev => ({ ...prev, [sheetName]: { ...(prev[sheetName] ?? {}), [col]: val } }));
    setSavedId(null);
  };
  const clearMapping = (sheetName: string, col: string) => {
    setColumnMappings(prev => {
      const next = { ...prev, [sheetName]: { ...(prev[sheetName] ?? {}) } };
      delete next[sheetName][col];
      return next;
    });
    setSavedId(null);
  };

  /* ── Inline synonym saver ────────────────────────────────────────
     Called when the user checks "Remember this" on an unmatched column.
     Fires POST /api/onboarding/save-synonym immediately so the next upload
     auto-detects without waiting for a full import to complete. */
  const saveSynonymInline = async (col: string, canonicalField: string, tabType: string) => {
    const key = `${tabType}::${col}`;
    if (savedSynonyms.has(key)) return;
    setSavingSynonym(key);
    try {
      await fetch(`${API}/save-synonym`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ alias: col, canonicalField, tabType }),
      });
      setSavedSynonyms(prev => new Set([...prev, key]));
    } finally {
      setSavingSynonym(null);
    }
  };

  const mappingOptions = (sheet: SheetPreview, forCol: string) => {
    // Prefer canonicalFields when the sheet has a simplifiedType (server-detected or
    // user-overridden via reanalysis) — ensures team/clients/assignments tabs never
    // show PMM/Opportunity fields.  Fall back to the live core2 schema (from
    // /api/onboarding/schema) for raw standard tabs.
    const tableSchema: string[] =
      (sheet.simplifiedType && sheet.canonicalFields?.length)
        ? sheet.canonicalFields
        : sheet.tableName?.startsWith("__override:")
          ? (sheet.canonicalFields ?? [])
          : (schema[sheet.tableName ?? ""] ?? []);
    const matched      = new Set(sheet.validation?.matched ?? []);
    const usedByOthers = new Set(
      Object.entries(columnMappings[sheet.sheetName] ?? {})
        .filter(([k, v]) => k !== forCol && v && v !== SKIP && v !== KEEP)
        .map(([, v]) => v),
    );
    return tableSchema
      .filter(f => !usedByOthers.has(f) && f !== "ID" && f !== "TenantID" && f !== "Deleted")
      .map(f => ({ field: f, alreadyMatched: matched.has(f) }));
  };

  /* ── Profile save / load / delete ───────────────────────────────── */
  const hasAnyMapping = Object.values(columnMappings).some(m => Object.keys(m).length > 0);

  const handleSaveProfile = () => {
    const name = savingName.trim();
    if (!name) { toast({ title: "Enter a profile name", variant: "destructive" }); return; }
    const profile: MappingProfile = {
      id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), mappings: columnMappings,
    };
    const updated = [profile, ...profiles];
    setProfiles(updated); saveProfiles(updated);
    setSavedId(profile.id); setSavingName(""); setShowSaveUI(false);
    toast({ title: `"${name}" saved` });
  };

  const handleLoadProfile = (profileId: string) => {
    const p = profiles.find(x => x.id === profileId);
    if (!p) return;
    setColumnMappings(p.mappings); setSavedId(p.id);
    toast({ title: `"${p.name}" loaded` });
  };

  const handleDeleteProfile = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = profiles.filter(p => p.id !== id);
    setProfiles(updated); saveProfiles(updated);
    if (savedId === id) setSavedId(null);
    toast({ title: `"${name}" deleted` });
  };

  /* ── Run pipeline ───────────────────────────────────────────────── */
  const runPipeline = async (force = false) => {
    if (!uploadResult) return;

    // Pre-import check: detect Division → BU re-link conflicts before writing
    // anything. If the file would silently move a Division from one BU to
    // another, stop here, show the warnings, and let the user confirm.
    if (!force) {
      try {
        const drRes = await fetch(`${API}/dry-run-validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ uploadId: uploadResult.uploadId }),
        });
        if (drRes.ok) {
          const drData = await drRes.json();
          const relinkIssues: string[] = (drData.issues ?? [])
            .filter((i: { type: string }) => i.type === "org_relink")
            .map((i: { message: string }) => i.message);
          const ambiguousIssues = (drData.issues ?? [])
            .filter((i: { type: string }) => i.type === "org_ambiguous")
            .map((i: { value: string; message: string; targetBU: string; existingBUs: Array<{ buTitle: string; divId: string }> }) => ({
              divLower:    i.value,
              message:     i.message,
              targetBU:    i.targetBU,
              existingBUs: i.existingBUs ?? [],
            }));
          if (ambiguousIssues.length > 0) {
            setOrgAmbiguousIssues(ambiguousIssues);
            setDivisionChoices({}); // reset so user must actively choose
            return; // stop — user must resolve each ambiguous division
          }
          if (relinkIssues.length > 0) {
            setOrgRelinkWarnings(relinkIssues);
            return; // stop — user must confirm via the warning banner
          }
        }
      } catch {
        // Non-fatal — if dry-run fails (e.g. server restarting), proceed normally
      }
    }
    setOrgRelinkWarnings([]);
    setOrgAmbiguousIssues([]);
    setRunning(true);
    try {
      const cleanMappings: Record<string, Record<string, string>> = {};
      const keepColumns:   Record<string, string[]>                = {};
      // Only send mappings for sheets that exist in THIS upload — never bleed
      // mappings from other uploads accumulated during the same session.
      const thisUploadSheets = new Set(uploadResult.sheets.map(s => s.sheetName));
      for (const [sheet, cols] of Object.entries(columnMappings)) {
        if (!thisUploadSheets.has(sheet)) continue;
        const mapped: Record<string, string> = {};
        const kept: string[] = [];
        for (const [client, rmone] of Object.entries(cols)) {
          if (rmone === KEEP) kept.push(client);
          else if (rmone && rmone !== SKIP) mapped[client] = rmone;
        }
        if (Object.keys(mapped).length) cleanMappings[sheet] = mapped;
        if (kept.length) keepColumns[sheet] = kept;
      }
      // Merge-only: existing clients always run "update"; fresh ones "create".
      const mainMode = uploadResult.existingClient ? "update" : "create";

      // Build tab/record overrides scoped to only THIS upload's sheets.
      // uploadTabTypes[id] is set when a file is dropped on a module card;
      // otherwise fall back to the user's manual tab picker (filtered to this file).
      const buildTabOverrides = (
        uid: string,
        sheetNames: string[],
      ): { tabTypeOverrides?: Record<string, string>; recordTypeOverrides?: Record<string, string> } => {
        const info = uploadTabTypes[uid];
        const tabOvr: Record<string, string> = {};
        const recOvr: Record<string, string> = {};
        const sheets = info?.sheetNames?.length ? info.sheetNames : sheetNames;
        for (const name of sheets) {
          // Per-sheet user choices (from the "Confirm what each tab contains"
          // grid) always win over the upload-level default, so a multi-tab file
          // routes each tab correctly even when auto-detection guessed wrong.
          const t = userTabOverrides[name] ?? info?.tabType;
          if (t) tabOvr[name] = t;
          const r = recordTypeOverrides[name] ?? info?.recordType;
          if (r) recOvr[name] = r;
        }
        return {
          tabTypeOverrides:    Object.keys(tabOvr).length ? tabOvr : undefined,
          recordTypeOverrides: Object.keys(recOvr).length ? recOvr : undefined,
        };
      };

      const mainOverrides = buildTabOverrides(
        uploadResult.uploadId,
        uploadResult.sheets.map(s => s.sheetName),
      );

      const cleanDivisionHints = Object.keys(divisionChoices).length > 0
        ? divisionChoices
        : undefined;
      const res = await fetch(`${API}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          uploadId: uploadResult.uploadId,
          columnMappings: cleanMappings,
          keepColumns,
          importMode: mainMode,
          fieldOverrides: buildFieldOverrides(validationFixes),
          ...(cleanDivisionHints ? { divisionHints: cleanDivisionHints } : {}),
          ...mainOverrides,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      // Also import any extra files (multi-file drop OR gap fills).
      // Merge-only: gap fills always run "update" (the server adds brand-new
      // records and patches existing ones either way); regular extra files
      // (multi-file drop) follow mainMode so a fresh tenant stays "create".
      const uploadIdToGapId: Record<string, string> = Object.fromEntries(
        Object.entries(filledGaps).map(([gapId, uploadId]) => [uploadId, gapId])
      );
      for (const uid of extraUploadIds) {
        const gapId = uploadIdToGapId[uid];
        const mode = !gapId ? mainMode : "update";
        const extraInfo = uploadTabTypes[uid];
        const extraOverrides = buildTabOverrides(uid, extraInfo?.sheetNames ?? []);
        await fetch(`${API}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            uploadId: uid,
            columnMappings: {},
            importMode: mode,
            ...extraOverrides,
          }),
        });
      }
      const total = 1 + extraUploadIds.length;
      toast({ title: "Import started!", description: total > 1 ? `${total} files are being imported into RM ONE.` : "Your data is being imported into RM ONE." });
      clearDraft();
      try { localStorage.setItem(activeImportKey(), uploadResult.uploadId); } catch {}
      navigate(`/onboarding/status/${uploadResult.uploadId}`);
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const checkIssues = async () => {
    if (!uploadResult) return;
    setValidating(true);
    // Yield one frame so React can paint the spinner before the fetch starts.
    // Without this, React 18 batching can merge true→false into a single render
    // when the network response arrives instantly (e.g. a cached 404).
    await new Promise(resolve => setTimeout(resolve, 50));
    try {
      const cleanMappings: Record<string, Record<string, string>> = {};
      const thisUploadSheets = new Set(uploadResult.sheets.map(s => s.sheetName));
      for (const [sheet, cols] of Object.entries(columnMappings)) {
        if (!thisUploadSheets.has(sheet)) continue;
        const mapped: Record<string, string> = {};
        for (const [client, rmone] of Object.entries(cols)) {
          if (rmone && rmone !== SKIP && rmone !== KEEP) mapped[client] = rmone;
        }
        if (Object.keys(mapped).length) cleanMappings[sheet] = mapped;
      }
      const r = await fetch(`${API}/validate-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ uploadId: uploadResult.uploadId, columnMappings: cleanMappings }),
      });
      if (!r.ok) {
        // server error or expired job — treat as no issues so import can proceed
        setValidationIssues([]);
        return;
      }
      const data = await r.json();
      const issues: ValidationIssue[] = data.issues ?? [];
      setValidationIssues(issues);
      setValidationFixes(prev => {
        const next: ValidationFixes = {};
        for (const issue of issues) {
          next[issue.field] = prev[issue.field] ?? { valueMap: {}, defaultForBlank: "" };
        }
        return next;
      });
    } catch {
      setValidationIssues([]);
    } finally {
      setValidating(false);
    }
  };

  // Auto-run the data check as soon as a file finishes uploading so the user
  // sees validation results immediately — they never need to find the button.
  const uploadId = uploadResult?.uploadId ?? null;
  useEffect(() => {
    if (!uploadId) return;
    checkIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

  /* ── Derived state ──────────────────────────────────────────────── */
  const simplified = uploadResult ? isSimplifiedUpload(uploadResult.sheets) : false;
  const simplifiedSummary = uploadResult && simplified ? getSimplifiedSummary(uploadResult.sheets) : null;

  // Merge user-chosen tab-type overrides into the sheet list. When the server
  // has already returned a full reanalysis for a sheet (via /reanalyze-sheet),
  // we use that. While the call is in-flight we show a loading skeleton.
  const effectiveSheets: SheetPreview[] = (uploadResult?.sheets ?? []).map(sheet => {
    const override   = userTabOverrides[sheet.sheetName];
    const serverData = reanalyzedSheets[sheet.sheetName];
    // Use the sheet as-is only when the user hasn't overridden its type, or the
    // override already matches what the server detected and no fresh reanalysis
    // is pending. Otherwise a manual correction — even of an auto-detected type —
    // must take effect so a wrong guess can be fixed without re-uploading.
    if (!override || (sheet.simplifiedType === override && !serverData)) return sheet;

    // If the server result has arrived, merge it in
    if (serverData) {
      return { ...sheet, ...serverData } as SheetPreview;
    }

    // While the call is in-flight: keep tableName non-null so sheetStatus
    // doesn't flip to no-match, but mark all columns unknown so the
    // loading spinner renders instead of mapping dropdowns.
    return {
      ...sheet,
      simplifiedType:     override,
      tableName:          `__override:${override}`,
      validation:         { matched: [], unknown: [], missingRequired: [] },
      canonicalFields:    null,
      fieldLabels:        null,
      templateOrder:      null,
      suggestedType:      null,
      simplifiedAnalysis: null,
    };
  });

  const sheetStatuses = effectiveSheets.map(s => ({
    sheet: s,
    status: sheetStatus(s, columnMappings[s.sheetName] ?? {}),
  }));
  const allReady     = sheetStatuses.length > 0 && sheetStatuses.every(x => x.status !== "needs-mapping");
  const allNoMatch   = sheetStatuses.length > 0 && sheetStatuses.every(x => x.status === "no-match");
  const simplifiedZeroRows = !!(simplifiedSummary && simplifiedSummary.teamRows === 0 && simplifiedSummary.clientRows === 0 && simplifiedSummary.assignRows === 0);
  const totalRecords = uploadResult?.sheets.reduce((s, sh) => s + sh.totalRows, 0) ?? 0;
  const sheetsWithUnknowns = uploadResult?.sheets.filter(s => (s.validation?.unknown?.length ?? 0) > 0) ?? [];

  /* ── Gap computation ─────────────────────────────────────────────
     Runs client-side from the upload response + columnMappings.
     Returns a list of GapItem objects describing what data is missing. */
  interface GapItem {
    id:              string;
    level:           "module" | "field";
    label:           string;
    impact:          string;
    templateModule:  string;
    metricKey?:      string;
    downloadTenantId?: string;
  }

  const dataGaps: GapItem[] = (() => {
    if (!uploadResult) return [];
    const sheets = uploadResult.sheets;
    const gaps: GapItem[] = [];

    // Helper: does a simplified tab type have any rows?
    const hasRows = (t: "team" | "clients" | "assignments") =>
      sheets.some(s => s.simplifiedType === t && s.totalRows > 0);

    // Helper: returns the set of canonical fields covered by this upload for
    // a given simplified type (auto-detected + manually-mapped, excluding SKIP).
    const coveredFields = (t: "team" | "clients" | "assignments"): Set<string> => {
      const covered = new Set<string>();
      for (const sheet of sheets) {
        if (sheet.simplifiedType !== t || !sheet.simplifiedAnalysis) continue;
        const sheetMap = columnMappings[sheet.sheetName] ?? {};
        for (const a of sheet.simplifiedAnalysis) {
          const m = sheetMap[a.col];
          if (m && m !== SKIP && m !== KEEP) { covered.add(m); continue; }
          if (!m && a.canonical && a.matchType !== "unknown") covered.add(a.canonical);
        }
      }
      return covered;
    };

    // ── Module-level gaps ─────────────────────────────────────────────
    if (!hasRows("team")) {
      gaps.push({
        id: "module:team",
        level: "module",
        label: "Team Members not uploaded",
        impact: "Without team data no one can be assigned to projects — resource planning, allocation reports, and utilisation charts will all be empty.",
        templateModule: "team",
      });
    }

    const clientsSheet = sheets.find(s => s.simplifiedType === "clients");
    if (!clientsSheet || clientsSheet.totalRows === 0) {
      gaps.push({
        id: "module:clients",
        level: "module",
        label: "Projects & Clients not uploaded",
        impact: "Without project data there is no delivery pipeline, no financial reporting, and no client records to link to.",
        templateModule: "clients",
      });
    } else {
      // Entity-type gaps within the clients tab (counted by the Type column)
      const tc = clientsSheet.typeCounts ?? {};
      const oppCount = Object.entries(tc)
        .filter(([k]) => /^opp/i.test(k))
        .reduce((a, [, v]) => a + v, 0);
      const leadCount = Object.entries(tc)
        .filter(([k]) => /^lead/i.test(k))
        .reduce((a, [, v]) => a + v, 0);

      if (oppCount === 0) {
        gaps.push({
          id: "module:opportunities",
          level: "module",
          label: "No Opportunities in your file",
          impact: "Pipeline reports, win-rate tracking, and revenue forecasting will show no data.",
          templateModule: "clients",
        });
      }
      if (leadCount === 0) {
        gaps.push({
          id: "module:leads",
          level: "module",
          label: "No Leads in your file",
          impact: "CRM lead funnel and new-business tracking will be empty.",
          templateModule: "clients",
        });
      }
    }

    if (!hasRows("assignments")) {
      gaps.push({
        id: "module:assignments",
        level: "module",
        label: "Resource Assignments not uploaded",
        impact: "Without assignment data, resource utilisation, allocation %, and who-is-on-what reports will all be empty.",
        templateModule: "assignments",
      });
    }

    // ── Field-level gaps ──────────────────────────────────────────────
    if (hasRows("team")) {
      const tf = coveredFields("team");
      if (!tf.has("UserName") && !tf.has("Email")) {
        gaps.push({
          id: "field:team:login-email",
          level: "field",
          label: "Team login emails missing",
          impact: "Without login email addresses your team members can't be given RM ONE accounts to sign in with.",
          templateModule: "team",
        });
      }
      if (!tf.has("JobTitle") && !tf.has("Title")) {
        gaps.push({
          id: "field:team:job-title",
          level: "field",
          label: "Job titles missing",
          impact: "Without job titles, staff can't be included in org-structure reports or matched to open positions.",
          templateModule: "team",
        });
      }
      if (!tf.has("Office") && !tf.has("Location")) {
        gaps.push({
          id: "field:team:office",
          level: "field",
          label: "Office locations missing",
          impact: "Without office data, headcount-by-location and capacity-by-office reports will be empty.",
          templateModule: "team",
        });
      }
    }

    if (hasRows("clients") && clientsSheet) {
      const cf = coveredFields("clients");
      if (!cf.has("Division") && !cf.has("DivisionLookup") && !cf.has("CRMBusinessUnitChoice") && !cf.has("BusinessUnit")) {
        gaps.push({
          id: "field:clients:division",
          level: "field",
          label: "Projects missing a Division",
          impact: "Projects without a Division can't be grouped in reports or filtered by business unit.",
          templateModule: "clients",
        });
      }
      if (!cf.has("ContractValue") && !cf.has("ApproxContractValue")) {
        gaps.push({
          id: "field:clients:contract-value",
          level: "field",
          label: "Contract values missing",
          impact: "Financial dashboards, revenue totals, and project budget reports will show £0 for all projects.",
          templateModule: "clients",
        });
      }
    }

    return gaps;
  })();

  // Active gaps = upload-file gaps + DB field-level gaps (readiness metrics), minus N/A.
  // Suppress DB metric gaps that are already detected from the uploaded file (same root cause,
  // but the file-based gap is preferred because it pre-fills from the file itself).
  const filteredDbFieldGaps = dbFieldGaps.filter(g => {
    if (g.metricKey === "unassigned_projects" &&
        dataGaps.some(d => d.id === "field:clients:division")) return false;
    if (g.metricKey === "orphaned_people" &&
        (dataGaps.some(d => d.id === "field:team:job-title") ||
         dataGaps.some(d => d.id === "field:team:office")))    return false;
    return true;
  });
  const allGaps    = [...dataGaps, ...filteredDbFieldGaps];
  const activeGaps = allGaps.filter(g => !naGaps.has(g.id));
  const naGapItems = allGaps.filter(g => naGaps.has(g.id));

  // Returns true when the CURRENT upload already contains data for this module,
  // so we don't re-flag it as missing in the DB-presence section (the DB is just
  // empty because the file hasn't been imported yet, not because data is absent).
  const uploadCoversModule = (mod: string): boolean => {
    if (!uploadResult) return false;
    const sheets = uploadResult.sheets;
    if (mod === "team")        return sheets.some(s => s.simplifiedType === "team"        && s.totalRows > 0);
    if (mod === "clients")     return sheets.some(s => s.simplifiedType === "clients"     && s.totalRows > 0);
    if (mod === "assignments")  return sheets.some(s => s.simplifiedType === "assignments" && s.totalRows > 0);
    if (mod === "opportunities") {
      const cs = sheets.find(s => s.simplifiedType === "clients");
      const tc = cs?.typeCounts ?? {};
      return Object.entries(tc).filter(([k]) => /^opp/i.test(k)).reduce((a, [, v]) => a + v, 0) > 0;
    }
    if (mod === "leads") {
      const cs = sheets.find(s => s.simplifiedType === "clients");
      const tc = cs?.typeCounts ?? {};
      return Object.entries(tc).filter(([k]) => /^lead/i.test(k)).reduce((a, [, v]) => a + v, 0) > 0;
    }
    return false; // demand/companies can't be detected from simplified format
  };

  /* ── Full-page grid when Upload is clicked on a module card ──────── */
  if (gridOpenCard) {
    const card = MODULE_CARDS.find(c => c.id === gridOpenCard);
    if (card) {
      return (
        <InlineDataGrid
          cardId={card.id}
          cardLabel={card.label}
          multiTab={card.multiTab}
          isSubmitting={moduleUploading[card.id]}
          forceCreate={!uploadResult?.existingClient}
          // Strict identity keys (Aug 2026): uploads into an EXISTING client
          // run as merge ("update") below, where the server matches by
          // ID/email only and blocks the whole upload on name-only rows.
          // Flag those rows in the review grid BEFORE submitting so the user
          // fixes/confirms them here instead of hitting a post-upload block.
          // A brand-new client (nothing to match against yet) stays tolerant.
          strictKeys={!!uploadResult?.existingClient}
          clientHasData={!!uploadResult?.existingClient}
          onClose={() => setGridOpenCard(null)}
          onSubmit={async (file, mode) => {
            const cardDef = card;
            setModuleUploading(prev => ({ ...prev, [cardDef.id]: true }));
            try {
              const tenantId = uploadResult?.tenantId ?? clientName.trim().replace(/\s+/g, "_");
              if (!tenantId) { toast({ title: "Enter company name first", variant: "destructive" }); return; }
              // 1. Upload
              const upRes = await uploadFileSmart({
                url: `${API}/upload`,
                file,
                extra: {
                  tenantId,
                  ...(!cardDef.multiTab ? { forcedTabType: cardDef.tabType } : {}),
                  ...(cardDef.recordType ? { forcedRecordType: cardDef.recordType } : {}),
                },
                headers: authHeaders(),
              });
              const upData = await upRes.json() as UploadResponse;
              if (!upRes.ok) throw new Error((upData as any).error ?? "Upload failed");
              // 2. Build tab overrides
              const tabOvr: Record<string, string> = {};
              const recOvr: Record<string, string> = {};
              for (const sheet of upData.sheets) {
                const isAsg = cardDef.multiTab && sheet.sheetName.toLowerCase().includes("assignment");
                const t = isAsg ? "assignments" : (!cardDef.multiTab ? cardDef.tabType : (sheet.simplifiedType ?? cardDef.tabType));
                if (t) tabOvr[sheet.sheetName] = t;
                if (cardDef.recordType && !isAsg) recOvr[sheet.sheetName] = cardDef.recordType;
              }
              // 3. Kick off pipeline. /run responds as soon as validation passes
              // (the heavy work continues server-side), so awaiting it is fast —
              // and we MUST await it: a swallowed 409 (e.g. company name already
              // onboarded in "create" mode) would leave the job stuck "pending"
              // while the user stares at a status page that never progresses.
              const runRes = await fetch(`${API}/run`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({
                  uploadId: upData.uploadId,
                  columnMappings: {},
                  // Merge-only: ignore the grid's mode for existing clients.
                  importMode: upData.existingClient ? "update" : "create",
                  tabTypeOverrides:    Object.keys(tabOvr).length ? tabOvr : undefined,
                  recordTypeOverrides: Object.keys(recOvr).length ? recOvr : undefined,
                }),
              });
              if (!runRes.ok) {
                const runErr = await runRes.json().catch(() => ({} as any));
                throw new Error(runErr.error ?? "Import could not start");
              }
              toast({ title: "Import started!", description: "Your data is being imported into RM ONE." });
              try { localStorage.setItem(activeImportKey(), upData.uploadId); } catch {}
              setGridOpenCard(null);
              navigate(`/onboarding/status/${upData.uploadId}`);
            } catch (e: any) {
              toast({ title: "Import failed", description: e.message, variant: "destructive" });
            } finally {
              setModuleUploading(prev => ({ ...prev, [cardDef.id]: false }));
            }
          }}
        />
      );
    }
  }

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div className={embedded ? "" : "min-h-screen bg-background"}>
      {/* Hidden file input for gap fill uploads */}
      <input
        ref={gapFillInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        multiple
        className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) handleGapFillFile(files);
        }}
      />
      <div className={embedded ? "space-y-6" : "max-w-4xl mx-auto px-4 py-8 space-y-6"}>

        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          {!embedded && (
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">Import Client Data</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Upload your Excel file to set up your company in RM ONE — 3 steps.
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <HelpCircle className="w-4 h-4" />
                  How it works?
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-primary" />
                    How column matching works
                  </DialogTitle>
                  <DialogDescription>
                    When you upload an Excel file, each column is matched to the right RM ONE field
                    using 4 layers in order. The first layer that finds a match wins.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 pt-2">

                  {/* Top recommendation banner */}
                  <div className="rounded-lg border-2 border-green-500 bg-green-50 dark:bg-green-950/40 p-3.5">
                    <div className="flex items-center gap-2 font-bold text-sm text-green-700 dark:text-green-400">
                      <Download className="w-4 h-4 shrink-0" />
                      Always use our Download Template for best results
                    </div>
                    <p className="text-xs text-green-700/80 dark:text-green-400/80 mt-1.5 leading-relaxed">
                      <strong>Fill your data directly into the downloaded template</strong> and keep the column names exactly as they are.
                      Every column becomes an instant exact match (Layer 1), skipping synonyms and AI entirely.
                      This is the <strong>fastest, most accurate, and time-saving</strong> way to import into RM ONE.
                    </p>
                  </div>

                  <p className="text-xs text-muted-foreground px-0.5">If you use your own Excel file, here is how each column is matched:</p>

                  {/* Layer 1 */}
                  <div className="flex gap-3 rounded-lg border p-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white">1</div>
                    <div>
                      <div className="flex items-center gap-1.5 font-semibold text-sm">
                        <Check className="w-4 h-4 text-green-600" />
                        Template header match
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        If your column name matches the official template header exactly (case-insensitive), it is matched instantly with no guessing needed. This is why using the template gives 100% accuracy.
                      </p>
                    </div>
                  </div>

                  {/* Layer 2 */}
                  <div className="flex gap-3 rounded-lg border p-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">2</div>
                    <div>
                      <div className="flex items-center gap-1.5 font-semibold text-sm">
                        <Tags className="w-4 h-4 text-sky-600" />
                        Tab-specific overrides
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Some words mean different things on different tabs. For example,{" "}
                        <span className="font-medium text-foreground">"Name"</span> on the Team tab maps to a
                        person's full name, while on the Clients tab it maps to the company name.
                        These context-aware rules run before the global synonym list.
                      </p>
                    </div>
                  </div>

                  {/* Layer 3 */}
                  <div className="flex gap-3 rounded-lg border p-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">3</div>
                    <div>
                      <div className="flex items-center gap-1.5 font-semibold text-sm">
                        <Tags className="w-4 h-4 text-blue-600" />
                        Global synonym map + learned synonyms
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        A built-in list of hundreds of common alternative names such as{" "}
                        <span className="font-medium text-foreground">"org unit"</span> mapping to Division or{" "}
                        <span className="font-medium text-foreground">"bill rate"</span> mapping to Billing Rate.
                        Every time you confirm a manual mapping RM ONE remembers it, so the same column
                        auto-matches in future uploads. You can also add your own aliases in the{" "}
                        <span className="font-medium text-foreground">Synonyms</span> manager.
                      </p>
                    </div>
                  </div>

                  {/* Layer 4 */}
                  <div className="flex gap-3 rounded-lg border p-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">4</div>
                    <div>
                      <div className="flex items-center gap-1.5 font-semibold text-sm">
                        <Sparkles className="w-4 h-4 text-purple-600" />
                        AI matching
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        If all three layers above fail, AI reads the column name <em>and</em> its actual
                        sample values. For example, seeing date values in a column called "Start" maps it
                        to Start Date. Anything the AI cannot confidently place is flagged for you to map
                        manually. Your data is never silently dropped.
                      </p>
                    </div>
                  </div>

                  {/* Unmatched columns */}
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 font-semibold text-sm">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      When a column still cannot be matched
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                      <li>
                        <span className="font-medium text-foreground">Map it manually</span> — pick the correct
                        RM ONE field from a dropdown. RM ONE saves this so future uploads with the same column
                        name auto-match.
                      </li>
                      <li>
                        <span className="font-medium text-foreground">Keep as extra field</span> — data is stored
                        in RM ONE alongside the record. Nothing is lost.
                      </li>
                      <li>
                        <span className="font-medium text-foreground">Skip it</span> — column is ignored and the
                        rest of your import continues normally.
                      </li>
                    </ul>
                  </div>

                </div>
              </DialogContent>
            </Dialog>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => navigate(`/onboarding/history${user?.tenant ? `?tenantId=${encodeURIComponent(user.tenant)}` : ""}`)}
            >
              <History className="w-4 h-4" />
              Import history
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => navigate("/onboarding/readiness")}
            >
              <Gauge className="w-4 h-4" />
              Data readiness
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Tags className="w-4 h-4" />
                  Synonyms
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Tags className="w-5 h-5 text-primary" />
                    Column Synonyms
                  </DialogTitle>
                  <DialogDescription>
                    Define how non-standard column names in uploaded Excel files are recognised as
                    RM ONE fields. Custom synonyms are picked up automatically on the next upload.
                  </DialogDescription>
                </DialogHeader>
                <SynonymsManager />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* ── Step 1: Company name ─────────────────────────────────── */}
        <Card>
          <CardContent className="pt-5 pb-5 space-y-4">

            {/* ── Step badges ─────────────────────────────────────── */}
            {simplified ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1 flex-wrap">
                <span className="flex items-center gap-1 font-semibold text-foreground">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">1</span>
                  Company &amp; Upload
                </span>
                <span className="text-border">→</span>
                <span className={uploadResult ? "font-semibold text-foreground" : ""}>
                  <span className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold mr-1 ${uploadResult ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>2</span>
                  Review mapping
                </span>
                <span className="text-border">→</span>
                <span className={simplifiedMappingConfirmed ? "font-semibold text-foreground" : ""}>
                  <span className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold mr-1 ${simplifiedMappingConfirmed ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>3</span>
                  Confirm &amp; Import
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <span className="flex items-center gap-1 font-semibold text-foreground">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">1</span>
                  Enter company name
                </span>
                <span className="text-border">→</span>
                <span className={uploadResult ? "font-semibold text-foreground" : ""}>
                  <span className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold mr-1 ${uploadResult ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>2</span>
                  Upload file
                </span>
                <span className="text-border">→</span>
                <span>
                  <span className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold mr-1 ${uploadResult && allReady ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>3</span>
                  Confirm &amp; Import
                </span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="clientName" className="font-semibold">
                What is your company name?
              </Label>
              <p className="text-xs text-muted-foreground">
                This is used to identify all your data in RM ONE.
              </p>
              <Input
                id="clientName"
                className="max-w-sm text-sm"
                placeholder="e.g. Acme Construction"
                value={clientName}
                onChange={e => setClientName(e.target.value)}
                disabled={!!uploadResult || !superAdmin}
                title={!superAdmin ? "Your company name is set automatically from your account." : undefined}
              />
              {!superAdmin && (
                <p className="text-xs text-muted-foreground">
                  Your company name is set automatically from your account.
                </p>
              )}
              {!uploadResult && clientName.trim() && (
                tenantCheck.checking ? (
                  <p className="text-xs text-muted-foreground">Checking…</p>
                ) : tenantCheck.taken ? (
                  tenantCheck.conflict?.status === "running" ? (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800/50 px-3 py-2.5 flex items-start gap-2.5">
                      <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">Import in progress</p>
                        <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
                          A file is already being imported for this company. New uploads are locked until it completes.
                        </p>
                        {tenantCheck.conflict.uploadId && (
                          <button
                            className="mt-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 underline underline-offset-2 flex items-center gap-1"
                            onClick={() => navigate(`/onboarding/status/${tenantCheck.conflict!.uploadId}`)}
                          >
                            <ArrowRight className="w-3 h-3" /> View live progress
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                  <div className="text-xs text-amber-600 flex items-start gap-1">
                    <Check className="w-3 h-3 shrink-0 mt-0.5" />
                    <span>
                      Your data already exists. Upload again and you'll choose how to update it.
                      {tenantCheck.conflict && (
                        <span className="block mt-0.5 text-muted-foreground">
                          Last file: <span className="font-medium text-foreground">{tenantCheck.conflict.fileName}</span>
                          {" "}({tenantCheck.conflict.status}
                          {fmtDate(tenantCheck.conflict.createdAt) ? ` · ${fmtDate(tenantCheck.conflict.createdAt)}` : ""})
                        </span>
                      )}
                    </span>
                  </div>
                  )
                ) : (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <Check className="w-3 h-3 shrink-0" /> New — first import
                  </p>
                )
              )}
              {uploadResult && (
                <button
                  className="text-xs text-primary underline"
                  onClick={() => { clearDraft(); setUploadResult(null); setExtraUploadIds([]); setColumnMappings({}); setUserTabOverrides({}); setReanalyzedSheets({}); setTemplateApplied(false); setSimplifiedMappingConfirmed(false); setModuleUploads({}); setRecordTypeOverrides({}); lastUploadIdRef.current = null; }}
                >
                  Start over with a different name
                </button>
              )}
            </div>

            {/* ── Module cards upload area ─────────────────────── */}
            {/* Hidden file input — billing rates card */}
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              ref={rateCardInputRef}
              onChange={async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                e.target.value = "";
                setRateCardUploading(true);
                try {
                  const result = await importRateCard(file);
                  const parts: string[] = [];
                  if (result.created > 0) parts.push(`${result.created} role${result.created !== 1 ? "s" : ""} created`);
                  if (result.saved   > 0) parts.push(`${result.saved} rate${result.saved   !== 1 ? "s" : ""} updated`);
                  if (result.skipped > 0) parts.push(`${result.skipped} row${result.skipped !== 1 ? "s" : ""} skipped`);
                  const summary = parts.length ? parts.join(", ") + "." : "Nothing changed.";
                  toast({
                    title: (result.saved > 0 || result.created > 0) ? "Billing Rates imported" : "Nothing changed",
                    description: result.errors.length > 0
                      ? `${summary} Errors: ${result.errors.slice(0, 3).join("; ")}`
                      : summary,
                    variant: result.errors.length > 0 ? "destructive" : "default",
                  });
                  if (result.saved > 0 || result.created > 0) setRateCardDone(true);
                } catch (err) {
                  toast({ title: "Import failed", description: String(err), variant: "destructive" });
                } finally {
                  setRateCardUploading(false);
                }
              }}
            />

            {/* Hidden file inputs — one per module card */}
            {MODULE_CARDS.map(card => (
              <input
                key={card.id}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                ref={el => { moduleInputRefs.current[card.id] = el; }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleModuleUpload(file, card.id);
                  e.target.value = "";
                }}
              />
            ))}

            {/* Module cards grid */}
            <div>
              <Label className="font-semibold">Upload your data — pick a module</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-3">
                Download the template for each module, fill it in, then upload it here. You can upload as many modules as you need.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-module-grid>
                {MODULE_CARDS.map(card => {
                  const uploaded = moduleUploads[card.id];
                  const isLoading = moduleUploading[card.id];
                  const isLocked  = tenantCheck.conflict?.status === "running";
                  const IconMap: Record<string, ComponentType<{ className?: string }>> = {
                    FolderKanban, ClipboardList, Tags, Users, Building2,
                  };
                  const Icon = IconMap[card.icon] ?? FolderKanban;
                  const accentClasses: Record<string, string> = {
                    blue:   "border-blue-200   dark:border-blue-800   bg-blue-50/50   dark:bg-blue-950/20",
                    purple: "border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20",
                    amber:  "border-amber-200  dark:border-amber-800  bg-amber-50/50  dark:bg-amber-950/20",
                    green:  "border-green-200  dark:border-green-800  bg-green-50/50  dark:bg-green-950/20",
                    slate:  "border-slate-200  dark:border-slate-700  bg-slate-50/50  dark:bg-slate-900/30",
                    teal:   "border-teal-200   dark:border-teal-800   bg-teal-50/50   dark:bg-teal-950/20",
                  };
                  const iconClasses: Record<string, string> = {
                    blue: "text-blue-600 dark:text-blue-400", purple: "text-purple-600 dark:text-purple-400",
                    amber: "text-amber-600 dark:text-amber-400", green: "text-green-600 dark:text-green-400",
                    slate: "text-slate-600 dark:text-slate-400", teal: "text-teal-600 dark:text-teal-400",
                  };
                  return (
                    <div
                      key={card.id}
                      className={`rounded-xl border p-3 flex flex-col gap-2 transition-all ${uploaded ? accentClasses[card.accent] : "border-border bg-background hover:bg-muted/30"}`}
                    >
                      <div className="flex items-start gap-2">
                        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconClasses[card.accent]}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold leading-tight">{card.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{card.desc}</p>
                        </div>
                        {uploaded && <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />}
                      </div>

                      {uploaded ? (
                        <div className="space-y-1.5">
                          <p className="text-xs text-green-700 dark:text-green-400 truncate font-medium" title={uploaded.fileName}>
                            {uploaded.fileName}
                          </p>
                          <p className="text-xs text-muted-foreground">{uploaded.rowCount} row{uploaded.rowCount !== 1 ? "s" : ""} ready</p>
                          <button
                            className="text-xs text-muted-foreground underline hover:text-foreground"
                            onClick={() => {
                              // Remove this module's upload
                              setModuleUploads(prev => { const n = { ...prev }; delete n[card.id]; return n; });
                              // Remove its overrides
                              const upload = moduleUploads[card.id];
                              if (upload) {
                                setRecordTypeOverrides(prev => {
                                  const n = { ...prev };
                                  for (const s of upload.sheetNames) delete n[s];
                                  return n;
                                });
                                // Remove from extraUploadIds or reset uploadResult
                                setExtraUploadIds(prev => prev.filter(id => id !== upload.uploadId));
                                if (uploadResult?.uploadId === upload.uploadId) {
                                  setUploadResult(null);
                                }
                              }
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs gap-1 px-2 flex-1"
                            onClick={() => {
                              const tid = uploadResult?.tenantId ?? clientName.trim().replace(/\s+/g, "_");
                              const url = `${API}/gap-template?module=${card.templateMod}${tid ? `&tenantId=${encodeURIComponent(tid)}` : ""}`;
                              window.open(url, "_blank");
                            }}
                          >
                            <Download className="w-3 h-3" />
                            Template
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs gap-1 px-2 flex-1"
                            disabled={isLoading || isLocked || !clientName.trim()}
                            onClick={() => setGridOpenCard(prev => prev === card.id ? null : card.id)}
                          >
                            {isLoading
                              ? <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                              : <Upload className="w-3 h-3" />
                            }
                            Upload
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* ── Billing Rates card ── */}
                <div className={`rounded-xl border p-3 flex flex-col gap-2 transition-all ${rateCardDone ? "border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-950/20" : "border-border bg-background hover:bg-muted/30"}`}>
                  <div className="flex items-start gap-2">
                    <DollarSign className={`w-4 h-4 shrink-0 mt-0.5 ${rateCardDone ? "text-teal-600 dark:text-teal-400" : "text-teal-600 dark:text-teal-400"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold leading-tight">Billing Rates</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-tight">Role billing, labor &amp; cost rates</p>
                    </div>
                    {rateCardDone && <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />}
                  </div>
                  {rateCardDone ? (
                    <div className="space-y-1.5">
                      <p className="text-xs text-green-700 dark:text-green-400 font-medium">Rates updated</p>
                      <button
                        className="text-xs text-muted-foreground underline hover:text-foreground"
                        onClick={() => setRateCardDone(false)}
                      >
                        Upload again
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs gap-1 px-2 flex-1"
                        onClick={async () => {
                          try { await downloadRateCard(); }
                          catch (e) { toast({ title: "Download failed", description: String(e), variant: "destructive" }); }
                        }}
                      >
                        <Download className="w-3 h-3" />
                        Template
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs gap-1 px-2 flex-1"
                        disabled={rateCardUploading}
                        onClick={() => rateCardInputRef.current?.click()}
                      >
                        {rateCardUploading
                          ? <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                          : <Upload className="w-3 h-3" />
                        }
                        Upload
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Summary row when any card is uploaded */}
              {Object.keys(moduleUploads).length > 0 && (
                <>
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 px-3 py-2">
                    <div className="flex items-center gap-2 text-sm text-green-800 dark:text-green-300">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        <strong>{Object.keys(moduleUploads).length}</strong> module{Object.keys(moduleUploads).length !== 1 ? "s" : ""} ready ·{" "}
                        <strong>{Object.values(moduleUploads).reduce((a, m) => a + m.rowCount, 0)}</strong> total records
                      </span>
                    </div>
                    <button
                      className="text-xs text-green-700 dark:text-green-400 underline hover:text-green-900 dark:hover:text-green-200"
                      onClick={() => {
                        setModuleUploads({});
                        setRecordTypeOverrides({});
                        setUploadResult(null);
                        setExtraUploadIds([]);
                        setExtraFileNames([]);
                        clearDraft();
                      }}
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="outline"
                      className="flex-1 h-11 text-sm gap-2"
                      onClick={() => document.querySelector<HTMLElement>('[data-module-grid]')?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      <Upload className="w-4 h-4" /> Add more files
                    </Button>
                    <Button
                      className="flex-1 h-11 text-sm gap-2"
                      onClick={() => importSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      Proceed to Import <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                </>
              )}

            </div>

            {/* ── Upload success (replace area) ────────────────────── */}
            {uploadResult && (
              <div className="rounded-xl border border-green-500 dark:border-green-600 bg-green-50 dark:bg-green-950/60 px-4 py-3 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  {extraFileNames.length === 0 ? (
                    <p className="text-sm font-semibold text-green-800 dark:text-green-300 truncate">{uploadResult.fileName}</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {[uploadResult.fileName, ...extraFileNames].map((name, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-200/60 dark:bg-green-800/50 text-green-900 dark:text-green-200 border border-green-300 dark:border-green-700 max-w-[200px] truncate"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                    {extraFileNames.length > 0
                      ? `${extraFileNames.length + 1} files · ${totalRecords} records ready to import`
                      : `${totalRecords} records ready to import`}
                  </p>
                </div>
                <button
                  className="text-xs text-green-700 dark:text-green-400 hover:text-green-900 dark:hover:text-green-200 underline shrink-0 font-medium mt-0.5"
                  onClick={() => { clearDraft(); setUploadResult(null); setExtraUploadIds([]); setExtraFileNames([]); setColumnMappings({}); setUserTabOverrides({}); setReanalyzedSheets({}); setTemplateApplied(false); setSimplifiedMappingConfirmed(false); setModuleUploads({}); setRecordTypeOverrides({}); lastUploadIdRef.current = null; }}
                >
                  Change files
                </button>
              </div>
            )}

            {/* ── Saved-template banner ────────────────────────────── */}
            {uploadResult && templateApplied && (
              <div className="rounded-xl border border-sky-400 dark:border-sky-500 bg-sky-50 dark:bg-sky-950/70 px-4 py-2.5 flex items-center gap-2.5">
                <Check className="w-4 h-4 text-sky-600 dark:text-sky-300 shrink-0" />
                <p className="text-xs font-medium text-sky-800 dark:text-sky-200">
                  Using your saved column mapping from a previous upload. You can still adjust it below.
                </p>
              </div>
            )}

            {/* ── Existing-client: uploads always merge (add + update, never remove) ─── */}
            {uploadResult?.existingClient && (
              <div className="rounded-xl border border-sky-400 dark:border-sky-500 bg-sky-50 dark:bg-sky-950/60 px-4 py-3.5 space-y-1">
                <p className="text-sm font-semibold text-sky-900 dark:text-sky-200">
                  Your data is already in RM ONE — this upload will be merged in
                </p>
                <p className="text-xs text-sky-800 dark:text-sky-300">
                  Anything new in the file is added. People, clients and projects that already
                  exist are matched and their details updated — projects in this file also get
                  their schedule and team updated to match the file. Nothing is ever removed by
                  an upload: whatever is not in the file stays exactly as it is.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Confirm what each tab contains (sheet-type grid) ─────────
            Always-visible, explicit per-tab type assignment. Solves the case
            where auto-detection guessed a tab's type wrong (e.g. an assignments
            tab named "Work Schedule" or a team tab named "Staff Roster"). The
            user simply picks the right category — no renaming or re-uploading. */}
        {uploadResult && effectiveSheets.length > 0 && (
          <Card className="border-primary/30">
            <CardContent className="pt-5 pb-5 space-y-4">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-primary shrink-0" />
                <h2 className="text-base font-semibold">Confirm what each tab contains</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                We auto-detected the type of each tab in your file. If any is wrong, correct it here —
                your data will be routed to the right place. No need to rename tabs or re-upload.
              </p>
              <div className="space-y-2">
                {effectiveSheets.map(sheet => {
                  const cur      = slotForSheet(sheet);
                  const busy     = reanalyzingSheet === sheet.sheetName;
                  const firstCol = sheet.columns?.[0];
                  const hint     = firstCol
                    ? (sheet.samples?.[firstCol] ?? []).filter(Boolean).slice(0, 3).join(", ")
                    : "";
                  return (
                    <div key={sheet.sheetName} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 bg-card">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{sheet.sheetName}</span>
                          {sheet.totalRows > 0 && (
                            <span className="text-xs text-muted-foreground shrink-0">
                              {sheet.totalRows} row{sheet.totalRows !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        {hint && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">e.g. {hint}</p>}
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="shrink-0 flex items-center gap-2">
                        {busy && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
                        <select
                          value={cur}
                          onChange={e => assignSheetSlot(sheet.sheetName, e.target.value)}
                          className="text-sm border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 min-w-[9.5rem]"
                        >
                          <option value="" disabled>— select type —</option>
                          {SHEET_SLOT_OPTIONS.map(o => (
                            <option key={o.key} value={o.key}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step 2: Column mapping review (simplified) ───────────── */}
        {uploadResult && simplified && !simplifiedMappingConfirmed && (
          <Card className="border-amber-300 dark:border-amber-800">
            <CardContent className="pt-5 pb-5 space-y-5">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs font-bold shrink-0">2</span>
                <h2 className="text-base font-semibold">Review column mapping</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                We matched your columns to RM ONE fields.{" "}
                <span className="font-medium text-amber-600 dark:text-amber-400">Auto-detected synonyms are highlighted</span> — confirm or change.
                Extra columns can be mapped to any RM ONE field.
              </p>

              <div className="space-y-6">
                {effectiveSheets.filter(s => s.simplifiedAnalysis).map(sheet => {
                  const analysis   = sheet.simplifiedAnalysis!;
                  const sheetMap   = columnMappings[sheet.sheetName] ?? {};
                  const fieldLabels  = sheet.fieldLabels ?? {};
                  const templateOrder = sheet.templateOrder ?? [];

                  // Friendly name for a RM ONE field (same wording as the template),
                  // falling back to the raw field name if no label is known.
                  const label = (f: string) => fieldLabels[f] ?? f;
                  // Position of a field in the original template (for ordering); fields
                  // not in the template (brand-new) sort to the very end.
                  const orderOf = (f: string | null) => {
                    const i = f ? templateOrder.indexOf(f) : -1;
                    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
                  };

                  // Dropdown options listed in template order, friendly names first.
                  const canonicals = [...(sheet.canonicalFields ?? [])].sort(
                    (a, b) => orderOf(a) - orderOf(b) || label(a).localeCompare(label(b)),
                  );

                  // Mapping rows shown in the original download-template order.
                  const byTemplate = (a: ColAnalysis, b: ColAnalysis) =>
                    orderOf(a.canonical) - orderOf(b.canonical);
                  // A column we defaulted (or the user switched) to "keep in our
                  // database" is shown in the Extra section, never the matched list —
                  // even if the AI had guessed a field for it — so a duplicate/uncertain
                  // AI guess is stored against the record instead of being mis-mapped to
                  // a wrong RM ONE field.
                  const isKept     = (col: string) => sheetMap[col] === KEEP;
                  const exact      = analysis.filter(a => a.matchType === "exact" && !isKept(a.col)).sort(byTemplate);
                  const synonyms   = analysis.filter(a => (a.matchType === "synonym" || a.matchType === "llm") && !isKept(a.col)).sort(byTemplate);
                  const unknowns   = analysis.filter(a => a.matchType === "unknown" || isKept(a.col));
                  // All matched columns (exact + auto-detected + AI) in ONE list, kept in
                  // the SAME left-to-right order as the columns in the user's file
                  // (analysis preserves file order). We deliberately do NOT reorder by the
                  // mapped target field, so rows mirror the spreadsheet exactly even when a
                  // column is auto-detected to a differently-positioned field. Brand-new
                  // (unknown) and kept-in-database columns are rendered last in their own
                  // section below.
                  const mapped     = analysis.filter(a => a.matchType !== "unknown" && !isKept(a.col));

                  // Effective field assignment per source column, reflecting live edits:
                  // a manual override wins; otherwise a matched row keeps its detected
                  // canonical. Unknown columns count only once explicitly mapped.
                  const effectiveField = (a: ColAnalysis): string | null => {
                    const m = sheetMap[a.col];
                    if (m === SKIP || m === KEEP) return null;
                    if (m) return m;
                    return a.matchType === "unknown" ? null : (a.canonical ?? null);
                  };
                  const assignments: Record<string, string> = {};
                  for (const a of analysis) {
                    const f = effectiveField(a);
                    if (f) assignments[a.col] = f;
                  }

                  // A field is "in use" if any OTHER column currently maps to it.
                  // Compare by friendly label so alias canonicals that share a label
                  // (e.g. StartDate vs AllocationStartDate, both shown as "Start Date")
                  // are treated as the same field — otherwise the unused twin of a
                  // mapped field wrongly appears available.
                  const isFieldTaken = (f: string, forCol: string) =>
                    Object.entries(assignments).some(
                      ([col, val]) => col !== forCol && label(val) === label(f),
                    );

                  // Collapse canonical fields that share a friendly label into a single
                  // dropdown option so the same field never appears twice. Always keep a
                  // canonical that is actually assigned to a column (so matched-row selects
                  // can render their value); otherwise keep the first (template-order)
                  // representative of each label.
                  const assignedVals = new Set(Object.values(assignments));
                  const seenLabels = new Set<string>();
                  const dropdownFields: string[] = [];
                  for (const f of canonicals) {
                    if (assignedVals.has(f)) { dropdownFields.push(f); seenLabels.add(label(f)); }
                  }
                  for (const f of canonicals) {
                    if (assignedVals.has(f)) continue;
                    if (seenLabels.has(label(f))) continue;
                    dropdownFields.push(f); seenLabels.add(label(f));
                  }
                  dropdownFields.sort(
                    (a, b) => orderOf(a) - orderOf(b) || label(a).localeCompare(label(b)),
                  );

                  // Split the bottom section: columns we are STORING in our database
                  // (KEEP) get their own positively-framed group, kept separate from any
                  // remaining "extra" columns the user mapped to a field or skipped.
                  const keptCols    = unknowns.filter(a => sheetMap[a.col] === KEEP);
                  const otherExtras = unknowns.filter(a => sheetMap[a.col] !== KEEP);

                  // Shared renderer for a single bottom-section column row.
                  const extraRow = (a: ColAnalysis) => {
                    const cur       = sheetMap[a.col];
                    const isSkipped = cur === SKIP;
                    const isKept    = cur === KEEP;
                    const isMapped  = cur && cur !== SKIP && cur !== KEEP;
                    const isBlank   = !cur; // no decision made yet
                    return (
                      <div key={a.col} className={`rounded-lg border px-3 py-2.5 ${
                        isMapped  ? "border-green-300 dark:border-green-800 bg-green-500/5" :
                        isKept    ? "border-blue-300 dark:border-blue-800 bg-blue-500/5" :
                        isSkipped ? "border-border opacity-50" :
                        "border-amber-300/60 dark:border-amber-700/60 bg-amber-500/5"
                      }`}>
                        {/* Top row: name + badge + arrow + dropdown */}
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-mono font-medium truncate">{a.col}</p>
                              {isBlank && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium border bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
                                  Not matched
                                </span>
                              )}
                              {isKept && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium border bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30 flex items-center gap-1">
                                  <Database className="w-2.5 h-2.5" /> Saved to your database
                                </span>
                              )}
                              {isMapped && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium border bg-green-500/15 text-green-600 dark:text-green-300 border-green-500/30">
                                  Mapped
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {isMapped ? `→ ${label(cur!)}` : isKept ? "Saved under its own name, against each matching record" : isSkipped ? "Will be skipped" : "Will be skipped — pick an action if you want to keep this data"}
                            </p>
                          </div>
                          {!isSkipped && <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                          {isSkipped ? (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-xs text-muted-foreground italic">Skipped</span>
                              <button className="text-xs text-primary underline" onClick={() => clearMapping(sheet.sheetName, a.col)}>Undo</button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 shrink-0">
                              <FieldSearchCombobox
                                value={cur ?? ""}
                                fields={dropdownFields}
                                labelOf={label}
                                isTaken={f => isFieldTaken(f, a.col)}
                                onSelect={val => {
                                  if (val === SKIP) setMapping(sheet.sheetName, a.col, SKIP);
                                  else if (val) setMapping(sheet.sheetName, a.col, val);
                                  else clearMapping(sheet.sheetName, a.col);
                                }}
                                colName={a.col}
                                tabType={sheet.simplifiedType ?? undefined}
                                sampleValues={sheet.samples?.[a.col] ?? []}
                                onAiSuggest={(alias, canonical) => {
                                  setMapping(sheet.sheetName, alias, canonical);
                                  if (sheet.simplifiedType) saveSynonymInline(alias, canonical, sheet.simplifiedType);
                                }}
                                triggerCls={`w-48 ${isMapped ? "border-green-400" : ""}`}
                              />
                              {isMapped && (
                                <button onClick={() => clearMapping(sheet.sheetName, a.col)} className="text-muted-foreground hover:text-foreground">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {/* Explanation — always shown so the user knows exactly what will happen */}
                        <p className="text-xs text-muted-foreground mt-2 leading-relaxed border-t border-border/40 pt-2">
                          <span className="font-medium text-foreground/70">What this means: </span>
                          {isKept
                            ? `There's no matching RM ONE field for this column, so it's stored in your database under its own name "${a.col}" against each record — kept permanently and re-applied automatically on future uploads.`
                            : isSkipped
                            ? `This column will be ignored completely — no data from "${a.col}" will be stored or imported.`
                            : isMapped
                            ? `Data from your "${a.col}" column will be imported into the "${label(cur!)}" field in RM ONE.`
                            : `This column name wasn't recognised as any standard RM ONE field. Search for the closest RM ONE field above — if nothing matches, an AI suggestion will appear automatically to map and remember it for future uploads. Leave it blank to skip.`
                          }
                        </p>
                        {/* "Remember this" inline synonym saver — only shown when the user
                            has just mapped an unmatched column. Saves the alias immediately
                            so future uploads auto-detect it without a full import. */}
                        {isMapped && sheet.simplifiedType && (() => {
                          const synKey = `${sheet.simplifiedType}::${a.col}`;
                          const isSaved = savedSynonyms.has(synKey);
                          const isSaving = savingsynonym === synKey;
                          return (
                            <div className="mt-2 flex items-center gap-2">
                              {isSaved ? (
                                <span className="flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400 font-medium">
                                  <Check className="w-3 h-3" />
                                  Remembered — "{a.col}" will auto-detect as {label(cur!)} on future uploads
                                </span>
                              ) : (
                                <button
                                  disabled={isSaving}
                                  onClick={() => saveSynonymInline(a.col, cur!, sheet.simplifiedType!)}
                                  className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 disabled:opacity-50 transition-colors"
                                >
                                  <Sparkles className="w-3 h-3 shrink-0" />
                                  {isSaving ? "Saving…" : `Remember this — auto-detect "${a.col}" as ${label(cur!)} next time`}
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  };

                  return (
                    <div key={sheet.sheetName} className="space-y-2.5">
                      {/* Sheet label + counts */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{sheet.sheetName}</span>
                        <span className="text-xs text-muted-foreground">{sheet.totalRows} {sheet.totalRows === 1 ? "row" : "rows"}</span>
                        {exact.length > 0 && (
                          <Badge variant="outline" className="text-[10px] text-green-600 border-green-300 dark:border-green-700">
                            {exact.length} matched
                          </Badge>
                        )}
                        {synonyms.length > 0 && (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 dark:border-amber-700">
                            {synonyms.length} auto-detected
                          </Badge>
                        )}
                        {keptCols.length > 0 && (
                          <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300 dark:border-blue-700">
                            {keptCols.length} saved to your database
                          </Badge>
                        )}
                        {otherExtras.length > 0 && (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 dark:border-amber-700">
                            {otherExtras.length} unmatched
                          </Badge>
                        )}
                      </div>

                      {/* Data preview — collapsible 5-row sample table */}
                      <SheetDataPreview sheet={sheet} />

                      {/* Every column in ONE unified list — RM ONE-field matches AND
                          columns saved to your database under their own name. There is
                          deliberately no separate "extra columns" bucket: a column with
                          no RM ONE field is a first-class field saved in your database. */}
                      {(mapped.length > 0 || keptCols.length > 0) && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                            Matched columns — confirm or change any mapping below.
                          </p>
                          {[...mapped, ...keptCols].map(a => {
                            const current  = sheetMap[a.col] ?? a.canonical ?? "";
                            const isKept   = current === KEEP;
                            const kind     = a.matchType; // "exact" | "synonym" | "llm"
                            const rowCls =
                              isKept
                                ? "border-blue-300 dark:border-blue-800 bg-blue-500/5"
                                : kind === "exact"
                                ? "border-green-500/40 bg-green-500/5"
                                : kind === "llm"
                                ? "border-violet-500/40 bg-violet-500/5"
                                : "border-amber-500/40 bg-amber-500/5";
                            const badgeCls =
                              isKept
                                ? "bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30"
                                : kind === "exact"
                                ? "bg-green-500/15 text-green-600 dark:text-green-300 border-green-500/30"
                                : kind === "llm"
                                ? "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30"
                                : "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30";
                            const badgeText = isKept ? "Saved to your database" : kind === "exact" ? "Matched" : kind === "llm" ? "AI suggested" : "Auto-detected";
                            const subText   = isKept ? "Saved to your database under its own name" : kind === "exact" ? "Matched your template exactly" : kind === "llm" ? "AI matched — please verify" : "Column from your file";
                            const arrowCls  = kind === "exact" && !isKept ? "text-green-400" : kind === "llm" && !isKept ? "text-violet-400" : "text-amber-400";
                            return (
                              <div key={a.col} className={`rounded-lg border px-3 py-2.5 ${rowCls}`}>
                                <div className="flex items-center gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <p className="text-sm font-mono font-medium">{a.col}</p>
                                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium border ${badgeCls}`}>
                                        {badgeText}
                                      </span>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">{subText}</p>
                                  </div>
                                  <ArrowRight className={`w-4 h-4 shrink-0 ${arrowCls}`} />
                                  <FieldSearchCombobox
                                    value={current}
                                    fields={dropdownFields}
                                    labelOf={label}
                                    isTaken={f => isFieldTaken(f, a.col)}
                                    onSelect={val => setMapping(sheet.sheetName, a.col, val)}
                                    colName={a.col}
                                    tabType={sheet.simplifiedType ?? undefined}
                                    sampleValues={sheet.samples?.[a.col] ?? []}
                                    onAiSuggest={(alias, canonical) => saveSynonymInline(alias, canonical, sheet.simplifiedType!)}
                                    triggerCls="w-44"
                                  />
                                </div>
                                {/* Verify-match warning for synonym / AI rows the user hasn't manually confirmed */}
                                {!isKept && (kind === "synonym" || kind === "llm") && !sheetMap[a.col] && current && current !== SKIP && (() => {
                                  // Find which other column is already claiming this same field so
                                  // we can explain the conflict instead of giving a generic warning.
                                  const conflictingCol = analysis.find(other => {
                                    if (other.col === a.col) return false;
                                    const otherClaim = sheetMap[other.col] ?? (other.matchType !== "unknown" ? other.canonical : null);
                                    return otherClaim === current;
                                  })?.col ?? null;
                                  return (
                                    <div className="mt-2 pt-2 border-t border-amber-300/40 dark:border-amber-700/40 flex items-start gap-1.5">
                                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                                      {conflictingCol ? (
                                        <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug">
                                          This column also maps to <span className="font-semibold">"{label(current)}"</span> — but that field is already covered by <span className="font-mono font-semibold">{conflictingCol}</span>. It will be skipped unless you pick a different field below.
                                        </p>
                                      ) : (
                                        <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug">
                                          Auto-matched: your column <span className="font-semibold">"{a.col}"</span> was interpreted as <span className="font-semibold">"{label(current)}"</span>. If this looks wrong, change it using the dropdown.
                                        </p>
                                      )}
                                    </div>
                                  );
                                })()}
                                {isKept ? (
                                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed border-t border-border/40 pt-2">
                                    <span className="font-medium text-foreground/70">What this means: </span>
                                    There’s no matching RM ONE field for this column, so it’s saved in your database under its own name “{a.col}” against each matching record — kept permanently and re-applied automatically on future uploads.
                                  </p>
                                ) : current && current !== KEEP && current !== SKIP && (
                                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed border-t border-border/40 pt-2">
                                    <span className="font-medium text-foreground/70">What this means: </span>
                                    {explainTarget(current, label(current), sheet.samples?.[a.col])}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Remaining columns the user mapped to a field or skipped */}
                      {otherExtras.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            These columns weren't recognised — map each to an RM ONE field, save as-is, or skip. Anything left blank will be skipped on import.
                          </p>
                          {otherExtras.map(extraRow)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {(() => {
                const unresolved = uploadResult.sheets.reduce((n, s) => {
                  const sm = columnMappings[s.sheetName] ?? {};
                  return n + (s.simplifiedAnalysis ?? []).filter(
                    a => a.matchType === "unknown" && !sm[a.col],
                  ).length;
                }, 0);
                return unresolved > 0 ? (
                  <p className="text-xs text-muted-foreground text-center">
                    {unresolved} unrecognised column{unresolved !== 1 ? "s" : ""} will be skipped — resolve above if you want to keep that data.
                  </p>
                ) : null;
              })()}
              <Button
                className="w-full gap-2 h-10 mt-2"
                onClick={() => setSimplifiedMappingConfirmed(true)}
              >
                Mapping looks good — continue
                <ArrowRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── Step 3: Simplified format — confirm & import ─────────── */}
        {uploadResult && simplified && simplifiedMappingConfirmed && simplifiedSummary && (
          <Card ref={importSectionRef} className="border-primary/30">
            <CardContent className="pt-5 pb-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">3</span>
                <h2 className="text-base font-semibold">Ready to import</h2>
                <button
                  className="text-xs text-muted-foreground underline ml-auto"
                  onClick={() => setSimplifiedMappingConfirmed(false)}
                >
                  ← Back to mapping
                </button>
              </div>
              <p className="text-sm text-muted-foreground">
                Here's what will be created for <strong>{clientName}</strong>:
              </p>

              {/* Summary grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-muted/30 px-3 py-3 text-center">
                  <Users className="w-5 h-5 mx-auto mb-1 text-primary" />
                  <p className="text-xl font-bold">{simplifiedSummary.teamRows}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Team Members</p>
                  <p className="text-[10px] text-muted-foreground">+ roles, departments, divisions</p>
                </div>
                <div className="rounded-lg border bg-muted/30 px-3 py-3 text-center">
                  <Building2 className="w-5 h-5 mx-auto mb-1 text-primary" />
                  <p className="text-xl font-bold">{simplifiedSummary.clientRows}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Clients & Projects</p>
                  <p className="text-[10px] text-muted-foreground">+ contacts auto-split</p>
                </div>
                <div className="rounded-lg border bg-muted/30 px-3 py-3 text-center">
                  <ClipboardList className="w-5 h-5 mx-auto mb-1 text-primary" />
                  {simplifiedSummary.assignRows > 0 ? (
                    <>
                      <p className="text-xl font-bold">{simplifiedSummary.assignRows}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Assignments</p>
                      <p className="text-[10px] text-muted-foreground">resource allocations</p>
                    </>
                  ) : simplifiedSummary.teamRows > 0 ? (
                    <>
                      <p className="text-xl font-bold text-green-600 dark:text-green-400">✓</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Assignments</p>
                      <p className="text-[10px] text-muted-foreground">included in team rows</p>
                    </>
                  ) : (
                    <>
                      <p className="text-xl font-bold">{simplifiedSummary.assignRows}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Assignments</p>
                      <p className="text-[10px] text-muted-foreground">resource allocations</p>
                    </>
                  )}
                </div>
              </div>

              {/* What gets auto-created */}
              <div className="rounded-lg bg-muted/40 px-4 py-3 space-y-1.5 text-xs text-muted-foreground">
                <p className="font-medium text-foreground text-sm mb-2">What gets created automatically:</p>
                <div className="flex items-start gap-2"><Check className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" /><span>Divisions, departments, roles &amp; job titles — extracted from each row, deduplicated</span></div>
                <div className="flex items-start gap-2"><Check className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" /><span>Client contacts — split by semicolon from the Contacts column</span></div>
                <div className="flex items-start gap-2"><Check className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" /><span>Projects vs Opportunities — determined by the Type column</span></div>
                <div className="flex items-start gap-2"><Check className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" /><span>Tenant registered, passwords hashed, ticket IDs generated</span></div>
              </div>

              {/* Data gap review removed — users proceed directly to import */}
              {false && (activeGaps.some(g => g.level === "module") || ALL_TEMPLATE_MODULES.some(({ mod }) => (!moduleCounts || moduleCounts[mod] === 0) && !naGaps.has(`module:${mod}`) && !allGaps.some(g => g.id === `module:${mod}`) && !uploadCoversModule(mod))) && (
                <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-500/5 overflow-hidden">
                  <div className="flex items-start gap-3 px-4 py-3.5 border-b border-amber-200 dark:border-amber-800">
                    <TriangleAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">Data gap review</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Some data modules haven't been uploaded yet. Upload them now or mark as N/A if they don't apply.
                      </p>
                    </div>
                  </div>

                  {/* ── Missing modules — not yet uploaded ── */}
                  {(activeGaps.some(g => g.level === "module") || ALL_TEMPLATE_MODULES.some(({ mod }) => (!moduleCounts || moduleCounts[mod] === 0) && !naGaps.has(`module:${mod}`) && !allGaps.some(g => g.id === `module:${mod}`) && !uploadCoversModule(mod))) && (
                    <div>
                      <div className="px-4 py-1.5 bg-amber-500/5 border-b border-amber-200/60 dark:border-amber-800/60">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">Modules not yet uploaded</p>
                      </div>
                      <div className="divide-y divide-amber-200/60 dark:divide-amber-800/60">
                        {activeGaps.filter(g => g.level === "module").map(gap => (
                          <div key={gap.id} className="px-4 py-3 flex items-start gap-3">
                            <div className="mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" />
                            <div className="flex-1 min-w-0 space-y-1">
                              <p className="text-sm font-medium leading-tight">{gap.label}</p>
                              <p className="text-xs text-muted-foreground leading-relaxed">{gap.impact}</p>
                            </div>
                            {filledGaps[gap.id] ? (
                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                <span className="flex items-center gap-1 text-xs font-medium text-green-500 dark:text-green-400">
                                  <CheckCircle2 className="w-3.5 h-3.5" />Queued
                                </span>
                                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                                  disabled={!!gapFillUploading[gap.id]}
                                  onClick={() => { pendingGapRef.current = { id: gap.id, templateModule: gap.templateModule }; gapFillInputRef.current?.click(); }}>
                                  {gapFillUploading[gap.id] ? <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" /> : <Upload className="w-3 h-3" />}
                                  Re-upload
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 shrink-0 ml-2 flex-wrap justify-end">
                                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-amber-300 dark:border-amber-700 hover:bg-amber-500/10"
                                  onClick={() => { const url = gap.metricKey && gap.downloadTenantId ? `${API}/gap-template?module=${gap.templateModule}&metricKey=${encodeURIComponent(gap.metricKey)}&tenantId=${encodeURIComponent(gap.downloadTenantId)}` : `${API}/gap-template?module=${gap.templateModule}&uploadId=${encodeURIComponent(uploadResult?.uploadId ?? "")}&gapId=${encodeURIComponent(gap.id)}`; window.open(url, "_blank"); }}>
                                  <FileDown className="w-3 h-3" />Download
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-amber-300 dark:border-amber-700 hover:bg-amber-500/10"
                                  disabled={!!gapFillUploading[gap.id]}
                                  onClick={() => { pendingGapRef.current = { id: gap.id, templateModule: gap.templateModule }; gapFillInputRef.current?.click(); }}>
                                  {gapFillUploading[gap.id] ? <span className="w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" /> : <Upload className="w-3 h-3" />}
                                  Upload filled
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={() => markGapNA(gap.id)}>
                                  <Ban className="w-3 h-3" />N/A
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                        {ALL_TEMPLATE_MODULES.filter(({ mod }) => (!moduleCounts || moduleCounts[mod] === 0) && !naGaps.has(`module:${mod}`) && !allGaps.some(g => g.id === `module:${mod}`) && !uploadCoversModule(mod)).map(({ mod, label, desc }) => (
                          <div key={mod} className="px-4 py-3 flex items-start gap-3">
                            <div className="mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" />
                            <div className="flex-1 min-w-0 space-y-1">
                              <p className="text-sm font-medium leading-tight">{label}</p>
                              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                            </div>
                            {filledGaps[`module:${mod}`] ? (
                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                <span className="flex items-center gap-1 text-xs font-medium text-green-500 dark:text-green-400">
                                  <CheckCircle2 className="w-3.5 h-3.5" />Queued
                                </span>
                                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                                  disabled={!!gapFillUploading[`module:${mod}`]}
                                  onClick={() => { pendingGapRef.current = { id: `module:${mod}`, templateModule: mod }; gapFillInputRef.current?.click(); }}>
                                  {gapFillUploading[`module:${mod}`] ? <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" /> : <Upload className="w-3 h-3" />}
                                  Re-upload
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 shrink-0 ml-2 flex-wrap justify-end">
                                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-amber-300 dark:border-amber-700 hover:bg-amber-500/10"
                                  onClick={() => window.open(`${API}/gap-template?module=${mod}&gapId=module%3A${mod}&uploadId=${encodeURIComponent(uploadResult?.uploadId ?? "")}`, "_blank")}>
                                  <FileDown className="w-3 h-3" />Download
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-amber-300 dark:border-amber-700 hover:bg-amber-500/10"
                                  disabled={!!gapFillUploading[`module:${mod}`]}
                                  onClick={() => { pendingGapRef.current = { id: `module:${mod}`, templateModule: mod }; gapFillInputRef.current?.click(); }}>
                                  {gapFillUploading[`module:${mod}`] ? <span className="w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" /> : <Upload className="w-3 h-3" />}
                                  Upload filled
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={() => markGapNA(`module:${mod}`)}>
                                  <Ban className="w-3 h-3" />N/A
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      {ALL_TEMPLATE_MODULES.some(({ mod }) => (!moduleCounts || moduleCounts[mod] === 0) && naGaps.has(`module:${mod}`) && !allGaps.some(g => g.id === `module:${mod}`) && !uploadCoversModule(mod)) && (
                        <div className="px-4 py-2 border-t border-amber-200/60 dark:border-amber-800/60 flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] text-muted-foreground">Marked as N/A:</span>
                          {ALL_TEMPLATE_MODULES.filter(({ mod }) => (!moduleCounts || moduleCounts[mod] === 0) && naGaps.has(`module:${mod}`) && !allGaps.some(g => g.id === `module:${mod}`) && !uploadCoversModule(mod)).map(({ mod, label }) => (
                            <button key={mod} className="text-[11px] text-muted-foreground underline decoration-dotted hover:text-foreground" onClick={() => unmarkGapNA(`module:${mod}`)}>{label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* N/A footer for field gaps */}
                  {naGapItems.length > 0 && (
                    <div className="px-4 py-2 border-t border-amber-200/60 dark:border-amber-800/60 flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-muted-foreground">Marked as N/A:</span>
                      {naGapItems.map(g => (
                        <button key={g.id} className="text-[11px] text-muted-foreground underline decoration-dotted hover:text-foreground" onClick={() => unmarkGapNA(g.id)}>{g.label}</button>
                      ))}
                    </div>
                  )}
                  {activeGaps.length === 0 && naGapItems.length > 0 && (
                    <div className="px-4 py-3 flex items-center gap-2">
                      <CircleDot className="w-4 h-4 text-green-500 shrink-0" />
                      <p className="text-xs text-muted-foreground">All gaps marked as N/A — you're good to import.</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Hard stop: zero rows in simplified flow ──── */}
              {simplifiedZeroRows && (
                <div className="rounded-xl border border-red-400 dark:border-red-700 bg-red-500/5 overflow-hidden">
                  <div className="flex items-start gap-3 px-4 py-4 border-b border-red-200 dark:border-red-800">
                    <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-red-700 dark:text-red-400">No data found to import</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Your file was recognised but contains no data rows. Download a blank template, fill it in, and re-upload.
                      </p>
                    </div>
                  </div>
                  <div className="max-h-[252px] overflow-y-auto divide-y divide-red-100/60 dark:divide-red-900/40">
                    {ALL_TEMPLATE_MODULES.map(({ mod, label, desc }) => (
                      <div key={mod} className="px-4 py-2.5 flex items-center gap-3">
                        <div className="mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full bg-red-400/60" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium leading-tight">{label}</p>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1.5"
                            onClick={() => window.open(`${API}/gap-template?module=${mod}&gapId=module%3A${mod}&uploadId=${encodeURIComponent(uploadResult?.uploadId ?? "")}`, "_blank")}
                          >
                            <FileDown className="w-3 h-3" />
                            Download
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1.5"
                            disabled={!!gapFillUploading[`module:${mod}`]}
                            onClick={() => { pendingGapRef.current = { id: `module:${mod}`, templateModule: mod }; gapFillInputRef.current?.click(); }}
                          >
                            {gapFillUploading[`module:${mod}`]
                              ? <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                              : <Upload className="w-3 h-3" />}
                            Upload
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!simplifiedZeroRows && <p className="text-[11px] text-muted-foreground text-center px-2">
                After importing, you can edit this data anytime — either directly inside RM ONE, or by uploading an updated file here — existing records are updated and new rows are added automatically.
              </p>}

              {!simplifiedZeroRows && (
                <ValidationPanel
                  issues={validationIssues}
                  fixes={validationFixes}
                  onFixes={setValidationFixes}
                  validating={validating}
                  onCheck={checkIssues}
                />
              )}

              {/* Division disambiguation banner — appears when a name exists under multiple BUs */}
              {orgAmbiguousIssues.length > 0 && (
                <div className="rounded-md border border-blue-500/40 bg-blue-500/10 p-3 space-y-3">
                  <div className="flex items-center gap-2 text-blue-400 text-sm font-medium">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Division name conflict — action required
                  </div>
                  {orgAmbiguousIssues.map((issue) => (
                    <div key={issue.divLower} className="space-y-1.5">
                      <p className="text-xs text-blue-300 leading-snug">{issue.message}</p>
                      <div className="flex flex-col gap-1">
                        {issue.existingBUs.map((e) => (
                          <label key={e.divId} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`div-choice-${issue.divLower}`}
                              value={e.divId}
                              checked={divisionChoices[issue.divLower] === e.divId}
                              onChange={() => setDivisionChoices(prev => ({ ...prev, [issue.divLower]: e.divId }))}
                              className="accent-blue-400"
                            />
                            <span className="text-xs text-muted-foreground">
                              {e.divId.startsWith("file:")
                                ? <>Use <strong className="text-foreground">{e.buTitle}</strong> as the Business Unit for &ldquo;{issue.divLower}&rdquo;</>
                                : <>Update the existing division under <strong className="text-foreground">{e.buTitle}</strong> → move it to <strong className="text-foreground">{issue.targetBU}</strong></>
                              }
                            </span>
                          </label>
                        ))}
                        {!issue.existingBUs.every(e => e.divId.startsWith("file:")) && (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`div-choice-${issue.divLower}`}
                              value="create"
                              checked={divisionChoices[issue.divLower] === "create"}
                              onChange={() => setDivisionChoices(prev => ({ ...prev, [issue.divLower]: "create" }))}
                              className="accent-blue-400"
                            />
                            <span className="text-xs text-muted-foreground">
                              Create a <strong className="text-foreground">new division</strong> under <strong className="text-foreground">{issue.targetBU}</strong> (leave existing ones untouched)
                            </span>
                          </label>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-blue-500/40 text-blue-400 hover:text-blue-400"
                      disabled={orgAmbiguousIssues.some(i => !divisionChoices[i.divLower])}
                      onClick={() => {
                        setOrgAmbiguousIssues([]);
                        runPipeline(true);
                      }}
                    >
                      Confirm &amp; import
                    </Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { setOrgAmbiguousIssues([]); setDivisionChoices({}); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* BU re-link confirmation banner */}
              {orgRelinkWarnings.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-amber-500 text-sm font-medium">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Division → Business Unit conflict detected
                  </div>
                  <div className="space-y-1">
                    {orgRelinkWarnings.map((w, i) => (
                      <p key={i} className="text-xs text-amber-400 leading-snug">{w}</p>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-500 hover:text-amber-500" onClick={() => runPipeline(true)}>
                      Proceed anyway
                    </Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setOrgRelinkWarnings([])}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {!simplifiedZeroRows && (
                <Button
                  className="w-full gap-2 h-11 text-base"
                  onClick={() => runPipeline()}
                  disabled={running || !dbConnected}
                >
                  {running ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Importing…
                    </>
                  ) : (
                    <>Import into RM ONE <ArrowRight className="w-4 h-4" /></>
                  )}
                </Button>
              )}
              {!simplifiedZeroRows && !dbConnected && (
                <p className="text-xs text-center text-amber-600">Waiting for database connection…</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Step 3B: Standard format — column mapping review ─────── */}
        {uploadResult && !simplified && (
          <div ref={importSectionRef} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Review your data</h2>
              {profiles.length > 0 && sheetsWithUnknowns.length > 0 && (
                <div className="flex items-center gap-2">
                  <Select onValueChange={handleLoadProfile} value="">
                    <SelectTrigger className="h-8 text-xs w-44 border-dashed">
                      <BookOpen className="w-3 h-3 mr-1" />
                      <SelectValue placeholder="Load saved mapping" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map(p => (
                        <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {sheetStatuses.map(({ sheet, status }) => {
              const friendlyName  = FRIENDLY_TABLE[sheet.tableName ?? ""] ?? sheet.sheetName;
              const sheetMappings = columnMappings[sheet.sheetName] ?? {};
              const unknowns      = sheet.validation?.unknown ?? [];
              const autoMatched   = sheet.simplifiedAnalysis?.filter(a => a.matchType !== "unknown") ?? [];
              const isExpanded    = expandedSheets.has(sheet.sheetName);
              const unmappedCount = unknowns.filter(c => !sheetMappings[c]).length;
              const mappedCount   = unknowns.filter(c => sheetMappings[c] && sheetMappings[c] !== SKIP && sheetMappings[c] !== KEEP).length;

              return (
                <Card key={sheet.sheetName} className={`overflow-hidden transition-all ${
                  status === "needs-mapping" ? "border-amber-300 dark:border-amber-800" :
                  status === "no-match"      ? "border-red-300 dark:border-red-800 opacity-60" :
                                              "border-green-300 dark:border-green-800"
                }`}>
                  <button
                    className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-accent/30 transition-colors"
                    onClick={() => setExpandedSheets(prev => {
                      const next = new Set(prev);
                      next.has(sheet.sheetName) ? next.delete(sheet.sheetName) : next.add(sheet.sheetName);
                      return next;
                    })}
                  >
                    <div className="shrink-0">
                      {status === "ready"        && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                      {status === "needs-mapping" && <AlertTriangle className="w-5 h-5 text-amber-500" />}
                      {status === "no-match"      && <XCircle className="w-5 h-5 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">
                          {sheet.tableName ? friendlyName : sheet.sheetName}
                        </span>
                        {sheet.totalRows > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {sheet.totalRows} {sheet.totalRows === 1 ? "record" : "records"}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {status === "ready"        && "All columns recognised — ready to import"}
                        {status === "no-match"     && "Tab name not recognised — tell us what type of data this is to continue without re-uploading"}
                        {status === "needs-mapping" && unmappedCount > 0
                          && `${unmappedCount} column${unmappedCount > 1 ? "s" : ""} need your attention`}
                        {status === "needs-mapping" && unmappedCount === 0
                          && (sheet.validation?.missingRequired?.length ?? 0) > 0
                          && `Missing required columns: ${sheet.validation!.missingRequired.join(", ")}`}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {status === "needs-mapping" && mappedCount > 0 && (
                        <span className="text-xs text-green-600 font-medium">{mappedCount} matched</span>
                      )}
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                        : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {/* Inline type picker — native <select> so it works in any iframe/proxy
                      context. Appears when the tab name wasn't auto-recognised. */}
                  {status === "no-match" && (
                    <div className="px-4 pb-4 pt-2 border-t border-red-100 dark:border-red-900/40 bg-red-500/5">
                      <p className="text-[11px] text-muted-foreground mb-2">
                        What kind of data is in this tab?
                      </p>
                      <select
                        value={userTabOverrides[sheet.sheetName] ?? ""}
                        onChange={async e => {
                          const chosen = e.target.value as "team" | "clients" | "assignments";
                          if (!chosen) return;
                          setUserTabOverrides(prev => ({ ...prev, [sheet.sheetName]: chosen }));
                          setExpandedSheets(prev => new Set([...prev, sheet.sheetName]));
                          setReanalyzingSheet(sheet.sheetName);
                          try {
                            const resp = await fetch("/api/onboarding/reanalyze-sheet", {
                              method: "POST",
                              headers: { "Content-Type": "application/json", ...authHeaders() },
                              body: JSON.stringify({ columns: sheet.columns, tabType: chosen, samples: sheet.samples ?? {}, uploadId: uploadResult?.uploadId, sheetName: sheet.sheetName }),
                            });
                            if (resp.ok) {
                              const data = await resp.json();
                              setReanalyzedSheets(prev => ({ ...prev, [sheet.sheetName]: data }));
                              const sugg = (data as Partial<SheetPreview>).validation?.suggestions ?? {};
                              if (Object.keys(sugg).length) {
                                setColumnMappings(prev => ({
                                  ...prev,
                                  [sheet.sheetName]: { ...sugg, ...(prev[sheet.sheetName] ?? {}) },
                                }));
                              }
                            }
                          } finally {
                            setReanalyzingSheet(null);
                          }
                        }}
                        className="text-sm border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 w-full max-w-xs"
                      >
                        <option value="">— select a type —</option>
                        {TAB_TYPE_PICKER_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label} — {opt.desc}
                          </option>
                        ))}
                      </select>

                      {/* Reanalysis in-flight spinner */}
                      {reanalyzingSheet === sheet.sheetName && (
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <div className="h-3.5 w-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                          Matching your columns…
                        </div>
                      )}
                    </div>
                  )}

                  {/* Data preview — collapsible 5-row sample table */}
                  {isExpanded && <div className="border-t px-4 pt-3 pb-0"><SheetDataPreview sheet={sheet} /></div>}

                  {/* Expanded column mapping — shows auto-matched summary + unknown dropdowns */}
                  {isExpanded && sheet.tableName && (autoMatched.length > 0 || unknowns.length > 0) && (
                    <div className="border-t px-4 py-4 space-y-3">

                      {/* Auto-mapped columns — collapsed by default, expand to review */}
                      {autoMatched.length > 0 && (
                        <div>
                          <button
                            type="button"
                            className="flex items-center gap-2 w-full text-left"
                            onClick={() => setExpandedAutoMapped(prev => {
                              const next = new Set(prev);
                              if (next.has(sheet.sheetName)) next.delete(sheet.sheetName);
                              else next.add(sheet.sheetName);
                              return next;
                            })}
                          >
                            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                            <span className="text-sm font-medium text-green-700 dark:text-green-400">
                              {autoMatched.length} column{autoMatched.length !== 1 ? "s" : ""} auto-mapped
                            </span>
                            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground ml-auto transition-transform ${expandedAutoMapped.has(sheet.sheetName) ? "rotate-180" : ""}`} />
                          </button>
                          {expandedAutoMapped.has(sheet.sheetName) && (
                            <div className="mt-2 space-y-1.5 pl-1">
                              {autoMatched.map(a => (
                                <div key={a.col} className="flex items-center gap-2 text-xs rounded border border-green-200 dark:border-green-900/40 bg-green-500/5 px-2.5 py-1.5">
                                  <span className="font-mono font-medium flex-1 truncate">{a.col}</span>
                                  <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                  <span className="text-green-700 dark:text-green-400 font-medium">{friendlyField(a.canonical ?? a.col)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Schema incompatibility warnings — advisory, non-blocking */}
                      {(sheet.schemaIncompatibilities?.length ?? 0) > 0 && (
                        <div className="rounded-lg border border-amber-400/50 bg-amber-500/5 px-3.5 py-3 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                            <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                              {sheet.schemaIncompatibilities!.length === 1
                                ? "1 schema type conflict detected"
                                : `${sheet.schemaIncompatibilities!.length} schema type conflicts detected`}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            These columns may fail to save because the value type the pipeline sends doesn't match
                            what this tenant's database expects. You can still proceed — failed fields will appear
                            as warnings in the import history.
                          </p>
                          <div className="mt-2 space-y-1">
                            {sheet.schemaIncompatibilities!.map((inc, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs rounded border border-amber-300/60 bg-amber-500/10 px-2.5 py-1.5">
                                <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
                                <span className="text-amber-900 dark:text-amber-200">{inc.reason}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Unknown columns — need user input */}
                      {unknowns.length > 0 && (
                        <div className="space-y-2.5">
                          <p className="text-sm font-medium">
                            {autoMatched.length > 0
                              ? `${unknowns.length} column${unknowns.length !== 1 ? "s" : ""} we don't recognise — tell us what each one contains:`
                              : "We found some column names we don't recognise. Please tell us what each one contains:"}
                          </p>
                          {unknowns.map(col => {
                            const mapped      = sheetMappings[col];
                            const isSkipped   = mapped === SKIP;
                            const isKept      = mapped === KEEP;
                            const isMapped    = mapped && mapped !== SKIP && mapped !== KEEP;
                            const options     = mappingOptions(sheet, col);
                            const aiSuggested = sheet.validation?.suggestions?.[col];
                            const isAiPrefilled = isMapped && mapped === aiSuggested;
                            return (
                              <div key={col} className={`rounded-lg border px-3 py-2.5 flex items-center gap-3 ${
                                isMapped  ? "border-green-500/40 bg-green-500/5" :
                                isKept    ? "border-blue-500/40 bg-blue-500/5" :
                                isSkipped ? "border-border opacity-50" : "border-amber-500/40 bg-amber-500/5"
                              }`}>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-mono font-medium truncate">{col}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {isKept
                                      ? "Kept in our database"
                                      : isAiPrefilled
                                        ? <span className="flex items-center gap-1">
                                            <span className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">AI</span>
                                            suggested — confirm or change
                                          </span>
                                        : isMapped
                                          ? `→ ${friendlyField(mapped!)}`
                                          : "Column from your file"}
                                  </p>
                                </div>
                                {!isSkipped && (
                                  <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                                )}
                                {isSkipped ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs text-muted-foreground italic">Skipped</span>
                                    <button
                                      type="button"
                                      className="text-xs text-primary underline"
                                      onClick={() => clearMapping(sheet.sheetName, col)}
                                    >
                                      Undo
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-end gap-1 shrink-0">
                                    <div className="flex items-center gap-2">
                                      <Select
                                        value={mapped ?? ""}
                                        onValueChange={val => {
                                          if (val === SKIP) setMapping(sheet.sheetName, col, SKIP);
                                          else if (val === KEEP) setMapping(sheet.sheetName, col, KEEP);
                                          else if (val) setMapping(sheet.sheetName, col, val);
                                          else clearMapping(sheet.sheetName, col);
                                        }}
                                      >
                                        <SelectTrigger className={`h-8 text-xs w-52 ${isMapped ? "border-green-400" : isKept ? "border-blue-400" : ""}`}>
                                          {mapped && mapped !== SKIP && mapped !== KEEP
                                            ? <span className="truncate">{friendlyField(mapped)}</span>
                                            : <SelectValue placeholder="Select RM ONE field…" />}
                                        </SelectTrigger>
                                        <SelectContent className="max-h-64 overflow-y-auto">
                                          <SelectItem value={SKIP} className="text-xs text-muted-foreground italic">
                                            — Skip this column —
                                          </SelectItem>
                                          {options.map(({ field, alreadyMatched }) => {
                                            const hint = sheet.fieldHints?.[field];
                                            return (
                                              <SelectItem
                                                key={field}
                                                value={field}
                                                className="text-xs"
                                                disabled={alreadyMatched}
                                              >
                                                <div className="flex flex-col gap-0.5 py-0.5">
                                                  <span>{friendlyField(field)}{alreadyMatched ? " (already matched)" : ""}</span>
                                                  {hint && !alreadyMatched && (
                                                    <span className="text-[10px] text-muted-foreground leading-tight">{hint}</span>
                                                  )}
                                                </div>
                                              </SelectItem>
                                            );
                                          })}
                                        </SelectContent>
                                      </Select>
                                      {(isMapped || isKept) && (
                                        <button type="button" onClick={() => clearMapping(sheet.sheetName, col)} className="text-muted-foreground hover:text-foreground">
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                    {isMapped && sheet.fieldHints?.[mapped!] && (
                                      <p className="text-[11px] text-muted-foreground leading-snug max-w-[13rem] text-right">
                                        {sheet.fieldHints[mapped!]}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}

            {/* ── Save / load mapping profile ───────────────────── */}
            {hasAnyMapping && (
              <div className="flex items-center justify-between gap-2 pt-1">
                {showSaveUI ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      value={savingName}
                      onChange={e => setSavingName(e.target.value)}
                      placeholder="Profile name (e.g. Our standard format)"
                      className="h-8 text-xs flex-1"
                      onKeyDown={e => e.key === "Enter" && handleSaveProfile()}
                    />
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleSaveProfile}>
                      <Save className="w-3 h-3 mr-1" /> Save
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowSaveUI(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 border-dashed" onClick={() => setShowSaveUI(true)}>
                      <Save className="w-3 h-3" />
                      {savedId ? "Saved" : "Save mapping"}
                    </Button>
                    {profiles.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {profiles.slice(0, 3).map(p => (
                          <Badge key={p.id} variant="outline" className="text-xs gap-1 pr-1 cursor-pointer hover:bg-accent" onClick={() => handleLoadProfile(p.id)}>
                            {p.name}
                            <button onClick={(e) => handleDeleteProfile(p.id, p.name, e)} className="hover:text-destructive">
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}


            {/* Data gap review removed — users proceed directly to import */}
            {false && allReady && !allNoMatch && (activeGaps.some(g => g.level === "module") || ALL_TEMPLATE_MODULES.some(({ mod }) => !naGaps.has(`module:${mod}`) && !allGaps.some(g => g.id === `module:${mod}`) && !uploadCoversModule(mod))) && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-500/5 overflow-hidden">
                {/* Header */}
                <div className="flex items-start gap-3 px-4 py-3.5 border-b border-amber-200 dark:border-amber-800">
                  <TriangleAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">Data gap review</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Some data modules haven't been uploaded yet. Upload them now or mark as N/A if they don't apply.
                    </p>
                  </div>
                </div>

                {/* ── Missing modules — not yet uploaded ── */}
                {(activeGaps.some(g => g.level === "module") || ALL_TEMPLATE_MODULES.some(({ mod }) => !naGaps.has(`module:${mod}`) && !allGaps.some(g => g.id === `module:${mod}`) && !uploadCoversModule(mod))) && (
                  <div>
                    <div className="px-4 py-1.5 bg-amber-500/5 border-b border-amber-200/60 dark:border-amber-800/60">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700/70 dark:text-amber-400/70">Modules not yet uploaded</p>
                    </div>
                    <div className="divide-y divide-amber-200/60 dark:divide-amber-800/60">
                      {activeGaps.filter(g => g.level === "module").map(gap => (
                        <div key={gap.id} className="px-4 py-3 flex items-start gap-3">
                          <div className="mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" />
                          <div className="flex-1 min-w-0 space-y-1">
                            <p className="text-sm font-medium leading-tight">{gap.label}</p>
                            <p className="text-xs text-muted-foreground leading-relaxed">{gap.impact}</p>
                          </div>
                          {filledGaps[gap.id] ? (
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <span className="flex items-center gap-1 text-xs font-medium text-green-500 dark:text-green-400">
                                <CheckCircle2 className="w-3.5 h-3.5" />Queued
                              </span>
                              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                                disabled={!!gapFillUploading[gap.id]}
                                onClick={() => { pendingGapRef.current = { id: gap.id, templateModule: gap.templateModule }; gapFillInputRef.current?.click(); }}>
                                {gapFillUploading[gap.id] ? <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" /> : <Upload className="w-3 h-3" />}
                                Re-upload
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 shrink-0 ml-2 flex-wrap justify-end">
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-amber-300 dark:border-amber-700 hover:bg-amber-500/10"
                                onClick={() => { const url = gap.metricKey && gap.downloadTenantId ? `${API}/gap-template?module=${gap.templateModule}&metricKey=${encodeURIComponent(gap.metricKey)}&tenantId=${encodeURIComponent(gap.downloadTenantId)}` : `${API}/gap-template?module=${gap.templateModule}&uploadId=${encodeURIComponent(uploadResult?.uploadId ?? "")}&gapId=${encodeURIComponent(gap.id)}`; window.open(url, "_blank"); }}>
                                <FileDown className="w-3 h-3" />Download
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-amber-300 dark:border-amber-700 hover:bg-amber-500/10"
                                disabled={!!gapFillUploading[gap.id]}
                                onClick={() => { pendingGapRef.current = { id: gap.id, templateModule: gap.templateModule }; gapFillInputRef.current?.click(); }}>
                                {gapFillUploading[gap.id] ? <span className="w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" /> : <Upload className="w-3 h-3" />}
                                Upload filled
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={() => markGapNA(gap.id)}>
                                <Ban className="w-3 h-3" />N/A
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                      {ALL_TEMPLATE_MODULES.filter(({ mod }) => !naGaps.has(`module:${mod}`) && !allGaps.some(g => g.id === `module:${mod}`) && !uploadCoversModule(mod)).map(({ mod, label, desc }) => (
                        <div key={mod} className="px-4 py-3 flex items-start gap-3">
                          <div className="mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" />
                          <div className="flex-1 min-w-0 space-y-1">
                            <p className="text-sm font-medium leading-tight">{label}</p>
                            <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                          </div>
                          {filledGaps[`module:${mod}`] ? (
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <span className="flex items-center gap-1 text-xs font-medium text-green-500 dark:text-green-400">
                                <CheckCircle2 className="w-3.5 h-3.5" />Queued
                              </span>
                              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                                disabled={!!gapFillUploading[`module:${mod}`]}
                                onClick={() => { pendingGapRef.current = { id: `module:${mod}`, templateModule: mod }; gapFillInputRef.current?.click(); }}>
                                {gapFillUploading[`module:${mod}`] ? <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" /> : <Upload className="w-3 h-3" />}
                                Re-upload
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 shrink-0 ml-2 flex-wrap justify-end">
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-amber-300 dark:border-amber-700 hover:bg-amber-500/10"
                                onClick={() => window.open(`${API}/gap-template?module=${mod}&gapId=module%3A${mod}&uploadId=${encodeURIComponent(uploadResult?.uploadId ?? "")}`, "_blank")}>
                                <FileDown className="w-3 h-3" />Download
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-amber-300 dark:border-amber-700 hover:bg-amber-500/10"
                                disabled={!!gapFillUploading[`module:${mod}`]}
                                onClick={() => { pendingGapRef.current = { id: `module:${mod}`, templateModule: mod }; gapFillInputRef.current?.click(); }}>
                                {gapFillUploading[`module:${mod}`] ? <span className="w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" /> : <Upload className="w-3 h-3" />}
                                Upload filled
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={() => markGapNA(`module:${mod}`)}>
                                <Ban className="w-3 h-3" />N/A
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {ALL_TEMPLATE_MODULES.some(({ mod }) => naGaps.has(`module:${mod}`)) && (
                      <div className="px-4 py-2 border-t border-amber-200/60 dark:border-amber-800/60 flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-muted-foreground">Marked as N/A:</span>
                        {ALL_TEMPLATE_MODULES.filter(({ mod }) => naGaps.has(`module:${mod}`)).map(({ mod, label }) => (
                          <button key={mod} className="text-[11px] text-muted-foreground underline decoration-dotted hover:text-foreground" onClick={() => unmarkGapNA(`module:${mod}`)}>{label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* N/A footer for field gaps */}
                {naGapItems.length > 0 && (
                  <div className="px-4 py-2 border-t border-amber-200/60 dark:border-amber-800/60 flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-muted-foreground">Marked as N/A:</span>
                    {naGapItems.map(g => (
                      <button key={g.id} className="text-[11px] text-muted-foreground underline decoration-dotted hover:text-foreground" onClick={() => unmarkGapNA(g.id)}>{g.label}</button>
                    ))}
                  </div>
                )}
                {activeGaps.length === 0 && naGapItems.length > 0 && (
                  <div className="px-4 py-3 flex items-center gap-2">
                    <CircleDot className="w-4 h-4 text-green-500 shrink-0" />
                    <p className="text-xs text-muted-foreground">All gaps marked as N/A — you're good to import.</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Import button ────────────────────────────────── */}
            {allReady && !allNoMatch && (
              <>
              <p className="text-[11px] text-muted-foreground text-center px-2">
                After importing, you can edit this data anytime — either directly inside RM ONE, or by uploading an updated file here — existing records are updated and new rows are added automatically.
              </p>

              <ValidationPanel
                issues={validationIssues}
                fixes={validationFixes}
                onFixes={setValidationFixes}
                validating={validating}
                onCheck={checkIssues}
              />

              {/* Division disambiguation banner — appears when a name exists under multiple BUs */}
              {orgAmbiguousIssues.length > 0 && (
                <div className="rounded-md border border-blue-500/40 bg-blue-500/10 p-3 space-y-3">
                  <div className="flex items-center gap-2 text-blue-400 text-sm font-medium">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Division name conflict — action required
                  </div>
                  {orgAmbiguousIssues.map((issue) => (
                    <div key={issue.divLower} className="space-y-1.5">
                      <p className="text-xs text-blue-300 leading-snug">{issue.message}</p>
                      <div className="flex flex-col gap-1">
                        {issue.existingBUs.map((e) => (
                          <label key={e.divId} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`div-choice-${issue.divLower}`}
                              value={e.divId}
                              checked={divisionChoices[issue.divLower] === e.divId}
                              onChange={() => setDivisionChoices(prev => ({ ...prev, [issue.divLower]: e.divId }))}
                              className="accent-blue-400"
                            />
                            <span className="text-xs text-muted-foreground">
                              {e.divId.startsWith("file:")
                                ? <>Use <strong className="text-foreground">{e.buTitle}</strong> as the Business Unit for &ldquo;{issue.divLower}&rdquo;</>
                                : <>Update the existing division under <strong className="text-foreground">{e.buTitle}</strong> → move it to <strong className="text-foreground">{issue.targetBU}</strong></>
                              }
                            </span>
                          </label>
                        ))}
                        {!issue.existingBUs.every(e => e.divId.startsWith("file:")) && (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`div-choice-${issue.divLower}`}
                              value="create"
                              checked={divisionChoices[issue.divLower] === "create"}
                              onChange={() => setDivisionChoices(prev => ({ ...prev, [issue.divLower]: "create" }))}
                              className="accent-blue-400"
                            />
                            <span className="text-xs text-muted-foreground">
                              Create a <strong className="text-foreground">new division</strong> under <strong className="text-foreground">{issue.targetBU}</strong> (leave existing ones untouched)
                            </span>
                          </label>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-blue-500/40 text-blue-400 hover:text-blue-400"
                      disabled={orgAmbiguousIssues.some(i => !divisionChoices[i.divLower])}
                      onClick={() => {
                        setOrgAmbiguousIssues([]);
                        runPipeline(true);
                      }}
                    >
                      Confirm &amp; import
                    </Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { setOrgAmbiguousIssues([]); setDivisionChoices({}); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* BU re-link confirmation banner */}
              {orgRelinkWarnings.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-amber-500 text-sm font-medium">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Division → Business Unit conflict detected
                  </div>
                  <div className="space-y-1">
                    {orgRelinkWarnings.map((w, i) => (
                      <p key={i} className="text-xs text-amber-400 leading-snug">{w}</p>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-500 hover:text-amber-500" onClick={() => runPipeline(true)}>
                      Proceed anyway
                    </Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setOrgRelinkWarnings([])}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              <Button
                className="w-full gap-2 h-11 text-base"
                onClick={() => runPipeline()}
                disabled={running || !dbConnected}
              >
                {running ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Importing…
                  </>
                ) : (
                  <>Import into RM ONE <ArrowRight className="w-4 h-4" /></>
                )}
              </Button>
              </>
            )}
            {!allReady && sheetStatuses.some(x => x.status === "needs-mapping") && (
              <p className="text-xs text-center text-amber-600">
                Resolve the highlighted columns above to enable import.
              </p>
            )}
          </div>
        )}

      </div>

      <AddStaffModal
        open={addStaffOpen}
        tenantId={(uploadResult?.tenantId ?? clientName.trim().replace(/\s+/g, "_")) || undefined}
        onClose={() => setAddStaffOpen(false)}
        onCreated={(name) => {
          setAddStaffOpen(false);
          toast({ title: "Team member added", description: `${name} has been added to RM ONE.` });
        }}
      />

    </div>
  );
}
