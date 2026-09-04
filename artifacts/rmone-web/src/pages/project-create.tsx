import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDivisions, getDepartments, getBusinessUnits, getUsers, getProjectTeam,
  createRecord, createDivision, createDepartment, createBusinessUnit,
  bustCache, getModuleRecords, getModuleRecordsFresh, getProjectDetails, getTaskData, getFieldOptions, peekCached,
  assignResource, bulkCopyTeam, createSchedule, updateFields, notifyLifecycleChanged,
  type ProjectTeamMember,
} from "@/lib/api";
import { readConvertSeed } from "@/lib/convertSeed";
import { CreatableSelect, type CreatableOption } from "@/components/CreatableSelect";
import { PersonSearchSelect } from "@/components/PersonSearchSelect";
import { CompanySearchSelect } from "@/components/CompanySearchSelect";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Loader2, Save, Check, Users, CalendarRange,
  FileText, UserPlus, ArrowRight, ClipboardList, ChevronDown,
  LayoutGrid, Table2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { sameJobFields } from "@/lib/sameJob";
import {
  SchedulePhases, TeamMemberList, WizardTeamListView, clearScheduleEntirely,
  type ProjectData, type Allocation,
} from "@/pages/project-detail";
import { AddTeamMemberModal, type ExistingAllocationRef } from "@/components/AddTeamMemberModal";
import { getBusinessRules, useBusinessRulesVersion } from "@/lib/businessRules";
import { resolveDivisionForSave } from "@/lib/orgHierarchy";
import { EditAllocationModal, type EditAllocPerson } from "@/components/EditAllocationModal";
import DateField from "@/components/DateField";
import CreationProgressOverlay from "@/components/CreationProgressOverlay";
import { Z } from "@/lib/zLayers";

type TabKey = "details" | "additional" | "schedule" | "team";

// Bumped on every deploy-relevant change to this page so a glance at the
// tiny "build" stamp under the Link-from-Opportunity badge tells us whether
// a device is actually running the latest published bundle.
const BUILD_TAG = "2026.07.24-3";

// First non-empty string wins. Unlike `a ?? b` (which stops at ""), this
// skips null/undefined AND blank strings — record payloads normalise some
// missing fields to "" and a ??-chain silently dies there instead of falling
// through to the next candidate (that exact trap left PM/Department blank).
const sv = (v: unknown) => (v != null && String(v).trim() ? String(v).trim() : "");
const pick = (...vals: unknown[]) => {
  for (const v of vals) { const s = sv(v); if (s) return s; }
  return "";
};

// Derive the next sequential ID from an existing record list.
// Finds the highest numeric suffix across all records, increments by 1,
// preserves the original prefix and zero-padding width.
// e.g. ["PMM-26-101", "PMM-26-103"] → "PMM-26-104"
function suggestNextId(records: { TicketId?: unknown; ID?: unknown }[]): string {
  let maxNum = 0;
  let template = "";
  for (const r of records) {
    const id = String(r.TicketId ?? r.ID ?? "");
    const m = id.match(/^(.+-)(\d+)$/);
    if (!m) continue;
    const n = parseInt(m[2], 10);
    if (n > maxNum) { maxNum = n; template = id; }
  }
  if (!template) return "";
  const m = template.match(/^(.+-)(\d+)$/);
  if (!m) return "";
  return `${m[1]}${String(maxNum + 1).padStart(m[2].length, "0")}`;
}

// Increment an ID's numeric suffix by one, preserving prefix + zero padding.
// Used by the collision-retry loop to step past IDs we already know collided
// when the fresh record list still predates a sibling session's row.
function bumpId(id: string): string {
  const m = id.match(/^(.+-)(\d+)$/);
  if (!m) return "";
  return `${m[1]}${String(parseInt(m[2], 10) + 1).padStart(m[2].length, "0")}`;
}

// Self-contained searchable combobox for the "Link from Opportunity" picker.
// Radix Select has no built-in search and the long list can't be scrolled
// on some platforms — this replaces it with a plain div dropdown.
function OppSearchSelect({ options, value, onChange, disabled, placeholder }: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 10);
    else setSearch("");
  }, [open]);

  const filtered = useMemo(
    () => !search
      ? options
      : options.filter(o => o.label.toLowerCase().includes(search.toLowerCase())),
    [options, search],
  );
  const selected = options.find(o => o.id === value);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        className="w-full flex items-center justify-between border border-input rounded-md px-3 py-2 text-sm bg-background hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed text-left"
      >
        <span className={selected ? "truncate" : "text-muted-foreground truncate"}>
          {selected ? selected.label : (placeholder ?? "Pick an option…")}
        </span>
        <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 border border-input rounded-md bg-popover shadow-lg overflow-hidden">
          <div className="p-2 border-b border-input">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full text-sm px-2 py-1.5 rounded border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="max-h-60 overflow-y-auto overscroll-contain">
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-sm text-center text-muted-foreground">No results</div>
            )}
            {filtered.map(o => (
              <button
                key={o.id}
                type="button"
                onClick={() => { onChange(o.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center gap-2"
              >
                <Check className={`h-3.5 w-3.5 shrink-0 ${value === o.id ? "text-primary" : "invisible"}`} />
                <span className="truncate">{o.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Merge preset options with live DB-scraped values (deduped, presets first).
function mergeOpts(presets: string[], live: string[]): CreatableOption[] {
  const seen = new Set<string>();
  return [...presets, ...live]
    .filter(v => { const k = v.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(v => ({ id: v, label: v }));
}

// Map the project-team API rows into the Allocation shape the reused
// detail-page components (TeamMemberList) expect.
function mapTeam(team: ProjectTeamMember[]): Allocation[] {
  return team
    .filter((t) => t.name)
    .map((t) => ({
      name: t.name,
      role: t.role || "",
      title: t.title || "",
      pct: t.pctAllocation ?? 0,
      startDate: t.startDate ?? "",
      endDate: t.endDate ?? "",
      eacHrs: t.eacHrs ?? 0,
      etcHrs: t.etcHrs ?? 0,
      costRate: t.costRate ?? 0,
      laborRate: t.laborRate ?? 0,
      eacCost: t.eacCost ?? 0,
      etcCost: t.etcCost ?? 0,
      ncHrs: t.ncHrs ?? 0,
      ncCost: t.ncCost ?? 0,
      hasWeeklyHours: (t.weeklyHours?.length ?? 0) > 0 || (t.eacHrs ?? 0) > 0 || (t.etcHrs ?? 0) > 0,
      bu: t.bu ?? "",
      email: "",
      resourceId: t.resourceId ?? "",
    }));
}

export default function ProjectCreate() {
  useBusinessRulesVersion(); // re-render when admin changes BU/Dept visibility
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  // Users (canEdit=false) may not create records — redirect to home.
  useEffect(() => { if (user?.canEdit === false) setLocation("/"); }, [user, setLocation]);
  const queryClient = useQueryClient();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [creationStep, setCreationStep] = useState("");
  const [creationPct, setCreationPct] = useState(0);
  // Smooth "trickle" so the bar keeps moving while the slow create API call
  // runs (instead of freezing at one value, then jumping to done). It eases
  // toward a cap and never goes backwards; real milestones bump it past caps.
  const trickleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTrickle = () => {
    if (trickleRef.current) { clearInterval(trickleRef.current); trickleRef.current = null; }
  };
  const startTrickle = (cap: number) => {
    stopTrickle();
    trickleRef.current = setInterval(() => {
      setCreationPct(p => {
        if (p >= cap) return p;
        const step = Math.max(0.4, (cap - p) * 0.06);
        return Math.min(cap, p + step);
      });
    }, 180);
  };
  useEffect(() => () => stopTrickle(), []);
  // Once the base record is created we have a ticket id; every other tab
  // (team / schedule / business unit) writes rows that attach to
  // it, so they stay locked until this is set.
  const [createdId, setCreatedId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabKey>("details");
  // Per-field "required" flags — drive the inline red highlights so the user
  // sees exactly WHICH field blocks them (the old toast statically listed all
  // required fields even when they were filled). Cleared as each field is set.
  const [missing, setMissing] = useState<{ title?: boolean; id?: boolean; division?: boolean }>({});
  const clearMissing = (k: "title" | "id" | "division") =>
    setMissing((m) => (m[k] ? { ...m, [k]: false } : m));
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamViewMode, setTeamViewMode] = useState<"card" | "list">(() =>
    (localStorage.getItem("wizard:teamView") as "card" | "list") || "card"
  );
  // "Skip for now" on the Schedule tab clears any already-saved phase dates
  // (SchedulePhases saves every edit immediately — skip must undo them).
  const [skippingSched, setSkippingSched] = useState(false);
  const [editAllocPerson, setEditAllocPerson] = useState<EditAllocPerson | null>(null);

  const [formData, setFormData] = useState({
    Title: "",
    ERPJobID: "",
    ApproxContractValue: "",
    DivisionID: "",
    DepartmentID: "",
    BusinessUnit: "",
    PrimaryProjectManager: "",
    TargetStartDate: "",
    TargetCompletionDate: "",
    // New projects default to Pipeline (committed, no contract signed yet).
    // A project only becomes Active once it is contracted — the user makes
    // that designation explicitly via the Contract Status selector below.
    Status: "Pipeline",
    Sector: "",
    ShortName: "",
    ProjectType: "",
    ServiceType: "",
    ContactName: "",
    Company: "",
    OwnersRepresentative: "",
    Office: "",
    City: "",
    ContingencyValue: "",
    CloseoutDate: "",
  });

  const [linkedOppId, setLinkedOppId] = useState("");
  const { data: opmsData } = useQuery({ queryKey: ["opm"], queryFn: () => getModuleRecords("OPM") });
  // Force-fresh — suggestNextId and the duplicate guard must never run on a
  // list that predates a record another user/session just created. Plain
  // getModuleRecords would serve the warm client cache (or a sibling
  // worker's stale server cache) even with staleTime:0.
  const { data: pmmsData } = useQuery({ queryKey: ["pmm"], queryFn: () => getModuleRecordsFresh("PMM"), staleTime: 0, refetchOnMount: "always" });

  // Auto-suggest the next Project ID from existing PMM records.
  // Fires each time pmmsData arrives (including the fresh follow-up after
  // stale-data was served). The ref tracks the last auto-suggestion so we
  // can distinguish "user typed something different" from "field still shows
  // our own suggestion and can be updated if a fresher ID is available".
  const suggestedIdRef = useRef<string>("");
  useEffect(() => {
    const records = (pmmsData?.data ?? []) as { TicketId?: unknown; ID?: unknown }[];
    if (!records.length) return;
    setFormData(prev => {
      // Only auto-fill when the field is empty OR still showing our last
      // suggestion — never override something the user typed themselves.
      if (prev.ERPJobID && prev.ERPJobID !== suggestedIdRef.current) return prev;
      const suggested = suggestNextId(records);
      if (!suggested) return prev;
      suggestedIdRef.current = suggested;
      return { ...prev, ERPJobID: suggested };
    });
  }, [pmmsData]);

  useEffect(() => {
    const fromOpp = new URLSearchParams(window.location.search).get("fromOpp") ?? "";
    if (fromOpp) setLinkedOppId(fromOpp);
  }, []);

  // Company link (mandatory-ID policy, Aug 2026): the numeric CRMCompany.ID
  // chosen via the picker. formData.Company keeps the display NAME for
  // prefill/hint only — the payload sends ONLY CRMCompanyLookup (free-text
  // company names are rejected server-side).
  const [companyId, setCompanyId] = useState("");

  const DROPDOWN_OPTS = { staleTime: 0, refetchOnMount: "always" as const, retry: 1, retryDelay: 1500 };
  // Org data (BU / Division / Department) changes rarely — use 5-min staleTime.
  // placeholderData seeds from the api.ts module cache (peekCached) so the form
  // never shows "Loading options…" when CachePrewarm already fetched the data
  // this session — even if the React Query cache hasn't been populated yet.
  const ORG_OPTS = { staleTime: 5 * 60 * 1000, refetchOnMount: true as const, retry: 1, retryDelay: 1500 };
  const { data: divisions, isLoading: divisionsLoading } = useQuery({ queryKey: ["divisions"], queryFn: () => getDivisions(), ...ORG_OPTS, placeholderData: () => peekCached<Awaited<ReturnType<typeof getDivisions>>>("divisions") ?? undefined });
  const { data: departments, isLoading: departmentsLoading } = useQuery({ queryKey: ["departments"], queryFn: () => getDepartments(), ...ORG_OPTS, placeholderData: () => peekCached<unknown[]>("departments") ?? undefined });
  const { data: businessUnits, isLoading: businessUnitsLoading } = useQuery({ queryKey: ["businessUnits"], queryFn: () => getBusinessUnits(), ...ORG_OPTS, placeholderData: () => peekCached<unknown[]>("business-units") ?? undefined });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => getUsers(), ...ORG_OPTS, placeholderData: () => peekCached<{ id: string; name: string }[]>("users") ?? undefined });

  // Live DB-scraped options — distinct values already stored on this tenant's
  // PMM records (including anything added via Excel import or previous creates).
  const FIELD_OPTS = { staleTime: 5 * 60 * 1000, retry: 1 };
  const { data: liveSector }      = useQuery({ queryKey: ["fieldOpts","sector"],      queryFn: () => getFieldOptions("sector"),      ...FIELD_OPTS });
  const { data: liveProjectType } = useQuery({ queryKey: ["fieldOpts","projecttype"], queryFn: () => getFieldOptions("projecttype"), ...FIELD_OPTS });
  const { data: liveServiceType } = useQuery({ queryKey: ["fieldOpts","servicetype"], queryFn: () => getFieldOptions("servicetype"), ...FIELD_OPTS });
  const { data: liveStatus }      = useQuery({ queryKey: ["fieldOpts","status"],      queryFn: () => getFieldOptions("status"),      ...FIELD_OPTS });

  // The prefilled opp sector may not exist in the preset/live lists yet —
  // append it so the select can actually RENDER the transferred value.
  // (getFieldOptions returns a plain string[] — no .options wrapper.)
  const sectorOpts      = useMemo(() => {
    const base = mergeOpts(["Transportation","Infrastructure","Healthcare","Commercial","Residential","Government","Education","Industrial","Energy","Mixed Use"], liveSector ?? []);
    const cur = formData.Sector.trim();
    if (cur && !base.some(o => o.id.trim().toLowerCase() === cur.toLowerCase())) base.push({ id: cur, label: cur });
    return base;
  }, [liveSector, formData.Sector]);
  const projectTypeOpts = useMemo(() => mergeOpts(["New Construction","Renovation","Rehabilitation","Design-Build","CM at Risk","Owner's Rep","Feasibility Study"], liveProjectType ?? []), [liveProjectType]);
  const serviceTypeOpts = useMemo(() => mergeOpts(["Construction Management","Program Management","Design-Build","Owner's Representative","Construction Administration","Project Controls","Commissioning"], liveServiceType ?? []), [liveServiceType]);
  // Status: tenant-provided values (from imports or edits) are first-class —
  // merge them with the standard designations so the dropdown always shows
  // whatever statuses this tenant actually uses.
  const statusOpts      = useMemo(() => mergeOpts(["Pipeline","Active","Pre-Con","Bid","On Hold","Complete","Closed","Closed \u2013 Won"], liveStatus ?? []), [liveStatus]);

  // Full-detail prefill: fetch the complete opportunity record so we get
  // Division, Department, PM, BU, dates — not just the thin list fields.
  // The fetch has an explicit status so the UI never lies: "loading" shows a
  // spinner, "failed"/"notfound" shows an error with a Retry button, and the
  // green "fields pre-filled" line only appears once data actually landed.
  type OppStatus = "idle" | "loading" | "loaded" | "notfound" | "failed";
  const [oppRaw, setOppRaw] = useState<Record<string, unknown> | null>(null);
  const [oppStatus, setOppStatus] = useState<OppStatus>("idle");
  const [oppFetchNonce, setOppFetchNonce] = useState(0);
  // Preselect the company from the source opp's actual FK (CRMCompanyLookup).
  // The NAME fallback chain in the prefill below only feeds the picker's hint.
  useEffect(() => {
    if (!oppRaw) return;
    const raw = String((oppRaw as Record<string, unknown>).CRMCompanyLookup ?? "").trim();
    if (/^\d+$/.test(raw)) setCompanyId(prev => prev || raw);
  }, [oppRaw]);
  useEffect(() => {
    if (!linkedOppId) { setOppRaw(null); setOppStatus("idle"); return; }
    let cancelled = false;
    // ── Instant path ── the opportunity detail page wrote its in-memory
    // record to a short-lived seed right before navigating here. It's the
    // exact record the user was just looking at, so the form pre-fills on
    // first paint with zero network wait. Retry (nonce > 0) always refetches.
    if (oppFetchNonce === 0) {
      const seed = readConvertSeed(linkedOppId);
      if (seed) { setOppRaw(seed); setOppStatus("loaded"); return; }
    }
    setOppRaw(null);
    setOppStatus("loading");
    // Race against a 20 s fallback so the badge never sits on "Loading…"
    // for the full fetch timeout — the user gets a Retry button instead.
    const TIMEOUT = Symbol("timeout");
    Promise.race([
      getProjectDetails(linkedOppId),
      new Promise((resolve) => setTimeout(() => resolve(TIMEOUT), 20_000)),
    ])
      .then((res: any) => {
        if (cancelled) return;
        if (res === TIMEOUT) { setOppStatus("failed"); return; }
        // Unwrap the API envelope — a {Status:false} envelope must never leak
        // into the form as if it were record data.
        const d = (res && typeof res === "object" && "Data" in res) ? res.Data : res;
        if (res?.Status === false || !d || typeof d !== "object") {
          setOppStatus("notfound");
          return;
        }
        setOppRaw(d as Record<string, unknown>);
        setOppStatus("loaded");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[oppPrefill] fetch failed:", err);
        setOppStatus("failed");
      });
    return () => { cancelled = true; };
  }, [linkedOppId, oppFetchNonce]);

  const retryOppFetch = () => {
    if (!linkedOppId) return;
    // A cached {Status:false} envelope would make the retry an instant no-op —
    // clear it so the retry actually goes back to the server.
    bustCache(`project:details:${linkedOppId}`);
    setOppFetchNonce(n => n + 1);
  };

  // Prefill pass 1 — non-org fields (title, value, PM, dates). Runs as soon
  // as the opportunity record arrives; PM fills in once the user list loads.
  useEffect(() => {
    if (!oppRaw) return;
    const d = oppRaw;

    // PM: try GUID fields first (OwnerUser, PrimaryProjectManager),
    // then display-name fields (ProjectManagerUser, OwnerName).
    // Strip honorifics (Dr., Mr., Prof., etc.) for fuzzy name matching.
    const stripHonorifics = (s: string) =>
      s.replace(/^(dr|mr|mrs|ms|miss|prof|sr|jr)\.?\s+/i, "").trim();
    const pmGuid = pick(d.OwnerUser, d.PrimaryProjectManager, d.CRMOwnerLookup, d.OwnerLookup);
    // The opp's PM/contact name. PMs persist by NAME (core2 PMM has only the
    // nvarchar ProjectManagerUser column), so a contact who is not a staff
    // user still transfers VERBATIM — the picker appends it as its own
    // "(from opportunity)" option, mirroring the BU pattern.
    const pmName = pick(d.ProjectManagerUser, d.ProjectManager, d.PMId, d.OwnerName, d.ContactName);
    const pmId = (() => {
      // 1. Direct GUID match
      if (pmGuid && users) {
        const byId = (users as any[]).find((u: any) => u.id === pmGuid);
        if (byId) return byId.id;
      }
      // 2. Name match (with + without honorifics)
      if (pmName && users) {
        const raw = pmName.toLowerCase();
        const stripped = stripHonorifics(pmName).toLowerCase();
        const byName = (users as any[]).find((u: any) => {
          const uName = String(u.name ?? "").toLowerCase();
          const uStripped = stripHonorifics(String(u.name ?? "")).toLowerCase();
          return uName === raw || uStripped === stripped || uName === stripped || uStripped === raw ||
            String(u.email ?? "").toLowerCase() === raw;
        });
        if (byName) return byName.id;
      }
      // 3. No staff match — carry the name itself (users may still be
      // loading; a later run upgrades to the user id if one matches).
      return pmName;
    })();

    setFormData(prev => ({
      ...prev,
      Title: prev.Title || sv(d.Title),
      ApproxContractValue: prev.ApproxContractValue || pick(d.ApproxContractValue, d.ContractValue),
      // Upgrade our own verbatim-name write to the staff user id once the
      // user list arrives; a hand-picked PM (anything else) is never touched.
      PrimaryProjectManager: (!prev.PrimaryProjectManager || prev.PrimaryProjectManager === pmName)
        ? (pmId || prev.PrimaryProjectManager)
        : prev.PrimaryProjectManager,
      TargetStartDate: prev.TargetStartDate || sv(d.TargetStartDate).slice(0, 10),
      TargetCompletionDate: prev.TargetCompletionDate || pick(d.TargetCompletionDate, d.BidDueDate).slice(0, 10),
      // Additional-details fields the opp already knows about.
      Sector: prev.Sector || pick(d.SectorChoice, d.Sector),
      Company: prev.Company || pick(d.CompanyName, d.CRMCompanyLookupName, d.Company),
      // The opp detail page's "Contact Name" is OwnerName when the record
      // has no explicit contact fields — mirror the same fallback here.
      ContactName: prev.ContactName || pick(d.ContactName, d.CRMContactLookupName, d.OwnerName),
      // Owner's Representative transfers verbatim from the opportunity.
      OwnersRepresentative: prev.OwnersRepresentative || sv(d.OwnersRepresentative),
      Office: prev.Office || pick(d.Office, d.OfficeLocation),
      City: prev.City || sv(d.City),
      ShortName: prev.ShortName || sv(d.ShortName),
      // Carry over every remaining form field the opp may know about —
      // most opp records lack these columns, but when present they transfer.
      ProjectType: prev.ProjectType || sv(d.ProjectType),
      ServiceType: prev.ServiceType || sv(d.ServiceType),
      ContingencyValue: prev.ContingencyValue || pick(d.ContingencyValue, d.Contingency),
    }));
  }, [oppRaw, users]);

  // Prefill pass 2 — org fields (BU → Division → Department). Applied
  // PROGRESSIVELY: it runs as soon as the opp record is in and upgrades the
  // values as each org catalog arrives (a catalog query that fails silently
  // must not block the whole prefill — the BU text alone needs no catalog).
  // orgAppliedRef remembers what THIS effect last wrote so a later upgrade
  // only overwrites values the user hasn't touched; the cascade still lands
  // ALIGNED because the Business Unit is derived from the transferred
  // division's PARENT BU (authoritative hierarchy) whenever the catalogs
  // are available, never from the opp's free-text BU field alone.
  const orgAppliedRef = useRef<{ bu?: string; div?: string; dept?: string } | null>(null);
  useEffect(() => { orgAppliedRef.current = null; }, [linkedOppId]);
  useEffect(() => {
    if (!oppRaw) return;
    const d = oppRaw;
    const divList: any[] = Array.isArray(divisions) ? divisions : [];
    const buList: any[] = Array.isArray(businessUnits) ? businessUnits : [];
    const deptList: any[] = Array.isArray(departments) ? departments : [];

    // Resolve the opp's division: by lookup id first, then by resolved name.
    const prefDivId = pick(d.DivisionLookup, d.DivisionID);
    let divRow = prefDivId ? divList.find((x) => String(x.ID) === prefDivId) : undefined;
    if (!divRow) {
      const divName = sv(d.DivisionName).toLowerCase();
      if (divName) {
        divRow = divList.find((x) =>
          String(x.Title ?? "").trim().toLowerCase() === divName ||
          String(x.ShortName ?? "").trim().toLowerCase() === divName);
      }
    }

    // Department: resolve by lookup id first, then by name (scoped to the
    // resolved division when we have one — dept names can repeat across
    // divisions).
    const prefDeptId = pick(d.DepartmentLookup, d.DepartmentID);
    let deptRow = prefDeptId ? deptList.find((x) => String(x.ID) === prefDeptId) : undefined;
    if (!deptRow) {
      const deptName = pick(d.DepartmentName, d.Department).toLowerCase();
      if (deptName) {
        const named = deptList.filter((x) =>
          String(x.Title ?? x.Name ?? "").trim().toLowerCase() === deptName);
        deptRow = (divRow && named.find((x) => String(x.DivisionIdLookup ?? "") === String(divRow.ID))) ?? named[0];
      }
    }

    // MIRROR the opp record verbatim (same as its detail page): the division
    // stays blank when the record has none — we never invent one from the
    // department's parent, because that would silently change the BU and
    // Division to values the opportunity never had.
    // Like the detail page, the record's OWN lookup id is authoritative —
    // it is used even before (or without) the catalog list, so a slow or
    // failed catalog fetch can never blank out a transferred value.
    const divId = divRow ? String(divRow.ID) : prefDivId;

    // BU: the division's parent BU wins (authoritative hierarchy). Otherwise
    // fall back to the opp's stored BU text — records persist BU by NAME
    // (CRMBusinessUnitChoice), so a name outside the BU catalog is still the
    // record's real value (the opp detail page shows exactly this text).
    // Prefer the catalog spelling when the name matches a real BU; an
    // unmatched name is safe for the cascade because it maps to no BU id,
    // which leaves the Division dropdown unfiltered.
    let buName = "";
    if (divRow) {
      const parent = buList.find((b) => String(b.ID) === String(divRow.BusinessUnitIdLookup ?? ""));
      buName = String(parent?.Title ?? parent?.ShortName ?? "").trim();
    }
    if (!buName) {
      const candidate = pick(d.BusinessUnitName, d.CRMBusinessUnitChoice, d.BusinessUnit);
      const match = buList.find((b) =>
        String(b.Title ?? b.ShortName ?? b.name ?? "").trim().toLowerCase() === candidate.toLowerCase());
      buName = match
        ? String(match.Title ?? match.ShortName ?? match.name ?? "").trim()
        : candidate;
    }

    // Transfer the department exactly like the opp detail page shows it:
    // the record's OWN Division + Department pair is authoritative and
    // transfers verbatim — even when the org catalog links that department
    // to a different (or no) parent division. The opp detail page renders
    // both values side by side regardless of catalog hierarchy, and the
    // create form must mirror it (user-confirmed after a dept blanked the
    // moment a division was added to the opp). The record's own
    // DepartmentLookup is trusted even when the catalog list hasn't
    // arrived (deptRow undefined).
    const deptId = deptRow ? String(deptRow.ID) : prefDeptId;
    // Dev-only diagnostic for the prefill decision (invaluable when a long-
    // lived tab rides through hot reloads with preserved state).
    if (import.meta.env.DEV) console.debug("[oppPrefill:org]", JSON.stringify({
      lists: { div: divList.length, bu: buList.length, dept: deptList.length },
      raw: { DivisionLookup: d.DivisionLookup, DepartmentLookup: d.DepartmentLookup, BU: d.CRMBusinessUnitChoice },
      resolved: { buName, divId, deptId, deptRowId: deptRow ? String(deptRow.ID) : null },
      ap: orgAppliedRef.current,
    }));
    setFormData(prev => {
      const ap = orgAppliedRef.current;
      // PER-FIELD convergence: each field fills independently when it is
      // still empty or still holds exactly what this effect wrote last time.
      // (An all-or-nothing guard can dead-lock after hot reloads or partial
      // earlier runs — one already-filled field then blocks the other two
      // forever.) A user's hand-picked value never matches these rules, so
      // manual edits stay untouched.
      // Writable when empty, or when it still holds OUR own previous write
      // (so a newer computation may upgrade — or clear — a stale one).
      const writable = (cur: string, last: string | undefined) =>
        !cur || cur === last;
      const next = { ...prev };
      let changed = false;
      // ap must record ONLY the fields THIS effect wrote — snapshotting the
      // whole org state would absorb a hand-picked value, and a later re-run
      // (e.g. a catalog refetch on window refocus) would then treat it as our
      // own stale write and silently revert it.
      const nextAp = { ...(ap ?? {}) };
      if (prev.BusinessUnit !== buName && writable(prev.BusinessUnit, ap?.bu) &&
          (buName || prev.BusinessUnit === ap?.bu)) {
        next.BusinessUnit = buName; nextAp.bu = buName; changed = true;
      }
      if (prev.DivisionID !== divId && writable(prev.DivisionID, ap?.div) &&
          (divId || prev.DivisionID === ap?.div)) {
        next.DivisionID = divId; nextAp.div = divId; changed = true;
      }
      if (deptId && prev.DepartmentID !== deptId && writable(prev.DepartmentID, ap?.dept)) {
        // The record's own Division + Department pair always transfers
        // together (verbatim mirror — targetDiv === divId), regardless of
        // what the catalog says the department's parent is. The catalog
        // belongs-check only guards a division the USER picked by hand,
        // so a transferred department never dangles under a foreign
        // hand-picked division.
        const targetDiv = next.DivisionID;
        const belongs = !targetDiv || targetDiv === divId ||
          String(deptRow?.DivisionIdLookup ?? "") === targetDiv;
        if (belongs) { next.DepartmentID = deptId; nextAp.dept = deptId; changed = true; }
      }
      if (!changed) return prev;
      orgAppliedRef.current = nextAp;
      return next;
    });
  }, [oppRaw, divisions, businessUnits, departments, linkedOppId]);

  // BU persists by NAME, but Divisions link to a BU by id, so resolve the
  // selected BU name → id to cascade the Division (and then Department) pickers.
  const buIdByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of (businessUnits ?? []) as any[]) {
      const name = String(b.Title ?? b.ShortName ?? b.name ?? "").trim();
      if (name) m.set(name, String(b.ID));
    }
    return m;
  }, [businessUnits]);
  const selectedBuId = buIdByName.get(formData.BusinessUnit) ?? "";

  // Divisions are filtered to the chosen BU; Departments to the chosen Division.
  const divOptions: CreatableOption[] = useMemo(() => {
    const opts = ((divisions ?? []) as any[])
      .filter((d) => !selectedBuId || String(d.BusinessUnitIdLookup ?? "") === selectedBuId)
      .map((d) => ({ id: String(d.ID), label: d.Title }));
    // A transferred division id must render even before/without the catalog
    // (the opp record itself is authoritative) — same pattern as the BU
    // picker's "(from opportunity)" append below.
    const cur = formData.DivisionID;
    if (cur && !opts.some((o) => o.id === cur)) {
      const d = oppRaw as Record<string, unknown> | null;
      const name = d && pick(d.DivisionLookup, d.DivisionID) === cur ? sv(d.DivisionName) : "";
      opts.push({ id: cur, label: name || `Division #${cur}` });
    }
    return opts;
  }, [divisions, selectedBuId, formData.DivisionID, oppRaw]);
  const deptOptions: CreatableOption[] = useMemo(() => {
    const opts = ((departments ?? []) as any[])
      .filter((d) => formData.DivisionID
        // Division chosen → its departments.
        ? String(d.DivisionIdLookup ?? "") === formData.DivisionID
        // Division tier hidden → no user-picked division exists; offer the
        // full department catalogue instead of an empty list.
        : !getBusinessRules().showDivision
        ? true
        // No division (opp transferred a bare department) → just that one,
        // so the picker can RENDER the transferred value like the opp page.
        : String(d.ID) === formData.DepartmentID)
      .map((d) => ({ id: String(d.ID), label: d.Title }));
    // Same verbatim append: a transferred department that isn't in the
    // division-filtered list still renders — prefer its catalog Title
    // (it may exist under another division), then the opp record's own
    // resolved name, then a plain #id fallback.
    const cur = formData.DepartmentID;
    if (cur && !opts.some((o) => o.id === cur)) {
      const row = ((departments ?? []) as any[]).find((x) => String(x.ID) === cur);
      const d = oppRaw as Record<string, unknown> | null;
      const name = String(row?.Title ?? "").trim() ||
        (d && pick(d.DepartmentLookup, d.DepartmentID) === cur
          ? pick(d.DepartmentName, d.Department) : "");
      opts.push({ id: cur, label: name || `Department #${cur}` });
    }
    return opts;
  }, [departments, formData.DivisionID, formData.DepartmentID, oppRaw]);
  // Business Units persist by NAME (CRMBusinessUnitChoice), so the select is
  // keyed on the BU name rather than its row id. If the current value came
  // from a linked opportunity whose BU text isn't in the catalog, append it
  // as an option — otherwise the select would render as an empty placeholder
  // even though the value is set (and is what the opp record really stores).
  const buOptions: CreatableOption[] = useMemo(() => {
    const opts = ((businessUnits ?? []) as any[]).map((b: any) => {
      const name = String(b.Title ?? b.ShortName ?? b.name ?? "");
      return { id: name, label: name };
    });
    const cur = formData.BusinessUnit.trim();
    if (cur && !opts.some((o) => o.id === cur)) {
      opts.push({ id: cur, label: `${cur} (from opportunity)` });
    }
    return opts;
  }, [businessUnits, formData.BusinessUnit]);

  const createDivisionOption = async (name: string): Promise<CreatableOption> => {
    if (!selectedBuId) throw new Error("Select a business unit first.");
    const r = await createDivision(name, selectedBuId);
    queryClient.setQueryData(["divisions"], (prev: unknown) => {
      const arr = Array.isArray(prev) ? prev : [];
      return [...arr, { ID: r.id, Title: r.name, ShortName: r.name, BusinessUnitIdLookup: selectedBuId }];
    });
    return { id: String(r.id), label: r.name };
  };
  const createDepartmentOption = async (name: string): Promise<CreatableOption> => {
    // Division tier hidden → new departments hang off the hidden bridge
    // division (resolved server-side) instead of a user-picked one.
    if (!formData.DivisionID && getBusinessRules().showDivision) throw new Error("Select a division first.");
    const divId = formData.DivisionID || await resolveDivisionForSave("", selectedBuId);
    const r = await createDepartment(name, divId);
    queryClient.setQueryData(["departments"], (prev: unknown) => {
      const arr = Array.isArray(prev) ? prev : [];
      return [...arr, { ID: r.id, Title: r.name, DivisionIdLookup: divId }];
    });
    return { id: String(r.id), label: r.name };
  };
  const createBusinessUnitOption = async (name: string): Promise<CreatableOption> => {
    const r = await createBusinessUnit(name);
    queryClient.setQueryData(["businessUnits"], (prev: unknown) => {
      const arr = Array.isArray(prev) ? prev : [];
      return [...arr, { ID: r.id, Title: r.name, ShortName: r.name }];
    });
    return { id: r.name, label: r.name };
  };

  const handleChange = (field: string, value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  // Stable empty rawFields object — a new literal `{}` on every memo recompute
  // would make SchedulePhases.loadTasks think its dep changed and re-run
  // (setting loading=true) every time allocations updates.
  const rawFieldsRef = useRef<Record<string, unknown>>({});

  // Minimal-but-complete ProjectData built from the create-form values so the
  // reused SchedulePhases / BudgetSection components have the context they need.
  const project: ProjectData = useMemo(
    () => ({
      id: createdId,
      name: formData.Title,
      status: "Pre-Con",
      phase: "",
      city: "",
      sector: "",
      value: Number(formData.ApproxContractValue) || 0,
      laborValue: 0,
      company: "",
      bu: "",
      groupId: "",
      targetStart: formData.TargetStartDate,
      targetEnd: formData.TargetCompletionDate,
      actualStart: "",
      actualEnd: "",
      scheduleStart: "",
      scheduleEnd: "",
      closeDate: "",
      bidDate: "",
      probability: 0,
      module: "PMM",
      allocations,
      keyPersonnel: [],
      healthScore: 0,
      healthIssues: [],
      healthChecks: [],
      rawFields: rawFieldsRef.current,
      guidToName: {},
    }),
    [createdId, formData, allocations],
  );

  const reloadTeam = async () => {
    if (!createdId) return;
    setTeamLoading(true);
    try {
      bustCache(`project:team:${createdId}`);
      // Race against a 10 s fallback so the spinner never hangs for the full
      // 90 s fetch timeout on a cold or slow RDS connection.
      const res = await Promise.race([
        getProjectTeam(createdId),
        new Promise<{ team: ProjectTeamMember[]; openRoles: never[] }>(
          (resolve) => setTimeout(() => resolve({ team: [], openRoles: [] }), 10_000),
        ),
      ]);
      setAllocations(mapTeam(res.team));
    } catch {
      /* the team panel surfaces its own errors on next interaction */
    } finally {
      setTeamLoading(false);
    }
  };

  // A brand-new project always starts with an empty team — skip the automatic
  // reloadTeam() so the Team tab shows instantly without a spinner.
  // reloadTeam() is still called when the user manually adds / edits members.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { /* intentional no-op on first create */ }, [createdId]);

  // Validate the Details tab's required fields: flags each missing one for
  // the inline red highlight, toasts ONLY the fields that are actually
  // missing, and scrolls to / focuses the first one. Returns true when all
  // required fields are present. Division is required for a blank project,
  // but a conversion mirrors the opportunity verbatim — an opp with no
  // division (DivisionLookup null) must still convert, or the create is
  // blocked before the copy can run. The backend never requires it (the "0"
  // payload is dropped by the filter).
  const validateDetails = (): boolean => {
    const miss = {
      title: !formData.Title.trim(),
      id: !formData.ERPJobID.trim(),
      division: !formData.DivisionID && !linkedOppId && getBusinessRules().showDivision,
    };
    setMissing(miss);
    if (!miss.title && !miss.id && !miss.division) return true;
    const labels = [
      miss.title && "Project Title",
      miss.id && "Project ID",
      miss.division && "Division",
    ].filter(Boolean) as string[];
    const names = labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
    toast({
      title: "Missing fields",
      description: linkedOppId
        ? `Your opportunity doesn't have ${names} — please fill ${labels.length === 1 ? "it" : "them"} in here before converting.`
        : `${names} ${labels.length === 1 ? "is" : "are"} required — highlighted in red below.`,
      variant: "destructive",
    });
    // Deferred so the Details tab has rendered when we jump back from
    // Additional Details before scrolling to the first missing field.
    setTimeout(() => {
      const el = document.getElementById(miss.title ? "title" : miss.id ? "erpJobId" : "division-field");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (el instanceof HTMLInputElement) el.focus({ preventScroll: true });
    }, 60);
    return false;
  };

  // Title the user explicitly confirmed to duplicate ("Create anyway" on the
  // same-name-different-job prompt). Compared against the CURRENT title so a
  // later rename invalidates the confirmation automatically.
  const dupOkTitleRef = useRef("");
  // Synchronous double-submit guard — isSubmitting state updates async, so a
  // rapid double-click on the toast's "Create anyway" could fire two creates.
  const submitInFlightRef = useRef(false);
  // Toast actions live longer than the render that created them. Calling
  // handleCreate through this ref always submits the LATEST form state (a
  // captured closure would silently create the form as it was at reject time).
  const handleCreateRef = useRef<(e: React.FormEvent) => void>(() => {});

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createdId) return; // already created — guard against double submit
    if (submitInFlightRef.current) return; // a create is already running
    const title = formData.Title.trim();
    const jobId = formData.ERPJobID.trim();
    if (!validateDetails()) {
      // The missing fields live on the Details tab — switch there so the user
      // can see them highlighted instead of staring at Additional Details.
      setActiveTab("details");
      return;
    }

    // Duplicate guards — the backend rejects duplicates too, but a clear
    // client-side message beats a generic API error after a long wait.
    // Title matches are qualified by client/BU/division (shared sameJob
    // voting rules): an agreeing match = possibly the SAME job → block; when
    // every same-titled row conflicts it's a separate job that happens to
    // share the name → allowed after an explicit "Create anyway" step (sent
    // as ConfirmDuplicateTitle; the server gate enforces the same rule).
    const existing = (pmmsData?.data ?? []) as any[];
    const titleMatches = existing.filter(
      (r) => String(r.Title ?? "").trim().toLowerCase() === title.toLowerCase());
    const rowJobSide = (r: any) => ({
      client: String(r.CRMCompanyLookupName ?? r.CompanyName ?? r.CRMCompanyNameChoice ?? r.ClientName ?? ""),
      bu: String(r.CRMBusinessUnitChoice ?? r.BusinessUnitName ?? ""),
      division: String(r.DivisionLookup ?? ""),
    });
    const myJobSide = { client: formData.Company, bu: formData.BusinessUnit, division: formData.DivisionID };
    const dupTitle = titleMatches.find((r) => sameJobFields(myJobSide, rowJobSide(r)));
    if (dupTitle) {
      const conflictId = String(dupTitle.TicketId ?? dupTitle.ID ?? "");
      if (linkedOppId) {
        // Converting an opp → the conflict is almost certainly the project this
        // opp was already converted to. Surface a navigable message instead of
        // a dead-end "choose a different title" error.
        toast({
          title: "This opportunity may already have a project",
          description: `A project named "${title}" already exists as ${conflictId}. If this opportunity was already converted, open that project instead. To create a separate project, change the title above.`,
          action: (
            <ToastAction altText={`Open ${conflictId}`} onClick={() => setLocation(`/project/${conflictId}`)}>
              Open {conflictId}
            </ToastAction>
          ),
          variant: "destructive",
          duration: 12000,
        });
      } else {
        toast({
          title: "Duplicate project title",
          description: `A project named "${title}" already exists (${conflictId}). Choose a different title.`,
          variant: "destructive",
        });
      }
      return;
    }
    // Same name but every existing row is clearly a DIFFERENT job (client /
    // BU / division conflict) — ask once, then resubmit with the confirmation.
    if (titleMatches.length > 0 && dupOkTitleRef.current !== title.toLowerCase()) {
      const conflictId = String(titleMatches[0].TicketId ?? titleMatches[0].ID ?? "");
      toast({
        title: "Same name, different job?",
        description: `A project named "${title}" already exists (${conflictId}) but for a different client, business unit, or division — it looks like a separate job. Create another project with the same name?`,
        action: (
          <ToastAction altText="Create anyway" onClick={() => {
            dupOkTitleRef.current = title.toLowerCase();
            void handleCreateRef.current({ preventDefault: () => {} } as unknown as React.FormEvent);
          }}>
            Create anyway
          </ToastAction>
        ),
        duration: 15000,
      });
      return;
    }
    const dupId = existing.find(
      (r) => String(r.TicketId ?? r.ID ?? "").trim().toLowerCase() === jobId.toLowerCase());
    if (dupId) {
      toast({
        title: "Duplicate project ID",
        description: `Project ID "${jobId}" is already used by "${String(dupId.Title ?? "")}". Choose a different ID.`,
        variant: "destructive",
      });
      return;
    }

    // Date business rules (YYYY-MM-DD strings compare correctly as strings).
    if (formData.TargetStartDate && formData.TargetCompletionDate &&
        formData.TargetCompletionDate < formData.TargetStartDate) {
      toast({ title: "Invalid dates", description: "Target Completion Date must be on or after the Target Start Date.", variant: "destructive" });
      return;
    }
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    setCreationStep("Creating project record…");
    setCreationPct(8);
    startTrickle(72); // keep the bar moving during the slow create API call
    try {
      // Division tier hidden → resolve the hidden bridge division so the
      // record still lands with a connected DivisionLookup chain. A conversion
      // with a transferred division id passes through verbatim.
      const divisionId = await resolveDivisionForSave(formData.DivisionID, selectedBuId);
      const dateVal = (v: string) => v ? `${v}T00:00:00` : "";
      const fields = [
        { FieldName: "Title",                    Value: title },
        // The user-supplied Project ID becomes the record's TicketId verbatim —
        // IDs are mandatory, the backend never auto-generates one.
        { FieldName: "TicketId", Value: jobId },
        // Explicit duplicate-name confirmation — the server gate requires it
        // when a same-titled record exists but is a different job. Control
        // field only; the server strips it before the insert.
        ...(dupOkTitleRef.current === title.toLowerCase() ? [{ FieldName: "ConfirmDuplicateTitle", Value: "1" }] : []),
        { FieldName: "ApproxContractValue",       Value: String(Number(formData.ApproxContractValue) || 0) },
        { FieldName: "DivisionLookup",            Value: String(Number(divisionId) || 0) },
        { FieldName: "DepartmentLookup",         Value: String(Number(formData.DepartmentID) || 0) },
        { FieldName: "CRMBusinessUnitChoice",    Value: formData.BusinessUnit },
        // PMs persist by NAME in core2 (ProjectManagerUser, nvarchar) — there
        // is no PrimaryProjectManager column, so a GUID here would be silently
        // dropped by the live-schema write guard. Translate a picked staff
        // user id to their display name; a verbatim contact name passes as-is.
        { FieldName: "ProjectManagerUser",
          Value: ((users as any[] | undefined)?.find((u: any) => u.id === formData.PrimaryProjectManager)?.name
            ?? formData.PrimaryProjectManager) },
        { FieldName: "TargetStartDate",          Value: dateVal(formData.TargetStartDate) },
        { FieldName: "TargetCompletionDate",     Value: dateVal(formData.TargetCompletionDate) },
        { FieldName: "CRMProjectStatusChoice",   Value: formData.Status || "Pipeline" },
        { FieldName: "Sector",                   Value: formData.Sector },
        { FieldName: "ShortName",                Value: formData.ShortName },
        { FieldName: "ProjectType",              Value: formData.ProjectType },
        { FieldName: "ServiceType",              Value: formData.ServiceType },
        { FieldName: "ContactName",              Value: formData.ContactName },
        // Mandatory-ID policy: the company link is the numeric FK from the
        // picker. Free-text names are rejected server-side, so none is sent —
        // a blank selection simply creates the project without a company.
        ...(companyId ? [{ FieldName: "CRMCompanyLookup", Value: companyId }] : []),
        ...(formData.OwnersRepresentative ? [{ FieldName: "OwnersRepresentative", Value: formData.OwnersRepresentative }] : []),
        // Key personnel carried VERBATIM from the source opportunity — the
        // create form has no fields for these; names persist as display text.
        ...(sv(oppRaw?.BusinessLeadUser) ? [{ FieldName: "BusinessLeadUser", Value: sv(oppRaw?.BusinessLeadUser) }] : []),
        ...(sv(oppRaw?.SeniorProjectManagerUser) ? [{ FieldName: "SeniorProjectManagerUser", Value: sv(oppRaw?.SeniorProjectManagerUser) }] : []),
        ...(sv(oppRaw?.StageActionUsersUser) ? [{ FieldName: "StageActionUsersUser", Value: sv(oppRaw?.StageActionUsersUser) }] : []),
        { FieldName: "Office",                   Value: formData.Office },
        { FieldName: "City",                     Value: formData.City },
        { FieldName: "ContingencyValue",         Value: String(Number(formData.ContingencyValue) || 0) },
        { FieldName: "CloseoutDate",             Value: dateVal(formData.CloseoutDate) },
        // Converting an opportunity: carry over the descriptive/financial
        // fields the form has no inputs for, verbatim. PMM has Description +
        // Comment columns (the opp's Note maps onto Comment); a column absent
        // from the live schema is dropped server-side, so this is safe across
        // tenants with older schemas.
        ...(linkedOppId && oppRaw ? [
          { FieldName: "Description",         Value: sv((oppRaw as Record<string, unknown>).Description) },
          { FieldName: "Comment",             Value: pick((oppRaw as Record<string, unknown>).Note, (oppRaw as Record<string, unknown>).Comment) },
          { FieldName: "LaborContractAmount", Value: sv((oppRaw as Record<string, unknown>).LaborContractAmount) },
        ] : []),
      ].filter(f => f.Value !== "" && f.Value !== "0");

      console.log("[oppCopy] 1. createRecord PMM — linkedOppId:", linkedOppId, "| hasOppRaw:", !!oppRaw, "| fields:", fields.map(f => `${f.FieldName}=${String(f.Value).slice(0, 40)}`));
      let res: any = await createRecord("PMM", fields);
      console.log("[oppCopy] 2. createRecord result — Status:", res?.Status, "| Data.TicketId:", res?.Data?.TicketId, "| Data.ID:", res?.Data?.ID, "| raw keys:", res && typeof res === "object" ? Object.keys(res) : typeof res);

      // ── Simultaneous-create collision recovery ──
      // Multiple users can pass the client duplicate guard in the same
      // second; the server's UPDLOCK gate rejects the losers with an "ID
      // already used" error. When the rejected ID was OUR auto-suggestion
      // (the user never typed their own), silently re-suggest from a fresh
      // record list and retry — up to 3 attempts with a jittered delay, so
      // even a THREE-way collision self-heals (two losers re-suggesting the
      // same next ID collide again; the second retry lands after the sibling
      // loser's row is visible). A user-typed ID that collides keeps the
      // visible error with zero retries.
      if (res?.Status === false && /already used/i.test(String(res?.error ?? "")) &&
          jobId === suggestedIdRef.current) {
        const MAX_ID_RETRIES = 3;
        // Every ID we've already seen collide — the fresh list may still
        // predate a sibling loser's row, so skip past known losers.
        const collided = new Set<string>([jobId]);
        for (let attempt = 1;
             attempt <= MAX_ID_RETRIES && res?.Status === false && /already used/i.test(String(res?.error ?? ""));
             attempt++) {
          try {
            console.log(`[idRetry] auto-suggested ID collided — re-suggesting (attempt ${attempt}/${MAX_ID_RETRIES})`);
            // Jittered backoff desyncs sibling losers so they don't refetch
            // and re-suggest in lockstep on every round.
            await new Promise(r => setTimeout(r, 100 * attempt + Math.random() * 400));
            const fresh = await getModuleRecordsFresh("PMM");
            let nextId = suggestNextId((fresh?.data ?? []) as { TicketId?: unknown; ID?: unknown }[]);
            while (nextId && collided.has(nextId)) nextId = bumpId(nextId);
            if (!nextId) break;
            collided.add(nextId);
            suggestedIdRef.current = nextId;
            const idForState = nextId;
            setFormData(prev => ({ ...prev, ERPJobID: idForState }));
            const retryFields = fields.map(f => f.FieldName === "TicketId" ? { ...f, Value: nextId } : f);
            console.log("[idRetry] retrying create with", nextId);
            res = await createRecord("PMM", retryFields);
          } catch (e) {
            console.warn("[idRetry] retry attempt failed — surfacing last error:", e);
            break;
          }
        }
      }

      if (res?.Status === false) {
        console.warn("[oppCopy] createRecord rejected:", res?.error);
        // Server-side backstop for the "same name, different job" confirm —
        // reached when the local list was stale and the pre-check missed the
        // duplicate. Same one-click confirm as the client-side guard.
        if (res?.code === "DUP_TITLE_DIFFERENT_JOB") {
          toast({
            title: "Same name, different job?",
            description: res?.error || `A project named "${title}" already exists for a different client. Create another with the same name?`,
            action: (
              <ToastAction altText="Create anyway" onClick={() => {
                dupOkTitleRef.current = title.toLowerCase();
                void handleCreateRef.current({ preventDefault: () => {} } as unknown as React.FormEvent);
              }}>
                Create anyway
              </ToastAction>
            ),
            duration: 15000,
          });
          return;
        }
        toast({
          title: "Couldn't create project",
          description: res?.error || "Failed to create project.",
          variant: "destructive",
        });
        return;
      }

      setCreationStep("Saving details…");
      setCreationPct(p => Math.max(p, 76));
      startTrickle(88);
      bustCache("module:PMM");
      await queryClient.invalidateQueries({ queryKey: ["pmm"] });

      const ticketId = res?.Data?.TicketId || res?.Data?.ID || res?.TicketId || res?.ID;
      console.log("[oppCopy] 3. resolved new project ticketId:", ticketId, "| hideSchedule:", hideSchedule);
      if (!ticketId) {
        console.warn("[oppCopy] no ticketId returned — aborting copy, redirecting to /projects");
        toast({ title: "Created, but…", description: "The project was created but no ID came back. Open it from the Projects list.", variant: "destructive" });
        setLocation("/projects");
        return;
      }
      setCreationStep(hideSchedule ? "Finishing up…" : "Warming up schedule…");
      setCreationPct(p => Math.max(p, 82));
      setCreatedId(ticketId);

      // ── Converting an opportunity: copy its schedule + team onto the new
      // project so the wizard opens fully staffed. Everything stays editable —
      // these are ordinary phase/assignment rows created through the exact
      // same endpoints the Schedule editor and Add Team Member modal use.
      // Every step is best-effort: a copy failure never rolls back the
      // created project, it just tells the user what to add manually.
      let copiedTeam = false;
      console.log("[oppCopy] 4. entering copy block — linkedOppId:", linkedOppId, "(copy runs only when truthy)");
      if (linkedOppId) {
        // 0) Stamp the source opportunity as converted. This surfaces in the
        // Opps grid as a distinct "Closed – Won" stage + row colour, and makes
        // clicking the opp open an "already converted" popup that links here to
        // the new project. Best-effort: a failure never blocks the conversion.
        try {
          const stamp = await updateFields(
            linkedOppId,
            [{ FieldName: "CRMOpportunityStatusChoice", Value: "Closed – Won" }],
            { lifecycleModules: ["OPM", "PMM"] },
          );
          if (!stamp.ok) throw new Error(stamp.error || "Could not mark the opportunity as Closed – Won");
          console.log("[oppCopy] 4a. stamped opp", linkedOppId, "as Closed – Won");
        } catch (e) {
          // The project still exists even if the best-effort source stamp
          // fails, so Pipeline Review must at least reflect the new destination.
          notifyLifecycleChanged(["OPM", "PMM"]);
          console.warn("[oppCopy] 4a. failed to stamp opp status (non-fatal):", e);
        }
        // 1) Team FIRST — assign every member BEFORE any schedule exists. Once
        // a phase schedule is present, assignResource validates member dates
        // against its window and silently rejects anyone whose span falls
        // outside it (opp members legitimately extend past the phase window
        // from imported dates). With no schedule yet, dates are free: each
        // member keeps the opp's exact dates and the record's Target End
        // auto-extends to cover them — a faithful mirror. The schedule is
        // copied afterwards (below) and never disturbs existing assignments.
        try {
          console.log("[oppCopy] 5. fetching opp team for", linkedOppId);
          const oppTeam = await getProjectTeam(linkedOppId);
          const allMembers = oppTeam.team ?? [];
          const members = allMembers.filter((m) => m.resourceId);
          // Members without a resource GUID can't be assigned — report them
          // instead of silently dropping them from the copy.
          const failed: string[] = allMembers.filter((m) => !m.resourceId).map((m) => m.name || "(unnamed)");
          const divList: any[] = Array.isArray(divisions) ? divisions : [];
          console.log("[oppCopy] 6. opp team — total:", allMembers.length, "| assignable (has resourceId):", members.length, "| unassignable (no resourceId):", failed, "| divCatalog:", divList.length);
          console.log("[oppCopy] 6b. member summary:", allMembers.map((m) => ({ name: m.name, resourceId: m.resourceId, role: m.role, title: m.title, bu: m.bu, eacHrs: m.eacHrs, start: m.startDate, end: m.endDate })));

          if (members.length > 0) {
            // ── Bulk copy: one HTTP call → two SQL round-trips server-side ──────
            // Replaces the former per-member /assign-resource loop that spent one
            // network + transaction round-trip per person (visible as the slow
            // "Adding X to the team (N/M)…" progress messages).
            setCreationStep(`Copying ${members.length} team member${members.length === 1 ? "" : "s"}…`);
            setCreationPct(p => Math.max(p, 85));
            try {
              console.log("[oppCopy] 7. bulk-copy-team for", members.length, "members");
              const bulkResult = await bulkCopyTeam({
                destProjectId: ticketId,
                members: members.map((m) => {
                  const buKey = String(m.bu ?? "").trim().toLowerCase();
                  const divRow = buKey ? divList.find((x: any) =>
                    String(x.Title ?? "").trim().toLowerCase() === buKey ||
                    String(x.ShortName ?? "").trim().toLowerCase() === buKey) : undefined;
                  return {
                    resourceId: m.resourceId!,
                    name: m.name,
                    role: m.role || null,
                    title: m.title || null,
                    bu: m.bu || null,
                    startDate: sv(m.startDate).slice(0, 10) || null,
                    endDate: sv(m.endDate).slice(0, 10) || null,
                    hours: Math.max(0, Number(m.eacHrs) || 0),
                    divisionId: divRow ? String(divRow.ID) : null,
                  };
                }),
                defaultStart: formData.TargetStartDate,
                defaultEnd: formData.TargetCompletionDate,
              });
              console.log("[oppCopy] 8. bulk-copy-team result:", bulkResult);
              if (!bulkResult.ok) {
                // Whole-batch failure — fall back to per-member so at least
                // some members land on the project rather than none.
                console.warn("[oppCopy] 8. bulk failed, falling back to per-member:", bulkResult.error);
                for (const m of members) {
                  const buKey = String(m.bu ?? "").trim().toLowerCase();
                  const divRow = buKey ? divList.find((x: any) =>
                    String(x.Title ?? "").trim().toLowerCase() === buKey ||
                    String(x.ShortName ?? "").trim().toLowerCase() === buKey) : undefined;
                  const hours = Math.max(0, Number(m.eacHrs) || 0);
                  try {
                    const result = await assignResource({ ProjectID: ticketId, Allocations: [{
                      AllocationStartDate: sv(m.startDate).slice(0, 10) || formData.TargetStartDate,
                      AllocationEndDate: sv(m.endDate).slice(0, 10) || formData.TargetCompletionDate,
                      AssignedTo: m.resourceId, AssignedToName: m.name, ID: 0,
                      PctAllocation: hours, ...(hours > 0 ? { AllocationHour: hours } : {}),
                      ProjectID: ticketId, TemplateID: 0,
                      Title: m.title || null, JobTitleName: m.title || null,
                      ...(divRow ? { DivisionId: String(divRow.ID) } : {}),
                      DivisionName: m.bu || null, Type: "", TypeName: m.role,
                      SoftAllocation: "false", NonChargeable: false,
                    }] });
                    const low = String(result).toLowerCase();
                    if (low.includes("allocationoutofbounds") || low.includes("overlappingallocation") || low.includes("schedulewindow")) {
                      failed.push(m.name);
                    }
                  } catch { failed.push(m.name); }
                }
              } else {
                failed.push(...(bulkResult.failed ?? []));
              }
            } catch (bulkErr) {
              console.error("[oppCopy] 8. bulk-copy-team threw:", bulkErr);
              // Treat as total failure — report all members as failed.
              failed.push(...members.map((m) => m.name));
            }
          }

          const copiedCount = allMembers.length - failed.length;
          copiedTeam = copiedCount > 0;
          console.log("[oppCopy] 9. team copy done — copiedCount:", copiedCount, "| copiedTeam:", copiedTeam, "| failed:", failed);
          if (copiedTeam) {
            setCreationStep("Loading the copied team…");
            setCreationPct(p => Math.max(p, 92));
            try {
              const freshTeam = await getProjectTeam(ticketId, true);
              console.log("[oppCopy] 10. reloaded new project team — members:", freshTeam.team?.length ?? 0);
              setAllocations(mapTeam(freshTeam.team));
            } catch (reErr) { console.warn("[oppCopy] 10x reload team failed (Team tab reloads on interaction):", reErr); }
          }
          if (failed.length > 0) {
            toast({
              title: copiedTeam ? "Team partially copied" : "Team not copied",
              description: `${copiedCount} of ${allMembers.length} members copied. Couldn't add: ${failed.join(", ")} — add them from the Team tab.`,
              variant: "destructive",
            });
          }
        } catch (teamErr) {
          console.error("[oppCopy] TEAM COPY FAILED (outer):", teamErr);
          toast({
            title: "Team not copied",
            description: "The project was created, but the opportunity's team couldn't be copied. Add members from the Team tab.",
            variant: "destructive",
          });
        }

        // 2) Schedule — copy the opportunity's phases AFTER the team is in
        // place. createSchedule only writes PMMTasks; it never validates or
        // disturbs the member assignments made above, so every member keeps
        // the exact dates copied from the opp.
        console.log("[oppCopy] 11. schedule copy — hideSchedule:", hideSchedule, "(skipped when true)");
        if (!hideSchedule) {
          try {
            setCreationStep("Copying schedule from the opportunity…");
            setCreationPct(p => Math.max(p, 94));
            bustCache(`project:tasks:${linkedOppId}`);
            console.log("[oppCopy] 12. fetching opp task-data for", linkedOppId);
            const oppTasks = await getTaskData(linkedOppId, "0") as any;
            // task-data sometimes arrives wrapped ({Data:[...]}) — mirror the
            // unwrap the schedule editor's own loadTasks uses.
            const rows: any[] = Array.isArray(oppTasks)
              ? oppTasks
              : (oppTasks?.Data ?? oppTasks?.data ?? []);
            console.log("[oppCopy] 13. opp task-data — isArray:", Array.isArray(oppTasks), "| shape:", oppTasks && typeof oppTasks === "object" && !Array.isArray(oppTasks) ? Object.keys(oppTasks) : "array", "| rows:", rows.length, "| titles:", rows.map((t: any) => t.Title));
            const lcId = sv((oppRaw as Record<string, unknown> | null)?.ProjectLifeCycleLookup) || "0";
            if (rows.length > 0) {
              const schedulePayload = {
                TicketID: ticketId,
                ProjectLifecycleID: lcId,
                ProjectScheduleExists: false,
                TargetStartDate: "0001-01-01T00:00:00",
                TargetCompletionDate: "0001-01-01T00:00:00",
                Tasks: rows.map((t: any, i: number) => ({
                  ID: -(i + 1),
                  Title: t.Title,
                  StartDate: t.StartDate,
                  DueDate: t.DueDate,
                  Status: t.Status || "Not Started",
                  PercentComplete: t.PercentComplete ?? 0,
                  ItemOrder: t.ItemOrder ?? i + 1,
                  TicketId: ticketId,
                  AssignedTo: "",
                  isSelected: true,
                  StageStep: t.StageStep ?? t.ItemOrder ?? i + 1,
                })),
              };
              console.log("[oppCopy] 14. POST createSchedule — lifecycleId:", lcId, "| taskCount:", schedulePayload.Tasks.length, "| payload:", JSON.stringify(schedulePayload).slice(0, 500));
              const schedRes = await createSchedule(schedulePayload);
              console.log("[oppCopy] 15. createSchedule OK — response:", typeof schedRes === "string" ? String(schedRes).slice(0, 300) : JSON.stringify(schedRes).slice(0, 300));
            } else {
              console.warn("[oppCopy] 14b. NO schedule rows to copy — opp has no phases, skipping createSchedule");
            }
          } catch (e) {
            console.error("[oppCopy] SCHEDULE COPY FAILED:", e);
            toast({
              title: "Schedule not copied",
              description: `The project was created, but the opportunity's schedule couldn't be copied${e instanceof Error && e.message ? ` (${e.message.slice(0, 120)})` : ""}. Set it up in the Schedule tab.`,
              variant: "destructive",
            });
          }
        }
      } else {
        console.log("[oppCopy] 4b. no linkedOppId — this is a blank project, nothing to copy");
      }

      // Pre-warm the detail + schedule caches AFTER the copy steps — both
      // createSchedule and assignResource bust the "project:" prefix, and
      // cached() re-inserts whatever a fetch resolves with, so a pre-copy
      // warm-up would pin a stale (no-lifecycle, no-team) snapshot for the
      // full TTL and silently break phase-date editing on the fresh project.
      bustCache(`project:details:${ticketId}`);
      void getProjectDetails(ticketId);
      if (!hideSchedule) void getTaskData(ticketId, "0").catch(() => {});
      stopTrickle();
      setCreationPct(100);
      setCreationStep("Ready!");
      // Brief pause so the user sees 100% before the overlay fades
      await new Promise((r) => setTimeout(r, 320));
      toast({
        title: "Project created",
        description: linkedOppId
          ? "Everything the opportunity had was carried over — review and adjust anything below."
          : hideSchedule
            ? "Now set up the team and business unit."
            : "Now set up the schedule, team and business unit.",
      });
      // Always land on Schedule first (when the schedule step exists) so the
      // user reviews the carried-over schedule before moving on to the team.
      setActiveTab(hideSchedule ? "team" : "schedule");
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Failed to create project", variant: "destructive" });
    } finally {
      submitInFlightRef.current = false;
      stopTrickle();
      setIsSubmitting(false);
      setCreationStep("");
      setCreationPct(0);
    }
  };
  // Keep the ref pointing at THIS render's handleCreate (fresh form state).
  handleCreateRef.current = handleCreate;

  // When the company's settings hide the phase schedule ("Without schedule"
  // display modes), the wizard skips the Schedule step entirely — mirrors the
  // project detail page, which hides its schedule section under the same rule.
  // "schedule-no-grid" keeps schedules (dates-only display), so it keeps the step.
  const hideSchedule = getBusinessRules().projectDisplayMode !== "full"
    && getBusinessRules().projectDisplayMode !== "schedule-no-grid";

  const TABS: { key: TabKey; label: string; icon: React.ElementType; postCreate?: boolean }[] = [
    { key: "details",    label: "Details",            icon: FileText },
    { key: "additional", label: "Additional Details", icon: ClipboardList },
    ...(hideSchedule ? [] : [{ key: "schedule" as TabKey, label: "Schedule", icon: CalendarRange, postCreate: true }]),
    { key: "team",       label: "Team",               icon: Users,         postCreate: true },
  ];

  const existingRefs: ExistingAllocationRef[] = allocations.map((a) => ({
    personId: a.resourceId || "",
    bu: a.bu,
    role: a.role,
    title: a.title,
    hours: a.eacHrs || 0,
  }));

  // Wizard step navigation — every tab gets Back / Next, and the final tab
  // offers the finish action instead of a persistent "Open Full Project" bar.
  const tabIdx = TABS.findIndex((t) => t.key === activeTab);
  const prevTab = tabIdx > 0 ? TABS[tabIdx - 1] : null;
  const nextTab = tabIdx < TABS.length - 1 ? TABS[tabIdx + 1] : null;

  const WizardNav = () => (
    <div className="flex items-center justify-between gap-3 pt-6 mt-2 border-t border-border">
      {prevTab ? (
        <Button variant="outline" type="button" onClick={() => setActiveTab(prevTab.key)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> {prevTab.label}
        </Button>
      ) : <span />}
      {nextTab ? (
        <Button type="button" onClick={() => setActiveTab(nextTab.key)}>
          Next: {nextTab.label} <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      ) : (
        <Button type="button" onClick={() => setLocation(`/project/${createdId}`)}>
          Finish &amp; Open Project <Check className="h-4 w-4 ml-2" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6 relative">
      {/* Creation progress overlay — shown while handleCreate runs */}
      {isSubmitting && (
        <CreationProgressOverlay entity="project" step={creationStep} pct={creationPct} />
      )}
      {/* Blocking overlay while the opportunity record loads (fetch path only
          — the seed path pre-fills instantly and never shows this). Without
          it the form renders empty with a tiny "Loading…" line and users
          start typing into fields that are about to be pre-filled. Failed /
          timed-out fetches drop the overlay and show the inline Retry line. */}
      {linkedOppId && !createdId && oppStatus === "loading" && (
        <div style={{ position: "fixed", inset: 0, zIndex: Z.PAGE_OVERLAY, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="bg-card border border-border rounded-xl shadow-2xl px-8 py-7 flex flex-col items-center gap-3 text-center" style={{ maxWidth: 380 }}>
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            <div className="font-semibold text-foreground">Converting opportunity {linkedOppId}…</div>
            <div className="text-sm text-muted-foreground">Loading the opportunity record and pre-filling the form. This only takes a moment.</div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-4">
        {/* When converting a linked opportunity, back returns to THAT opp's
            detail page — landing on the generic projects list loses context. */}
        <Button variant="outline" size="icon" asChild>
          <Link href={linkedOppId ? `/project/${encodeURIComponent(linkedOppId)}` : "/projects"}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">New Project</h1>
          <p className="text-muted-foreground mt-1">
            {createdId
              ? (hideSchedule ? "Complete the full setup below — team." : "Complete the full setup below — schedule and team.")
              : (hideSchedule
                ? "Start with the basics. After you create the project you can set up the team."
                : "Start with the basics. After you create the project you can set up the schedule and team.")}
          </p>
        </div>
        {createdId && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 text-emerald-600 px-3 py-1.5 text-sm font-semibold">
            <Check className="h-4 w-4" /> {createdId}
          </span>
        )}
      </div>

      {/* Tab bar — equal partitions (Schedule drops out when the company's
          settings hide it); Schedule/Team lock until created, Additional
          Details is always reachable (pre-creation step 2). */}
      <div className={`grid ${TABS.length === 3 ? "grid-cols-3" : "grid-cols-4"} gap-2 border-b border-border pb-3`}>
        {TABS.map((t) => {
          const locked = !!t.postCreate && !createdId;
          const active = activeTab === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              disabled={locked}
              onClick={() => !locked && setActiveTab(t.key)}
              className={[
                "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted",
                locked ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              {(t.key === "details" || t.key === "additional") && createdId && <Check className="h-3.5 w-3.5 text-emerald-400" />}
            </button>
          );
        })}
      </div>

      {/* DETAILS */}
      {activeTab === "details" && (
        <Card>
          <form onSubmit={handleCreate}>
            <CardContent className="space-y-6 pt-6">
              {/* Link from existing opportunity — optional, auto-fills fields below */}
              <div className="space-y-2">
                <Label>Link from Opportunity <span className="text-muted-foreground text-xs font-normal">(optional — auto-fills fields below)</span></Label>
                {linkedOppId ? (
                  /* Linked opp — show a read-only badge, no Radix involvement */
                  <div className="flex items-center justify-between border rounded-md px-3 py-2 bg-muted/40 min-h-10">
                    <span className="text-sm truncate">
                      {oppRaw
                        ? `${String(oppRaw.Title ?? linkedOppId)}  ·  ${linkedOppId}`
                        : oppStatus === "loading" ? `Loading ${linkedOppId}…` : linkedOppId}
                    </span>
                    {!createdId && (
                      <button
                        type="button"
                        className="ml-2 text-muted-foreground hover:text-foreground text-lg leading-none"
                        onClick={() => { setLinkedOppId(""); setOppRaw(null); setOppStatus("idle"); }}
                        title="Unlink opportunity"
                      >×</button>
                    )}
                  </div>
                ) : (
                  <OppSearchSelect
                    value={linkedOppId}
                    onChange={setLinkedOppId}
                    disabled={!!createdId}
                    placeholder="Pick an opportunity to pre-fill fields…"
                    options={((opmsData?.data ?? []) as any[]).map((o: any) => {
                      const id = String(o.TicketId ?? o.ID ?? "");
                      const title = String(o.Title ?? id);
                      return { id, label: id && id !== title ? `${title} · ${id}` : title };
                    })}
                  />
                )}
                {linkedOppId && oppStatus === "loading" && (
                  <p className="text-xs text-muted-foreground">Loading opportunity details…</p>
                )}
                {linkedOppId && oppStatus === "loaded" && (
                  <p className="text-xs text-emerald-500">✓ Fields pre-filled from opportunity — review and adjust before creating</p>
                )}

                {linkedOppId && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug") && (
                  <pre className="text-[10px] text-muted-foreground bg-muted/40 border rounded-md p-2 whitespace-pre-wrap break-all">
                    {JSON.stringify({
                      build: BUILD_TAG,
                      oppStatus,
                      oppKeys: oppRaw ? {
                        OwnerName: (oppRaw as Record<string, unknown>).OwnerName ?? null,
                        ProjectManagerUser: (oppRaw as Record<string, unknown>).ProjectManagerUser ?? null,
                        DepartmentLookup: (oppRaw as Record<string, unknown>).DepartmentLookup ?? null,
                        DepartmentName: (oppRaw as Record<string, unknown>).DepartmentName ?? null,
                        DivisionLookup: (oppRaw as Record<string, unknown>).DivisionLookup ?? null,
                        CRMBusinessUnitChoice: (oppRaw as Record<string, unknown>).CRMBusinessUnitChoice ?? null,
                      } : null,
                      form: {
                        PM: formData.PrimaryProjectManager,
                        BU: formData.BusinessUnit,
                        Div: formData.DivisionID,
                        Dept: formData.DepartmentID,
                      },
                      catalogs: {
                        divisions: Array.isArray(divisions) ? divisions.length : String(divisions),
                        departments: Array.isArray(departments) ? departments.length : String(departments),
                        businessUnits: Array.isArray(businessUnits) ? businessUnits.length : String(businessUnits),
                        users: Array.isArray(users) ? users.length : String(users),
                      },
                    }, null, 1)}
                  </pre>
                )}
                {linkedOppId && (oppStatus === "failed" || oppStatus === "notfound") && (
                  <p className="text-xs text-destructive">
                    {oppStatus === "notfound"
                      ? "Couldn't find that opportunity — fields were not pre-filled."
                      : "Couldn't load the opportunity — fields were not pre-filled."}{" "}
                    <button type="button" className="underline font-medium" onClick={retryOppFetch}>
                      Retry
                    </button>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Project Title <span className="text-destructive">*</span></Label>
                <Input
                  id="title"
                  placeholder="Enter project title"
                  value={formData.Title}
                  disabled={!!createdId}
                  className={missing.title ? "border-destructive focus-visible:ring-destructive" : undefined}
                  onChange={(e) => { if (e.target.value.trim()) clearMissing("title"); handleChange("Title", e.target.value); }}
                />
                {missing.title && (
                  <p className="text-xs text-destructive font-medium">Project Title is required.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="erpJobId">Project ID <span className="text-destructive">*</span></Label>
                <Input
                  id="erpJobId"
                  placeholder="e.g. JOB-2025-001"
                  value={formData.ERPJobID}
                  disabled={!!createdId}
                  className={missing.id ? "border-destructive focus-visible:ring-destructive" : undefined}
                  onChange={(e) => { if (e.target.value.trim()) clearMissing("id"); handleChange("ERPJobID", e.target.value); }}
                />
                {missing.id && (
                  <p className="text-xs text-destructive font-medium">Project ID is required.</p>
                )}
                {/* Shown only while the value is still our auto-suggestion —
                    it disappears the moment the user edits the field. Muted,
                    not red: this is a hint, and red made it read as an error. */}
                {!createdId && !!formData.ERPJobID && formData.ERPJobID === suggestedIdRef.current && (
                  <p className="text-xs text-muted-foreground">
                    Pre-filled based on your most recent Project ID — feel free to edit it.
                  </p>
                )}
              </div>

              {/* Contract designation — Pipeline (committed, no contract) vs
                  Active (contracted). Required when converting an opportunity
                  so nothing lands as Active without a signed contract. */}
              <div className="space-y-2">
                <Label>Contract Status <span className="text-destructive">*</span></Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    { v: "Pipeline", title: "Pipeline", desc: "Committed — no contract signed yet" },
                    { v: "Active",   title: "Active",   desc: "Contracted — signed and under contract" },
                  ].map(o => (
                    <button
                      key={o.v}
                      type="button"
                      disabled={!!createdId}
                      onClick={() => handleChange("Status", o.v)}
                      className={`rounded-md border px-4 py-3 text-left transition-colors ${
                        formData.Status === o.v
                          ? "border-primary bg-primary/10"
                          : "border-input hover:bg-muted/40"
                      }`}
                    >
                      <div className="text-sm font-semibold flex items-center gap-2">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${o.v === "Active" ? "bg-primary" : "bg-blue-500"}`} />
                        {o.title}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{o.desc}</div>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  A project stays in Pipeline until the contract is signed. You can change this later from the Status field on the project page.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="value">Contract Value</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                    <Input
                      id="value"
                      type="number"
                      placeholder="0"
                      className="pl-8"
                      value={formData.ApproxContractValue}
                      disabled={!!createdId}
                      onChange={(e) => handleChange("ApproxContractValue", e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pm">Project Manager</Label>
                  {/* PersonSearchSelect filters the list as you type — much
                      easier than scrolling hundreds of names.
                      extraItem handles the case where the PM name came from a
                      linked opportunity and isn't a staff user: it injects a
                      synthetic entry so the picker shows the name instead of
                      a blank placeholder. Ignore empty onChange fires (same
                      guard as the old Radix Select — no legitimate empty
                      selection exists). */}
                  <PersonSearchSelect
                    options={(users ?? []) as { id: string; name: string }[]}
                    value={formData.PrimaryProjectManager}
                    onChange={(v) => { if (v) handleChange("PrimaryProjectManager", v); }}
                    disabled={!!createdId}
                    placeholder="Select PM"
                    clearable
                    extraItem={
                      formData.PrimaryProjectManager &&
                      !(users as any[] | undefined)?.some((u: any) => u.id === formData.PrimaryProjectManager)
                        ? { id: formData.PrimaryProjectManager, name: `${formData.PrimaryProjectManager} (from opportunity)` }
                        : undefined
                    }
                  />
                </div>

                {getBusinessRules().showBusinessUnit && (
                <div className="space-y-2">
                  <Label htmlFor="bu">Business Unit</Label>
                  <CreatableSelect
                    value={formData.BusinessUnit}
                    /* Only cascade-clear Division/Department when the BU value
                       actually changes to a real value. Ignore empty fires (a
                       Radix controlled Select emits onValueChange("") on native
                       <form> reset and during the mount race) and no-op same-
                       value fires — either would wipe the prefilled children. */
                    onValueChange={(v) => setFormData((p) => (!v || v === p.BusinessUnit ? p : { ...p, BusinessUnit: v, DivisionID: "", DepartmentID: "" }))}
                    disabled={!!createdId}
                    loading={businessUnitsLoading}
                    placeholder="Select Business Unit"
                    addLabel="Add new business unit"
                    newPlaceholder="New business unit name"
                    options={buOptions}
                    onCreate={createBusinessUnitOption}
                  />
                </div>
                )}

                {getBusinessRules().showDivision && (
                <div
                  id="division-field"
                  className={missing.division
                    ? "space-y-2 rounded-md ring-2 ring-destructive/70 ring-offset-2 ring-offset-background"
                    : "space-y-2"}
                >
                  <Label htmlFor="division">Division {!linkedOppId && <span className="text-destructive">*</span>}</Label>
                  <CreatableSelect
                    value={formData.DivisionID}
                    /* Only cascade-clear Department when Division changes to a
                       real value; ignore empty and no-op fires so they can't
                       wipe the child. */
                    onValueChange={(v) => { if (v) clearMissing("division"); setFormData((p) => (!v || v === p.DivisionID ? p : { ...p, DivisionID: v, DepartmentID: "" })); }}
                    disabled={!!createdId}
                    loading={divisionsLoading}
                    placeholder="Select Division"
                    addLabel="Add new division"
                    newPlaceholder="New division name"
                    options={divOptions}
                    onCreate={createDivisionOption}
                  />
                  {missing.division && (
                    <p className="text-xs text-destructive font-medium">Division is required — select one to continue.</p>
                  )}
                </div>
                )}

                {getBusinessRules().showDepartment && (
                <div className="space-y-2">
                  <Label htmlFor="department">Department</Label>
                  <CreatableSelect
                    value={formData.DepartmentID}
                    /* Ignore empty fires (mount-race correction) — there is no
                       empty option, so "" is always spurious and would wipe the
                       prefilled department. */
                    onValueChange={(v) => { if (v) handleChange("DepartmentID", v); }}
                    disabled={!!createdId || (getBusinessRules().showDivision && !formData.DivisionID && !formData.DepartmentID)}
                    loading={departmentsLoading}
                    placeholder={formData.DivisionID || formData.DepartmentID || !getBusinessRules().showDivision ? "Select Department" : "Select a division first"}
                    addLabel="Add new department"
                    newPlaceholder="New department name"
                    options={deptOptions}
                    onCreate={createDepartmentOption}
                  />
                </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="start">Target Start Date</Label>
                  <DateField id="start" value={formData.TargetStartDate} disabled={!!createdId} onChange={(v) => handleChange("TargetStartDate", v)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="end">Target Completion Date</Label>
                  <DateField id="end" value={formData.TargetCompletionDate} disabled={!!createdId} onChange={(v) => handleChange("TargetCompletionDate", v)} />
                </div>
              </div>

            </CardContent>
            <div className="bg-muted/30 border-t px-6 py-4 flex justify-end gap-3">
              <Button variant="outline" type="button" asChild>
                <Link href="/projects">Cancel</Link>
              </Button>
              {createdId ? (
                <Button type="button" onClick={() => setActiveTab("additional")}>
                  Additional Details <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                /* Gate on required fields HERE, not just at Create — bouncing
                   the user to Additional Details and back to a red Details
                   page was the old (confusing) behavior. */
                <Button type="button" onClick={() => { if (validateDetails()) setActiveTab("additional"); }}>
                  Next: Additional Details <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}

      {/* ADDITIONAL DETAILS */}
      {activeTab === "additional" && (
        <Card>
          <form onSubmit={handleCreate}>
            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <CreatableSelect
                    value={formData.Status}
                    onValueChange={(v) => handleChange("Status", v)}
                    disabled={!!createdId}
                    placeholder="Select status"
                    addLabel="Add custom status"
                    newPlaceholder="Status name"
                    options={statusOpts}
                    onCreate={async (name) => ({ id: name, label: name })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sector">Sector</Label>
                  <CreatableSelect
                    value={formData.Sector}
                    onValueChange={(v) => handleChange("Sector", v)}
                    disabled={!!createdId}
                    placeholder="Select sector"
                    addLabel="Add custom sector"
                    newPlaceholder="e.g. Aviation, Marine…"
                    options={sectorOpts}
                    onCreate={async (name) => ({ id: name, label: name })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="shortname">Short Name</Label>
                  <Input id="shortname" placeholder="Abbreviated project name" value={formData.ShortName} disabled={!!createdId} onChange={(e) => handleChange("ShortName", e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="projecttype">Project Type</Label>
                  <CreatableSelect
                    value={formData.ProjectType}
                    onValueChange={(v) => handleChange("ProjectType", v)}
                    disabled={!!createdId}
                    placeholder="Select project type"
                    addLabel="Add custom type"
                    newPlaceholder="e.g. Adaptive Reuse…"
                    options={projectTypeOpts}
                    onCreate={async (name) => ({ id: name, label: name })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="servicetype">Service Type</Label>
                  <CreatableSelect
                    value={formData.ServiceType}
                    onValueChange={(v) => handleChange("ServiceType", v)}
                    disabled={!!createdId}
                    placeholder="Select service type"
                    addLabel="Add custom service type"
                    newPlaceholder="e.g. Inspection Services…"
                    options={serviceTypeOpts}
                    onCreate={async (name) => ({ id: name, label: name })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company">Client Company</Label>
                  <CompanySearchSelect
                    value={companyId}
                    onChange={(id, label) => { setCompanyId(id); handleChange("Company", label); }}
                    disabled={!!createdId}
                    hintName={formData.Company}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contact">Client Contact</Label>
                  <Input id="contact" placeholder="Client contact person" value={formData.ContactName} disabled={!!createdId} onChange={(e) => handleChange("ContactName", e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ownersRep">Owner's Representative</Label>
                  <Input id="ownersRep" placeholder="Owner's representative" value={formData.OwnersRepresentative} disabled={!!createdId} onChange={(e) => handleChange("OwnersRepresentative", e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="office">Office</Label>
                  <Input id="office" placeholder="Office location" value={formData.Office} disabled={!!createdId} onChange={(e) => handleChange("Office", e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input id="city" placeholder="Project city" value={formData.City} disabled={!!createdId} onChange={(e) => handleChange("City", e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contingency">Contingency</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                    <Input id="contingency" type="number" placeholder="0" className="pl-8" value={formData.ContingencyValue} disabled={!!createdId} onChange={(e) => handleChange("ContingencyValue", e.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="closeout">Closeout Date</Label>
                  <DateField id="closeout" value={formData.CloseoutDate} disabled={!!createdId} onChange={(v) => handleChange("CloseoutDate", v)} />
                </div>

              </div>
            </CardContent>
            <div className="bg-muted/30 border-t px-6 py-4 flex justify-between gap-3">
              <Button variant="outline" type="button" onClick={() => setActiveTab("details")}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              {createdId ? (
                <Button type="button" onClick={() => setActiveTab(hideSchedule ? "team" : "schedule")}>
                  Continue to {hideSchedule ? "Team" : "Schedule"} <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Create Project
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}

      {/* SCHEDULE */}
      {activeTab === "schedule" && createdId && !hideSchedule && (
        <Card>
          <CardContent className="pt-6">
            <SchedulePhases
              ticketId={createdId}
              module="PMM"
              project={project}
              canEdit
              isAdmin={user?.isAdmin !== false}
              onRefresh={() => { /* no auto-advance — user clicks Next: Team when ready */ }}
            />
            {/* Schedule is optional at creation — "skip" removes all saved
                phase rows and unassigns the lifecycle, leaving the section
                completely blank. SchedulePhases saves every edit immediately,
                so skipping also clears any dates already saved this session.
                On failure the user stays here so they never leave believing
                the schedule was removed. */}
            <div className="flex justify-end pt-4">
              <Button variant="ghost" type="button" className="text-muted-foreground" disabled={skippingSched}
                onClick={async () => {
                  if (!createdId) return;
                  try {
                    setSkippingSched(true);
                    await clearScheduleEntirely(createdId);
                    toast({ title: "Schedule skipped", description: "Set up the schedule anytime from the project page." });
                  } catch (e) {
                    toast({ title: "Couldn't skip the schedule", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
                    return;
                  } finally {
                    setSkippingSched(false);
                  }
                  setActiveTab("team");
                }}>
                {skippingSched
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Skipping schedule…</>
                  : "Skip for now — set up the schedule later"}
              </Button>
            </div>
            <WizardNav />
          </CardContent>
        </Card>
      )}

      {/* TEAM */}
      {activeTab === "team" && createdId && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Team</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {allocations.length > 0 && (
                  <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                    <button type="button" title="Card view"
                      onClick={() => { setTeamViewMode("card"); localStorage.setItem("wizard:teamView", "card"); }}
                      style={{ padding: "5px 8px", background: teamViewMode === "card" ? "var(--accent)" : "transparent", border: "none", borderRight: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", color: teamViewMode === "card" ? "var(--accent-foreground)" : "var(--muted-foreground)" }}>
                      <LayoutGrid size={15} />
                    </button>
                    <button type="button" title="List view"
                      onClick={() => { setTeamViewMode("list"); localStorage.setItem("wizard:teamView", "list"); }}
                      style={{ padding: "5px 8px", background: teamViewMode === "list" ? "var(--accent)" : "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: teamViewMode === "list" ? "var(--accent-foreground)" : "var(--muted-foreground)" }}>
                      <Table2 size={15} />
                    </button>
                  </div>
                )}
                <Button type="button" onClick={() => setTeamModalOpen(true)}>
                  <UserPlus className="h-4 w-4 mr-2" /> Add Team Member
                </Button>
              </div>
            </div>
            {teamLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading team…
              </div>
            ) : allocations.length === 0 ? (
              <div className="text-center text-muted-foreground py-10 border border-dashed rounded-lg">
                No team members yet. Click <span className="font-medium text-foreground">Add Team Member</span> to assign someone.
              </div>
            ) : teamViewMode === "card" ? (
              <TeamMemberList
                allocations={allocations}
                onEdit={(a) => setEditAllocPerson({ name: a.name, role: a.role, pct: a.pct, resourceId: a.resourceId })}
                searchQuery=""
                canEdit
                projectId={createdId}
                scheduleStart={project.scheduleStart}
                scheduleEnd={project.scheduleEnd}
                onReload={reloadTeam}
              />
            ) : (
              <WizardTeamListView
                allocations={allocations}
                onEdit={(a) => setEditAllocPerson({ name: a.name, role: a.role, pct: a.pct, resourceId: a.resourceId })}
              />
            )}
            <WizardNav />
          </CardContent>
        </Card>
      )}

      {teamModalOpen && createdId && (
        <AddTeamMemberModal
          open={teamModalOpen}
          onClose={() => setTeamModalOpen(false)}
          projectId={createdId}
          module="PMM"
          projectName={formData.Title}
          projectStartDate={formData.TargetStartDate}
          projectEndDate={formData.TargetCompletionDate}
          existingAllocations={existingRefs}
          onAssigned={() => {
            setTeamModalOpen(false);
            void reloadTeam();
          }}
        />
      )}

      {editAllocPerson && createdId && (
        <EditAllocationModal
          person={editAllocPerson}
          projectId={createdId}
          projectName={formData.Title}
          onClose={() => setEditAllocPerson(null)}
          onSaved={() => {
            setEditAllocPerson(null);
            void reloadTeam();
          }}
          noDatesDescription={hideSchedule
            ? "Hours can only be edited once the schedule has phase dates. Finish creating the project now — you can edit hours anytime from the Team section inside the record."
            : "Hours can only be edited once the schedule has phase dates. Set the dates in the Schedule step, or finish creating the project now — you can edit hours anytime from the Team section inside the record."}
          {...(hideSchedule ? {} : {
            onSetupSchedule: () => setActiveTab("schedule"),
            setupScheduleLabel: "Set dates in the Schedule step →",
          })}
        />
      )}
    </div>
  );
}
