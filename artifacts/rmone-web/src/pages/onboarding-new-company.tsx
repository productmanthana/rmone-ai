import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/useAuth";
import { isSuperAdmin } from "@/lib/roleResolver";
import { Button } from "@/components/ui/button";
import {
  Building2, User, CheckCircle2, Loader2, ChevronRight, ArrowLeft, Mail,
  Globe, Phone, MapPin, Briefcase, ShieldCheck, AlertCircle,
} from "lucide-react";
import { provisionTenant, checkTenantAvailability } from "@/lib/api";
import { Z } from "@/lib/zLayers";

const inp =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm " +
  "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow";

const sel =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none " +
  "focus:ring-2 focus:ring-ring transition-shadow";

const STEPS = [
  { icon: Building2,    label: "Company" },
  { icon: User,         label: "Admin" },
  { icon: CheckCircle2, label: "Review" },
];

const COUNTRIES = [
  "", "United States", "Canada", "United Kingdom", "Australia", "New Zealand",
  "Ireland", "Germany", "France", "Netherlands", "Singapore", "Other",
];

const INDUSTRIES = [
  "", "Construction", "Engineering", "Architecture", "Real Estate", "Other",
];

const OWNERSHIP_TYPES = [
  "", "Private", "Public", "Joint Venture", "Non-Profit", "Other",
];

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
        style={{ background: "#6BA53920" }}>
        <Icon className="w-3.5 h-3.5" style={{ color: "#6BA539" }} />
      </div>
      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
    </div>
  );
}

function Field({ label, required, children, hint }: {
  label: string; required?: boolean; children: React.ReactNode; hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ── 3-D flower celebration burst ───────────────────────────────────────── */
const FLOWER_EMOJIS = ["🌸", "🌺", "🌹", "🌻", "🌼", "💐", "✨", "🎊", "🎉"];

interface FlowerParticle {
  id: number; emoji: string;
  x: number; y: number;
  vx: number; vy: number;
  rotX: number; rotY: number; rotZ: number;
  spinX: number; spinY: number; spinZ: number;
  size: number; opacity: number;
  depth: number;
}

function TenantFlowerBurst() {
  const [particles, setParticles] = useState<FlowerParticle[]>([]);
  const [active, setActive] = useState(true);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const lastRef = useRef<number>(0);

  useEffect(() => {
    const COUNT = 28;
    const initial: FlowerParticle[] = Array.from({ length: COUNT }, (_, i) => {
      const angle = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const speed = 3.5 + Math.random() * 4.5;
      return {
        id: i,
        emoji: FLOWER_EMOJIS[i % FLOWER_EMOJIS.length],
        x: 50 + (Math.random() - 0.5) * 6,
        y: 42 + (Math.random() - 0.5) * 6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.5,
        rotX: Math.random() * 360,
        rotY: Math.random() * 360,
        rotZ: Math.random() * 360,
        spinX: (Math.random() - 0.5) * 8,
        spinY: (Math.random() - 0.5) * 10,
        spinZ: (Math.random() - 0.5) * 6,
        size: 1.4 + Math.random() * 1.6,
        opacity: 1,
        depth: 80 + Math.random() * 160,
      };
    });
    setParticles(initial);

    const GRAVITY = 0.18;
    const DURATION = 3400;
    let prev = performance.now();
    startRef.current = prev;

    function tick(now: number) {
      const elapsed = now - startRef.current;
      const dt = Math.min(now - prev, 50);
      prev = now;
      lastRef.current = elapsed;

      if (elapsed > DURATION) { setActive(false); return; }

      setParticles(ps => ps.map(p => ({
        ...p,
        x: p.x + p.vx * dt * 0.02,
        y: p.y + p.vy * dt * 0.02,
        vy: p.vy + GRAVITY * dt * 0.02,
        vx: p.vx * (1 - 0.008 * dt * 0.02 * 60),
        rotX: p.rotX + p.spinX * dt * 0.05,
        rotY: p.rotY + p.spinY * dt * 0.05,
        rotZ: p.rotZ + p.spinZ * dt * 0.05,
        opacity: elapsed < DURATION * 0.6 ? 1 : 1 - (elapsed - DURATION * 0.6) / (DURATION * 0.4),
      })));

      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  if (!active) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, pointerEvents: "none", zIndex: Z.POPUP,
      perspective: "600px", perspectiveOrigin: "50% 42%",
    }}>
      {particles.map(p => (
        <div key={p.id} style={{
          position: "absolute",
          left: `${p.x}%`, top: `${p.y}%`,
          fontSize: `${p.size}rem`,
          opacity: p.opacity,
          transform: `
            translateZ(${p.depth * (1 - lastRef.current / 3400)}px)
            rotateX(${p.rotX}deg)
            rotateY(${p.rotY}deg)
            rotateZ(${p.rotZ}deg)
          `,
          willChange: "transform, opacity",
          filter: `drop-shadow(0 2px 6px rgba(0,0,0,0.35))`,
          userSelect: "none",
        }}>
          {p.emoji}
        </div>
      ))}
    </div>
  );
}
/* ─────────────────────────────────────────────────────────────────────────── */

export default function ProvisionTenantPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const superAdmin = isSuperAdmin(user?.username, user?.tenant);

  if (!superAdmin) {
    return (
      <div className="p-10 text-center text-muted-foreground">
        This page is only accessible to superadmins.
      </div>
    );
  }

  const [step, setStep] = useState(0);

  const [companyName,    setCompanyName]    = useState("");
  const [website,        setWebsite]        = useState("");
  const [phone,          setPhone]          = useState("");
  const [email,          setEmail]          = useState("");
  const [streetAddress,  setStreetAddress]  = useState("");
  const [city,           setCity]           = useState("");
  const [state,          setState]          = useState("");
  const [zip,            setZip]            = useState("");
  const [country,        setCountry]        = useState("");
  const [industry,       setIndustry]       = useState("");
  const [ownershipType,  setOwnershipType]  = useState("");
  const [licenseNumber,  setLicenseNumber]  = useState("");

  const [adminName,     setAdminName]     = useState("");
  const [adminEmail,    setAdminEmail]    = useState("");
  const [emailTouched,  setEmailTouched]  = useState(false);
  const [sendInvite, setSendInvite] = useState(true);

  const [nameCheck, setNameCheck] = useState<"idle" | "checking" | "taken" | "ok">("idle");
  const nameCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const tid = companyName.trim().replace(/\s+/g, "_");
    if (!tid || tid.length < 2) { setNameCheck("idle"); return; }
    setNameCheck("checking");
    if (nameCheckRef.current) clearTimeout(nameCheckRef.current);
    nameCheckRef.current = setTimeout(async () => {
      try {
        const res = await checkTenantAvailability(tid);
        setNameCheck(res.available ? "ok" : "taken");
      } catch {
        setNameCheck("idle");
      }
    }, 500);
    return () => { if (nameCheckRef.current) clearTimeout(nameCheckRef.current); };
  }, [companyName]);

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [done, setDone] = useState<{
    tenantId: string; adminGuid: string; inviteSent: boolean; inviteMessage: string;
  } | null>(null);

  const step0ok = companyName.trim().length > 1 && nameCheck !== "taken" && nameCheck !== "checking";
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adminEmail.trim());
  const step1ok = adminName.trim().length > 0 && emailValid;

  async function handleCreate() {
    if (submitting) return;
    setSubmitting(true); setError(null);
    try {
      const result = await provisionTenant({
        companyName:   companyName.trim(),
        adminName:     adminName.trim(),
        adminEmail:    adminEmail.trim(),
        sendInvite,
        website:       website.trim()       || undefined,
        phone:         phone.trim()         || undefined,
        companyEmail:  email.trim()         || undefined,
        streetAddress: streetAddress.trim() || undefined,
        city:          city.trim()          || undefined,
        state:         state.trim()         || undefined,
        zip:           zip.trim()           || undefined,
        country:       country              || undefined,
        industry:      industry             || undefined,
        ownershipType: ownershipType        || undefined,
        licenseNumber: licenseNumber.trim() || undefined,
      });
      setDone({
        tenantId:      result.tenantId,
        adminGuid:     result.adminGuid,
        inviteSent:    result.inviteSent,
        inviteMessage: result.inviteMessage,
      });
    } catch (e) {
      setError((e as Error)?.message || "Unexpected error");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setDone(null); setStep(0);
    setCompanyName(""); setWebsite(""); setPhone(""); setEmail("");
    setStreetAddress(""); setCity(""); setState(""); setZip(""); setCountry("");
    setIndustry(""); setOwnershipType(""); setLicenseNumber("");
    setAdminName(""); setAdminEmail(""); setSendInvite(true);
  }

  if (done) {
    return (
      <div className="p-6 max-w-xl mx-auto space-y-6 pt-14" style={{ position: "relative" }}>

        {/* ── 3-D flower celebration ─────────────────────────────────── */}
        <TenantFlowerBurst />
        {/* ─────────────────────────────────────────────────────────── */}
        {/* Invite confirmation banner */}
        {done.inviteSent && adminEmail && (
          <div className="rounded-xl px-5 py-3 flex items-start gap-3"
            style={{ background: "#fef2f2", border: "1px solid #fca5a5" }}>
            <Mail className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#dc2626" }} />
            <p className="text-sm font-medium" style={{ color: "#dc2626" }}>
              Invitation sent to <strong>{adminEmail}</strong>
            </p>
          </div>
        )}

        <div className="text-center space-y-3">
          <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto" />
          <h1 className="text-2xl font-bold">Company Created</h1>
          <p className="text-muted-foreground">
            <strong>{done.tenantId}</strong> is ready in RM ONE.
          </p>
        </div>

        {/* Summary table — more spacious */}
        <div className="rounded-xl border border-border overflow-hidden">
          {[
            { label: "Company",     value: done.tenantId },
            { label: "Admin email", value: adminEmail },
            { label: "Invite sent", value: done.inviteSent ? "Yes — check inbox" : (() => {
                const m = done.inviteMessage || "";
                if (!m) return "Not sent";
                if (m.includes("invalid_format") || m.includes("invalid_email") || m.includes("Invalid email"))
                  return "Not sent — email address is invalid. Update the admin's email and re-send the invite.";
                if (m.includes("Failed to send email"))
                  return "Not sent — email delivery failed. You can re-send the invite from the admin panel.";
                return m.length > 120 ? "Not sent — invite delivery failed." : m;
              })() },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between px-6 py-4 border-b border-border last:border-0">
              <span className="text-sm text-muted-foreground w-32 shrink-0">{label}</span>
              <span className="text-sm font-semibold text-right">{value}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-3 justify-center pt-2">
          <Button variant="outline" onClick={resetForm}>Create Another</Button>
          <Button onClick={() => navigate("/onboarding/history")}>View All Companies</Button>
        </div>
      </div>
    );
  }

  const StepperHeader = () => (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => {
        const done_ = i < step;
        const active = i === step;
        const Icon = s.icon;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className={`flex items-center gap-2 shrink-0 ${active ? "text-foreground" : done_ ? "text-green-500" : "text-muted-foreground"}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 text-xs font-bold
                ${active ? "border-[#6BA539] bg-[#6BA539] text-white"
                : done_ ? "border-green-500 bg-green-500 text-white"
                : "border-muted-foreground/30 bg-background"}`}>
                {done_ ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <span className="text-sm font-semibold hidden sm:inline">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 mx-3 h-0.5 rounded-full ${done_ ? "bg-green-500" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );

  const NavButtons = ({ nextDisabled, nextLabel, onNext }: {
    nextDisabled?: boolean; nextLabel?: string; onNext?: () => void;
  }) => (
    <div className="flex justify-between pt-5 border-t border-border mt-6">
      <Button variant="ghost" onClick={() => step === 0 ? navigate("/onboarding/history") : setStep(s => s - 1)}>
        <ArrowLeft className="w-4 h-4 mr-1.5" />
        {step === 0 ? "Cancel" : "Back"}
      </Button>
      <Button
        disabled={nextDisabled}
        onClick={onNext ?? (() => setStep(s => s + 1))}
        style={!nextDisabled ? { background: "#6BA539", color: "#fff" } : undefined}
        className={!nextDisabled ? "hover:opacity-90" : ""}
      >
        {nextLabel === "Creating…" && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
        {nextLabel ?? "Next"}
        {!nextLabel && <ChevronRight className="w-4 h-4 ml-1.5" />}
      </Button>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">New Company</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Provision a new tenant with a full company profile and admin account.
        </p>
      </div>

      <StepperHeader />

      {/* ── Step 0: Company ───────────────────────────────────────────────── */}
      {step === 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">

            {/* LEFT: Identity */}
            <div className="p-6 space-y-5">
              <SectionHeader icon={Building2} title="Basic Info" />

              <Field label="Company name" required
                hint="This becomes the tenant identifier used across RM ONE.">
                <input
                  className={inp} placeholder="e.g. Acme Construction"
                  value={companyName} onChange={e => setCompanyName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && step0ok) setStep(1); }}
                />
              </Field>

              {companyName.trim() && (
                <div className="rounded-lg px-3 py-2 text-xs text-muted-foreground"
                  style={{ background: "#6BA53910", border: "1px solid #6BA53930" }}>
                  Tenant ID: <code className="font-mono font-semibold" style={{ color: "#6BA539" }}>
                    {companyName.trim().replace(/\s+/g, "_")}
                  </code>
                  {nameCheck === "checking" && (
                    <span className="ml-2 inline-flex items-center gap-1" style={{ color: "#94a3b8" }}>
                      <Loader2 className="w-3 h-3 animate-spin" /> checking…
                    </span>
                  )}
                </div>
              )}

              {nameCheck === "taken" && (
                <div className="rounded-lg px-3 py-2.5 flex items-start gap-2"
                  style={{ background: "#fef2f2", border: "1px solid #fca5a5" }}>
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#dc2626" }} />
                  <div>
                    <p className="text-xs font-semibold" style={{ color: "#dc2626" }}>
                      This company name is already taken.
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#b91c1c" }}>
                      Choose a different name, or go to All Companies to manage the existing tenant.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Field label="Website URL">
                  <div className="relative">
                    <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input className={inp + " pl-8"} placeholder="https://acme.com"
                      value={website} onChange={e => setWebsite(e.target.value)} />
                  </div>
                </Field>
                <Field label="Phone">
                  <div className="relative">
                    <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input className={inp + " pl-8"} placeholder="+1 (555) 000-0000"
                      value={phone} onChange={e => setPhone(e.target.value)} />
                  </div>
                </Field>
              </div>

              <Field label="Company email">
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input className={inp + " pl-8"} type="email" placeholder="info@acme.com"
                    value={email} onChange={e => setEmail(e.target.value)} />
                </div>
              </Field>

              {/* Business Profile inside left column */}
              <div className="border-t border-border pt-5 space-y-5">
                <SectionHeader icon={Briefcase} title="Business Profile" />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Industry / Sector">
                    <select className={sel} value={industry} onChange={e => setIndustry(e.target.value)}>
                      {INDUSTRIES.map(i => <option key={i} value={i}>{i || "Select…"}</option>)}
                    </select>
                  </Field>
                  <Field label="Ownership type">
                    <select className={sel} value={ownershipType} onChange={e => setOwnershipType(e.target.value)}>
                      {OWNERSHIP_TYPES.map(o => <option key={o} value={o}>{o || "Select…"}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Contractor license number">
                  <input className={inp} placeholder="e.g. LIC-123456"
                    value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} />
                </Field>
              </div>
            </div>

            {/* RIGHT: Address */}
            <div className="p-6 space-y-5">
              <SectionHeader icon={MapPin} title="Address" />

              <Field label="Street address">
                <input className={inp} placeholder="123 Main Street"
                  value={streetAddress} onChange={e => setStreetAddress(e.target.value)} />
              </Field>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <Field label="City">
                    <input className={inp} placeholder="New York"
                      value={city} onChange={e => setCity(e.target.value)} />
                  </Field>
                </div>
                <Field label="State / Province">
                  <input className={inp} placeholder="NY"
                    value={state} onChange={e => setState(e.target.value)} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="ZIP / Postal code">
                  <input className={inp} placeholder="10001"
                    value={zip} onChange={e => setZip(e.target.value)} />
                </Field>
                <Field label="Country">
                  <select className={sel} value={country} onChange={e => setCountry(e.target.value)}>
                    {COUNTRIES.map(c => <option key={c} value={c}>{c || "Select country…"}</option>)}
                  </select>
                </Field>
              </div>

              {/* Map preview stub — visual polish */}
              <div className="rounded-xl overflow-hidden border border-border"
                style={{ height: 160, background: "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)" }}>
                <div className="flex items-center justify-center h-full gap-2">
                  <MapPin className="w-5 h-5 text-gray-500 shrink-0" />
                  <span className="text-sm font-bold text-gray-900">
                    {[streetAddress, city, state, country].filter(Boolean).join(", ") || "Address preview"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Footer nav */}
          <div className="px-6 pb-6">
            <NavButtons nextDisabled={!step0ok} />
          </div>
        </div>
      )}

      {/* ── Step 1: Admin ────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
            {/* Left: form */}
            <div className="p-6 space-y-5">
              <SectionHeader icon={ShieldCheck} title="Admin Account" />
              <Field label="Full name" required>
                <input className={inp} placeholder="e.g. Jane Smith"
                  value={adminName} onChange={e => setAdminName(e.target.value)} />
              </Field>
              <Field label="Email address" required>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    className={inp + " pl-8" + (emailTouched && !emailValid && adminEmail.trim() ? " border-red-500 focus:border-red-500 focus:ring-red-500/30" : "")}
                    type="email"
                    placeholder="jane@acme.com"
                    value={adminEmail}
                    onChange={e => { setAdminEmail(e.target.value); if (emailTouched) setEmailTouched(false); }}
                    onBlur={() => { if (adminEmail.trim()) setEmailTouched(true); }}
                  />
                </div>
                {emailTouched && !emailValid && adminEmail.trim() && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <span>⚠</span> Please enter a valid email address (e.g. jane@company.com)
                  </p>
                )}
              </Field>

              <label className="flex items-start gap-3 rounded-xl border border-border p-4 cursor-pointer
                hover:border-[#6BA539]/40 transition-colors group">
                <input
                  type="checkbox" checked={sendInvite}
                  onChange={e => setSendInvite(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#6BA539]"
                />
                <div>
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Mail className="w-3.5 h-3.5" style={{ color: "#6BA539" }} />
                    Send login invite email
                  </span>
                  <span className="text-muted-foreground text-xs block mt-0.5">
                    The admin receives a secure link to set their own password and log in.
                  </span>
                </div>
              </label>
            </div>

            {/* Right: context */}
            <div className="p-6 flex flex-col gap-4">
              <SectionHeader icon={Building2} title="Company Summary" />
              <div className="rounded-xl border border-border divide-y text-sm">
                <div className="flex justify-between px-4 py-3">
                  <span className="text-muted-foreground">Company</span>
                  <span className="font-semibold">{companyName}</span>
                </div>
                {website && (
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-muted-foreground">Website</span>
                    <span className="font-medium truncate max-w-[180px]">{website}</span>
                  </div>
                )}
                {(city || country) && (
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-muted-foreground">Location</span>
                    <span className="font-medium">{[city, country].filter(Boolean).join(", ")}</span>
                  </div>
                )}
                {industry && (
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-muted-foreground">Industry</span>
                    <span className="font-medium">{industry}</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                The admin account will have full access to the company's RM ONE workspace.
                They can invite additional users and configure permissions after setup.
              </p>
            </div>
          </div>
          <div className="px-6 pb-6">
            <NavButtons nextDisabled={!step1ok} />
          </div>
        </div>
      )}

      {/* ── Step 2: Review ───────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-border">

            {/* Company */}
            <div className="p-6 space-y-1">
              <SectionHeader icon={Building2} title="Company" />
              <ReviewRow label="Name"     value={companyName.trim()} />
              {website       && <ReviewRow label="Website"  value={website} />}
              {phone         && <ReviewRow label="Phone"    value={phone} />}
              {email         && <ReviewRow label="Email"    value={email} />}
              {industry      && <ReviewRow label="Industry" value={industry} />}
              {ownershipType && <ReviewRow label="Ownership" value={ownershipType} />}
              {licenseNumber && <ReviewRow label="License #" value={licenseNumber} />}
            </div>

            {/* Address */}
            <div className="p-6 space-y-1">
              <SectionHeader icon={MapPin} title="Address" />
              {streetAddress
                ? <>
                    <ReviewRow label="Street"  value={streetAddress} />
                    <ReviewRow label="City"    value={[city, state].filter(Boolean).join(", ")} />
                    <ReviewRow label="ZIP"     value={zip} />
                    <ReviewRow label="Country" value={country} />
                  </>
                : <p className="text-sm text-muted-foreground">No address provided.</p>
              }
            </div>

            {/* Admin */}
            <div className="p-6 space-y-1">
              <SectionHeader icon={ShieldCheck} title="Admin" />
              <ReviewRow label="Name"   value={adminName} />
              <ReviewRow label="Email"  value={adminEmail} />
              <ReviewRow label="Invite" value={sendInvite ? "Will be sent" : "Skipped"} />
            </div>
          </div>

          {error && (
            <div className="mx-6 rounded-lg px-4 py-3 text-sm text-destructive"
              style={{ background: "hsl(var(--destructive)/0.08)", border: "1px solid hsl(var(--destructive)/0.3)" }}>
              {error}
            </div>
          )}

          <div className="px-6 pb-6">
            <NavButtons
              nextLabel={submitting ? "Creating…" : "Create Company"}
              nextDisabled={submitting}
              onNext={handleCreate}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-baseline gap-2 py-1.5 text-sm border-b border-border/50 last:border-0">
      <span className="text-muted-foreground shrink-0 w-20">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}
