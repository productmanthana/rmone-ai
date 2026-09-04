import { useState, useMemo, useContext } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Check, X, Search, AlertTriangle, Info, Pencil, Trash2, Lock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AuthContext } from "@/lib/auth-context";
import { authHeaders } from "@/lib/api";

const API = "/api/synonyms";

const TAB_OPTIONS = [
  { value: "_all",        label: "All tabs" },
  { value: "team",        label: "Your Team" },
  { value: "clients",     label: "Clients & Projects" },
  { value: "assignments", label: "Assignments" },
];

const CANONICAL_FIELDS: Record<string, string[]> = {
  team: [
    "Division","Department","Role","BillingRate","EmpLaborRate","EmpCostRate",
    "JobTitle","UserName","FullName","Email","Password","UserRole",
    "Manager","StartDate","EndDate","IsManager","JobProfile",
  ],
  clients: [
    "Type","CompanyName","ContactName","MarketSector","ProjectTitle",
    "ERPJobID","ContractValue","ContractType","Status","Division","Department",
    "StartDate","EndDate","CRMHealth","ClientRep",
  ],
  assignments: [
    "Project","Resource","AllocationStartDate","AllocationEndDate",
    "PctAllocation","AllocationType","AllocationHour",
  ],
};

function canonicalOptions(tabType: string): string[] {
  if (tabType === "_all") {
    const all = new Set<string>();
    Object.values(CANONICAL_FIELDS).forEach(arr => arr.forEach(f => all.add(f)));
    return [...all].sort();
  }
  return CANONICAL_FIELDS[tabType] ?? [];
}

function tabLabel(t: string | null): string {
  return TAB_OPTIONS.find(o => o.value === (t ?? "_all"))?.label ?? "All tabs";
}

/** Convert UI sentinel "_all" → null before sending to the API */
function toApiTabType(v: string): string | null {
  return v === "_all" ? null : v;
}

/** Convert null from API → UI sentinel "_all" */
function fromApiTabType(v: string | null): string {
  return v ?? "_all";
}

interface SynonymRow {
  id:             number | null;
  alias:          string;
  canonicalField: string;
  tabType:        string | null;
  isBuiltin:      boolean;
  createdBy:      string | null;
  createdAt:      string | null;
}

interface FormState {
  alias:          string;
  canonicalField: string;
  tabType:        string;   // uses "_all" sentinel
}

const EMPTY_FORM: FormState = { alias: "", canonicalField: "", tabType: "_all" };

export default function SynonymsManager() {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const auth      = useContext(AuthContext);
  const currentUser = auth?.user?.username ?? null;

  const [search,     setSearch]     = useState("");
  const [filterTab,  setFilterTab]  = useState("_all");
  const [filterType, setFilterType] = useState<"all" | "custom" | "builtin">("all");
  const [showAdd,    setShowAdd]    = useState(false);
  const [form,       setForm]       = useState<FormState>(EMPTY_FORM);
  const [editingRow, setEditingRow] = useState<SynonymRow | null>(null);
  const [editForm,   setEditForm]   = useState<FormState>(EMPTY_FORM);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  /* ── Fetch ─────────────────────────────────────────────────────── */
  const { data, isLoading, error } = useQuery<{
    synonyms: SynonymRow[]; customCount: number; builtinCount: number;
  }>({
    queryKey: ["synonyms"],
    queryFn:  () => fetch(API, { headers: authHeaders() }).then(r => r.json()),
    staleTime: 30_000,
  });

  /* ── Mutations ──────────────────────────────────────────────────── */
  const addMut = useMutation({
    mutationFn: (f: FormState) =>
      fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ...f, tabType: toApiTabType(f.tabType) }),
      }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["synonyms"] });
      setForm(EMPTY_FORM);
      setShowAdd(false);
      toast({ title: "Synonym added" });
    },
    onError: (e: Error) => toast({ title: "Failed to add", description: e.message, variant: "destructive" }),
  });

  const editMut = useMutation({
    mutationFn: ({ id, f }: { id: number; f: FormState }) =>
      fetch(`${API}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ...f, tabType: toApiTabType(f.tabType) }),
      }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["synonyms"] });
      setEditingRow(null);
      toast({ title: "Synonym updated" });
    },
    onError: (e: Error) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      fetch(`${API}/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["synonyms"] });
      setConfirmDeleteId(null);
      toast({ title: "Synonym deleted" });
    },
    onError: (e: Error) => toast({ title: "Failed to delete", description: e.message, variant: "destructive" }),
  });

  /* ── Filtered + sorted rows ─────────────────────────────────────── */
  const rows = useMemo(() => {
    if (!data) return [];
    return data.synonyms
      .filter(s => {
        if (filterType === "custom"  && s.isBuiltin)  return false;
        if (filterType === "builtin" && !s.isBuiltin) return false;
        if (filterTab !== "_all" && s.tabType !== filterTab && s.tabType !== null) return false;
        if (search) {
          const q = search.toLowerCase();
          if (!s.alias.includes(q) && !s.canonicalField.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (!a.isBuiltin && b.isBuiltin) return -1;
        if (a.isBuiltin && !b.isBuiltin) return 1;
        return a.alias.localeCompare(b.alias);
      });
  }, [data, search, filterTab, filterType]);

  /** Can the current user edit/delete this row? */
  function canEdit(row: SynonymRow): boolean {
    if (row.isBuiltin) return false;
    if (row.id === null) return false;
    // Only the person who added it can edit it (null createdBy = auto-learned, not editable via UI)
    return row.createdBy !== null && row.createdBy === currentUser;
  }

  function startEdit(row: SynonymRow) {
    setEditingRow(row);
    setEditForm({
      alias:          row.alias,
      canonicalField: row.canonicalField,
      tabType:        fromApiTabType(row.tabType),
    });
    setShowAdd(false);
  }

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div className="space-y-4">

      {/* ── Toolbar: stats + add ─────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {data && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span><span className="font-semibold text-foreground">{data.customCount}</span> custom</span>
            <span>·</span>
            <span><span className="font-semibold text-foreground">{data.builtinCount}</span> built-in</span>
            <span>·</span>
            <span><span className="font-semibold text-foreground">{data.customCount + data.builtinCount}</span> total</span>
          </div>
        )}
        <Button
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => { setShowAdd(true); setForm(EMPTY_FORM); setEditingRow(null); }}
        >
          <Plus className="w-4 h-4" />
          Add synonym
        </Button>
      </div>

      {/* ── Add form ──────────────────────────────────────────────── */}
      {showAdd && (
        <Card className="border-primary/40">
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold">Add new synonym</h2>
            </div>
            <SynonymFormFields form={form} setForm={setForm} />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => addMut.mutate(form)}
                disabled={!form.alias.trim() || !form.canonicalField || addMut.isPending}
              >
                <Check className="w-3.5 h-3.5" />
                {addMut.isPending ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm" variant="ghost" className="h-8"
                onClick={() => { setShowAdd(false); setForm(EMPTY_FORM); }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Edit form ─────────────────────────────────────────────── */}
      {editingRow && (
        <Card className="border-amber-400/50">
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-semibold">Edit synonym</h2>
              <span className="text-xs text-muted-foreground font-mono ml-1">{editingRow.alias}</span>
            </div>
            <SynonymFormFields form={editForm} setForm={setEditForm} />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => editMut.mutate({ id: editingRow.id!, f: editForm })}
                disabled={!editForm.alias.trim() || !editForm.canonicalField || editMut.isPending}
              >
                <Check className="w-3.5 h-3.5" />
                {editMut.isPending ? "Saving…" : "Save changes"}
              </Button>
              <Button
                size="sm" variant="ghost" className="h-8"
                onClick={() => setEditingRow(null)}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Info tip ─────────────────────────────────────────────── */}
      <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-3 flex items-start gap-3">
        <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Built-in synonyms</span> are coded into the
          system (e.g. <span className="font-mono">"business unit"</span> → Division) and cannot be
          edited. <span className="font-medium text-foreground">Custom synonyms</span> can only be
          edited or deleted by the person who added them.
        </p>
      </div>

      {/* ── Filter / search bar ───────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Search alias or field…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterTab} onValueChange={setFilterTab}>
          <SelectTrigger className="h-8 text-xs w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAB_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={v => setFilterType(v as "all" | "custom" | "builtin")}>
          <SelectTrigger className="h-8 text-xs w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all"     className="text-xs">All types</SelectItem>
            <SelectItem value="custom"  className="text-xs">Custom only</SelectItem>
            <SelectItem value="builtin" className="text-xs">Built-in only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Table ────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="text-center py-10 text-sm text-muted-foreground">Loading synonyms…</div>
      )}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Failed to load synonyms. Check API server is running.
        </div>
      )}
      {!isLoading && !error && (
        <Card>
          <div className="divide-y">
            {/* Header row */}
            <div className="grid grid-cols-[2fr_1.5fr_1fr_8rem_5rem] gap-3 px-4 py-2 text-xs text-muted-foreground font-medium bg-muted/30 rounded-t-lg">
              <span>Alias (from client's file)</span>
              <span>Maps to RM ONE field</span>
              <span>Tab</span>
              <span>Type</span>
              <span></span>
            </div>

            {rows.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No synonyms match your filter.
              </div>
            )}

            {rows.map((row, i) => {
              const isEditing = editingRow?.id === row.id && !row.isBuiltin;
              const mine      = canEdit(row);
              const isConfirm = confirmDeleteId !== null && confirmDeleteId === row.id;

              return (
                <div
                  key={row.id ?? `builtin-${row.alias}`}
                  className={`grid grid-cols-[2fr_1.5fr_1fr_8rem_auto] gap-3 px-4 py-2.5 items-center hover:bg-muted/30 transition-colors ${
                    i === rows.length - 1 ? "rounded-b-lg" : ""
                  } ${isEditing ? "bg-amber-50/50 dark:bg-amber-950/20" : ""}`}
                >
                  <span className="text-sm font-mono text-foreground truncate">{row.alias}</span>
                  <span className="text-sm font-medium text-primary truncate">{row.canonicalField}</span>
                  <span className="text-xs text-muted-foreground">{tabLabel(row.tabType)}</span>
                  <div className="flex items-center gap-1.5">
                    {row.isBuiltin ? (
                      <Badge variant="outline" className="text-[10px] px-1.5 text-muted-foreground shrink-0 gap-1">
                        <Lock className="w-2.5 h-2.5" />Built-in
                      </Badge>
                    ) : row.createdBy ? (
                      <Badge variant="outline" className="text-[10px] px-1.5 text-blue-600 border-blue-300 dark:border-blue-700 shrink-0">
                        Custom
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] px-1.5 text-muted-foreground shrink-0">
                        Auto
                      </Badge>
                    )}
                  </div>

                  {/* Actions — inline, same row always */}
                  <div className="flex items-center gap-1 justify-end min-w-[5rem]">
                    {mine && !isConfirm && (
                      <>
                        <button
                          onClick={() => isEditing ? setEditingRow(null) : startEdit(row)}
                          className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-600 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(row.id)}
                          className="p-1 rounded hover:bg-destructive/10 text-destructive transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    {isConfirm && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-destructive whitespace-nowrap font-medium">Delete?</span>
                        <button
                          onClick={() => deleteMut.mutate(row.id!)}
                          disabled={deleteMut.isPending}
                          className="p-1 rounded bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors disabled:opacity-50"
                          title="Confirm delete"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {rows.length > 0 && (
        <p className="text-xs text-center text-muted-foreground">
          Showing {rows.length} of {data?.synonyms.length ?? 0} synonyms
        </p>
      )}
    </div>
  );
}

/* ── Shared form fields used by both Add and Edit ──────────────────── */
function SynonymFormFields({
  form, setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="space-y-1">
        <Label className="text-xs">Client's column name (alias)</Label>
        <Input
          className="h-8 text-sm"
          placeholder="e.g. Workforce, Rate Card"
          value={form.alias}
          onChange={e => setForm(f => ({ ...f, alias: e.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Applies to tab</Label>
        <Select
          value={form.tabType}
          onValueChange={v => setForm(f => ({ ...f, tabType: v, canonicalField: "" }))}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAB_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Maps to RM ONE field</Label>
        <Select
          value={form.canonicalField}
          onValueChange={v => setForm(f => ({ ...f, canonicalField: v }))}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select field…" />
          </SelectTrigger>
          <SelectContent>
            {canonicalOptions(form.tabType).map(f => (
              <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
