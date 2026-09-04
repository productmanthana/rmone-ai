/**
 * Settings → Access Levels — admin-defined CUSTOM access levels (#87).
 *
 * A custom level is a named set of capability toggles (view is always
 * included): edit data, move records between stages, edit financial fields,
 * manage staff, manage company settings. Levels created here appear in the
 * staff editor's Access Level dropdown alongside the built-in Admin /
 * Manager / User levels, and the SERVER enforces them on every write path.
 *
 * tenantId semantics (mirrors StageRulesSettings):
 *   undefined — a company admin editing their OWN company
 *   string    — a superadmin editing that specific company
 *   null      — a superadmin still on "Global defaults" scope → pick-a-company note
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Plus, Trash2, ShieldCheck, Shield, AlertTriangle, Check, X, Lock, RotateCcw } from "lucide-react";
import {
  fetchAccessLevelsDoc, saveAccessLevelsDoc, levelIdFromName, CAP_ROWS,
  type AccessLevelDef, type Caps, type AccessLevelsDoc,
} from "@/lib/permissions";
import { getSeed, setSeed, seedScope } from "@/lib/settingsSeed";

/** The built-in levels' effective capabilities — MUST mirror the server's
 *  built-in gates in /my-capabilities (rmone-proxy): admin = everything;
 *  manager = everything except company settings (financials additionally
 *  gated by the "restrict financial edits to admins" business rule);
 *  user = view-only. Display-only — the server enforces the real rules. */
const BUILTIN_LEVELS: { name: string; desc: string; caps: Caps; note?: string }[] = [
  {
    name: "Admin",
    desc: "Full access — can do everything, including company settings.",
    caps: { editData: true, advanceStages: true, editFinancials: true, manageStaff: true, manageSettings: true, importPage: true },
  },
  {
    name: "Manager",
    desc: "Can edit records, move stages, and manage staff — but not company settings.",
    caps: { editData: true, advanceStages: true, editFinancials: true, manageStaff: true, manageSettings: false, importPage: false },
    note: "Edit financials can be turned off for Managers with the \u201Crestrict financial edits to admins\u201D company rule.",
  },
  {
    name: "User",
    desc: "View only — can see everything but change nothing.",
    caps: { editData: false, advanceStages: false, editFinancials: false, manageStaff: false, manageSettings: false, importPage: false },
  },
];

function WarnNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: "#d97706", marginTop: 6, lineHeight: 1.45 }}>
      <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

/** Default built-in caps (what the server uses when no override is set). */
const BUILTIN_DEFAULTS = {
  manager: { editData: true, advanceStages: true, editFinancials: true, manageStaff: true, manageSettings: false, importPage: false } as Caps,
  user:    { editData: false, advanceStages: false, editFinancials: false, manageStaff: false, manageSettings: false, importPage: false } as Caps,
};

export default function AccessLevelsSettings({ tenantId }: { tenantId?: string | null }) {
  const { toast } = useToast();
  // Instant render: boot from the session seed (settings hub pre-warms it)
  // and revalidate in the background.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-time seed only
  const bootLevels = useMemo((): AccessLevelDef[] | null => {
    if (tenantId === null) return null;
    return getSeed<AccessLevelDef[]>(`accessLevels:${seedScope(tenantId)}`) ?? null;
  }, []);
  const [levels, setLevelsRaw] = useState<AccessLevelDef[]>(bootLevels ?? []);
  const [snapshot, setSnapshot] = useState<string>(bootLevels ? JSON.stringify(bootLevels) : "[]");

  // Builtin overrides + import access (part of the same access-levels doc).
  const [managerOv, setManagerOv] = useState<Caps>(BUILTIN_DEFAULTS.manager);
  const [userOv, setUserOv]       = useState<Caps>(BUILTIN_DEFAULTS.user);
  const [managerOverridden, setManagerOverridden] = useState(false);
  const [userOverridden, setUserOverridden]       = useState(false);
  // Snapshot of the non-level fields for dirty tracking.
  const [extraSnapshot, setExtraSnapshot] = useState<string>(JSON.stringify({ managerOv: BUILTIN_DEFAULTS.manager, userOv: BUILTIN_DEFAULTS.user, managerOverridden: false, userOverridden: false }));

  const [loading, setLoading] = useState(!bootLevels);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Stable card keys ────────────────────────────────────────────────────
  const uidCounterRef = useRef(0);
  const stableKeysRef = useRef<string[]>(
    (bootLevels ?? []).map(() => `lvl-${++uidCounterRef.current}`),
  );
  const syncStableKeys = useCallback((list: AccessLevelDef[]) => {
    while (stableKeysRef.current.length < list.length) {
      stableKeysRef.current.push(`lvl-${++uidCounterRef.current}`);
    }
    stableKeysRef.current.length = list.length;
  }, []);

  const applyDoc = useCallback((doc: AccessLevelsDoc) => {
    syncStableKeys(doc.levels);
    setLevelsRaw(doc.levels);
    setSnapshot(JSON.stringify(doc.levels));
    const mgr = doc.builtinOverrides?.manager ? { ...BUILTIN_DEFAULTS.manager, ...doc.builtinOverrides.manager } : BUILTIN_DEFAULTS.manager;
    const usr = doc.builtinOverrides?.user    ? { ...BUILTIN_DEFAULTS.user,    ...doc.builtinOverrides.user    } : BUILTIN_DEFAULTS.user;
    setManagerOv(mgr);
    setUserOv(usr);
    setManagerOverridden(!!doc.builtinOverrides?.manager);
    setUserOverridden(!!doc.builtinOverrides?.user);
    setExtraSnapshot(JSON.stringify({ managerOv: mgr, userOv: usr, managerOverridden: !!doc.builtinOverrides?.manager, userOverridden: !!doc.builtinOverrides?.user }));
  }, [syncStableKeys]);

  const dirtyRef = useRef(false);
  const loadSeqRef = useRef(0);
  const setLevels = useCallback(
    (v: AccessLevelDef[] | ((prev: AccessLevelDef[]) => AccessLevelDef[])) => {
      dirtyRef.current = true;
      setLevelsRaw(v);
    }, []);

  const load = useCallback(async (background: boolean) => {
    if (tenantId === null) { setLoading(false); return; }
    const seq = ++loadSeqRef.current;
    if (!background) { setLoading(true); setLoadErr(null); }
    try {
      const doc = await fetchAccessLevelsDoc(tenantId ?? undefined);
      if (seq !== loadSeqRef.current) return;
      setSeed(`accessLevels:${seedScope(tenantId)}`, doc.levels);
      if (!background || !dirtyRef.current) applyDoc(doc);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      if (!background) setLoadErr(e instanceof Error ? e.message : "Could not load access levels");
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [tenantId, applyDoc]);

  const firstRunRef = useRef(true);
  useEffect(() => {
    if (firstRunRef.current) { firstRunRef.current = false; void load(!!bootLevels); return; }
    if (tenantId === null) { setLoading(false); return; }
    const s = getSeed<AccessLevelDef[]>(`accessLevels:${seedScope(tenantId)}`);
    if (s) {
      syncStableKeys(s); setLevelsRaw(s); setSnapshot(JSON.stringify(s));
      setLoading(false); setLoadErr(null); dirtyRef.current = false;
      void load(true);
    } else { void load(false); }
  }, [bootLevels, load, tenantId, syncStableKeys]);

  const savedIds = useMemo(() => {
    try { return new Set((JSON.parse(snapshot) as AccessLevelDef[]).map(l => l.id)); }
    catch { return new Set<string>(); }
  }, [snapshot]);

  const extraDirty = useMemo(() => {
    const cur = JSON.stringify({ managerOv, userOv, managerOverridden, userOverridden });
    return cur !== extraSnapshot;
  }, [managerOv, userOv, managerOverridden, userOverridden, extraSnapshot]);

  const dirty = useMemo(() => JSON.stringify(levels) !== snapshot || extraDirty, [levels, snapshot, extraDirty]);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  const doSave = async () => {
    const bad = levels.find(l => !l.name.trim());
    if (bad) {
      toast({ title: "Every level needs a name", description: "Give each access level a name before saving.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      loadSeqRef.current++;
      const doc: AccessLevelsDoc = {
        levels,
        builtinOverrides: {
          ...(managerOverridden ? { manager: managerOv } : {}),
          ...(userOverridden    ? { user: userOv }       : {}),
        },
      };
      const saved = await saveAccessLevelsDoc(doc, tenantId ?? undefined);
      applyDoc(saved);
      setSeed(`accessLevels:${seedScope(tenantId)}`, saved.levels);
      toast({ title: "Access levels saved", description: "Changes are live — capabilities take effect on the next login or page refresh." });
    } catch (e) {
      toast({
        title: "Could not save access levels",
        description: e instanceof Error ? e.message : "Something went wrong — please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  /** Toggle a single capability for an editable built-in level. */
  const setBuiltinCap = (level: "manager" | "user", key: keyof Caps, value: boolean) => {
    if (level === "manager") {
      setManagerOv(prev => {
        const next = { ...prev, [key]: value };
        if (key === "editData" && !value) { next.advanceStages = false; next.importPage = false; }
        if ((key === "advanceStages" || key === "importPage") && value) next.editData = true;
        return next;
      });
      setManagerOverridden(true);
      dirtyRef.current = true;
    } else {
      setUserOv(prev => {
        const next = { ...prev, [key]: value };
        if (key === "editData" && !value) { next.advanceStages = false; next.importPage = false; }
        if ((key === "advanceStages" || key === "importPage") && value) next.editData = true;
        return next;
      });
      setUserOverridden(true);
      dirtyRef.current = true;
    }
  };

  const resetBuiltin = (level: "manager" | "user") => {
    if (level === "manager") { setManagerOv(BUILTIN_DEFAULTS.manager); setManagerOverridden(false); }
    else                     { setUserOv(BUILTIN_DEFAULTS.user);       setUserOverridden(false); }
    dirtyRef.current = true;
  };

  const setLevel = (i: number, patch: Partial<AccessLevelDef>) =>
    setLevels(ls => ls.map((x, j) => j === i ? { ...x, ...patch } : x));

  const renameLevel = (i: number, name: string) => {
    setLevels(ls => ls.map((x, j) => {
      if (j !== i) return x;
      // The id is what's stored on each person — once a level has been saved
      // its id is frozen; before that it follows the name for readability.
      if (savedIds.has(x.id)) return { ...x, name };
      const taken = new Set(ls.filter((_, k) => k !== i).map(l => l.id));
      return { ...x, name, id: levelIdFromName(name || "level", taken) };
    }));
  };

  const setCap = (i: number, key: keyof Caps, value: boolean) => {
    setLevels(ls => ls.map((x, j) => {
      if (j !== i) return x;
      const caps = { ...x.caps, [key]: value };
      // Moving stages / importing requires being able to edit at all — keep
      // the pairs sane in the UI (the server treats them the same way).
      if (key === "editData" && !value) { caps.advanceStages = false; caps.importPage = false; }
      if ((key === "advanceStages" || key === "importPage") && value) caps.editData = true;
      return { ...x, caps };
    }));
  };

  const addLevel = () => {
    const taken = new Set(levels.map(l => l.id));
    stableKeysRef.current.push(`lvl-${++uidCounterRef.current}`);
    setLevels(ls => [...ls, {
      id: levelIdFromName("New level", taken),
      name: "New level",
      caps: { editData: true, advanceStages: false, editFinancials: false, manageStaff: false, manageSettings: false, importPage: false },
    }]);
  };

  const deleteLevel = (i: number) => {
    stableKeysRef.current.splice(i, 1);
    setLevels(ls => ls.filter((_, j) => j !== i));
  };

  if (tenantId === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access Levels</CardTitle>
          <CardDescription>
            Access levels are set per company. Pick a company in “Who do these apply to?” above, then come back here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (loadErr) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access Levels</CardTitle>
          <CardDescription>{loadErr}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={() => void load(false)}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: "hsl(var(--foreground))" }}>Access Levels</h1>
          <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 4, marginBottom: 0, maxWidth: 640 }}>
            Create your own access levels beyond the built-in Admin, Manager, and User. Each level is a
            set of permissions; assign it to people in Manage Organization → edit staff. Everyone can
            always view.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <Button onClick={() => void doSave()} disabled={saving || !dirty} size="sm">
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
            {dirty ? "Save changes" : "Saved"}
          </Button>
          {dirty && !saving && (
            <span style={{ fontSize: 11, fontWeight: 600, color: "#B45309", whiteSpace: "nowrap" }}>
              Changes not saved yet
            </span>
          )}
        </div>
      </div>

      {/* ── Built-in levels — Admin read-only; Manager + User customizable ── */}
      <Card style={{ marginBottom: 16 }}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Shield style={{ width: 15, height: 15, color: "hsl(var(--muted-foreground))" }} /> Built-in levels
          </CardTitle>
          <CardDescription>
            Admin is always full access. Manager and User start with sensible defaults — you can
            customize their capabilities for your company below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Admin — always full access, read-only */}
          <div style={{ padding: "12px 14px", border: "1px solid hsl(var(--border))", borderRadius: 8, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "hsl(var(--foreground))" }}>Admin</span>
              <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>Full access — can do everything, including company settings.</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", marginLeft: "auto" }}>
                <Lock style={{ width: 11, height: 11 }} /> fixed
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 8 }}>
              {CAP_ROWS.map(({ key, label, hint }) => (
                <div key={key} title={hint} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", border: "1px solid hsl(var(--border))", borderRadius: 6, background: "hsl(var(--primary) / 0.06)" }}>
                  <Check style={{ width: 14, height: 14, marginTop: 2, flexShrink: 0, color: "#10b981" }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>{label}</span>
                    <span style={{ display: "block", fontSize: 11, color: "hsl(var(--muted-foreground))", lineHeight: 1.35 }}>Can — {hint.charAt(0).toLowerCase() + hint.slice(1)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Manager + User — editable */}
          {(["manager", "user"] as const).map(lvlKey => {
            const isManager = lvlKey === "manager";
            const caps = isManager ? managerOv : userOv;
            const overridden = isManager ? managerOverridden : userOverridden;
            const defaults = BUILTIN_DEFAULTS[lvlKey];
            const name = isManager ? "Manager" : "User";
            const defaultDesc = isManager
              ? "Can edit records, move stages, and manage staff — but not company settings."
              : "View only — can see everything but change nothing.";
            return (
              <div key={lvlKey} style={{ padding: "12px 14px", border: `1px solid ${overridden ? "hsl(var(--primary) / 0.4)" : "hsl(var(--border))"}`, borderRadius: 8, marginBottom: 10, background: overridden ? "hsl(var(--primary) / 0.03)" : undefined }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: "hsl(var(--foreground))" }}>{name}</span>
                  <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>{defaultDesc}</span>
                  {overridden && (
                    <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "hsl(var(--primary))", background: "hsl(var(--primary) / 0.1)", padding: "2px 8px", borderRadius: 99 }}>
                      Customized
                    </span>
                  )}
                  {overridden && (
                    <button type="button" title="Reset to default" onClick={() => resetBuiltin(lvlKey)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "1px solid hsl(var(--border))", borderRadius: 6, cursor: "pointer", fontSize: 11, color: "hsl(var(--muted-foreground))", padding: "3px 8px" }}>
                      <RotateCcw style={{ width: 11, height: 11 }} /> Reset
                    </button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 8 }}>
                  {CAP_ROWS.filter(r => r.key !== "importPage").map(({ key, label, hint }) => {
                    const lockedOn = key === "editData" && caps.advanceStages;
                    const checked = lockedOn ? true : caps[key];
                    const changed = caps[key] !== defaults[key];
                    return (
                      <label key={key} title={lockedOn ? "Required by \u201cMove stages\u201d \u2014 can\u2019t remove Edit data while it\u2019s on" : hint} style={{
                        display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px",
                        border: `1px solid ${changed ? "hsl(var(--primary) / 0.35)" : "hsl(var(--border))"}`,
                        borderRadius: 6, cursor: lockedOn ? "default" : "pointer",
                        background: checked ? "hsl(var(--primary) / 0.06)" : "hsl(var(--background))",
                        opacity: lockedOn ? 0.75 : 1,
                      }}>
                        <input type="checkbox" checked={checked} disabled={lockedOn}
                          onChange={lockedOn ? undefined : e => setBuiltinCap(lvlKey, key, e.target.checked)}
                          style={{ accentColor: "hsl(var(--primary))", width: 14, height: 14, marginTop: 2, cursor: lockedOn ? "default" : "pointer", flexShrink: 0 }} />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "hsl(var(--foreground))" }}>
                            {label}{changed && <span style={{ fontSize: 10, fontWeight: 500, color: "hsl(var(--primary))", marginLeft: 4 }}>(changed)</span>}
                          </span>
                          <span style={{ display: "block", fontSize: 11, color: "hsl(var(--muted-foreground))", lineHeight: 1.35 }}>{hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {isManager && (
                  <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 6, lineHeight: 1.45 }}>
                    The &ldquo;restrict financial edits to admins&rdquo; company rule can additionally lock out financials for Managers.
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck style={{ width: 15, height: 15, color: "#10b981" }} /> Custom levels
          </CardTitle>
          <CardDescription>
            Example: a "Viewer+" level that can edit data but never move a record to another stage or
            touch financial fields. Deleting a level makes anyone still on it view-only until you assign
            them something else.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {levels.length === 0 && (
            <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginBottom: 10 }}>
              No custom levels yet — everyone uses the built-in Admin / Manager / User levels.
            </div>
          )}
          {levels.map((lvl, i) => {
            const dupe = levels.findIndex(l => l.name.trim().toLowerCase() === lvl.name.trim().toLowerCase() && l.name.trim() !== "") !== i;
            const stableKey = stableKeysRef.current[i] ?? `lvl-fallback-${i}`;
            return (
              <div key={stableKey} style={{ padding: "12px 14px", border: "1px solid hsl(var(--border))", borderRadius: 8, marginBottom: 10, background: "hsl(var(--muted) / 0.25)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <Input
                    value={lvl.name}
                    onChange={e => renameLevel(i, e.target.value)}
                    placeholder="Level name (e.g. Proposals team)"
                    style={{ maxWidth: 280, height: 32, fontSize: 13, fontWeight: 600 }}
                  />
                  <button type="button" title="Delete this level"
                    onClick={() => deleteLevel(i)}
                    style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", display: "flex", padding: 4 }}>
                    <Trash2 style={{ width: 14, height: 14 }} />
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 8 }}>
                  {CAP_ROWS.filter(r => r.key !== "importPage").map(({ key, label, hint }) => {
                    const lockedOn = key === "editData" && lvl.caps.advanceStages;
                    const effectiveChecked = lockedOn ? true : lvl.caps[key];
                    const effectiveTitle = lockedOn
                      ? "Required by \u201cMove stages\u201d \u2014 can\u2019t remove Edit data while it\u2019s on"
                      : hint;
                    return (
                      <label key={key} title={effectiveTitle} style={{
                        display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px",
                        border: `1px solid ${lockedOn ? "hsl(var(--primary) / 0.3)" : "hsl(var(--border))"}`,
                        borderRadius: 6, cursor: lockedOn ? "default" : "pointer",
                        background: effectiveChecked ? "hsl(var(--primary) / 0.06)" : "hsl(var(--background))",
                        opacity: lockedOn ? 0.75 : 1,
                      }}>
                        <input type="checkbox" checked={effectiveChecked}
                          disabled={lockedOn}
                          onChange={lockedOn ? undefined : e => setCap(i, key, e.target.checked)}
                          style={{ accentColor: "hsl(var(--primary))", width: 14, height: 14, marginTop: 2, cursor: lockedOn ? "default" : "pointer", flexShrink: 0 }} />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "hsl(var(--foreground))" }}>
                            {label}{lockedOn && <span style={{ fontSize: 10, fontWeight: 400, color: "hsl(var(--muted-foreground))", marginLeft: 4 }}>(required)</span>}
                          </span>
                          <span style={{ display: "block", fontSize: 11, color: "hsl(var(--muted-foreground))", lineHeight: 1.35 }}>{hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {dupe && (
                  <WarnNote>Two levels share this name — rename one so admins can tell them apart.</WarnNote>
                )}
                {savedIds.has(lvl.id) && !lvl.caps.editData && (
                  <WarnNote>
                    {lvl.caps.editFinancials
                      ? "Without \u201CEdit data\u201D this level can ONLY edit money fields — everything else on records is view-only"
                      : "Without \u201CEdit data\u201D this level is view-only"}
                    {lvl.caps.manageStaff || lvl.caps.manageSettings ? " (staff/settings permissions still apply)" : ""}.
                  </WarnNote>
                )}
              </div>
            );
          })}
          <Button variant="outline" size="sm" onClick={addLevel}>
            <Plus className="w-4 h-4 mr-1.5" /> Add access level
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
