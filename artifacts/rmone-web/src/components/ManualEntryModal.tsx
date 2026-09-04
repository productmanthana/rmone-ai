import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { createRecord } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Z } from "@/lib/zLayers";
import { CompanySearchSelect } from "@/components/CompanySearchSelect";

type FDef = {
  key: string; label: string; fieldName: string;
  // "company" renders the CompanySearchSelect picker and stores the numeric
  // CRMCompany.ID — free-text company names are rejected by the server
  // (mandatory Company-ID policy), so no company field may be a text input.
  type: "text" | "select" | "date" | "number" | "textarea" | "company";
  opts?: string[]; required?: boolean; fullWidth?: boolean;
};
type SDef = { title: string; fields: FDef[] };

const SECTORS = ["Transportation","Healthcare","Government","Real Estate","Technology","Education","Commercial","Industrial","Residential","Energy","Aviation","Utilities","Water/Wastewater"];
const STATES  = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

const PMM: SDef[] = [
  { title: "Basic Info", fields: [
    { key:"title",       label:"Project Title",   fieldName:"Title",                type:"text",   required:true, fullWidth:true },
    { key:"ticketId",    label:"Project ID",      fieldName:"TicketId",             type:"text",   required:true },
    { key:"company",     label:"Client Company",  fieldName:"CRMCompanyLookup",     type:"company" },
    { key:"owner",       label:"Project Manager", fieldName:"PrimaryProjectManager",type:"text" },
    { key:"sector",      label:"Market Sector",   fieldName:"CRMSectorChoice",      type:"select", opts:SECTORS },
    { key:"projType",    label:"Project Type",    fieldName:"CRMProjectTypeChoice", type:"select", opts:["New Construction","Renovation","Design-Build","Reconstruction","Rehabilitation","Addition","Retrofit","Interior Fit-Out"] },
    { key:"svcType",     label:"Service Type",    fieldName:"ServiceType",          type:"select", opts:["Architecture","Engineering","Construction Management","General Contracting","Program Management","Inspection","Owner's Representative","Design-Build"] },
    { key:"status",      label:"Status",          fieldName:"Status",               type:"select", opts:["Active","On Hold","Complete","Pending","Cancelled","In Review"] },
    { key:"priority",    label:"Priority",        fieldName:"Priority",             type:"select", opts:["Low","Medium","High","Critical"] },
    { key:"contractType",label:"Contract Type",   fieldName:"ContractType",         type:"select", opts:["Lump Sum","Cost Plus","GMP","Unit Price","Time & Materials","Fixed Fee","IDIQ"] },
  ]},
  { title: "Organization", fields: [
    { key:"bu",         label:"Business Unit", fieldName:"CRMBusinessUnitChoice", type:"text" },
    { key:"division",   label:"Division",      fieldName:"Division",              type:"text" },
    { key:"department", label:"Department",    fieldName:"Department",            type:"text" },
  ]},
  { title: "Dates", fields: [
    { key:"startDate",    label:"Target Start Date",      fieldName:"TargetStartDate",          type:"date" },
    { key:"endDate",      label:"Target End Date",        fieldName:"TargetCompletionDate",     type:"date" },
    { key:"closeout",     label:"Closeout Date",          fieldName:"CloseoutDate",             type:"date" },
    { key:"milestoneDate",label:"Next Milestone Date",    fieldName:"NextMilestoneDate",        type:"date" },
  ]},
  { title: "Financial", fields: [
    { key:"contractVal",  label:"Contract Value ($)",      fieldName:"ContractValue",       type:"number" },
    { key:"laborBudget",  label:"Labor Budget ($)",        fieldName:"LaborContractAmount", type:"number" },
    { key:"grossMargin",  label:"Gross Margin ($)",        fieldName:"GrossMargin",         type:"number" },
    { key:"feePct",       label:"Fee %",                   fieldName:"FeePct",              type:"number" },
    { key:"pctComplete",  label:"% Complete",              fieldName:"PctComplete",         type:"number" },
    { key:"contingency",  label:"Contingency ($)",         fieldName:"Contingency",         type:"number" },
    { key:"totalCost",    label:"Total Project Cost ($)",  fieldName:"TotalProjectCost",    type:"number" },
    { key:"proposalAmt",  label:"Proposal Amount ($)",     fieldName:"ProposalAmount",      type:"number" },
    { key:"bidAmount",    label:"Bid Amount ($)",          fieldName:"BidAmount",           type:"number" },
    { key:"changeOrders", label:"Change Orders ($)",       fieldName:"ChangeOrders",        type:"number" },
    { key:"retainage",    label:"Retainage ($)",           fieldName:"Retainage",           type:"number" },
  ]},
  { title: "Location & Notes", fields: [
    { key:"address",     label:"Street Address",   fieldName:"StreetAddress", type:"text",     fullWidth:true },
    { key:"city",        label:"City",             fieldName:"City",          type:"text" },
    { key:"state",       label:"State",            fieldName:"State",         type:"select",   opts:STATES },
    { key:"milestone",   label:"Next Milestone",   fieldName:"NextMilestone", type:"text",     fullWidth:true },
    { key:"description", label:"Description",      fieldName:"Description",   type:"textarea", fullWidth:true },
  ]},
];

const OPM: SDef[] = [
  { title: "Basic Info", fields: [
    { key:"title",       label:"Opportunity Title",    fieldName:"Title",                     type:"text",   required:true, fullWidth:true },
    { key:"erpJob",      label:"Opportunity ID",       fieldName:"TicketId",                  type:"text",   required:true },
    { key:"company",     label:"Client Company",       fieldName:"CRMCompanyLookup",          type:"company" },
    { key:"contact",     label:"Key Client Contact",   fieldName:"Contact",                   type:"text" },
    { key:"sector",      label:"Market Sector",        fieldName:"CRMSectorChoice",           type:"select", opts:SECTORS },
    { key:"projCat",     label:"Project Category",     fieldName:"RequestCategory",           type:"select", opts:["Service Projects (CNS)","Construction Projects (CPR)"] },
    { key:"stage",       label:"Stage",                fieldName:"CRMOpportunityStageChoice", type:"select", opts:["Prospecting","Qualifying","Proposal","Negotiation","Awarded","Lost"] },
    { key:"status",      label:"Status",               fieldName:"CRMOpportunityStatusChoice",type:"select", opts:["Active","On Hold","Closed"] },
    { key:"contractType",label:"Contract Type",        fieldName:"ContractType",              type:"select", opts:["Fixed","T&M","GMP","Cost-Plus"] },
    { key:"chance",      label:"Chance of Success",    fieldName:"SuccessChance",             type:"text" },
  ]},
  { title: "Organization", fields: [
    { key:"bu",       label:"Business Unit",    fieldName:"CRMBusinessUnitChoice", type:"text" },
    { key:"division", label:"Division",          fieldName:"Division",             type:"text" },
    { key:"dept",     label:"Department",        fieldName:"Department",           type:"text" },
    { key:"poc",      label:"Point of Contact",  fieldName:"PointOfContact",       type:"text" },
  ]},
  { title: "Dates", fields: [
    { key:"startDate",   label:"Target Start Date", fieldName:"TargetStartDate",      type:"date" },
    { key:"endDate",     label:"Target End Date",   fieldName:"TargetCompletionDate", type:"date" },
    { key:"awardDate",   label:"Award / Loss Date", fieldName:"AwardedorLossDate",    type:"date" },
  ]},
  { title: "Financial", fields: [
    { key:"approxVal", label:"Approx Contract Value ($)",  fieldName:"ApproxContractValue",   type:"number" },
    { key:"costEst",   label:"Forecasted Project Cost ($)",fieldName:"ForecastedProjectCost", type:"number" },
    { key:"laborAmt",  label:"Labor Contract Amount ($)",  fieldName:"LaborContractAmount",   type:"number" },
    { key:"margin",    label:"Gross Margin (%)",           fieldName:"GrossMargin",           type:"number" },
  ]},
  { title: "Other", fields: [
    { key:"description", label:"Description", fieldName:"Description",  type:"textarea", fullWidth:true },
  ]},
];

const INPUT: React.CSSProperties = {
  width:"100%", border:"1px solid #D1D9E0", borderRadius:8,
  padding:"7px 10px", fontSize:13, color:"#1C2D3A", outline:"none",
  background:"#fff", boxSizing:"border-box", fontFamily:"inherit",
};

const LEM: SDef[] = [
  { title: "Basic Info", fields: [
    { key:"title",       label:"Lead Name",           fieldName:"Title",                 type:"text",   required:true, fullWidth:true },
    { key:"leadId",      label:"Lead ID",             fieldName:"TicketId",              type:"text",   required:true },
    { key:"company",     label:"Client Company",       fieldName:"CRMCompanyLookup",      type:"company" },
    { key:"contact",     label:"Key Client Contact",   fieldName:"ContactName",           type:"text" },
    { key:"sector",      label:"Market Sector",        fieldName:"SectorChoice",          type:"select", opts:SECTORS },
    { key:"projCat",     label:"Project Category",     fieldName:"RequestCategory",       type:"select", opts:["Service Projects (CNS)","Construction Projects (CPR)"] },
    { key:"status",      label:"Lead Status",          fieldName:"LeadStatus",            type:"select", opts:["New","Prospecting","Qualifying","Proposal","Negotiation","Awarded","Lost","Declined"] },
    { key:"chance",      label:"Chance of Success",    fieldName:"ChanceOfSuccessChoice", type:"text" },
  ]},
  { title: "Organization", fields: [
    { key:"bu",       label:"Business Unit", fieldName:"CRMBusinessUnitChoice", type:"text" },
    { key:"division", label:"Division",      fieldName:"Division",              type:"text" },
    { key:"dept",     label:"Department",    fieldName:"Department",            type:"text" },
  ]},
  { title: "Location", fields: [
    { key:"office",  label:"Office",         fieldName:"Office",         type:"text" },
    { key:"address", label:"Street Address", fieldName:"StreetAddress1", type:"text" },
    { key:"city",    label:"City",           fieldName:"City",           type:"text" },
    { key:"state",   label:"State",          fieldName:"State",          type:"select", opts:STATES },
  ]},
  { title: "Dates", fields: [
    // Leads use Target dates only — Actual Start/End were retired for leads
    // (client mandate, Jul 2026). PMM/OPM keep their Actual fields above.
    { key:"targetStart", label:"Target Start", fieldName:"TargetStartDate",       type:"date" },
    { key:"targetEnd",   label:"Target End",   fieldName:"TargetCompletionDate",  type:"date" },
  ]},
  { title: "Financial", fields: [
    { key:"approxVal",  label:"Approx Contract Value ($)", fieldName:"ApproxContractValue", type:"number" },
    { key:"contractVal",label:"Contract Value ($)",        fieldName:"ContractValue",       type:"number" },
  ]},
  { title: "Notes", fields: [
    { key:"description", label:"Description", fieldName:"Description", type:"textarea", fullWidth:true },
    { key:"note",        label:"Notes",       fieldName:"Note",        type:"textarea", fullWidth:true },
  ]},
];

export default function ManualEntryModal({ open, entity, onClose, onCreated }: {
  open: boolean; entity: "project" | "opportunity" | "lead";
  onClose: () => void; onCreated?: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm]   = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const sections = entity === "project" ? PMM : entity === "opportunity" ? OPM : LEM;
  const module   = entity === "project" ? "PMM" : entity === "opportunity" ? "OPM" : "LEM";
  const label    = entity === "project" ? "Project" : entity === "opportunity" ? "Opportunity" : "Lead";

  const set = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }));

  async function handleSave() {
    // Every field flagged `required` must be filled — Title AND the record ID
    // (IDs are mandatory; the backend never auto-generates them).
    const missing = sections.flatMap(s => s.fields).filter(f => f.required && !form[f.key]?.trim());
    if (missing.length) {
      toast({ title: `${missing[0].label} is required`, variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const fields = sections.flatMap(s => s.fields)
        .filter(f => form[f.key]?.trim())
        .map(f => {
          let v = form[f.key].trim();
          if (f.type === "date" && v) v = `${v}T00:00:00`;
          return { FieldName: f.fieldName, Value: v };
        });
      const res: any = await createRecord(module, fields);
      if (res?.Status === false) throw new Error(res?.error ?? res?.Message ?? "Server rejected the record");
      toast({ title: `${label} created` });
      setForm({});
      onCreated?.();
      onClose();
    } catch (e: any) {
      toast({ title: "Failed to create", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={{
      position:"fixed", inset:0, background:"rgba(10,22,32,0.65)", zIndex:Z.MODAL_CHILD_2,
      display:"flex", alignItems:"flex-start", justifyContent:"center",
      padding:"5vh 16px 48px", overflowY:"auto",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width:"100%", maxWidth:820, background:"#fff", borderRadius:16,
        boxShadow:"0 28px 64px rgba(0,0,0,0.35)", overflow:"hidden",
        display:"flex", flexDirection:"column",
      }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"16px 20px",
          borderBottom:"1px solid #E8EDF2", background:"#F9FBFC", flexShrink:0 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:15, fontWeight:800, color:"#1C2D3A" }}>New {label}</div>
            <div style={{ fontSize:11.5, color:"#6B7E8A", marginTop:2 }}>
              Fields marked * are required — fill in as much or as little of the rest as you need
            </div>
          </div>
          <button onClick={onClose} style={{
            background:"none", border:"none", cursor:"pointer", color:"#6B7E8A", padding:4, borderRadius:6,
          }}><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={{ padding:"20px 20px 4px", overflowY:"auto" }}>
          {sections.map(sec => (
            <div key={sec.title} style={{ marginBottom:24 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#6BA539", textTransform:"uppercase",
                letterSpacing:"0.07em", marginBottom:10, paddingBottom:6, borderBottom:"1px solid #EEF1F4" }}>
                {sec.title}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px 18px" }}>
                {sec.fields.map(f => (
                  <div key={f.key} style={f.fullWidth ? { gridColumn:"1 / -1" } : {}}>
                    <label style={{ display:"block", fontSize:11.5, fontWeight:600,
                      color:"#4A5E6A", marginBottom:4 }}>
                      {f.label}
                      {f.required && <span style={{ color:"#E87722", marginLeft:2 }}>*</span>}
                    </label>
                    {f.type === "company" ? (
                      <CompanySearchSelect
                        value={form[f.key] ?? ""}
                        onChange={(id) => set(f.key, id)}
                      />
                    ) : f.type === "textarea" ? (
                      <textarea rows={3} value={form[f.key] ?? ""}
                        onChange={e => set(f.key, e.target.value)}
                        style={{ ...INPUT, resize:"vertical" }} />
                    ) : f.type === "select" ? (
                      <select value={form[f.key] ?? ""}
                        onChange={e => set(f.key, e.target.value)}
                        style={{ ...INPUT, color: form[f.key] ? "#1C2D3A" : "#9BAAB5" }}>
                        <option value="">— select —</option>
                        {f.opts!.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                        value={form[f.key] ?? ""}
                        onChange={e => set(f.key, e.target.value)}
                        style={INPUT} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", padding:"14px 20px",
          borderTop:"1px solid #E8EDF2", background:"#F9FBFC", flexShrink:0 }}>
          <button onClick={onClose} disabled={saving} style={{
            padding:"8px 18px", borderRadius:8, border:"1px solid #D1D9E0",
            background:"#fff", cursor:"pointer", fontSize:13.5, fontWeight:600, color:"#4A5E6A",
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding:"8px 24px", borderRadius:8, border:"none",
            background: saving ? "#9DC57A" : "#6BA539",
            cursor: saving ? "not-allowed" : "pointer",
            fontSize:13.5, fontWeight:700, color:"#fff",
            display:"flex", alignItems:"center", gap:6,
          }}>
            {saving && <Loader2 size={14} style={{ animation:"spin 1s linear infinite" }} />}
            {saving ? "Creating…" : `Create ${label}`}
          </button>
        </div>
      </div>
    </div>
  );
}
