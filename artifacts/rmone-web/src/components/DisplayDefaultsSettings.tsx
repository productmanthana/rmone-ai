/**
 * Settings → Display defaults — company-wide starting point for what
 * everyone sees: default list view mode, visible columns per entity,
 * and record-page field defaults.
 *
 * Personal choices always win: these defaults only apply to users who never
 * customized the matching view themselves (see lib/displayDefaults.ts).
 * Saving is admin-only — the server rejects everyone else (fail closed).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Table2, LayoutGrid, RotateCcw, Search, Lock, CheckCircle2,
  Eye, GripVertical, ArrowUp, ArrowDown, X,
} from "lucide-react";
import {
  GRID_COLUMN_CATALOG, EXTRA_FIELD_CATALOG, DISPLAY_VIEWS, DISPLAY_MODULES,
  fetchDisplayDefaultsFor, saveDisplayDefaults, fetchDetailFieldCatalog,
  getDisplayDefaults, displayDefaultsLoaded, EMPTY_MODULE_DETAIL,
  reorderPinnedDetailKeys, orderedDetailPreviewKeys, orderVisibleGridColumns,
  type DisplayDefaults, type DisplayView, type DisplayModule, type CatalogModule,
  type ModuleDetailDefaults,
} from "@/lib/displayDefaults";
import { AUTO_SHOWN_KEYS, SUPPRESSED_FIELD_KEYS, humanizeFieldKey } from "@/lib/recordFieldCatalog";
import { getSeed, setSeed, seedScope } from "@/lib/settingsSeed";

const VIEW_LABELS: Record<DisplayView, string> = {
  projects: "Projects",
  opportunities: "Opportunities",
  leads: "Leads",
  companies: "Companies (CRM)",
};

// Module display names (for footer / reset copy)
const MODULE_LABELS: Record<DisplayModule, string> = {
  PMM: "Projects",
  OPM: "Opportunities",
  LEM: "Leads",
  COM: "Companies",
  CON: "Contacts",
};

// Which entity view maps to a detail-field catalog module
const VIEW_TO_CATALOG_MOD: Partial<Record<DisplayView, CatalogModule>> = {
  projects:      "PMM",
  opportunities: "OPM",
  leads:         "LEM",
};

// "On the X page" — the second column header changes per entity
const ENTITY_PAGE_LABEL: Record<DisplayView, string> = {
  projects:      "project page",
  opportunities: "opportunity page",
  leads:         "lead page",
  companies:     "company page",
};

/**
 * Compact professional auto-save indicator: a smooth ring spinner while the
 * card is saving, then a brief green "Saved" pill that fades back out.
 * Fixed min-width so the card header never shifts as it appears/disappears.
 */
function SavePill({ status }: { status: "idle" | "saving" | "saved" }) {
  if (status === "idle") return <span style={{ minWidth: 92, flexShrink: 0 }} aria-hidden />;
  const saving = status === "saving";
  return (
    <span
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        minWidth: 92, justifyContent: "center", flexShrink: 0,
        padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600,
        border: `1px solid ${saving ? "hsl(var(--border))" : "hsl(var(--primary) / 0.35)"}`,
        background: saving ? "hsl(var(--muted) / 0.55)" : "hsl(var(--primary) / 0.08)",
        color: saving ? "hsl(var(--muted-foreground))" : "hsl(var(--primary))",
        transition: "background 150ms ease, color 150ms ease, border-color 150ms ease",
      }}
    >
      {saving ? (
        <span
          aria-hidden
          style={{
            width: 13, height: 13, borderRadius: "50%", boxSizing: "border-box",
            border: "2px solid hsl(var(--muted-foreground) / 0.25)",
            borderTopColor: "hsl(var(--primary))",
            animation: "spin 0.7s linear infinite",
            flexShrink: 0,
          }}
        />
      ) : (
        <CheckCircle2 style={{ width: 13, height: 13, flexShrink: 0 }} />
      )}
      {saving ? "Saving…" : "Saved"}
    </span>
  );
}

type FieldRow = {
  key: string;
  label: string;
  /** null = field not in the list catalog at all */
  inList: boolean | "always" | null;
  /** null = field not in the detail catalog at all */
  inDetail: boolean | "always" | null;
  /** "From database" badge; came from EXTRA_FIELD_CATALOG */
  fromDatabase: boolean;
  /** Original extra-field key (needed to remove it) */
  extraKey?: string;
};

/**
 * tenantId semantics:
 *   undefined — company admin editing their OWN tenant (server pins it)
 *   string    — superadmin editing a specific company
 *   null      — superadmin on "Global defaults" scope (no per-company defaults here)
 */
export default function DisplayDefaultsSettings({ tenantId }: { tenantId?: string | null }) {
  const { toast } = useToast();

  // Instant render: boot from the session seed or the app-wide singleton.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-time seed only
  const boot = useMemo((): DisplayDefaults | null => {
    if (tenantId === null) return null;
    const s = getSeed<DisplayDefaults>(`displayDefaults:${seedScope(tenantId)}`);
    if (s) return s;
    if (tenantId === undefined && displayDefaultsLoaded()) return getDisplayDefaults();
    return null;
  }, []);
  const [defaults, setDefaultsRaw] = useState<DisplayDefaults | null>(boot);
  // Always-current mirror so debounce timers never save a stale snapshot.
  const defaultsRef = useRef<DisplayDefaults | null>(boot);
  defaultsRef.current = defaults;
  const [savedSnapshot, setSavedSnapshot] = useState<string>(boot ? JSON.stringify(boot) : "");
  const [loading, setLoading] = useState(!boot);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const dirtyRef    = useRef(false);
  const loadSeqRef  = useRef(0);
  const editSeqRef  = useRef(0); // bumped on every user edit — detects edits made while a save is in flight
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewModeSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Scope guard: a timer scheduled under one tenant must never fire after the
  // superadmin switches this card to another tenant — defaultsRef may still
  // hold the previous tenant's doc while the new one loads, and the whole-doc
  // PUT would write tenant A's fields into tenant B.
  const scopeRef = useRef(seedScope(tenantId));
  scopeRef.current = seedScope(tenantId);
  // Per-CARD auto-save status — each card shows only its own pill. A checkbox
  // tick in Fields must not light up the "Default list view" card too (both
  // showed "Saving…" before, which read as the whole page being stuck).
  type Section = "viewMode" | "fields";
  type SaveStatus = "idle" | "saving" | "saved";
  const [saveStatus, setSaveStatusRaw] = useState<Record<Section, SaveStatus>>({ viewMode: "idle", fields: "idle" });
  const savedFadeTimers = useRef<{ viewMode: ReturnType<typeof setTimeout> | null; fields: ReturnType<typeof setTimeout> | null }>({ viewMode: null, fields: null });
  const setSaveStatus = useCallback((key: Section, s: SaveStatus) => {
    // Cancel any pending saved→idle fade FIRST — otherwise a stale timeout
    // from the previous save flips the pill to idle while a new save runs.
    const t = savedFadeTimers.current[key];
    if (t) { clearTimeout(t); savedFadeTimers.current[key] = null; }
    setSaveStatusRaw((prev) => (prev[key] === s ? prev : { ...prev, [key]: s }));
    if (s === "saved") {
      savedFadeTimers.current[key] = setTimeout(() => {
        savedFadeTimers.current[key] = null;
        setSaveStatusRaw((prev) => (prev[key] === "saved" ? { ...prev, [key]: "idle" } : prev));
      }, 1800);
    }
  }, []);
  const setDefaults = useCallback(
    (v: DisplayDefaults | null | ((prev: DisplayDefaults | null) => DisplayDefaults | null)) => {
      dirtyRef.current = true;
      editSeqRef.current++;
      setDefaultsRaw(v);
    }, []);

  const load = useCallback(async (background: boolean, attempt = 0) => {
    if (tenantId === null) { setLoading(false); return; }
    const seq = ++loadSeqRef.current;
    if (!background) { setLoading(true); setLoadErr(null); }
    try {
      const d = await fetchDisplayDefaultsFor(tenantId);
      if (seq !== loadSeqRef.current) return;
      setSeed(`displayDefaults:${seedScope(tenantId)}`, d);
      if (!background || !dirtyRef.current) {
        setDefaultsRaw(d);
        setSavedSnapshot(JSON.stringify(d));
      }
      setLoading(false);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      // The API is a single settings-row read, but the upstream DB has brief
      // timeout bursts. Retry quietly (spinner stays up) before surfacing the
      // error card — this is why the page used to need a manual refresh.
      if (!background && attempt < 2) {
        setTimeout(() => {
          if (seq === loadSeqRef.current) void load(false, attempt + 1);
        }, attempt === 0 ? 1500 : 4000);
        return;
      }
      if (!background) setLoadErr(e instanceof Error ? e.message : "Could not load display defaults");
      setLoading(false);
    }
  }, [tenantId]);

  const firstRunRef = useRef(true);
  useEffect(() => {
    if (firstRunRef.current) { firstRunRef.current = false; void load(!!boot); return; }
    if (tenantId === null) { setLoading(false); return; }
    const s = getSeed<DisplayDefaults>(`displayDefaults:${seedScope(tenantId)}`);
    if (s) {
      setDefaultsRaw(s); setSavedSnapshot(JSON.stringify(s));
      setLoading(false); setLoadErr(null); dirtyRef.current = false;
      void load(true);
    } else { void load(false); }
  }, [boot, load, tenantId]);

  // Tenant switch / unmount: drop pending debounced saves — they belong to the
  // previous tenant's edits and must not fire under the new scope.
  useEffect(() => () => {
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    if (viewModeSaveTimer.current) { clearTimeout(viewModeSaveTimer.current); viewModeSaveTimer.current = null; }
    setSaveStatus("viewMode", "idle");
    setSaveStatus("fields", "idle");
  }, [tenantId, setSaveStatus]);

  const dirty = useMemo(
    () => (defaults ? JSON.stringify(defaults) !== savedSnapshot : false),
    [defaults, savedSnapshot],
  );
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  // ── Per-card save ──────────────────────────────────────────────────────
  const [savingSection, setSavingSection] = useState<Section | null>(null);
  const savingSectionRef = useRef<Section | null>(null);
  const saving = savingSection !== null;

  const saveSection = async (key: Section, opts?: { silent?: boolean }) => {
    // Read through refs — timers may invoke an older closure; refs are always current.
    const snap = defaultsRef.current;
    if (!snap || savingSectionRef.current !== null) return;
    savingSectionRef.current = key;
    setSavingSection(key);
    const editsAtStart = editSeqRef.current;
    const scopeAtStart = scopeRef.current;
    try {
      // Invalidate any in-flight background load — its (older) payload must
      // not stomp the post-save sync below.
      loadSeqRef.current++;
      // ONE round trip: the server merges this section onto the stored doc
      // (PUT carries `section`), replacing the old client-side GET+merge+PUT —
      // saves land in half the time and the merge can't race other admins.
      const saved = await saveDisplayDefaults(snap, tenantId ?? undefined, key);
      // The seed is keyed by the scope this save actually wrote, so it is
      // always safe; the UI-state syncs below are NOT once the card has been
      // switched to a different tenant mid-flight.
      setSeed(`displayDefaults:${seedScope(tenantId)}`, saved);
      if (scopeAtStart === scopeRef.current) setSavedSnapshot(JSON.stringify(saved));
      // Sync local state from the server response only when the user made no
      // newer edits while this save was in flight — otherwise their newest
      // ticks would visually revert (the pending debounce saves them next).
      if (editSeqRef.current === editsAtStart && scopeAtStart === scopeRef.current) {
        setDefaultsRaw((prev) => {
          if (!prev) return saved;
          return key === "viewMode"
            ? { ...prev, viewMode: saved.viewMode }
            : { ...prev, columns: saved.columns, extraColumns: saved.extraColumns, detail: saved.detail };
        });
      }
      if (!opts?.silent) {
        toast({ title: "Saved", description: "Everyone at the company inherits this on their next visit — anyone who customized their own view keeps it." });
      }
      // Brief green "Saved" pill on the card that saved (fades on its own).
      setSaveStatus(key, "saved");
    } catch (e) {
      setSaveStatus(key, "idle");
      toast({ title: "Could not save", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    } finally {
      savingSectionRef.current = null;
      setSavingSection(null);
    }
  };
  // Timers must always run the LATEST closure (fresh state + tenantId), never
  // the one captured when the timer was scheduled.
  const saveSectionRef = useRef(saveSection);
  saveSectionRef.current = saveSection;

  // Debounced auto-save — fires 200 ms after the last checkbox change (just
  // enough to batch a rapid burst of ticks; feels immediate). Concurrent saves
  // are deferred: if a save is already in flight the timer backs off and
  // retries, so no edit is ever lost.
  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setSaveStatus("fields", "saving");
    const scope = scopeRef.current; // tenant these edits belong to
    autoSaveTimer.current = setTimeout(function run() {
      autoSaveTimer.current = null;
      if (scope !== scopeRef.current) return; // tenant switched — stale edits, drop
      if (savingSectionRef.current !== null) {
        autoSaveTimer.current = setTimeout(run, 250); // back off while a save is in flight
        return;
      }
      void saveSectionRef.current("fields", { silent: true });
    }, 200);
  }, [setSaveStatus]);

  // Same pattern for view-mode — same back-off guarantee. A view-mode pick is
  // a single click (no burst to batch), so it saves almost instantly.
  const scheduleViewModeSave = useCallback(() => {
    if (viewModeSaveTimer.current) clearTimeout(viewModeSaveTimer.current);
    setSaveStatus("viewMode", "saving");
    const scope = scopeRef.current;
    viewModeSaveTimer.current = setTimeout(function run() {
      viewModeSaveTimer.current = null;
      if (scope !== scopeRef.current) return; // tenant switched — stale edit, drop
      if (savingSectionRef.current !== null) {
        viewModeSaveTimer.current = setTimeout(run, 250);
        return;
      }
      void saveSectionRef.current("viewMode", { silent: true });
    }, 150);
  }, [setSaveStatus]);


  // ── List column helpers ────────────────────────────────────────────────
  const isColVisible = (view: DisplayView, key: string): boolean => {
    const cat = GRID_COLUMN_CATALOG[view];
    const catEntry = cat.find((c) => c.key === key);
    const list = defaults?.columns[view];
    if (!list || !list.length) {
      // No stored list: catalog keys are visible by default — except entries
      // marked defaultHidden (off until an admin enables them). Extra/detail-
      // only keys are likewise off by default.
      return !!catEntry && !catEntry.defaultHidden;
    }
    return list.includes(key);
  };
  const toggleCol = (view: DisplayView, key: string) => {
    setDefaults((prev) => {
      if (!prev) return prev;
      const cat = GRID_COLUMN_CATALOG[view];
      const cur = prev.columns[view];
      // Seed from the stored list, or fall back to the default view
      // (all catalog keys except the defaultHidden ones).
      const seed = cur && cur.length ? [...cur] : cat.filter((c) => !c.defaultHidden).map((c) => c.key);
      const visible = new Set(seed);
      // Locked catalog columns are always on.
      for (const c of cat) if (c.locked) visible.add(c.key);
      if (visible.has(key)) visible.delete(key); else visible.add(key);
      // Store the full key list (catalog + any non-catalog extras).
      const next = [...visible];
      const columns = { ...prev.columns };
      // Omit the stored list only when it exactly matches the DEFAULT view —
      // every non-hidden catalog key on, every defaultHidden key off, no
      // extras. Any other combination must persist.
      const hasNonCat = next.some((k) => !cat.some((c) => c.key === k));
      const matchesDefault = cat.every((c) => (c.defaultHidden ? !visible.has(c.key) : visible.has(c.key)));
      if (matchesDefault && !hasNonCat) delete columns[view];
      else columns[view] = next;
      return { ...prev, columns };
    });
    scheduleAutoSave();
  };

  // ── Extra DB-field column helpers ──────────────────────────────────────
  const extraList = (view: DisplayView): string[] => defaults?.extraColumns?.[view] ?? [];
  const addExtra  = (view: DisplayView, key: string) => {
    if (!key) return;
    setDefaults((prev) => {
      if (!prev) return prev;
      const cur = prev.extraColumns?.[view] ?? [];
      if (cur.includes(key)) return prev;
      const catalogDefault = GRID_COLUMN_CATALOG[view].filter((column) => !column.defaultHidden).map((column) => column.key);
      const columnOrder = prev.columns[view]?.length ? prev.columns[view]! : catalogDefault;
      return {
        ...prev,
        extraColumns: { ...(prev.extraColumns ?? {}), [view]: [...cur, key] },
        columns: { ...prev.columns, [view]: [...columnOrder, key] },
      };
    });
    scheduleAutoSave();
  };
  const removeExtra = (view: DisplayView, key: string) => {
    setDefaults((prev) => {
      if (!prev) return prev;
      const next = (prev.extraColumns?.[view] ?? []).filter((k) => k !== key);
      const extraColumns = { ...(prev.extraColumns ?? {}) };
      if (next.length) extraColumns[view] = next; else delete extraColumns[view];
      const columns = { ...prev.columns };
      if (columns[view]) columns[view] = columns[view]!.filter((column) => column !== key);
      return { ...prev, extraColumns, columns };
    });
    scheduleAutoSave();
  };

  const clearModule = (mod: DisplayModule) => {
    setDefaults((prev) => {
      if (!prev) return prev;
      const detail = { ...prev.detail };
      delete detail[mod];
      return { ...prev, detail };
    });
    scheduleAutoSave();
  };

  // ── Detail field catalog (lazy-loaded per module) ──────────────────────
  const [catalogs, setCatalogs] = useState<Partial<Record<CatalogModule, string[] | "loading" | "error">>>({});
  const loadCatalog = useCallback((mod: CatalogModule, attempt = 0) => {
    setCatalogs((prev) => ({ ...prev, [mod]: "loading" }));
    fetchDetailFieldCatalog(mod)
      .then((fields) => setCatalogs((prev) => ({ ...prev, [mod]: fields })))
      .catch(() => {
        // Same upstream-DB burst tolerance as the main load: without a retry,
        // a failed catalog fetch rendered the table with most rows missing
        // ("didn't load fully") until the user manually refreshed.
        if (attempt < 2) {
          setTimeout(() => loadCatalog(mod, attempt + 1), attempt === 0 ? 1500 : 4000);
          return;
        }
        setCatalogs((prev) => ({ ...prev, [mod]: "error" }));
      });
  }, []);
  // Pre-load all three entity catalogs on mount so the tab switch is instant.
  useEffect(() => {
    for (const mod of ["PMM", "OPM", "LEM"] as CatalogModule[]) loadCatalog(mod);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const detailOf  = (mod: DisplayModule): ModuleDetailDefaults => defaults?.detail[mod] ?? EMPTY_MODULE_DETAIL;
  const toggleIn  = (list: string[], k: string): string[] => list.includes(k) ? list.filter((x) => x !== k) : [...list, k];
  const patchDetail = (mod: DisplayModule, patch: Partial<ModuleDetailDefaults>) => {
    setDefaults((prev) => {
      if (!prev) return prev;
      const cur = prev.detail[mod] ?? EMPTY_MODULE_DETAIL;
      const next: ModuleDetailDefaults = { ...cur, ...patch };
      const detail = { ...prev.detail };
      if (!next.pinned.length && !next.hidden.length && !next.budgetPinned.length) delete detail[mod];
      else detail[mod] = next;
      return { ...prev, detail };
    });
  };

  // ── Field-on-page helpers ──────────────────────────────────────────────
  const isFieldOnPage = (mod: DisplayModule, key: string): boolean => {
    const d = detailOf(mod);
    if (AUTO_SHOWN_KEYS.has(key)) return !d.hidden.includes(key);
    return d.pinned.includes(key);
  };
  const toggleField = (mod: DisplayModule, key: string) => {
    const d = detailOf(mod);
    if (AUTO_SHOWN_KEYS.has(key)) patchDetail(mod, { hidden: toggleIn(d.hidden, key) });
    else                          patchDetail(mod, { pinned: toggleIn(d.pinned, key) });
    scheduleAutoSave();
  };

  // ── Build merged rows for the two-column table ─────────────────────────
  const buildRows = useCallback((view: DisplayView): FieldRow[] => {
    const mod      = VIEW_TO_CATALOG_MOD[view];
    const listCols = GRID_COLUMN_CATALOG[view]  ?? [];
    const extraCols = EXTRA_FIELD_CATALOG[view] ?? [];
    const rawCat   = mod ? catalogs[mod] : undefined;
    const detailCat = Array.isArray(rawCat)
      ? rawCat.filter(k => !SUPPRESSED_FIELD_KEYS.has(k) && !k.startsWith("_"))
      : null;
    const detailSet = detailCat ? new Set(detailCat) : null;

    const rows: FieldRow[] = [];
    const seen = new Set<string>();

    // 1. Built-in list columns (always present)
    for (const col of listCols) {
      seen.add(col.key);
      const isAlways  = col.locked;
      const hasDetail = !!(detailSet?.has(col.key));
      rows.push({
        key:          col.key,
        label:        col.label,
        inList:       isAlways ? "always" : isColVisible(view, col.key),
        inDetail:     hasDetail && mod
          ? (isAlways ? "always" : isFieldOnPage(mod as DisplayModule, col.key))
          : null,
        fromDatabase: false,
      });
    }

    // 2. Detail-only fields (appear on the page, optionally on the grid too)
    if (detailCat && mod) {
      for (const key of detailCat) {
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          key,
          label:        humanizeFieldKey(key),
          // Let admins add any detail field to the grid — only locked catalog
          // keys (id, name, ai) stay "always" above; detail-only fields default
          // to hidden in the list (false) but are fully toggleable.
          inList:       isColVisible(view, key),
          inDetail:     isFieldOnPage(mod as DisplayModule, key),
          fromDatabase: false,
        });
      }
    }

    // 3. DB-added columns ("From database" badge)
    const addedExtras = extraList(view);
    const extraByKey  = new Map(extraCols.map(f => [f.key, f]));
    for (const key of addedExtras) {
      const def = extraByKey.get(key);
      if (!def) continue;
      rows.push({
        key:          `extra_${key}`,
        extraKey:     key,
        label:        def.label,
        inList:       true,
        inDetail:     null,
        fromDatabase: true,
      });
    }

    // The saved columns array is also the grid-priority order. Keep locked
    // identity rows in their catalog positions when reading an older document
    // that did not include them, and place all ranked rows accordingly.
    const savedOrder = defaults?.columns[view] ?? [];
    if (!savedOrder.length) return rows;
    const locked = new Set(
      GRID_COLUMN_CATALOG[view].filter((column) => column.locked).map((column) => column.key),
    );
    return orderVisibleGridColumns(
      rows.map((row) => ({ ...row, key: row.extraKey ?? row.key, rowKey: row.key })),
      savedOrder,
      locked,
    ).map(({ rowKey, ...row }) => ({ ...row, key: rowKey }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- needs live defaults helpers
  }, [defaults, catalogs]);

  // ── Active view tab + search ───────────────────────────────────────────
  const [activeView, setActiveView] = useState<DisplayView>("projects");
  const [fieldSearch, setFieldSearch] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  useEffect(() => {
    if (!previewOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [previewOpen]);

  // ── Early return states ────────────────────────────────────────────────
  if (tenantId === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Display defaults</CardTitle>
          <CardDescription>
            Display defaults are set per company — there is no global layer. Switch the scope
            above to a specific client, then come back here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (loadErr || !defaults) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Display defaults</CardTitle>
          <CardDescription>{loadErr ?? "Could not load display defaults."}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={() => void load(false)}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  // "grid" is the fallback when nothing is stored. Cards is a real choice.
  const effectiveViewMode: DisplayDefaults["viewMode"] =
    defaults.viewMode === "cards" ? "cards" : "grid";

  // Current view data
  const catalogMod   = VIEW_TO_CATALOG_MOD[activeView];
  const rawCatalog   = catalogMod ? catalogs[catalogMod] : undefined;
  const catalogState = rawCatalog === "loading" || rawCatalog === undefined ? "loading"
    : rawCatalog === "error" ? "error" : "ready";
  const allRows   = buildRows(activeView);
  const q         = fieldSearch.trim().toLowerCase();
  const visRows   = q ? allRows.filter(r => r.label.toLowerCase().includes(q)) : allRows;
  const listCount = allRows.filter(r => r.inList === true || r.inList === "always").length;
  const detCount  = allRows.filter(r => r.inDetail === true || r.inDetail === "always").length;
  const entityPageLabel = ENTITY_PAGE_LABEL[activeView];
  const extraCatalog = EXTRA_FIELD_CATALOG[activeView] ?? [];
  const addedExtras  = extraList(activeView);
  const remainingExtras = extraCatalog.filter(f => !addedExtras.includes(f.key));
  const listOrderedRows = allRows.filter((row) => row.inList === true || row.inList === "always");
  const listPriority = new Map(listOrderedRows.map((row, index) => [row.key, index + 1]));
  const detailPinnedRows = catalogMod
    ? (detailOf(catalogMod as DisplayModule).pinned
        .map((key) => allRows.find((row) => row.key === key))
        .filter((row): row is FieldRow => !!row && row.inDetail === true))
    : [];
  const detailPriority = new Map(detailPinnedRows.map((row, index) => [row.key, index + 1]));
  const rowSavedKey = (row: FieldRow) => row.extraKey ?? row.key;
  const reorderField = (fromKey: string, toKey: string) => {
    if (fieldSearch || fromKey === toKey) return;
    const fromRow = allRows.find((row) => row.key === fromKey);
    const toRow = allRows.find((row) => row.key === toKey);
    if (!fromRow || !toRow || fromRow.inList !== true || toRow.inList !== true) return;
    const order = listOrderedRows.map(rowSavedKey);
    const from = order.indexOf(rowSavedKey(fromRow));
    const to = order.indexOf(rowSavedKey(toRow));
    if (from < 0 || to < 0) return;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    setDefaults((prev) => prev ? { ...prev, columns: { ...prev.columns, [activeView]: order } } : prev);
    scheduleAutoSave();
  };
  const moveField = (rowKey: string, direction: -1 | 1) => {
    const movable = listOrderedRows.filter((row) => row.inList === true);
    const index = movable.findIndex((row) => row.key === rowKey);
    const target = movable[index + direction];
    if (index >= 0 && target) reorderField(rowKey, target.key);
  };
  const moveDetailField = (rowKey: string, direction: -1 | 1) => {
    if (!catalogMod) return;
    const index = detailPinnedRows.findIndex((row) => row.key === rowKey);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= detailPinnedRows.length) return;
    const pinned = reorderPinnedDetailKeys(
      detailOf(catalogMod as DisplayModule).pinned,
      rowKey,
      detailPinnedRows[target].key,
    );
    patchDetail(catalogMod as DisplayModule, { pinned });
    scheduleAutoSave();
  };
  const previewDetailRows = catalogMod
    ? orderedDetailPreviewKeys(
        allRows.filter((row) =>
          row.inDetail === "always" || (row.inDetail === true && AUTO_SHOWN_KEYS.has(row.key)),
        ).map((row) => row.key),
        detailOf(catalogMod as DisplayModule).pinned,
        new Set(allRows.filter((row) => row.inDetail === true || row.inDetail === "always").map((row) => row.key)),
      ).map((key) => allRows.find((row) => row.key === key)).filter((row): row is FieldRow => !!row)
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Compact page header + list-mode controls */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 420px" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: "hsl(var(--foreground))" }}>Display defaults</h1>
          <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 4, marginBottom: 0, maxWidth: 640 }}>
            Company starting view. Personal choices still win, and changes apply as people navigate.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>Default list</span>
          <div className="flex flex-wrap gap-1">
            {([
              { value: "grid"  as DisplayDefaults["viewMode"], label: "Grid",  icon: Table2 },
              { value: "cards" as DisplayDefaults["viewMode"], label: "Cards", icon: LayoutGrid },
            ] as { value: DisplayDefaults["viewMode"]; label: string; icon: typeof Table2 }[]).map((opt) => {
              const Icon = opt.icon;
              const active = effectiveViewMode === opt.value;
              return (
                <Button
                  key={opt.value}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setDefaults((prev) => (prev ? { ...prev, viewMode: opt.value } : prev));
                    scheduleViewModeSave();
                  }}
                >
                  <Icon className="w-4 h-4 mr-1.5" />
                  {opt.label}
                </Button>
              );
            })}
          </div>
          <SavePill status={saveStatus.viewMode === "idle" ? saveStatus.fields : saveStatus.viewMode} />
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
            <Eye className="w-4 h-4 mr-1.5" /> Preview
          </Button>
        </div>
      </div>

      {/* ── Card 2: Fields — merged two-column table ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-baseline gap-2 flex-wrap">
              <CardTitle className="text-base">Fields</CardTitle>
              <CardDescription>
                Choose grid and record visibility; drag enabled grid fields into priority order.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent style={{ paddingTop: 0 }}>
          {/* Entity tab strip */}
          <div style={{
            position: "sticky", top: 0, zIndex: 8, display: "flex",
            border: "1px solid hsl(var(--border))", borderRadius: 9,
            marginBottom: 12, overflowX: "auto", background: "hsl(var(--card))",
            boxShadow: "0 5px 12px hsl(var(--background) / .8)",
          }}>
            {DISPLAY_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setActiveView(v); setFieldSearch(""); }}
                style={{
                  flex: "1 0 130px", textAlign: "center",
                  padding: "9px 16px", fontSize: 13, fontWeight: activeView === v ? 700 : 500,
                  color: activeView === v ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                  background: "none", border: "none",
                  borderBottom: activeView === v
                    ? "2px solid hsl(var(--primary))"
                    : "2px solid transparent",
                  marginBottom: -1, cursor: "pointer", transition: "color .12s",
                }}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14,
            padding: "7px 10px", border: "1px solid hsl(var(--border))", borderRadius: 8,
            background: "hsl(var(--card))" }}>
            <Search style={{ width: 13, height: 13, color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
            <input
              value={fieldSearch}
              onChange={(e) => setFieldSearch(e.target.value)}
              placeholder={`Search ${allRows.length} fields…`}
              style={{ flex: 1, border: "none", background: "transparent",
                color: "hsl(var(--foreground))", fontSize: 13, outline: "none" }}
            />
            {fieldSearch && (
              <button type="button" onClick={() => setFieldSearch("")}
                style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14,
                  color: "hsl(var(--muted-foreground))", padding: 0, lineHeight: 1 }}>×</button>
            )}
          </div>

          {/* Two-column table */}
          <div style={{
            border: "1px solid hsl(var(--border))", borderRadius: 10,
            overflowX: "auto", overflowY: "auto", maxHeight: "min(58vh, 620px)",
          }}>
            {/* Table header */}
            <div style={{
              position: "sticky", top: 0, zIndex: 4,
              display: "grid", gridTemplateColumns: "70px minmax(190px, 1fr) 110px 160px", minWidth: 680,
              background: "hsl(var(--muted) / 0.5)",
              borderBottom: "1px solid hsl(var(--border))",
              padding: "10px 16px", gap: 8,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--muted-foreground))", textAlign: "center" }}>Priority</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>Field</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--muted-foreground))", textAlign: "center", lineHeight: 1.35 }}>
                On the grid
                <div style={{ fontSize: 11, fontWeight: 400, color: "hsl(var(--muted-foreground))", opacity: 0.75 }}>Before you open it</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--muted-foreground))", textAlign: "center", lineHeight: 1.35 }}>
                Inside the record
                <div style={{ fontSize: 11, fontWeight: 400, color: "hsl(var(--muted-foreground))", opacity: 0.75 }}>After you open it</div>
              </div>
            </div>

            {/* Rows */}
            {catalogState === "loading" && visRows.length === 0 ? (
              <div style={{ padding: "24px 16px", display: "flex", alignItems: "center", gap: 8,
                color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
                <Loader2 style={{ width: 15, height: 15 }} className="animate-spin" /> Loading fields…
              </div>
            ) : catalogState === "error" ? (
              <div style={{ padding: "16px", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
                Could not load the field list.{" "}
                <button type="button" onClick={() => catalogMod && loadCatalog(catalogMod)}
                  style={{ background: "none", border: "none", padding: 0, color: "hsl(var(--primary))",
                    cursor: "pointer", textDecoration: "underline", fontSize: 13 }}>
                  Try again
                </button>
              </div>
            ) : visRows.length === 0 ? (
              <div style={{ padding: "16px", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
                No fields match "{fieldSearch.trim()}".
              </div>
            ) : visRows.map((row, i) => (
              <div key={row.key}
                draggable={!fieldSearch && row.inList === true}
                onDragStart={() => row.inList === true && setDragKey(row.key)}
                onDragEnd={() => setDragKey(null)}
                onDragOver={(event) => { if (dragKey && row.inList === true) event.preventDefault(); }}
                onDrop={() => { if (dragKey) reorderField(dragKey, row.key); setDragKey(null); }}
                style={{
                display: "grid", gridTemplateColumns: "70px minmax(190px, 1fr) 110px 160px", minWidth: 680,
                padding: "8px 16px", gap: 8, alignItems: "center",
                borderTop: i > 0 ? "1px solid hsl(var(--border))" : "none",
                background: row.inList === "always" ? "hsl(var(--muted) / 0.25)" : "transparent",
                opacity: dragKey === row.key ? .48 : 1,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                  {row.inList === "always" ? (
                    <Lock style={{ width: 12, height: 12, color: "hsl(var(--muted-foreground))" }} />
                  ) : row.inList === true ? (
                    <>
                      <GripVertical style={{ width: 14, height: 14, cursor: fieldSearch ? "default" : "grab", color: "hsl(var(--muted-foreground))" }} />
                      <b style={{ fontSize: 11, color: "hsl(var(--primary))" }}>{listPriority.get(row.key)}</b>
                      <span style={{ display: "inline-flex", flexDirection: "column" }}>
                        <button type="button" aria-label={`Move ${row.label} up`} onClick={() => moveField(row.key, -1)}
                          style={{ border: 0, background: "none", padding: 0, lineHeight: 0, color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><ArrowUp size={10} /></button>
                        <button type="button" aria-label={`Move ${row.label} down`} onClick={() => moveField(row.key, 1)}
                          style={{ border: 0, background: "none", padding: 0, lineHeight: 0, color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><ArrowDown size={10} /></button>
                      </span>
                    </>
                  ) : <span style={{ color: "hsl(var(--border))" }}>—</span>}
                </div>
                {/* Field name */}
                <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  {row.inList === "always" && (
                    <Lock style={{ width: 11, height: 11, color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: 13, fontWeight: row.inList === "always" ? 500 : 400,
                    color: row.inList === "always" ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.label}
                  </span>
                  {row.fromDatabase && (
                    <span style={{
                      fontSize: 10.5, padding: "1px 6px", borderRadius: 4, flexShrink: 0,
                      background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))",
                      border: "1px solid hsl(var(--border))",
                    }}>From database</span>
                  )}
                </div>

                {/* On the grid column */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  {row.inList === "always" ? (
                    <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>Always</span>
                  ) : row.inList !== null ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <input
                        type="checkbox"
                        checked={row.inList}
                        disabled={row.fromDatabase}
                        onChange={() => !row.fromDatabase && toggleCol(activeView, row.key)}
                        style={{ accentColor: "hsl(var(--primary))", width: 15, height: 15,
                          cursor: row.fromDatabase ? "default" : "pointer" }}
                      />
                      {row.fromDatabase && row.extraKey && (
                        <button type="button" onClick={() => removeExtra(activeView, row.extraKey!)}
                          title="Remove this database column"
                          style={{ border: "none", background: "hsl(var(--muted))", cursor: "pointer",
                            width: 16, height: 16, borderRadius: 999, fontSize: 13, lineHeight: "15px",
                            fontWeight: 700, color: "hsl(var(--muted-foreground))", padding: 0 }}>×</button>
                      )}
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: "hsl(var(--border))" }}>—</span>
                  )}
                </div>

                {/* On the page column */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {row.inDetail === "always" ? (
                    <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>Always</span>
                  ) : row.inDetail !== null && catalogMod ? (
                    <>
                      <input
                        type="checkbox"
                        checked={row.inDetail}
                        onChange={() => toggleField(catalogMod as DisplayModule, row.key)}
                        style={{ accentColor: "hsl(var(--primary))", width: 15, height: 15, cursor: "pointer" }}
                      />
                      {detailPriority.has(row.key) && (
                        <>
                          <b title="Record-field priority" style={{ fontSize: 10.5, color: "hsl(var(--primary))" }}>#{detailPriority.get(row.key)}</b>
                          <span style={{ display: "inline-flex", flexDirection: "column" }}>
                            <button type="button" aria-label={`Move ${row.label} up inside the record`} onClick={() => moveDetailField(row.key, -1)}
                              style={{ border: 0, background: "none", padding: 0, lineHeight: 0, color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><ArrowUp size={10} /></button>
                            <button type="button" aria-label={`Move ${row.label} down inside the record`} onClick={() => moveDetailField(row.key, 1)}
                              style={{ border: 0, background: "none", padding: 0, lineHeight: 0, color: "hsl(var(--muted-foreground))", cursor: "pointer" }}><ArrowDown size={10} /></button>
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: "hsl(var(--border))" }}>—</span>
                  )}
                </div>
              </div>
            ))}

            {/* Footer */}
            <div style={{
              borderTop: "1px solid hsl(var(--border))",
              padding: "8px 16px", fontSize: 12,
              color: "hsl(var(--muted-foreground))",
              background: "hsl(var(--muted) / 0.3)",
              display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6,
            }}>
              <span>
                <b>{listCount}</b> column{listCount !== 1 ? "s" : ""} on the grid
                {catalogMod ? <> · <b>{detCount}</b> field{detCount !== 1 ? "s" : ""} inside the record</> : null}
              </span>
              {catalogMod && defaults.detail[catalogMod as DisplayModule] && (
                <button type="button"
                  onClick={() => clearModule(catalogMod as DisplayModule)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4,
                    background: "none", border: "1px solid hsl(var(--border))", borderRadius: 6,
                    cursor: "pointer", fontSize: 11, color: "hsl(var(--muted-foreground))",
                    padding: "3px 8px" }}>
                  <RotateCcw style={{ width: 10, height: 10 }} /> Reset page defaults
                </button>
              )}
            </div>
          </div>

          {/* Add database column — auto-saves immediately on selection */}
          {remainingExtras.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                Add a database column to the list:
              </span>
              <select
                value=""
                onChange={(e) => addExtra(activeView, e.target.value)}
                style={{ fontSize: 12, padding: "5px 8px", borderRadius: 8,
                  border: "1px dashed hsl(var(--border))",
                  background: "transparent", color: "hsl(var(--foreground))", cursor: "pointer" }}
              >
                <option value="" disabled>+ Pick a column…</option>
                {remainingExtras.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>
          )}
        </CardContent>
      </Card>
      {previewOpen && (
        <div
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewOpen(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: 1600, display: "grid", placeItems: "center",
            padding: 18, background: "rgba(4,10,16,.68)", backdropFilter: "blur(4px)",
          }}
        >
          <section role="dialog" aria-modal="true" aria-label={`${VIEW_LABELS[activeView]} display preview`} style={{
            width: "min(960px, 96vw)", maxHeight: "88vh", overflow: "auto",
            borderRadius: 16, border: "1px solid hsl(var(--border))",
            background: "hsl(var(--card))", boxShadow: "0 28px 80px rgba(0,0,0,.35)",
          }}>
            <header style={{
              position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center",
              justifyContent: "space-between", padding: "14px 16px",
              borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--card))",
            }}>
              <div>
                <b>{VIEW_LABELS[activeView]} preview</b>
                <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                  {effectiveViewMode === "grid" ? "Grid" : "Cards"} · current company default
                </div>
              </div>
              <button type="button" onClick={() => setPreviewOpen(false)} aria-label="Close preview"
                style={{ border: 0, background: "transparent", cursor: "pointer", color: "hsl(var(--muted-foreground))" }}>
                <X size={18} />
              </button>
            </header>
            <div style={{ padding: 16 }}>
              {effectiveViewMode === "grid" ? (
                <div style={{ overflowX: "auto", border: "1px solid hsl(var(--border))", borderRadius: 12 }}>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${Math.max(listOrderedRows.length, 1)}, minmax(120px, 1fr))`,
                    minWidth: listOrderedRows.length * 120,
                  }}>
                    {listOrderedRows.map((row) => (
                      <b key={row.key} style={{ padding: "9px 10px", fontSize: 11, color: "hsl(var(--muted-foreground))", borderRight: "1px solid hsl(var(--border))" }}>
                        {row.label}
                      </b>
                    ))}
                    {[1, 2, 3].flatMap((sample) => listOrderedRows.map((row) => (
                      <span key={`${sample}-${row.key}`} style={{
                        padding: "11px 10px", fontSize: 12, borderTop: "1px solid hsl(var(--border))",
                        borderRight: "1px solid hsl(var(--border))", whiteSpace: "nowrap",
                      }}>{row.key === "id" ? `RM-${String(sample).padStart(5, "0")}` : row.label}</span>
                    )))}
                  </div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                  {[1, 2, 3].map((sample) => (
                    <div key={sample} style={{ padding: 14, border: "1px solid hsl(var(--border))", borderRadius: 12 }}>
                      <b>Sample {VIEW_LABELS[activeView].replace(" (CRM)", "")} {sample}</b>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                        {listOrderedRows.slice(0, 7).map((row) => (
                          <span key={row.key} style={{ padding: "3px 7px", borderRadius: 6, background: "hsl(var(--muted))", fontSize: 11 }}>{row.label}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {catalogMod && (
                <div style={{ marginTop: 16 }}>
                  <b style={{ fontSize: 13 }}>Inside the record</b>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, marginTop: 8 }}>
                    {previewDetailRows.map((row, index) => (
                      <div key={row.key} style={{ padding: "9px 10px", border: "1px solid hsl(var(--border))", borderRadius: 8 }}>
                        <span style={{ fontSize: 10, color: "hsl(var(--primary))", fontWeight: 800 }}>#{index + 1}</span>
                        <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{row.label}</div>
                        <b style={{ fontSize: 12 }}>Sample value</b>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
