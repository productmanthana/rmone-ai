import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDivisions, getBusinessUnits, getUsers, getProjectTeam,
  createRecord, createDivision, createBusinessUnit, bustCache, getFieldOptions, type ProjectTeamMember,
} from "@/lib/api";
import { CreatableSelect, type CreatableOption } from "@/components/CreatableSelect";
import { PersonSearchSelect } from "@/components/PersonSearchSelect";
import { CompanySearchSelect } from "@/components/CompanySearchSelect";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Loader2, Save, Check, Users,
  FileText, UserPlus, ArrowRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  TeamMemberList,
  type ProjectData, type Allocation,
} from "@/pages/project-detail";
import { AddTeamMemberModal, type ExistingAllocationRef } from "@/components/AddTeamMemberModal";
import DateField from "@/components/DateField";
import { getBusinessRules, useBusinessRulesVersion } from "@/lib/businessRules";
import { getStageRules, loadStageRules, useStageRulesVersion } from "@/lib/stageRules";
import { resolveDivisionForSave } from "@/lib/orgHierarchy";

const SECTORS = [
  "Transportation","Healthcare","Government","Real Estate","Technology",
  "Education","Commercial","Industrial","Residential","Energy","Aviation",
  "Utilities","Water/Wastewater",
];
const LEAD_STATUSES = ["New","Prospecting","Qualifying","Proposal","Negotiation","Awarded","Lost","Declined","Converted"];
const PROJECT_CATEGORIES = ["Service Projects (CNS)","Construction Projects (CPR)"];
const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

type TabKey = "details" | "team";

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
      memberBu: t.memberBu ?? "",
      dept: t.dept ?? "",
      employeeType: t.employeeType,
      email: "",
      resourceId: t.resourceId ?? "",
      rwiId: t.rwiId ?? undefined,
    }));
}

export default function LeadCreate() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  useBusinessRulesVersion(); // re-render when admin changes BU visibility
  // Users (canEdit=false) may not create records — redirect to home.
  useEffect(() => { if (user?.canEdit === false) setLocation("/"); }, [user, setLocation]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdId, setCreatedId] = useState<string>("");
  // Company link (mandatory-ID policy, Aug 2026): numeric CRMCompany.ID from
  // the picker. formData.CRMClientName keeps the display NAME only — the
  // payload sends ONLY CRMCompanyLookup (free-text names are rejected
  // server-side; a lead without a company stays legal).
  const [companyId, setCompanyId] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("details");
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [teamLoading, setTeamLoading] = useState(false);
  // Member being edited — opens the Edit Assignment modal (dates + hours).
  // Leads have no phase schedule, so the phase-based allocation editor is
  // never used here.
  const [editMemberAlloc, setEditMemberAlloc] = useState<Allocation | null>(null);

  const [formData, setFormData] = useState({
    Title: "",
    LeadId: "",
    ContactName: "",
    CRMClientName: "",
    SectorChoice: "",
    RequestCategory: "",
    LeadStatus: "",
    CRMBusinessUnitChoice: "",
    DivisionID: "",
    Owner: "",
    Office: "",
    StreetAddress1: "",
    City: "",
    State: "",
    TargetStartDate: "",
    TargetCompletionDate: "",
    ApproxContractValue: "",
    SuccessChance: "",
    Description: "",
  });

  const { data: divisions } = useQuery({ queryKey: ["divisions"], queryFn: () => getDivisions() });
  const { data: businessUnits } = useQuery({ queryKey: ["businessUnits"], queryFn: () => getBusinessUnits() });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => getUsers() });
  // Tenant-provided lead statuses (imported or typed on existing leads) merge
  // with the standard presets so the dropdown reflects the tenant's own values.
  // EXCEPT when a lead WORKFLOW applies to this viewer (a group-scoped stage
  // set or a tenant-configured order): then the workflow IS the status list —
  // merging the built-in presets around it would resurrect the very stages the
  // custom workflow replaced. ("Converted" is stamped only by the To
  // Opportunity flow, never hand-picked at creation.)
  const stageRulesVer = useStageRulesVersion();
  useEffect(() => { void loadStageRules(); }, []);
  const { data: liveLeadStatus } = useQuery({ queryKey: ["fieldOpts", "status", "LEM"], queryFn: () => getFieldOptions("status", "LEM"), staleTime: 5 * 60 * 1000, retry: 1 });
  const leadStatusOpts = useMemo(() => {
    void stageRulesVer; // re-derive when the rules arrive/change
    const workflow = getStageRules().stageOrder?.LEM;
    if (workflow && workflow.length > 0) {
      return workflow
        .filter(v => { const k = v.trim().toLowerCase(); return k && k !== "converted"; })
        .map(v => ({ id: v, label: v }));
    }
    const seen = new Set<string>();
    return [...LEAD_STATUSES, ...(liveLeadStatus ?? [])]
      .filter(v => { const k = v.trim().toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; })
      .map(v => ({ id: v, label: v }));
  }, [liveLeadStatus, stageRulesVer]);

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
  const buOptions: CreatableOption[] = useMemo(
    () => ((businessUnits as any[] | undefined) ?? [])
      .map((b: any) => (b.ShortName || b.Title || b.Name || "").trim())
      .filter((name: string) => name)
      .map((name: string) => ({ id: name, label: name })),
    [businessUnits],
  );

  const createDivisionOption = async (name: string): Promise<CreatableOption> => {
    if (!selectedBuId) throw new Error("Select a business unit first.");
    const r = await createDivision(name, selectedBuId);
    await queryClient.invalidateQueries({ queryKey: ["divisions"] });
    return { id: String(r.id), label: r.name };
  };
  const createBusinessUnitOption = async (name: string): Promise<CreatableOption> => {
    const r = await createBusinessUnit(name);
    await queryClient.invalidateQueries({ queryKey: ["businessUnits"] });
    return { id: r.name, label: r.name };
  };

  const handleChange = (field: string, value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  // Stable empty rawFields — a new literal `{}` on every memo recompute
  // would make SchedulePhases.loadTasks re-run (setting loading=true) every
  // time allocations updates, causing an infinite loading loop.
  const rawFieldsRef = useRef<Record<string, unknown>>({});

  const project: ProjectData = useMemo(
    () => ({
      id: createdId,
      name: formData.Title,
      status: formData.LeadStatus || "",
      phase: "",
      city: "",
      sector: formData.SectorChoice || "",
      value: Number(formData.ApproxContractValue) || 0,
      laborValue: 0,
      company: formData.CRMClientName || "",
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
      module: "LEM",
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
      /* team panel surfaces its own errors */
    } finally {
      setTeamLoading(false);
    }
  };


  // Required fields the last Create attempt found empty — drives the inline
  // red highlights (a destructive toast alone proved too easy to miss).
  const [missing, setMissing] = useState<{ title?: boolean; id?: boolean }>({});
  const clearMissing = (k: "title" | "id") =>
    setMissing((m) => (m[k] ? { ...m, [k]: false } : m));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createdId) return;
    // Inline validation: a toast alone is easy to miss (it vanishes after a
    // few seconds), so also mark each missing field in red and scroll the
    // first one into view.
    const miss = { title: !formData.Title, id: !formData.LeadId.trim() };
    if (miss.title || miss.id) {
      setMissing(miss);
      setActiveTab("details");
      const labels = [miss.id && "Lead ID", miss.title && "Lead Name"].filter(Boolean) as string[];
      toast({
        title: "Missing fields",
        description: `${labels.join(", ")} ${labels.length === 1 ? "is" : "are"} required — highlighted in red below.`,
        variant: "destructive",
      });
      const firstId = miss.id ? "leadId" : "title";
      setTimeout(() => {
        const el = document.getElementById(firstId);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (el instanceof HTMLInputElement) el.focus({ preventScroll: true });
      }, 60);
      return;
    }
    setMissing({});

    setIsSubmitting(true);
    try {
      // Division tier hidden → resolve the hidden bridge division so the
      // record still lands with a connected DivisionLookup chain.
      const divisionId = await resolveDivisionForSave(formData.DivisionID, selectedBuId);
      const fields = [
        { FieldName: "Title",                Value: formData.Title },
        // The user-supplied Lead ID becomes the record's TicketId verbatim —
        // IDs are mandatory, the backend never auto-generates one.
        { FieldName: "TicketId",             Value: formData.LeadId.trim() },
        { FieldName: "ContactName",          Value: formData.ContactName },
        // Mandatory-ID policy: link by numeric FK from the picker only —
        // free-text company names are rejected server-side. Blank = no company.
        ...(companyId ? [{ FieldName: "CRMCompanyLookup", Value: companyId }] : []),
        { FieldName: "SectorChoice",         Value: formData.SectorChoice },
        { FieldName: "RequestCategory",      Value: formData.RequestCategory },
        { FieldName: "LeadStatus",           Value: formData.LeadStatus },
        { FieldName: "CRMBusinessUnitChoice",Value: formData.CRMBusinessUnitChoice },
        { FieldName: "DivisionLookup",       Value: String(Number(divisionId) || 0) },
        { FieldName: "Office",               Value: formData.Office },
        { FieldName: "StreetAddress1",       Value: formData.StreetAddress1 },
        { FieldName: "City",                 Value: formData.City },
        { FieldName: "State",                Value: formData.State },

        { FieldName: "TargetStartDate",      Value: formData.TargetStartDate ? `${formData.TargetStartDate}T00:00:00` : "" },
        { FieldName: "TargetCompletionDate", Value: formData.TargetCompletionDate ? `${formData.TargetCompletionDate}T00:00:00` : "" },
        { FieldName: "ApproxContractValue",  Value: String(Number(formData.ApproxContractValue) || 0) },
        // Free text allowed — tenants use values like "(4) More Than 80%";
        // the core2 column is nvarchar. Blank falls through the "0"/"" filter.
        { FieldName: "ChanceOfSuccessChoice",Value: formData.SuccessChance.trim() },
        { FieldName: "Description",          Value: formData.Description },
        { FieldName: "IsLead",               Value: "1" },
        // TicketId and IsLead must always be sent — never drop them, even if a
        // user enters a literal "0" as the Lead ID.
      ].filter((f) => f.FieldName === "TicketId" || f.FieldName === "IsLead" || (f.Value !== "" && f.Value !== "0"));

      const res: any = await createRecord("LEM", fields);

      if (res?.Status === false) {
        toast({ title: "Couldn't create lead", description: res?.error || "Server rejected the record.", variant: "destructive" });
        return;
      }

      bustCache("module:LEM");
      await queryClient.invalidateQueries({ queryKey: ["lem"] });

      const ticketId = res?.Data?.TicketId || res?.Data?.ID || res?.TicketId || res?.ID;
      if (!ticketId) {
        toast({ title: "Created, but…", description: "Lead was created but no ID came back. Open it from the Leads list.", variant: "destructive" });
        setLocation("/projects?view=Leads");
        return;
      }
      setCreatedId(ticketId);
      toast({ title: "Lead created", description: "Now add the pursuit team." });
      setActiveTab("team");
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Failed to create lead", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: "details", label: "Details", icon: FileText },
    { key: "team",    label: "Team",    icon: Users },
  ];

  const existingRefs: ExistingAllocationRef[] = allocations.map((a) => ({
    personId: a.resourceId || "",
    bu: a.bu,
    role: a.role,
    title: a.title,
    hours: a.eacHrs || 0,
  }));

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
          Finish &amp; Open Lead <Check className="h-4 w-4 ml-2" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/projects?view=Leads"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">New Lead</h1>
          <p className="text-muted-foreground mt-1">
            {createdId
              ? "Add the pursuit team below."
              : "Start with the basics. After you create the lead you can add the pursuit team."}
          </p>
        </div>
        {createdId && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 text-emerald-600 px-3 py-1.5 text-sm font-semibold">
            <Check className="h-4 w-4" /> {createdId}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-border pb-3">
        {TABS.map((t) => {
          const locked = t.key !== "details" && !createdId;
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
                <Label htmlFor="leadId">Lead ID <span className="text-destructive">*</span></Label>
                <Input
                  id="leadId"
                  placeholder="e.g. LD-1001"
                  value={formData.LeadId}
                  disabled={!!createdId}
                  className={missing.id ? "border-destructive focus-visible:ring-destructive" : undefined}
                  onChange={(e) => { handleChange("LeadId", e.target.value); clearMissing("id"); }}
                />
                {missing.id && (
                  <p className="text-xs text-destructive">Lead ID is required.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Lead Name <span className="text-destructive">*</span></Label>
                <Input
                  id="title"
                  placeholder="Enter lead name"
                  value={formData.Title}
                  disabled={!!createdId}
                  className={missing.title ? "border-destructive focus-visible:ring-destructive" : undefined}
                  onChange={(e) => { handleChange("Title", e.target.value); clearMissing("title"); }}
                />
                {missing.title && (
                  <p className="text-xs text-destructive">Lead Name is required.</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="company">Client Company</Label>
                  <CompanySearchSelect
                    value={companyId}
                    onChange={(id, label) => { setCompanyId(id); handleChange("CRMClientName", label); }}
                    disabled={!!createdId}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contact">Key Client Contact</Label>
                  <Input
                    id="contact"
                    placeholder="Primary contact"
                    value={formData.ContactName}
                    disabled={!!createdId}
                    onChange={(e) => handleChange("ContactName", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sector">Market Sector</Label>
                  <Select value={formData.SectorChoice} onValueChange={(v) => handleChange("SectorChoice", v)} disabled={!!createdId}>
                    <SelectTrigger><SelectValue placeholder="Select sector" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {SECTORS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="projCat">Project Category</Label>
                  <Select value={formData.RequestCategory} onValueChange={(v) => handleChange("RequestCategory", v)} disabled={!!createdId}>
                    <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      {PROJECT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Lead Status</Label>
                  <CreatableSelect
                    value={formData.LeadStatus}
                    onValueChange={(v) => handleChange("LeadStatus", v)}
                    disabled={!!createdId}
                    placeholder="Select status"
                    addLabel="Add custom status"
                    newPlaceholder="Status name"
                    options={leadStatusOpts}
                    onCreate={async (name) => ({ id: name, label: name })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="value">Approx Contract Value</Label>
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
                <div className="space-y-2">
                  <Label htmlFor="division">Division</Label>
                  <CreatableSelect
                    value={formData.DivisionID}
                    onValueChange={(v) => handleChange("DivisionID", v)}
                    disabled={!!createdId}
                    placeholder="Select Division"
                    addLabel="Add new division"
                    newPlaceholder="New division name"
                    options={divOptions}
                    onCreate={createDivisionOption}
                  />
                </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="owner">Owner</Label>
                  <PersonSearchSelect
                    options={(users ?? []) as { id: string; name: string }[]}
                    value={formData.Owner}
                    onChange={(v) => handleChange("Owner", v)}
                    disabled={!!createdId}
                    placeholder="Select owner"
                    clearable
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
                  <Select value={formData.State} onValueChange={(v) => handleChange("State", v)} disabled={!!createdId}>
                    <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="start">Target Start Date</Label>
                  <DateField
                    id="start"
                    value={formData.TargetStartDate}
                    disabled={!!createdId}
                    onChange={(v) => handleChange("TargetStartDate", v)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="end">Target Completion Date</Label>
                  <DateField
                    id="end"
                    value={formData.TargetCompletionDate}
                    disabled={!!createdId}
                    onChange={(v) => handleChange("TargetCompletionDate", v)}
                  />
                </div>

              </div>

              <div className="space-y-2">
                <Label htmlFor="desc">Description</Label>
                <textarea
                  id="desc"
                  rows={3}
                  placeholder="Brief description of this lead…"
                  value={formData.Description}
                  disabled={!!createdId}
                  onChange={(e) => handleChange("Description", e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                />
              </div>

              <div className="flex items-center justify-between gap-3 pt-6 mt-2 border-t border-border">
                <Button variant="outline" type="button" asChild>
                  <Link href="/projects?view=Leads">Cancel</Link>
                </Button>
                {createdId ? (
                  <Button type="button" onClick={() => setActiveTab("team")}>
                    Next: Team <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                ) : (
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Create Lead
                  </Button>
                )}
              </div>
            </CardContent>
          </form>
        </Card>
      )}

      {/* TEAM */}
      {activeTab === "team" && createdId && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Pursuit Team</h2>
              <Button type="button" onClick={() => setTeamModalOpen(true)}>
                <UserPlus className="h-4 w-4 mr-2" /> Add Team Member
              </Button>
            </div>
            {teamLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading team…
              </div>
            ) : allocations.length === 0 ? (
              <div className="text-center text-muted-foreground py-10 border border-dashed rounded-lg">
                No team members yet. Click <span className="font-medium text-foreground">Add Team Member</span> to assign someone.
              </div>
            ) : (
              <TeamMemberList
                allocations={allocations}
                onEdit={(a) => setEditMemberAlloc(a)}
                searchQuery=""
                canEdit
                module="LEM"
                projectId={createdId}
                scheduleStart={project.scheduleStart}
                scheduleEnd={project.scheduleEnd}
                onReload={reloadTeam}
                /* Leads carry no phase schedule — the expanded card must not
                   render the Hours-by-Phase table ("Phase dates not set"). */
                hideSchedule
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
          module="LEM"
          projectName={formData.Title}
          projectStartDate={formData.TargetStartDate}
          projectEndDate={formData.TargetCompletionDate}
          existingAllocations={existingRefs}
          onAssigned={() => {
            setTeamModalOpen(false);
            void reloadTeam();
          }}
          /* Leads: no phase schedule exists, so capture start/end dates and
             total hours directly in the modal. */
          showHoursField
          forceDates
        />
      )}

      {/* Edit Assignment — same dates + total-hours modal used on the lead
          detail page. Replaces the phase-based allocation editor, which
          doesn't apply to leads. */}
      {editMemberAlloc && createdId && (
        <AddTeamMemberModal
          open={!!editMemberAlloc}
          onClose={() => setEditMemberAlloc(null)}
          projectId={createdId}
          module="LEM"
          projectName={formData.Title}
          projectStartDate={formData.TargetStartDate}
          projectEndDate={formData.TargetCompletionDate}
          existingAllocations={existingRefs}
          onAssigned={() => {
            setEditMemberAlloc(null);
            void reloadTeam();
          }}
          prefillPersonId={editMemberAlloc.resourceId}
          prefillPersonName={editMemberAlloc.name}
          prefillBuShort={editMemberAlloc.bu}
          prefillMemberBu={editMemberAlloc.memberBu}
          prefillRole={editMemberAlloc.role}
          prefillTitle={editMemberAlloc.title}
          prefillDept={editMemberAlloc.dept}
          prefillStartDate={editMemberAlloc.startDate?.slice(0, 10)}
          prefillEndDate={editMemberAlloc.endDate?.slice(0, 10)}
          prefillPct={editMemberAlloc.pct}
          prefillAllocationId={editMemberAlloc.rwiId}
          prefillHours={editMemberAlloc.eacHrs}
          showHoursField
          forceDates
        />
      )}
    </div>
  );
}
