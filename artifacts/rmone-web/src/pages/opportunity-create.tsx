import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDivisions, getDepartments, getBusinessUnits, getFieldOptions, getProjectTeam,
  getProjectDetails, getTaskData, getModuleRecords, getModuleRecordsFresh, getCompanyContacts,
  createRecord, createDivision, createDepartment, createBusinessUnit, updateFields,
  bustCache, peekCached, notifyLifecycleChanged, type ProjectTeamMember,
} from "@/lib/api";
import { readConvertSeed } from "@/lib/convertSeed";
import { ToastAction } from "@/components/ui/toast";
import { CreatableSelect, type CreatableOption } from "@/components/CreatableSelect";
import { CompanySearchSelect } from "@/components/CompanySearchSelect";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Loader2, Save, Check, Users,
  FileText, UserPlus, ArrowRight, CalendarRange,
  LayoutGrid, Table2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  SchedulePhases, TeamMemberList, WizardTeamListView, clearScheduleDates, clearScheduleEntirely,
  type ProjectData, type Allocation,
} from "@/pages/project-detail";
import { AddTeamMemberModal, type ExistingAllocationRef } from "@/components/AddTeamMemberModal";
import { getBusinessRules, getDisplayModeFor, useBusinessRulesVersion } from "@/lib/businessRules";
import { resolveDivisionForSave } from "@/lib/orgHierarchy";
import { EditAllocationModal, type EditAllocPerson } from "@/components/EditAllocationModal";
import DateField from "@/components/DateField";
import CreationProgressOverlay from "@/components/CreationProgressOverlay";
import { Z } from "@/lib/zLayers";

type TabKey = "details" | "schedule" | "team";

// Derive the next sequential ID from an existing record list.
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

export default function OpportunityCreate() {
  useBusinessRulesVersion(); // re-render when admin changes BU/Dept visibility
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  // Users (canEdit=false) may not create records — redirect to home.
  useEffect(() => { if (user?.canEdit === false) setLocation("/"); }, [user, setLocation]);
  const queryClient = useQueryClient();

  const [isSubmitting, setIsSubmitting] = useState(false);
  // Required fields the last Create attempt found empty — drives the inline
  // red highlights (a destructive toast alone proved too easy to miss).
  const [missing, setMissing] = useState<{ title?: boolean; id?: boolean; division?: boolean }>({});
  const clearMissing = (k: "title" | "id" | "division") =>
    setMissing((m) => (m[k] ? { ...m, [k]: false } : m));
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
  // (schedule / team) writes rows that attach to it, so they stay locked
  // until this is set.
  const [createdId, setCreatedId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabKey>("details");
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

  // Force-fresh — suggestNextId and the duplicate guard must never run on a
  // list that predates a record another user/session just created. Plain
  // getModuleRecords would serve the warm client cache (or a sibling
  // worker's stale server cache) even with staleTime:0.
  const { data: opmsData } = useQuery({ queryKey: ["opm"], queryFn: () => getModuleRecordsFresh("OPM"), staleTime: 0, refetchOnMount: "always" });

  const [formData, setFormData] = useState({
    Title: "",
    ERPJobID: "",
    RequestCategory: "",
    ApproxContractValue: "",
    SuccessChance: "",
    CRMOpportunityStatusChoice: "",
    CRMBusinessUnitChoice: "",
    DivisionID: "",
    DepartmentID: "",
    Sector: "",
    Company: "",
    ContactName: "",
    OwnersRepresentative: "",
    Office: "",
    StreetAddress1: "",
    City: "",
    State: "",
    TargetStartDate: "",
    TargetCompletionDate: "",
  });

  // ── Lead → Opportunity conversion ──
  // Arriving via /opportunity/create?fromLead=<LEM id> (the lead detail page's
  // "To Opportunity" action) pre-fills the form from the lead record. After a
  // successful create, the source lead is stamped LeadStatus="Converted" (the
  // exact sentinel the Leads grid checks for its blue row + popup).
  const fromLeadId = useMemo(
    () => new URLSearchParams(window.location.search).get("fromLead") ?? "",
    [],
  );
  type LeadFetch = "idle" | "loading" | "loaded" | "failed";
  const [leadStatus, setLeadStatus] = useState<LeadFetch>(fromLeadId ? "loading" : "idle");
  const [leadTitle, setLeadTitle] = useState("");
  // The lead's resolved department NAME (DepartmentName from the FK
  // resolution). Kept separately so the Department select can still render a
  // label when the transferred DepartmentLookup id isn't in the (division-
  // filtered) options list, and so a missing id can be resolved by name once
  // the departments list loads.
  const [leadDeptName, setLeadDeptName] = useState("");
  // Raw lead record (seed or fetched) — lets submit carry fields the form has
  // no inputs for (key personnel names) verbatim when the lead has them.
  const leadRawRef = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (!fromLeadId) return;
    let cancelled = false;
    // Applies a lead record (seed or fetched) to the form. Shared by the
    // instant seed path and the network fetch below.
    const applyLead = (d: Record<string, unknown>) => {
        leadRawRef.current = d;
        const s = (v: unknown) => String(v ?? "").trim();
        const day = (v: unknown) => { const t = s(v); return t ? t.slice(0, 10) : ""; };
        // First NON-EMPTY candidate. `a ?? b` chains die on empty strings —
        // a field normalized to "" stops the chain before the real fallback.
        const pick = (...vals: unknown[]) => { for (const v of vals) { const t = s(v); if (t) return t; } return ""; };
        const pickNum = (...vals: unknown[]) => { for (const v of vals) { const n = Number(v); if (Number.isFinite(n) && n > 0) return String(n); } return ""; };
        setLeadTitle(s(d.Title));
        // DepartmentName is the server-side FK resolution of DepartmentLookup —
        // the same value the lead detail card displays.
        setLeadDeptName(s(d.DepartmentName) || s(d.Department));
        // Linked lead → preselect its company FK. Name-only leads get the
        // amber hint under the picker instead (pick/create to keep the link).
        {
          const co = s(d.CRMCompanyLookup);
          if (/^\d+$/.test(co)) setCompanyId(prev => prev || co);
        }
        // Only fill fields the user hasn't already typed into.
        setFormData(prev => ({
          ...prev,
          Title: prev.Title || s(d.Title),
          Company: prev.Company || pick(d.CRMClientName, d.CRMCompanyLookupName, d.CompanyName),
          // The lead's Key Client Contact (ContactName; Contact = legacy alias).
          ContactName: prev.ContactName || pick(d.ContactName, d.Contact),
          // Same fallback chain the detail page uses — lead sectors may live
          // in Sector / MarketSector rather than SectorChoice.
          Sector: prev.Sector || pick(d.SectorChoice, d.Sector, d.MarketSector),
          // Leads may carry a project/request category — transfer it when present.
          RequestCategory: prev.RequestCategory || pick(d.RequestCategory, d.ProjectCategory, d.Category),
          CRMBusinessUnitChoice: prev.CRMBusinessUnitChoice || pick(d.CRMBusinessUnitChoice, d.BusinessUnitName),
          DivisionID: prev.DivisionID || pickNum(d.DivisionID, d.DivisionLookup),
          DepartmentID: prev.DepartmentID || pickNum(d.DepartmentLookup, d.DepartmentID),
          ApproxContractValue: prev.ApproxContractValue || pickNum(d.ApproxContractValue, d.ContractValue),
          // SuccessChance is free text ("(4) More Than 80%", "High", "60") —
          // transfer verbatim; skip "0"/blank so the field stays empty.
          SuccessChance: prev.SuccessChance || (s(d.ChanceOfSuccessChoice) !== "0" ? s(d.ChanceOfSuccessChoice) : ""),
          // Status: transfer the lead's status (statuses are tenant-defined
          // free text — never hard-validated, dropdown appends it if needed).
          // "Converted" is the lead-side sentinel stamped by a previous
          // conversion, not a real workflow status — never carry it over.
          CRMOpportunityStatusChoice: prev.CRMOpportunityStatusChoice ||
            (/^converted$/i.test(pick(d.LeadStatus, d.Status)) ? "" : pick(d.LeadStatus, d.Status)),
          Office: prev.Office || s(d.Office),
          StreetAddress1: prev.StreetAddress1 || s(d.StreetAddress1),
          City: prev.City || s(d.City),
          State: prev.State || s(d.State),
          TargetStartDate: prev.TargetStartDate || day(d.TargetStartDate),
          TargetCompletionDate: prev.TargetCompletionDate || day(d.TargetCompletionDate),
        }));
        setLeadStatus("loaded");
    };

    // ── Instant path ── the lead detail page wrote its in-memory record to a
    // short-lived seed right before navigating here. It's the exact record the
    // user was just looking at (fresher than any TTL cache), so the form
    // pre-fills on first paint with zero network wait.
    const seed = readConvertSeed(fromLeadId);
    if (seed) { applyLead(seed); return; }

    // ── Fetch path ── direct URL / expired seed. Conversion must always read
    // the LATEST lead record. The shared TTL cache can hold a snapshot from
    // minutes ago (e.g. fetched before the user edited the lead, or before an
    // import backfilled ContactName) — a stale entry here silently prefills
    // blanks, so bust it and force a fresh fetch.
    setLeadStatus("loading");
    bustCache(`project:details:${fromLeadId}`);
    getProjectDetails(fromLeadId)
      .then((res: any) => {
        if (cancelled) return;
        // Unwrap the API envelope — a {Status:false} envelope must never leak
        // into the form as if it were record data.
        const d = (res && typeof res === "object" && "Data" in res) ? res.Data : res;
        if (res?.Status === false || !d || typeof d !== "object") { setLeadStatus("failed"); return; }
        applyLead(d as Record<string, unknown>);
      })
      .catch(() => { if (!cancelled) setLeadStatus("failed"); });
    return () => { cancelled = true; };
  }, [fromLeadId]);

  // Auto-suggest the next Opportunity ID from existing OPM records.
  // The ref tracks our last auto-suggestion so fresh data can self-correct
  // the field without overriding something the user typed themselves.
  const suggestedIdRef = useRef<string>("");
  useEffect(() => {
    const records = (opmsData?.data ?? []) as { TicketId?: unknown; ID?: unknown }[];
    if (!records.length) return;
    setFormData(prev => {
      // Only auto-fill when empty OR still showing our last suggestion.
      if (prev.ERPJobID && prev.ERPJobID !== suggestedIdRef.current) return prev;
      const suggested = suggestNextId(records);
      if (!suggested) return prev;
      suggestedIdRef.current = suggested;
      return { ...prev, ERPJobID: suggested };
    });
  }, [opmsData]);

  const DROPDOWN_OPTS = { staleTime: 0, refetchOnMount: "always" as const, retry: 1, retryDelay: 1500 };
  // Same caching strategy as project-create: seed from api.ts module cache so
  // the dropdowns never spin when the data is already in memory this session.
  const ORG_OPTS = { staleTime: 5 * 60 * 1000, refetchOnMount: true as const, retry: 1, retryDelay: 1500 };
  const { data: divisions } = useQuery({ queryKey: ["divisions"], queryFn: () => getDivisions(), ...ORG_OPTS, placeholderData: () => peekCached<Awaited<ReturnType<typeof getDivisions>>>("divisions") ?? undefined });
  const { data: departments } = useQuery({ queryKey: ["departments"], queryFn: () => getDepartments(), ...ORG_OPTS, placeholderData: () => peekCached<unknown[]>("departments") ?? undefined });
  const { data: businessUnits } = useQuery({ queryKey: ["businessUnits"], queryFn: () => getBusinessUnits(), ...ORG_OPTS, placeholderData: () => peekCached<unknown[]>("business-units") ?? undefined });
  // Stage options: serve from cache (5-min stale) so the dropdown is instant on
  // mount. OPM_DEFAULT_STAGES shows immediately as initialData while the real
  // server response loads in the background.  The manual "Refresh" link force-
  // busts the cache for admins who just changed the stage set in onboarding.
  const OPM_DEFAULT_STAGES = ["Pending Assignment", "Proposal Development", "Contract Negotiations", "Awarded", "Lost"];
  const { data: statusOptions, refetch: refetchStagesBase } = useQuery({ queryKey: ["field-options", "status", "OPM"], queryFn: () => getFieldOptions("status", "OPM"), staleTime: 5 * 60 * 1000, refetchOnMount: true, retry: 2, retryDelay: 1500, initialData: OPM_DEFAULT_STAGES });
  const refetchStages = async () => { await getFieldOptions("status", "OPM", { force: true }); void refetchStagesBase(); };

  // A status prefilled from the source lead ("awarded") must snap to the OPM
  // option's exact casing ("Awarded") — the select's value has to match an
  // option id verbatim or it renders as a stray duplicate option.
  useEffect(() => {
    const cur = formData.CRMOpportunityStatusChoice;
    if (!cur) return;
    const opts = (statusOptions ?? []) as string[];
    // Exact-case match already — never re-snap (idempotence: if the options
    // list itself carried two case variants, flipping between them per render
    // would loop forever; the first find() below is the one canonical pick).
    if (opts.includes(cur)) return;
    const canon = opts.find((o) => o.toLowerCase() === cur.toLowerCase());
    if (canon) setFormData((p) => ({ ...p, CRMOpportunityStatusChoice: canon }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snap only when options or value change
  }, [statusOptions, formData.CRMOpportunityStatusChoice]);

  // Live DB-scraped custom-type options for OPM fields.
  const FIELD_OPTS = { staleTime: 5 * 60 * 1000, retry: 1 };
  const { data: liveSector }          = useQuery({ queryKey: ["fieldOpts","sector","OPM"],          queryFn: () => getFieldOptions("sector"),          ...FIELD_OPTS });
  const { data: liveRequestCategory } = useQuery({ queryKey: ["fieldOpts","requestcategory","OPM"], queryFn: () => getFieldOptions("requestcategory","OPM"), ...FIELD_OPTS });

  // When a lead's SectorChoice uses a slightly different spelling than the opp
  // dropdown (e.g. "Mixed-Use" vs "Mixed Use"), correct it to the closest match.
  // Match against the preset + live lists directly (NOT sectorOpts below —
  // that memo appends the current value, which would defeat the exact check).
  useEffect(() => {
    const cur = formData.Sector.trim();
    if (!cur) return;
    const opts = [
      "Transportation","Infrastructure","Healthcare","Commercial","Residential",
      "Government","Education","Industrial","Energy","Mixed Use",
      ...(liveSector ?? []),
    ];
    if (opts.some(o => o === cur)) return; // already exact
    const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, " ").trim();
    const match = opts.find(opt => norm(opt) === norm(cur));
    if (match && match !== cur) setFormData(prev => ({ ...prev, Sector: match }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSector]);

  // The prefilled lead sector may not exist in the preset/live lists yet —
  // append it so the select can actually RENDER the transferred value.
  const sectorOpts          = useMemo(() => {
    const base = mergeOpts(["Transportation","Infrastructure","Healthcare","Commercial","Residential","Government","Education","Industrial","Energy","Mixed Use"], liveSector ?? []);
    const cur = formData.Sector.trim();
    if (cur && !base.some(o => o.id.trim().toLowerCase() === cur.toLowerCase())) base.push({ id: cur, label: cur });
    return base;
  }, [liveSector, formData.Sector]);
  // Append the transferred category when it isn't in the preset/live lists —
  // a select whose value is missing from its options renders blank.
  const requestCategoryOpts = useMemo(() => {
    const base = mergeOpts(["Service Projects (CNS)","Construction Projects (CPR)"], liveRequestCategory ?? []);
    const cur = formData.RequestCategory.trim();
    if (cur && !base.some(o => o.id.trim().toLowerCase() === cur.toLowerCase())) base.push({ id: cur, label: cur });
    return base;
  }, [liveRequestCategory, formData.RequestCategory]);

  // BU persists by NAME (CRMBusinessUnitChoice), but Divisions link to a BU by
  // id, so resolve the selected BU name → id and cascade-filter the Divisions.
  const buIdByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of (businessUnits ?? []) as any[]) {
      const name = String(b.ShortName ?? b.Title ?? b.Name ?? "").trim();
      if (name) m.set(name, String(b.ID));
    }
    return m;
  }, [businessUnits]);
  const selectedBuId = buIdByName.get(formData.CRMBusinessUnitChoice) ?? "";

  const divOptions: CreatableOption[] = useMemo(
    () => ((divisions ?? []) as any[])
      .filter((d) => !selectedBuId || String(d.BusinessUnitIdLookup ?? "") === selectedBuId)
      .map((d) => ({ id: String(d.ID), label: d.Title })),
    [divisions, selectedBuId],
  );
  // Opportunity BU is stored as a NAME (CRMBusinessUnitChoice), so options are
  // keyed by name rather than id.
  const buOptions: CreatableOption[] = useMemo(
    () => ((businessUnits as any[] | undefined) ?? [])
      .map((b: any) => (b.ShortName || b.Title || b.Name || "").trim())
      .filter((name: string) => name)
      .map((name: string) => ({ id: name, label: name })),
    [businessUnits],
  );

  const deptOptions: CreatableOption[] = useMemo(() => {
    const all = (departments ?? []) as any[];
    const base = all
      .filter((d) => !formData.DivisionID || String(d.DivisionIdLookup ?? d.DivisionID ?? "") === formData.DivisionID)
      .map((d) => ({ id: String(d.ID), label: String(d.Title ?? "") }));
    // A transferred lead department may not survive the division filter (or
    // may not be in the departments list at all) — append it so the select can
    // actually RENDER the selection instead of showing blank. Label comes from
    // the full list when the row exists, else the lead's resolved name.
    const cur = formData.DepartmentID.trim();
    if (cur && !base.some((o) => o.id === cur)) {
      const row = all.find((d) => String(d.ID) === cur);
      const label = String(row?.Title ?? "").trim() || leadDeptName || cur;
      base.push({ id: cur, label });
    }
    return base;
  }, [departments, formData.DivisionID, formData.DepartmentID, leadDeptName]);

  // Lead rows sometimes carry a department NAME without a usable
  // DepartmentLookup id — resolve it against the departments list once loaded.
  // One-shot: after the first attempt with a loaded list, never run again, so
  // a later departments refetch can't re-fill a department the user
  // deliberately cleared (e.g. by switching divisions).
  const deptNameResolvedRef = useRef(false);
  useEffect(() => {
    if (deptNameResolvedRef.current || !leadDeptName) return;
    const all = (departments ?? []) as any[];
    if (!all.length) return;
    deptNameResolvedRef.current = true;
    setFormData(prev => {
      if (prev.DepartmentID) return prev;
      const match = all.find((d) => String(d.Title ?? "").trim().toLowerCase() === leadDeptName.toLowerCase());
      return match ? { ...prev, DepartmentID: String(match.ID) } : prev;
    });
  }, [departments, leadDeptName]);

  // Company link (mandatory-ID policy, Aug 2026): numeric CRMCompany.ID from
  // the picker. formData.Company keeps the display NAME for prefill/hint only
  // — the payload sends ONLY CRMCompanyLookup.
  const [companyId, setCompanyId] = useState("");

  // ── Company contacts for the Contact Name dropdown ──
  // Prefer the PICKED company's numeric id (exact contact scoping); the
  // debounced NAME path only serves unlinked prefills carried from a lead.
  const companyName = formData.Company.trim();
  const [debouncedCompany, setDebouncedCompany] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedCompany(companyName), 400);
    return () => window.clearTimeout(t);
  }, [companyName]);
  const { data: companyContacts, isLoading: contactsLoading } = useQuery({
    queryKey: ["companyContacts", companyId || debouncedCompany.toLowerCase()],
    queryFn: () => (companyId ? getCompanyContacts(companyId) : getCompanyContacts("", debouncedCompany)),
    enabled: !!companyId || !!debouncedCompany,
    staleTime: 60 * 1000,
    retry: 1,
  });
  const contactOpts: CreatableOption[] = useMemo(() => {
    const rows = ((companyContacts as { data?: { name?: string }[] } | undefined)?.data ?? []);
    const seen = new Set<string>();
    const base: CreatableOption[] = [];
    for (const c of rows) {
      const n = String(c?.name ?? "").trim();
      if (!n || seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      base.push({ id: n, label: n });
    }
    // The transferred lead contact may not exist as a CRMContact row yet —
    // append it so the select can actually render the prefilled value.
    const cur = formData.ContactName.trim();
    if (cur && !seen.has(cur.toLowerCase())) base.push({ id: cur, label: cur });
    return base;
  }, [companyContacts, formData.ContactName]);

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

  // Stable empty rawFields — a new literal `{}` on every memo recompute
  // would make SchedulePhases.loadTasks re-run (setting loading=true) every
  // time allocations updates, causing an infinite loading loop.
  const rawFieldsRef = useRef<Record<string, unknown>>({});

  // Minimal-but-complete ProjectData built from the create-form values so the
  // reused SchedulePhases / TeamMemberList components have the context they need.
  const project: ProjectData = useMemo(
    () => ({
      id: createdId,
      name: formData.Title,
      status: formData.CRMOpportunityStatusChoice || "",
      phase: "",
      city: "",
      sector: "",
      value: Number(formData.ApproxContractValue) || 0,
      laborValue: 0,
      company: "",
      bu: formData.CRMBusinessUnitChoice || "",
      groupId: "",
      targetStart: formData.TargetStartDate,
      targetEnd: formData.TargetCompletionDate,
      actualStart: "",
      actualEnd: "",
      scheduleStart: "",
      scheduleEnd: "",
      closeDate: "",
      bidDate: "",
      probability: Number(formData.SuccessChance) || 0,
      module: "OPM",
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

  // A brand-new opportunity always starts with an empty team — skip the
  // automatic reloadTeam() so the Team tab shows instantly without a spinner.
  // reloadTeam() is still called when the user manually adds / edits members.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { /* intentional no-op on first create */ }, [createdId]);

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
    // Inline validation: a toast alone is easy to miss (it vanishes after a
    // few seconds), so also mark each missing field in red and scroll the
    // first one into view. Leads converted from imports often arrive with no
    // Division, which made this page look "complete" while Create refused.
    const miss = {
      title: !formData.Title,
      id: !formData.ERPJobID.trim(),
      division: getBusinessRules().showDivision && !formData.DivisionID,
    };
    if (miss.title || miss.id || miss.division) {
      setMissing(miss);
      setActiveTab("details");
      const labels = [
        miss.title && "Opportunity Title",
        miss.id && "Opportunity ID",
        miss.division && "Division",
      ].filter(Boolean) as string[];
      const fieldList = labels.join(", ");
      const isAre = labels.length === 1 ? "is" : "are";
      toast({
        title: "Missing fields",
        description: fromLeadId
          ? `Your lead doesn't have ${fieldList} — please fill ${labels.length === 1 ? "it" : "them"} in here before converting.`
          : `${fieldList} ${isAre} required — highlighted in red below.`,
        variant: "destructive",
      });
      const firstId = miss.title ? "title" : miss.id ? "erpJobId" : "division-field";
      setTimeout(() => {
        const el = document.getElementById(firstId);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (el instanceof HTMLInputElement) el.focus({ preventScroll: true });
      }, 60);
      return;
    }
    setMissing({});

    submitInFlightRef.current = true;
    setIsSubmitting(true);
    setCreationStep("Creating opportunity record…");
    setCreationPct(8);
    startTrickle(72); // keep the bar moving during the slow create API call
    try {
      // Division tier hidden → resolve the hidden bridge division so the
      // record still lands with a connected DivisionLookup chain.
      const divisionId = await resolveDivisionForSave(formData.DivisionID, selectedBuId);
      // createRecord expects a module name plus a list of { FieldName, Value }
      // pairs. Field names that don't map to a live Opportunity column are
      // dropped server-side (schema-drift safe), so we only send real fields.
      const fields = [
        { FieldName: "Title", Value: formData.Title },
        // The user-supplied Opp ID becomes the record's TicketId verbatim —
        // IDs are mandatory, the backend never auto-generates one.
        { FieldName: "TicketId", Value: formData.ERPJobID.trim() },
        // Explicit duplicate-name confirmation — the server gate requires it
        // when a same-titled opp exists but is a different job. Control field
        // only; the server strips it before the insert.
        ...(dupOkTitleRef.current === formData.Title.trim().toLowerCase()
          ? [{ FieldName: "ConfirmDuplicateTitle", Value: "1" }] : []),
        ...(formData.RequestCategory ? [{ FieldName: "RequestCategory", Value: formData.RequestCategory }] : []),
        { FieldName: "ApproxContractValue", Value: String(Number(formData.ApproxContractValue) || 0) },
        // Free text allowed — tenants use values like "(4) More Than 80%";
        // the core2 column is nvarchar. Blank keeps the legacy "0" for parity.
        { FieldName: "SuccessChance", Value: formData.SuccessChance.trim() || "0" },
        { FieldName: "CRMOpportunityStatusChoice", Value: formData.CRMOpportunityStatusChoice },
        { FieldName: "CRMBusinessUnitChoice", Value: formData.CRMBusinessUnitChoice },
        { FieldName: "DivisionLookup", Value: String(Number(divisionId) || 0) },
        ...(formData.DepartmentID ? [{ FieldName: "DepartmentLookup", Value: String(Number(formData.DepartmentID) || 0) }] : []),
        ...(formData.Sector      ? [{ FieldName: "SectorChoice",  Value: formData.Sector }]      : []),
        // Mandatory-ID policy: link by numeric FK from the picker only —
        // free-text company names are rejected server-side.
        ...(companyId            ? [{ FieldName: "CRMCompanyLookup", Value: companyId }]        : []),
        ...(formData.ContactName ? [{ FieldName: "ContactName",   Value: formData.ContactName }] : []),
        ...(formData.OwnersRepresentative ? [{ FieldName: "OwnersRepresentative", Value: formData.OwnersRepresentative }] : []),
        // Key personnel carried VERBATIM when the source lead has them (rare
        // but legal — recurring imports can stamp these shared columns).
        ...(String(leadRawRef.current?.BusinessLeadUser ?? "").trim() ? [{ FieldName: "BusinessLeadUser", Value: String(leadRawRef.current?.BusinessLeadUser ?? "").trim() }] : []),
        ...(String(leadRawRef.current?.ProjectManagerUser ?? "").trim() ? [{ FieldName: "ProjectManagerUser", Value: String(leadRawRef.current?.ProjectManagerUser ?? "").trim() }] : []),
        ...(String(leadRawRef.current?.SeniorProjectManagerUser ?? "").trim() ? [{ FieldName: "SeniorProjectManagerUser", Value: String(leadRawRef.current?.SeniorProjectManagerUser ?? "").trim() }] : []),
        ...(String(leadRawRef.current?.StageActionUsersUser ?? "").trim() ? [{ FieldName: "StageActionUsersUser", Value: String(leadRawRef.current?.StageActionUsersUser ?? "").trim() }] : []),
        ...(formData.Office      ? [{ FieldName: "Office",        Value: formData.Office }]      : []),
        ...(formData.StreetAddress1 ? [{ FieldName: "StreetAddress1", Value: formData.StreetAddress1 }] : []),
        ...(formData.City        ? [{ FieldName: "City",          Value: formData.City }]        : []),
        ...(formData.State       ? [{ FieldName: "State",         Value: formData.State }]       : []),
        ...(formData.TargetStartDate      ? [{ FieldName: "TargetStartDate",      Value: `${formData.TargetStartDate}T00:00:00` }]      : []),
        ...(formData.TargetCompletionDate ? [{ FieldName: "TargetCompletionDate", Value: `${formData.TargetCompletionDate}T00:00:00` }] : []),
      ];

      let res: any = await createRecord("OPM", fields);

      // ── Simultaneous-create collision recovery ── (mirrors project-create)
      // When the server's UPDLOCK dup gate rejects an ID that was OUR
      // auto-suggestion (the user never typed their own), silently re-suggest
      // from a fresh record list and retry — up to 3 attempts with a jittered
      // delay, so even a THREE-way collision self-heals. A user-typed ID that
      // collides keeps the visible error with zero retries.
      const submittedId = formData.ERPJobID.trim();
      if (res?.Status === false && /already used/i.test(String(res?.error ?? "")) &&
          submittedId === suggestedIdRef.current) {
        const MAX_ID_RETRIES = 3;
        // Every ID we've already seen collide — the fresh list may still
        // predate a sibling loser's row, so skip past known losers.
        const collided = new Set<string>([submittedId]);
        for (let attempt = 1;
             attempt <= MAX_ID_RETRIES && res?.Status === false && /already used/i.test(String(res?.error ?? ""));
             attempt++) {
          try {
            console.log(`[idRetry] auto-suggested ID collided — re-suggesting (attempt ${attempt}/${MAX_ID_RETRIES})`);
            // Jittered backoff desyncs sibling losers so they don't refetch
            // and re-suggest in lockstep on every round.
            await new Promise(r => setTimeout(r, 100 * attempt + Math.random() * 400));
            const fresh = await getModuleRecordsFresh("OPM");
            let nextId = suggestNextId((fresh?.data ?? []) as { TicketId?: unknown; ID?: unknown }[]);
            while (nextId && collided.has(nextId)) nextId = bumpId(nextId);
            if (!nextId) break;
            collided.add(nextId);
            suggestedIdRef.current = nextId;
            const idForState = nextId;
            setFormData(prev => ({ ...prev, ERPJobID: idForState }));
            const retryFields = fields.map(f => f.FieldName === "TicketId" ? { ...f, Value: nextId } : f);
            console.log("[idRetry] retrying create with", nextId);
            res = await createRecord("OPM", retryFields);
          } catch (e) {
            console.warn("[idRetry] retry attempt failed — surfacing last error:", e);
            break;
          }
        }
      }

      if (res?.Status === false) {
        // "Same name, different job" — a same-titled opp exists but its
        // client/BU/division conflict, so the server asks for an explicit
        // confirmation instead of hard-rejecting. One-click resubmit.
        if (res?.code === "DUP_TITLE_DIFFERENT_JOB") {
          toast({
            title: "Same name, different job?",
            description: res?.error || `An opportunity named "${formData.Title}" already exists for a different client. Create another with the same name?`,
            action: (
              <ToastAction altText="Create anyway" onClick={() => {
                dupOkTitleRef.current = formData.Title.trim().toLowerCase();
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
          title: "Couldn't create opportunity",
          description: res?.error || "Failed to create opportunity.",
          variant: "destructive",
        });
        return;
      }

      setCreationStep("Saving details…");
      setCreationPct(p => Math.max(p, 76));
      startTrickle(88);
      bustCache("module:OPM");
      await queryClient.invalidateQueries({ queryKey: ["opm"] });

      const ticketId = res?.Data?.TicketId || res?.Data?.ID || res?.TicketId || res?.ID;
      if (!ticketId) {
        toast({ title: "Created, but…", description: "The opportunity was created but no ID came back. Open it from the Projects list.", variant: "destructive" });
        setLocation("/projects?view=Opportunities");
        return;
      }
      setCreationStep("Warming up record…");
      setCreationPct(p => Math.max(p, 90));
      setCreatedId(ticketId);
      bustCache(`project:details:${ticketId}`);
      void getProjectDetails(ticketId);
      void getTaskData(ticketId, "0").catch(() => {});

      // ── Converting a lead: stamp the source lead as "Converted" so the
      // Leads grid shows the blue chip and intercepts clicks with the
      // "already converted" popup linking here. Best-effort: a stamp failure
      // never rolls back the created opportunity.
      if (fromLeadId) {
        setCreationStep("Marking lead as converted…");
        try {
          const stamp = await updateFields(
            fromLeadId,
            [{ FieldName: "LeadStatus", Value: "Converted" }],
            { lifecycleModules: ["LEM", "OPM"] },
          );
          if (!stamp.ok) throw new Error(stamp.error || "Could not mark the lead as Converted");
          bustCache(`project:details:${fromLeadId}`);
        } catch (e) {
          // The opportunity still exists even if the best-effort source stamp
          // fails, so Pipeline Review must at least reflect the new destination.
          notifyLifecycleChanged(["LEM", "OPM"]);
          console.warn("[leadConvert] failed to stamp lead status (non-fatal):", e);
          toast({ title: "Lead not marked", description: `The opportunity was created, but the lead ${fromLeadId} couldn't be marked as Converted. You can set its status manually.`, variant: "destructive" });
        }
      }
      stopTrickle();
      setCreationPct(100);
      setCreationStep("Ready!");
      await new Promise((r) => setTimeout(r, 320));
      toast({
        title: "Opportunity created",
        description: hideSchedule
          ? "Now add the pursuit team."
          : "Now set up the schedule and add the pursuit team.",
      });
      setActiveTab(hideSchedule ? "team" : "schedule");
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Failed to create opportunity", variant: "destructive" });
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
  // project wizard and the detail page, which hide it under the same rule.
  // "schedule-no-grid" keeps schedules (dates-only display), so it keeps the step.
  const hideSchedule = getDisplayModeFor("OPM") !== "full"
    && getDisplayModeFor("OPM") !== "schedule-no-grid";

  const TABS: { key: TabKey; label: string; icon: React.ElementType; postCreate?: boolean }[] = [
    { key: "details", label: "Details", icon: FileText },
    ...(hideSchedule ? [] : [{ key: "schedule" as TabKey, label: "Schedule", icon: CalendarRange, postCreate: true }]),
    { key: "team", label: "Team", icon: Users, postCreate: true },
  ];

  const existingRefs: ExistingAllocationRef[] = allocations.map((a) => ({
    personId: a.resourceId || "",
    bu: a.bu,
    role: a.role,
    title: a.title,
    hours: a.eacHrs || 0,
  }));

  // Wizard step navigation — every tab gets Back / Next, and the final tab
  // offers the finish action instead of a persistent bar.
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
          Finish &amp; Open Opportunity <Check className="h-4 w-4 ml-2" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6 relative">
      {/* Creation progress overlay — shown while handleCreate runs */}
      {isSubmitting && (
        <CreationProgressOverlay entity="opportunity" step={creationStep} pct={creationPct} />
      )}
      {/* Blocking overlay while the lead record loads (fetch path only — the
          seed path pre-fills instantly and never shows this). Without it the
          form renders empty with a tiny "Loading…" line and users start
          typing into fields that are about to be pre-filled. */}
      {fromLeadId && !createdId && leadStatus === "loading" && (
        <div style={{ position: "fixed", inset: 0, zIndex: Z.PAGE_OVERLAY, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="bg-card border border-border rounded-xl shadow-2xl px-8 py-7 flex flex-col items-center gap-3 text-center" style={{ maxWidth: 380 }}>
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            <div className="font-semibold text-foreground">Converting lead {fromLeadId}…</div>
            <div className="text-sm text-muted-foreground">Loading the lead record and pre-filling the form. This only takes a moment.</div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/projects?view=Opportunities"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">New Opportunity</h1>
          <p className="text-muted-foreground mt-1">
            {createdId
              ? (hideSchedule ? "Add the pursuit team below." : "Complete the setup below — schedule and pursuit team.")
              : (hideSchedule
                ? "Start with the basics. After you create the opportunity you can add the pursuit team."
                : "Start with the basics. After you create the opportunity you can set up the schedule and pursuit team.")}
          </p>
          {fromLeadId && !createdId && (
            <p className={`text-sm mt-1 font-medium ${leadStatus === "failed" ? "text-destructive" : "text-emerald-600"}`}>
              {leadStatus === "loading" ? `Loading lead ${fromLeadId}…`
                : leadStatus === "failed" ? `Couldn't load lead ${fromLeadId} — fill in the fields manually.`
                : `Converting lead ${fromLeadId}${leadTitle ? ` — "${leadTitle}"` : ""}. Fields are pre-filled; the lead will be marked Converted when you create this opportunity.`}
            </p>
          )}
        </div>
        {createdId && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 text-emerald-600 px-3 py-1.5 text-sm font-semibold">
            <Check className="h-4 w-4" /> {createdId}
          </span>
        )}
      </div>

      {/* Tab bar — equal partitions (Schedule drops out when the company's
          settings hide it); Schedule/Team stay locked until the record
          exists, since their rows attach to the created opportunity. */}
      <div className={`grid ${TABS.length === 2 ? "grid-cols-2" : "grid-cols-3"} gap-2 border-b border-border pb-3`}>
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
              {t.key === "details" && createdId && <Check className="h-3.5 w-3.5 text-emerald-400" />}
            </button>
          );
        })}
      </div>

      {/* DETAILS */}
      {activeTab === "details" && (
        <Card>
          <form onSubmit={handleCreate}>
            <CardContent className="space-y-6 pt-6">
              <div className="space-y-2">
                <Label htmlFor="title">Opportunity Title <span className="text-destructive">*</span></Label>
                <Input
                  id="title"
                  placeholder="Enter opportunity title"
                  value={formData.Title}
                  disabled={!!createdId}
                  className={missing.title ? "border-destructive focus-visible:ring-destructive" : undefined}
                  onChange={(e) => { handleChange("Title", e.target.value); clearMissing("title"); }}
                />
                {missing.title && (
                  <p className="text-xs text-destructive">Opportunity Title is required.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="erpJobId">Opportunity ID <span className="text-destructive">*</span></Label>
                <Input
                  id="erpJobId"
                  placeholder="e.g. OPP-2025-001"
                  value={formData.ERPJobID}
                  disabled={!!createdId}
                  className={missing.id ? "border-destructive focus-visible:ring-destructive" : undefined}
                  onChange={(e) => { handleChange("ERPJobID", e.target.value); clearMissing("id"); }}
                />
                {missing.id && (
                  <p className="text-xs text-destructive">Opportunity ID is required.</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="projectCategory">Project Category</Label>
                  <CreatableSelect
                    value={formData.RequestCategory}
                    onValueChange={(v) => handleChange("RequestCategory", v)}
                    disabled={!!createdId}
                    placeholder="Select project category"
                    addLabel="Add custom category"
                    newPlaceholder="e.g. Federal Projects…"
                    options={requestCategoryOpts}
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
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="value">Estimated Value</Label>
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
                  <Label htmlFor="prob">Win Probability (%)</Label>
                  <Input
                    id="prob"
                    type="text"
                    placeholder={'e.g. 60 or "More than 80%"'}
                    value={formData.SuccessChance}
                    disabled={!!createdId}
                    onChange={(e) => handleChange("SuccessChance", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="stage">Status</Label>
                    {(!statusOptions || statusOptions.length === 0) && (
                      <button
                        type="button"
                        onClick={() => void refetchStages()}
                        className="text-xs text-muted-foreground hover:text-foreground underline"
                      >
                        Refresh
                      </button>
                    )}
                  </div>
                  <CreatableSelect
                    value={formData.CRMOpportunityStatusChoice}
                    onValueChange={(v) => handleChange("CRMOpportunityStatusChoice", v)}
                    disabled={!!createdId}
                    placeholder="Select status"
                    addLabel="Add custom status"
                    newPlaceholder="Status name"
                    options={(() => {
                      const base = (statusOptions ?? []) as string[];
                      let all = base.includes("Closed \u2013 Won") ? base : [...base, "Closed \u2013 Won"];
                      // Select-shows-blank trap: a status prefilled from the
                      // source lead may not be an OPM option — append it so
                      // the select can display the current selection.
                      const cur = formData.CRMOpportunityStatusChoice;
                      if (cur && !all.some((s) => s.toLowerCase() === cur.toLowerCase())) all = [...all, cur];
                      return all.map((s) => ({ id: s, label: s }));
                    })()}
                    onCreate={async (name) => ({ id: name, label: name })}
                  />
                </div>

                {getBusinessRules().showBusinessUnit && (
                <div className="space-y-2">
                  <Label htmlFor="bu">Business Unit</Label>
                  <CreatableSelect
                    value={formData.CRMBusinessUnitChoice}
                    onValueChange={(v) => setFormData((p) => (!v || v === p.CRMBusinessUnitChoice ? p : { ...p, CRMBusinessUnitChoice: v, DivisionID: "" }))}
                    disabled={!!createdId}
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
                  className={`space-y-2${missing.division ? " rounded-md ring-2 ring-destructive/70 ring-offset-2 ring-offset-background" : ""}`}
                >
                  <Label htmlFor="division">Division <span className="text-destructive">*</span></Label>
                  <CreatableSelect
                    value={formData.DivisionID}
                    onValueChange={(v) => {
                      if (v) clearMissing("division");
                      setFormData((p) => (!v || v === p.DivisionID ? p : { ...p, DivisionID: v, DepartmentID: "" }));
                    }}
                    disabled={!!createdId}
                    placeholder="Select Division"
                    addLabel="Add new division"
                    newPlaceholder="New division name"
                    options={divOptions}
                    onCreate={createDivisionOption}
                  />
                  {missing.division && (
                    <p className="text-xs text-destructive">
                      {fromLeadId
                        ? "This lead doesn't have a Division on file — select one to finish converting."
                        : "Division is required."}
                    </p>
                  )}
                </div>
                )}

                {getBusinessRules().showDepartment && (
                <div className="space-y-2">
                  <Label htmlFor="department">Department</Label>
                  <CreatableSelect
                    value={formData.DepartmentID}
                    onValueChange={(v) => handleChange("DepartmentID", v)}
                    disabled={!!createdId}
                    placeholder={formData.DivisionID || !getBusinessRules().showDivision ? "Select Department" : "Select a division first"}
                    addLabel="Add new department"
                    newPlaceholder="New department name"
                    options={deptOptions}
                    onCreate={createDepartmentOption}
                  />
                </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="targetStart">Target Start Date</Label>
                  <DateField
                    id="targetStart"
                    value={formData.TargetStartDate}
                    disabled={!!createdId}
                    onChange={(v) => handleChange("TargetStartDate", v)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="targetEnd">Target End Date</Label>
                  <DateField
                    id="targetEnd"
                    value={formData.TargetCompletionDate}
                    disabled={!!createdId}
                    onChange={(v) => handleChange("TargetCompletionDate", v)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company">Company</Label>
                  <CompanySearchSelect
                    value={companyId}
                    onChange={(id, label) => { setCompanyId(id); handleChange("Company", label); }}
                    disabled={!!createdId}
                    hintName={formData.Company}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contactName">Contact Name</Label>
                  <CreatableSelect
                    value={formData.ContactName}
                    onValueChange={(v) => handleChange("ContactName", v)}
                    disabled={!!createdId}
                    loading={contactsLoading && !!debouncedCompany}
                    placeholder={companyName ? "Select contact" : "Enter a company first"}
                    addLabel="Add new contact"
                    newPlaceholder="Contact name"
                    options={contactOpts}
                    onCreate={async (name) => ({ id: name, label: name })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ownersRep">Owner's Representative</Label>
                  <Input
                    id="ownersRep"
                    placeholder="Owner's representative"
                    value={formData.OwnersRepresentative}
                    disabled={!!createdId}
                    onChange={(e) => handleChange("OwnersRepresentative", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="office">Office</Label>
                  <Input
                    id="office"
                    placeholder="e.g. New York, San Francisco"
                    value={formData.Office}
                    disabled={!!createdId}
                    onChange={(e) => handleChange("Office", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Input
                    id="address"
                    placeholder="Street address"
                    value={formData.StreetAddress1}
                    disabled={!!createdId}
                    onChange={(e) => handleChange("StreetAddress1", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    placeholder="City"
                    value={formData.City}
                    disabled={!!createdId}
                    onChange={(e) => handleChange("City", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    placeholder="e.g. NY"
                    value={formData.State}
                    disabled={!!createdId}
                    onChange={(e) => handleChange("State", e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-6 mt-2 border-t border-border">
                <span />
                {createdId ? (
                  <Button type="button" onClick={() => setActiveTab(hideSchedule ? "team" : "schedule")}>
                    Next: {hideSchedule ? "Team" : "Schedule"} <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                ) : (
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Create Opportunity
                  </Button>
                )}
              </div>
            </CardContent>
          </form>
        </Card>
      )}

      {/* SCHEDULE — same editor the project wizard uses (incl. the Phase
          Length quick-fill). Optional at creation: the user can skip and set
          dates later from the opportunity page. */}
      {activeTab === "schedule" && createdId && !hideSchedule && (
        <Card>
          <CardContent className="pt-6">
            <SchedulePhases
              ticketId={createdId}
              module="OPM"
              project={project}
              canEdit
              isAdmin={user?.isAdmin !== false}
              onRefresh={() => { /* no auto-advance — user clicks Next: Team when ready */ }}
            />
            {/* "Skip" must leave the opportunity UNSCHEDULED — SchedulePhases
                saves every edit immediately, so skipping clears any dates
                already saved this session (phase list stays). Mirrors the
                project wizard's skip behavior. */}
            <div className="flex justify-end pt-4">
              <Button variant="ghost" type="button" className="text-muted-foreground" disabled={skippingSched}
                onClick={async () => {
                  if (!createdId) return;
                  try {
                    setSkippingSched(true);
                    await clearScheduleEntirely(createdId);
                    toast({ title: "Schedule skipped", description: "Set up the schedule anytime from the opportunity page." });
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
                module="OPM"
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
          module="OPM"
          projectName={formData.Title}
          projectStartDate=""
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
            ? "Hours can only be edited once the schedule has phase dates. Finish creating the opportunity now — you can edit hours anytime from the Team section inside the record."
            : "Hours can only be edited once the schedule has phase dates. Set the dates in the Schedule step, or finish creating the opportunity now — you can edit hours anytime from the Team section inside the record."}
          {...(hideSchedule ? {} : {
            onSetupSchedule: () => setActiveTab("schedule"),
            setupScheduleLabel: "Set dates in the Schedule step →",
          })}
        />
      )}
    </div>
  );
}
