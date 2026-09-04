// CompanyCreateModal — create ONE company from anywhere a company can be
// picked: the Companies tab's "New Company" button and CompanySearchSelect's
// "+ Create new company…" both open this.
//
// Mandatory-ID policy (Aug 2026): every company row carries a COM-YY-NNNNNN
// TicketId. The ID field here is OPTIONAL — leave it blank and the server
// auto-assigns the next available ID; fill it to adopt a customer's own code
// (e.g. an ERP vendor number). Duplicate name/ID comes back as a 409 WITH the
// existing row, so the modal offers "Use existing company" instead of a dead
// end — nobody should ever create "Acme Corp (2)" because of a collision.
//
// Full-form parity (Aug 2026): mirrors the legacy product's New Company form —
// abbreviated name, relationship/business classification, full address, fax,
// assigned-to and description — minus Master Agreement (deliberately dropped).
// Friendly keys only — the server maps them to the REAL live CRMCompany
// columns (phone→Telephone, businessType→TypesofWorkChoice, …). Sending raw
// column names in a fields bag was silently discarded (and would invite
// arbitrary-column writes), so don't reintroduce it.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Building2, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { createCompany, getAllContacts, type CompanySlim, type ContactSlim } from "@/lib/api";
import { CreatableSelect, type CreatableOption } from "@/components/CreatableSelect";

// "New contact" sentinel prefix for the Primary Contact picker — a free-typed
// name gets a local `new:<name>` id (never sent to the server as a real id).
const RELATIONSHIP_TYPES = ["Client", "Prospect", "Partner", "Vendor", "Subcontractor", "Consultant", "Competitor", "Other"];
const BUSINESS_TYPES = ["General Contractor", "Subcontractor", "Architect", "Engineer", "Owner / Developer", "Construction Manager", "Consultant", "Supplier / Vendor", "Government Agency", "Other"];

// Native select styled like <Input> — values always come from our own lists
// and the empty option stays ENABLED so users can clear a choice (a disabled
// placeholder with an unmatched value would lie about the real state).
// allowCustom appends a "Custom — type your own…" entry that swaps in a free
// text input; the typed text IS the stored value (these are plain varchar
// choice columns), and a loaded value outside the list re-renders as custom
// text instead of silently snapping to the first option.
const CUSTOM_SENTINEL = "__custom__";
function ChoiceSelect({ id, value, options, onChange, allowCustom = false }: {
  id: string; value: string; options: string[]; onChange: (v: string) => void; allowCustom?: boolean;
}) {
  const [customMode, setCustomMode] = useState(false);
  const isCustom = allowCustom && (customMode || (!!value && !options.includes(value)));
  return (
    <div className="space-y-1.5">
      <select
        id={id} value={isCustom ? CUSTOM_SENTINEL : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM_SENTINEL) { setCustomMode(true); onChange(""); return; }
          setCustomMode(false); onChange(v);
        }}
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">— Select —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        {allowCustom && <option value={CUSTOM_SENTINEL}>Custom — type your own…</option>}
      </select>
      {isCustom && (
        <Input id={`${id}-custom`} value={value} autoFocus placeholder="Type your own…"
          onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

type FormState = {
  name: string; ticketId: string; shortName: string;
  relationshipType: string; businessType: string; secondaryBusinessType: string;
  phone: string; fax: string; email: string; website: string;
  address: string; address2: string; city: string; state: string; zip: string;
  assignedTo: string; description: string;
};
const EMPTY_FORM: FormState = {
  name: "", ticketId: "", shortName: "",
  relationshipType: "", businessType: "", secondaryBusinessType: "",
  phone: "", fax: "", email: "", website: "",
  address: "", address2: "", city: "", state: "", zip: "",
  assignedTo: "", description: "",
};

export function CompanyCreateModal({
  open, onOpenChange, onCreated, initialName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires for BOTH a fresh create and "Use existing company" on a duplicate. */
  onCreated: (company: CompanySlim) => void;
  /** Seed the name field (e.g. what the user typed into the picker search). */
  initialName?: string;
}) {
  const { toast } = useToast();
  const [f, setF]     = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);
  const [dup, setDup]   = useState<CompanySlim | null>(null);
  // Primary Contact (Aug 2026): dropdown of EXISTING tenant contacts (a new
  // company has none yet) + free-typing a new name. Picking an existing one
  // prefills the title/email fields below; typing a new name creates a fresh
  // CRMContact row server-side.
  const [contactSel, setContactSel] = useState("");          // contact id | "new:<name>" | ""
  const [contactTitle, setContactTitle] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const { data: allContacts, isLoading: contactsLoading } = useQuery({
    queryKey: ["allContacts"],
    queryFn: getAllContacts,
    enabled: open,
    staleTime: 60 * 1000,
    retry: 1,
  });
  const contactOpts: CreatableOption[] = useMemo(() => {
    const rows = (allContacts ?? []) as ContactSlim[];
    return rows
      .filter((c) => c.name)
      .map((c) => ({
        id: c.id,
        label: c.companyName ? `${c.name} — ${c.companyName}` : c.name,
      }));
  }, [allContacts]);
  const pickContact = (v: string) => {
    setContactSel(v);
    if (v.startsWith(NEW_CONTACT_PREFIX)) return; // fresh name — keep typed title/email
    const row = ((allContacts ?? []) as ContactSlim[]).find((c) => c.id === v);
    if (row) {
      // Prefill from the picked contact (title/email), but never clobber with
      // placeholders — companyContactsRds sends "—" when no job title exists.
      setContactTitle(row.title && row.title !== "—" ? row.title : "");
      setContactEmail(row.email || "");
    }
  };

  const set = (k: keyof FormState) => (v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    if (k === "name" || k === "ticketId") { setErr(null); setDup(null); }
  };
  const setInput = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k)(e.target.value);

  // Re-seed on every open so a reused modal never shows the previous attempt.
  useEffect(() => {
    if (!open) return;
    setF({ ...EMPTY_FORM, name: initialName?.trim() ?? "" });
    setErr(null); setDup(null); setBusy(false);
    setContactSel(""); setContactTitle(""); setContactEmail("");
  }, [open, initialName]);

  const submit = async () => {
    const title = f.name.trim();
    if (!title) { setErr("Company name is required."); return; }
    setBusy(true); setErr(null); setDup(null);
    const opt = (v: string) => v.trim() || undefined;
    try {
      const r = await createCompany({
        title,
        ticketId: opt(f.ticketId),
        shortName: opt(f.shortName),
        relationshipType: opt(f.relationshipType),
        businessType: opt(f.businessType),
        secondaryBusinessType: opt(f.secondaryBusinessType),
        phone: opt(f.phone),
        fax: opt(f.fax),
        email: opt(f.email),
        website: opt(f.website),
        address: opt(f.address),
        address2: opt(f.address2),
        city: opt(f.city),
        state: opt(f.state),
        zip: opt(f.zip),
        assignedTo: opt(f.assignedTo),
        description: opt(f.description),
        // Primary contact: existing pick sends its id (server re-links the
        // row); a free-typed "new:<name>" sends only the name (server creates
        // a fresh CRMContact). Name travels in both cases for the fallback.
        contactId: contactSel && !contactSel.startsWith(NEW_CONTACT_PREFIX) ? contactSel : undefined,
        contactName: contactSel.startsWith(NEW_CONTACT_PREFIX)
          ? opt(contactSel.slice(NEW_CONTACT_PREFIX.length))
          : opt(((allContacts ?? []) as ContactSlim[]).find((c) => c.id === contactSel)?.name ?? ""),
        contactTitle: opt(contactTitle),
        contactEmail: opt(contactEmail),
      });
      if (r.ok) {
        if (r.contactWarning) {
          toast({ title: "Contact not saved", description: r.contactWarning, variant: "destructive" });
        }
        toast({ title: "Company created", description: `${r.company.title} (${r.company.ticketId ?? "ID pending"})` });
        onCreated(r.company);
        onOpenChange(false);
        return;
      }
      if ((r.code === "dup-title" || r.code === "dup-id") && r.existing) {
        setDup(r.existing);
        setErr(r.error);
        return;
      }
      setErr(r.error);
    } catch (e) {
      setErr((e as Error)?.message || "Could not create the company — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const field = (id: string, label: string, k: keyof FormState, placeholder?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={f[k]} placeholder={placeholder} onChange={setInput(k)} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-4 h-4" /> New Company
          </DialogTitle>
          <DialogDescription>
            Records and imports find the right company by its Company ID —
            enter your own code, or leave it blank to get the next COM-…
            number automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cc-name">Company Name <span className="text-destructive">*</span></Label>
            <Input id="cc-name" value={f.name} autoFocus placeholder="e.g. Acme Construction"
              onChange={setInput("name")}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cc-id">Company ID</Label>
              <Input id="cc-id" value={f.ticketId} placeholder="Blank = auto-assigned COM-… number"
                onChange={setInput("ticketId")} />
            </div>
            {field("cc-short", "Abbreviated Name", "shortName", "e.g. ACME")}
          </div>

          <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Classification</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cc-rel">Relationship Type</Label>
              <ChoiceSelect id="cc-rel" value={f.relationshipType} options={RELATIONSHIP_TYPES} onChange={set("relationshipType")} allowCustom />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-biz">Business Type</Label>
              <ChoiceSelect id="cc-biz" value={f.businessType} options={BUSINESS_TYPES} onChange={set("businessType")} allowCustom />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-biz2">Secondary Business Type</Label>
              <ChoiceSelect id="cc-biz2" value={f.secondaryBusinessType} options={BUSINESS_TYPES} onChange={set("secondaryBusinessType")} allowCustom />
            </div>
            {field("cc-assigned", "Assigned To", "assignedTo", "Person at your firm")}
          </div>

          <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Primary Contact</div>
          <div className="space-y-1.5">
            <Label>Contact Name</Label>
            <CreatableSelect
              value={contactSel}
              onValueChange={pickContact}
              options={contactOpts}
              placeholder="Pick an existing contact or add a new one"
              loading={contactsLoading}
              addLabel="Add new contact"
              newPlaceholder="Contact name"
              // Free-typed name — local sentinel only; the CRMContact row is
              // created by the SAME create-company call (no orphan contacts
              // if the user cancels the modal).
              onCreate={async (name) => ({ id: `${NEW_CONTACT_PREFIX}${name}`, label: name })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cc-ct-title">Contact Title</Label>
              <Input id="cc-ct-title" value={contactTitle} placeholder="e.g. VP of Operations"
                onChange={(e) => setContactTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-ct-email">Contact Email</Label>
              <Input id="cc-ct-email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
          </div>

          <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Company Contact Info</div>
          <div className="grid grid-cols-2 gap-3">
            {field("cc-phone", "Phone", "phone")}
            {field("cc-fax", "Fax", "fax")}
            {field("cc-email", "Email", "email")}
            {field("cc-web", "Website", "website")}
          </div>

          <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Address</div>
          <div className="grid grid-cols-2 gap-3">
            {field("cc-street1", "Street 1", "address")}
            {field("cc-street2", "Street 2", "address2", "Suite / floor / unit")}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {field("cc-city", "City", "city")}
            {field("cc-state", "State", "state")}
            {field("cc-zip", "Zip", "zip")}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc-desc">Description</Label>
            <Textarea id="cc-desc" value={f.description} rows={3}
              placeholder="Notes about this company (optional)"
              onChange={setInput("description")} />
          </div>

          {err && (
            <div className="text-xs rounded border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2">
              {err}
            </div>
          )}
          {dup && (
            <Button variant="outline" size="sm" className="w-full" disabled={busy}
              onClick={() => { onCreated(dup); onOpenChange(false); }}>
              <Check className="w-3.5 h-3.5 mr-1.5" />
              Use existing: {dup.title}{dup.ticketId ? ` (${dup.ticketId})` : ""}
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || !f.name.trim()}>
            {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Create Company
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const NEW_CONTACT_PREFIX = "new:";
