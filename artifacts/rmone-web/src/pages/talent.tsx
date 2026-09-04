import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Users,
  User,
  Mail,
  Building2,
  Briefcase,
  MapPin,
  Star,
  Plus,
  Trash2,
  X,
  Loader2,
  AlertCircle,
  FileText,
  Download,
  UploadCloud,
  Award,
  GraduationCap,
  Linkedin,
  Edit2,
  Check,
  ChevronLeft,
  Sparkles,
  Target,
  Calendar,
} from "lucide-react";
import {
  peopleSearch,
  getResourceProfile,
  updateResourceProfile,
  addResourceSkill,
  deleteResourceSkill,
  addResourceCertification,
  deleteResourceCertification,
  addResourceEducation,
  deleteResourceEducation,
  addResourceWorkHistory,
  deleteResourceWorkHistory,
  addResourcePortfolioProject,
  deleteResourcePortfolioProject,
  addResourceResume,
  deleteResourceResume,
  searchResourcesBySkill,
  requestUploadUrl,
  uploadFileToSignedUrl,
  resourceFileUrl,
  type PeopleSearchResult,
  type ResourceProfileBundle,
  type SkillSearchResult,
} from "@/lib/api";
import { generateResumePdf, type ResumeExtraSummary } from "@/lib/resumeGenerator";
import DateField from "@/components/DateField";

const BRAND = {
  bg: "var(--rm-bg)",
  card: "var(--rm-panel)",
  cardBorder: "var(--rm-panel-border)",
  green: "#6BA539",
  greenLight: "#A9C23F",
  orange: "#E87722",
  red: "#F87171",
  white: "var(--rm-text)",
  textSecondary: "var(--rm-text-muted)",
  textMuted: "var(--rm-text-faint)",
};

type TalentTab = "Profiles" | "Skill Search";

/* ──────────────── shared little helpers ──────────────── */

function initialsOf(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function fmtBytes(n?: number | null): string {
  if (!n || n <= 0) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} KB`;
  return `${n} B`;
}

const PANEL: React.CSSProperties = {
  backgroundColor: BRAND.card,
  border: `1px solid ${BRAND.cardBorder}`,
  borderRadius: 16,
  padding: 18,
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  backgroundColor: "var(--rm-bg)",
  border: `1px solid ${BRAND.cardBorder}`,
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  color: BRAND.white,
  outline: "none",
};

function FieldInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...INPUT_STYLE, ...(props.style || {}) }} />;
}

function btnPrimary(disabled?: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    backgroundColor: BRAND.green,
    color: "#FFFFFF",
    border: "none",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

function btnGhost(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    backgroundColor: "transparent",
    color: BRAND.textSecondary,
    border: `1px solid ${BRAND.cardBorder}`,
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  };
}

function SectionHeader({
  icon: Icon,
  title,
  count,
  color = BRAND.green,
  action,
}: {
  icon: typeof Award;
  title: string;
  count?: number;
  color?: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            backgroundColor: color + "22",
            border: `1px solid ${color}40`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={16} color={color} />
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: BRAND.white }}>{title}</div>
        {typeof count === "number" && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: BRAND.textMuted,
              backgroundColor: "var(--rm-bg)",
              border: `1px solid ${BRAND.cardBorder}`,
              borderRadius: 999,
              padding: "1px 8px",
            }}
          >
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: typeof Award; text: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "20px 12px",
        borderRadius: 10,
        border: `1px dashed ${BRAND.cardBorder}`,
        color: BRAND.textMuted,
        fontSize: 12.5,
      }}
    >
      <Icon size={20} color={BRAND.textMuted} />
      {text}
    </div>
  );
}

function ProficiencyDots({ level }: { level?: number | null }) {
  const n = Math.max(0, Math.min(5, level ?? 0));
  return (
    <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={11}
          color={i <= n ? BRAND.greenLight : BRAND.cardBorder}
          fill={i <= n ? BRAND.greenLight : "none"}
        />
      ))}
    </span>
  );
}

function DeleteButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      aria-label="Delete"
      style={{
        background: "transparent",
        border: "none",
        padding: 4,
        cursor: busy ? "not-allowed" : "pointer",
        color: BRAND.textMuted,
        display: "inline-flex",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = BRAND.red)}
      onMouseLeave={(e) => (e.currentTarget.style.color = BRAND.textMuted)}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
    </button>
  );
}

/* ──────────────── Profile detail ──────────────── */

/** True when the bundle has any enrichment worth showing (any list row OR any
 *  filled profile field). Drives the collapsed "upload only" empty state. */
function hasEnrichmentData(data?: ResourceProfileBundle): boolean {
  if (!data) return false;
  const p = data.profile;
  const hasProfile = !!(
    p &&
    (p.headline || p.bio || p.location || p.yearsExperience || p.availableFrom || p.preferredRoles || p.linkedinUrl)
  );
  return (
    hasProfile ||
    (data.skills?.length ?? 0) > 0 ||
    (data.certifications?.length ?? 0) > 0 ||
    (data.education?.length ?? 0) > 0 ||
    (data.workHistory?.length ?? 0) > 0 ||
    (data.projects?.length ?? 0) > 0 ||
    (data.resumes?.length ?? 0) > 0
  );
}

/** Compact empty state shown (in collapse mode) when a person has no talent
 *  data yet: a single résumé Upload button so the modal isn't a wall of empty
 *  "No X yet" cards. Once a résumé is uploaded the full editor appears. */
function EnrichmentEmptyState({
  guid,
  fallbackName,
  fallbackEmail,
  data,
  extraSummary,
}: {
  guid: string;
  onChanged: () => void;
  fallbackName?: string;
  fallbackEmail?: string;
  data?: ResourceProfileBundle;
  extraSummary?: ResumeExtraSummary;
}) {
  const [err, setErr] = useState<string | null>(null);

  const handleDownload = () => {
    try {
      setErr(null);
      generateResumePdf(guid, fallbackName, fallbackEmail, data, extraSummary);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't generate résumé");
    }
  };

  return (
    <div style={{ ...PANEL, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12, padding: 28 }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: BRAND.green + "1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Download size={22} color={BRAND.green} />
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.white }}>No talent profile yet</div>
        <div style={{ fontSize: 12.5, color: BRAND.textSecondary, marginTop: 3, maxWidth: 320 }}>
          Download a résumé compiled from this person's existing role, allocation and profile data.
        </div>
      </div>
      <button style={btnPrimary(false)} onClick={handleDownload}>
        <Download size={14} /> Download Resume
      </button>
      {err && (
        <div style={{ color: BRAND.red, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <AlertCircle size={13} /> {err}
        </div>
      )}
    </div>
  );
}

/**
 * Small standalone icon button that downloads the compiled résumé directly —
 * no talent-profile section required. Fetches the person's profile bundle by
 * `guid` on click and compiles the PDF from it + `resumeExtraSummary`. Meant
 * to sit in a corner of a hero/header area (e.g. next to the avatar in the
 * Resources "Profile" modal).
 */
export function ResumeDownloadButton({
  guid,
  fallbackName,
  fallbackEmail,
  resumeExtraSummary,
  size = 30,
  variant = "icon",
}: {
  guid: string;
  fallbackName?: string;
  fallbackEmail?: string;
  resumeExtraSummary?: ResumeExtraSummary;
  size?: number;
  /** "icon" = round icon-only button (e.g. corner of an avatar). "labeled" = pill button with text, for people who don't recognize the icon-only affordance. */
  variant?: "icon" | "labeled";
}) {
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  const handleClick = async () => {
    setLoading(true);
    try {
      const data = await qc.fetchQuery({
        queryKey: ["resource", guid],
        queryFn: () => getResourceProfile(guid),
        staleTime: 60 * 1000,
      });
      generateResumePdf(guid, fallbackName, fallbackEmail, data, resumeExtraSummary);
    } catch {
      generateResumePdf(guid, fallbackName, fallbackEmail, undefined, resumeExtraSummary);
    } finally {
      setLoading(false);
    }
  };

  if (variant === "labeled") {
    return (
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "7px 14px", borderRadius: 20,
          border: "none", backgroundColor: BRAND.green,
          color: "#FFFFFF", fontSize: 12.5, fontWeight: 600,
          cursor: loading ? "default" : "pointer",
          boxShadow: "0 2px 6px rgba(0,0,0,0.14)",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? (
          <Loader2 size={14} color="#FFFFFF" className="animate-spin" />
        ) : (
          <Download size={14} color="#FFFFFF" />
        )}
        Download Resume
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title="Download résumé"
      aria-label="Download résumé"
      style={{
        width: size, height: size, borderRadius: size / 2,
        border: "none", backgroundColor: BRAND.green,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: loading ? "default" : "pointer",
        boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
        opacity: loading ? 0.7 : 1,
      }}
    >
      {loading ? (
        <Loader2 size={size * 0.5} color="#FFFFFF" className="animate-spin" />
      ) : (
        <Download size={size * 0.5} color="#FFFFFF" />
      )}
    </button>
  );
}

/**
 * Self-contained talent-profile editor (resume, skills, certifications,
 * education, work history, portfolio + editable headline/bio). Fetches its own
 * data by `guid` so it can be dropped into the Talent page OR the Resources
 * "Profile" modal. Pass `showHeaderIdentity={false}` when the surrounding
 * surface already shows the person's avatar/name (e.g. the modal hero).
 * Pass `collapseWhenEmpty` to show only a single Upload button (instead of a
 * wall of empty sections) until the person actually has talent data.
 */
export function ResourceEnrichment({
  guid,
  fallbackName,
  fallbackEmail,
  showHeaderIdentity = true,
  collapseWhenEmpty = false,
  resumeExtraSummary,
}: {
  guid: string;
  fallbackName?: string;
  fallbackEmail?: string;
  showHeaderIdentity?: boolean;
  collapseWhenEmpty?: boolean;
  resumeExtraSummary?: ResumeExtraSummary;
}) {
  const qc = useQueryClient();
  const queryKey = ["resource", guid] as const;
  const profileQ = useQuery({
    queryKey,
    queryFn: () => getResourceProfile(guid),
    staleTime: 60 * 1000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const data = profileQ.data;
  const name = data?.name || fallbackName || "Name not recorded";
  const email = data?.email || fallbackEmail || "";

  if (profileQ.isLoading) {
    return (
      <div style={{ ...PANEL, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: BRAND.textSecondary }}>
        <Loader2 size={18} className="animate-spin" /> Loading profile…
      </div>
    );
  }

  if (profileQ.isError) {
    return (
      <div style={{ ...PANEL, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: BRAND.red, fontSize: 13 }}>
          <AlertCircle size={16} /> Couldn't load this profile.
        </div>
        <button style={btnGhost()} onClick={() => profileQ.refetch()}>Retry</button>
      </div>
    );
  }

  // Collapsed empty state: no data yet → just a Download Resume button, no empty cards.
  if (collapseWhenEmpty && !hasEnrichmentData(data)) {
    return (
      <EnrichmentEmptyState
        guid={guid}
        onChanged={invalidate}
        fallbackName={fallbackName}
        fallbackEmail={fallbackEmail}
        data={data}
        extraSummary={resumeExtraSummary}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ProfileHeaderCard guid={guid} name={name} email={email} data={data} onSaved={invalidate} showIdentity={showHeaderIdentity} />

      <ResumeSection guid={guid} data={data} onChanged={invalidate} />

      <SkillsSection guid={guid} data={data} onChanged={invalidate} />

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <CertificationsSection guid={guid} data={data} onChanged={invalidate} />
        <EducationSection guid={guid} data={data} onChanged={invalidate} />
        <WorkHistorySection guid={guid} data={data} onChanged={invalidate} />
        <PortfolioSection guid={guid} data={data} onChanged={invalidate} />
      </div>
    </div>
  );
}

function ProfileDetail({
  guid,
  fallbackName,
  fallbackEmail,
  onBack,
}: {
  guid: string;
  fallbackName?: string;
  fallbackEmail?: string;
  onBack: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <button
        onClick={onBack}
        style={{ ...btnGhost(), alignSelf: "flex-start" }}
      >
        <ChevronLeft size={15} /> Back to results
      </button>

      <ResourceEnrichment guid={guid} fallbackName={fallbackName} fallbackEmail={fallbackEmail} />
    </div>
  );
}

/* ──────────────── Header card (editable profile) ──────────────── */

function ProfileHeaderCard({
  guid,
  name,
  email,
  data,
  onSaved,
  showIdentity = true,
}: {
  guid: string;
  name: string;
  email: string;
  data?: ResourceProfileBundle;
  onSaved: () => void;
  /** When false, the avatar + name + email block is hidden (e.g. embedded in a
   *  modal that already shows the person's identity in its hero). The editable
   *  headline / location / bio fields stay so the user can still enrich here. */
  showIdentity?: boolean;
}) {
  const p = data?.profile;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    headline: "",
    location: "",
    yearsExperience: "",
    preferredRoles: "",
    linkedinUrl: "",
    availableFrom: "",
    bio: "",
  });

  useEffect(() => {
    setForm({
      headline: p?.headline ?? "",
      location: p?.location ?? "",
      yearsExperience: p?.yearsExperience != null ? String(p.yearsExperience) : "",
      preferredRoles: p?.preferredRoles ?? "",
      linkedinUrl: p?.linkedinUrl ?? "",
      availableFrom: p?.availableFrom ? String(p.availableFrom).slice(0, 10) : "",
      bio: p?.bio ?? "",
    });
  }, [p, editing]);

  const save = useMutation({
    mutationFn: () =>
      updateResourceProfile(guid, {
        headline: form.headline,
        location: form.location,
        yearsExperience: form.yearsExperience === "" ? undefined : Number(form.yearsExperience),
        preferredRoles: form.preferredRoles,
        linkedinUrl: form.linkedinUrl,
        availableFrom: form.availableFrom || undefined,
        bio: form.bio,
      }),
    onSuccess: () => {
      setEditing(false);
      onSaved();
    },
  });

  return (
    <div style={{ ...PANEL, position: "relative", overflow: "hidden" }}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -40,
          right: -40,
          width: 140,
          height: 140,
          borderRadius: 70,
          background: `radial-gradient(circle, ${BRAND.green}22, transparent 70%)`,
          pointerEvents: "none",
        }}
      />
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {showIdentity && (
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: "50%",
              backgroundColor: BRAND.green,
              color: "#FFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {initialsOf(name)}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 220 }}>
          {showIdentity && (
            <div style={{ fontSize: 20, fontWeight: 800, color: BRAND.white }}>{name}</div>
          )}
          {showIdentity && email && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: BRAND.textSecondary, marginTop: 3 }}>
              <Mail size={13} /> {email}
            </div>
          )}
          {!editing && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {p?.headline ? (
                <div style={{ fontSize: 14, fontWeight: 600, color: BRAND.white }}>{p.headline}</div>
              ) : (
                <div style={{ fontSize: 13, color: BRAND.textMuted, fontStyle: "italic" }}>No headline yet</div>
              )}
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5, color: BRAND.textSecondary }}>
                {p?.location && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <MapPin size={13} color={BRAND.orange} /> {p.location}
                  </span>
                )}
                {p?.yearsExperience != null && p.yearsExperience !== "" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Briefcase size={13} color={BRAND.greenLight} /> {p.yearsExperience} yrs exp
                  </span>
                )}
                {p?.availableFrom && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Calendar size={13} color={BRAND.greenLight} /> Available {fmtDate(p.availableFrom)}
                  </span>
                )}
                {p?.preferredRoles && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Target size={13} color={BRAND.green} /> {p.preferredRoles}
                  </span>
                )}
                {p?.linkedinUrl && (
                  <a
                    href={p.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, color: BRAND.green, textDecoration: "none" }}
                  >
                    <Linkedin size={13} /> LinkedIn
                  </a>
                )}
              </div>
              {p?.bio && <div style={{ fontSize: 12.5, color: BRAND.textSecondary, marginTop: 4, lineHeight: 1.5 }}>{p.bio}</div>}
            </div>
          )}
        </div>
        {!editing && (
          <button style={btnGhost()} onClick={() => setEditing(true)}>
            <Edit2 size={13} /> Edit
          </button>
        )}
      </div>

      {editing && (
        <div style={{ marginTop: 16, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <LabeledInput label="Headline" value={form.headline} onChange={(v) => setForm((f) => ({ ...f, headline: v }))} />
          <LabeledInput label="Location" value={form.location} onChange={(v) => setForm((f) => ({ ...f, location: v }))} />
          <LabeledInput label="Years of experience" type="number" value={form.yearsExperience} onChange={(v) => setForm((f) => ({ ...f, yearsExperience: v }))} />
          <LabeledInput label="Available from" type="date" value={form.availableFrom} onChange={(v) => setForm((f) => ({ ...f, availableFrom: v }))} />
          <LabeledInput label="Preferred roles" value={form.preferredRoles} onChange={(v) => setForm((f) => ({ ...f, preferredRoles: v }))} />
          <LabeledInput label="LinkedIn URL" value={form.linkedinUrl} onChange={(v) => setForm((f) => ({ ...f, linkedinUrl: v }))} />
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: BRAND.textMuted, display: "block", marginBottom: 4 }}>Bio</label>
            <textarea
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              rows={3}
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
          </div>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
            <button style={btnPrimary(save.isPending)} disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
            </button>
            <button style={btnGhost()} onClick={() => setEditing(false)} disabled={save.isPending}>
              Cancel
            </button>
            {save.isError && <span style={{ color: BRAND.red, fontSize: 12, alignSelf: "center" }}>Save failed</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, color: BRAND.textMuted, display: "block", marginBottom: 4 }}>{label}</label>
      {type === "date" ? (
        <DateField value={value} onChange={onChange} />
      ) : (
        <FieldInput type={type} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

/* ──────────────── Resume section ──────────────── */

function ResumeSection({
  guid,
  data,
  onChanged,
}: {
  guid: string;
  data?: ResourceProfileBundle;
  onChanged: () => void;
}) {
  const resumes = data?.resumes ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { uploadURL, objectPath } = await requestUploadUrl(file.name, file.size, file.type || "application/octet-stream");
      await uploadFileToSignedUrl(uploadURL, file);
      return addResourceResume(guid, {
        objectPath,
        fileName: file.name,
        contentType: file.type || undefined,
        sizeBytes: file.size,
        isPrimary: true,
      });
    },
    onSuccess: () => {
      setUploadErr(null);
      if (fileRef.current) fileRef.current.value = "";
      onChanged();
    },
    onError: (e) => setUploadErr(e instanceof Error ? e.message : "Upload failed"),
  });

  const del = useMutation({
    mutationFn: (id: number) => deleteResourceResume(guid, id),
    onMutate: (id) => setDeletingId(id),
    onSettled: () => setDeletingId(null),
    onSuccess: onChanged,
  });

  return (
    <div style={PANEL}>
      <SectionHeader
        icon={FileText}
        title="Resumes"
        count={resumes.length}
        color={BRAND.orange}
        action={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
              }}
            />
            <button
              style={btnPrimary(upload.isPending)}
              disabled={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              {upload.isPending ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />} Upload
            </button>
          </>
        }
      />
      {uploadErr && (
        <div style={{ color: BRAND.red, fontSize: 12, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <AlertCircle size={13} /> {uploadErr}
        </div>
      )}
      {resumes.length === 0 ? (
        <EmptyState icon={FileText} text="No resumes uploaded yet." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {resumes.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${BRAND.cardBorder}`,
                backgroundColor: "var(--rm-bg)",
              }}
            >
              <FileText size={16} color={BRAND.orange} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: BRAND.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.fileName}
                  </span>
                  {r.isPrimary && (
                    <span style={{ fontSize: 9, fontWeight: 800, color: BRAND.green, backgroundColor: BRAND.green + "22", padding: "2px 6px", borderRadius: 4, letterSpacing: 0.4 }}>
                      PRIMARY
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: BRAND.textMuted }}>
                  {fmtBytes(r.sizeBytes)}
                  {r.uploadedAt ? ` · ${fmtDate(r.uploadedAt)}` : ""}
                </div>
              </div>
              <a
                href={resourceFileUrl(r.objectPath)}
                target="_blank"
                rel="noreferrer"
                style={{ ...btnGhost(), padding: "6px 10px", textDecoration: "none" }}
              >
                <Download size={13} /> Open
              </a>
              <DeleteButton onClick={() => del.mutate(r.id)} busy={deletingId === r.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────── Skills section ──────────────── */

function SkillsSection({
  guid,
  data,
  onChanged,
}: {
  guid: string;
  data?: ResourceProfileBundle;
  onChanged: () => void;
}) {
  const skills = data?.skills ?? [];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ skillName: "", category: "", proficiency: "3", yearsExperience: "", isPrimary: false });
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const add = useMutation({
    mutationFn: () =>
      addResourceSkill(guid, {
        skillName: form.skillName.trim(),
        category: form.category.trim() || undefined,
        proficiency: form.proficiency ? Number(form.proficiency) : undefined,
        yearsExperience: form.yearsExperience ? Number(form.yearsExperience) : undefined,
        isPrimary: form.isPrimary,
      }),
    onSuccess: () => {
      setForm({ skillName: "", category: "", proficiency: "3", yearsExperience: "", isPrimary: false });
      setOpen(false);
      onChanged();
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => deleteResourceSkill(guid, id),
    onMutate: (id) => setDeletingId(id),
    onSettled: () => setDeletingId(null),
    onSuccess: onChanged,
  });

  return (
    <div style={PANEL}>
      <SectionHeader
        icon={Sparkles}
        title="Skills"
        count={skills.length}
        action={
          <button style={open ? btnGhost() : btnPrimary()} onClick={() => setOpen((o) => !o)}>
            {open ? <X size={14} /> : <Plus size={14} />} {open ? "Close" : "Add"}
          </button>
        }
      />

      {open && (
        <div style={{ marginBottom: 14, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <LabeledInput label="Skill name" value={form.skillName} onChange={(v) => setForm((f) => ({ ...f, skillName: v }))} />
          <LabeledInput label="Category" value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v }))} />
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: BRAND.textMuted, display: "block", marginBottom: 4 }}>Proficiency (1-5)</label>
            <select
              value={form.proficiency}
              onChange={(e) => setForm((f) => ({ ...f, proficiency: e.target.value }))}
              style={INPUT_STYLE as React.CSSProperties}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <LabeledInput label="Years exp" type="number" value={form.yearsExperience} onChange={(v) => setForm((f) => ({ ...f, yearsExperience: v }))} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: BRAND.textSecondary, alignSelf: "end", paddingBottom: 8 }}>
            <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))} />
            Primary skill
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
            <button style={btnPrimary(add.isPending || !form.skillName.trim())} disabled={add.isPending || !form.skillName.trim()} onClick={() => add.mutate()}>
              {add.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save skill
            </button>
            {add.isError && <span style={{ color: BRAND.red, fontSize: 12, alignSelf: "center" }}>Couldn't save</span>}
          </div>
        </div>
      )}

      {skills.length === 0 ? (
        <EmptyState icon={Sparkles} text="No skills recorded yet." />
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {skills.map((s) => (
            <div
              key={s.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 10px",
                borderRadius: 999,
                border: `1px solid ${s.isPrimary ? BRAND.green : BRAND.cardBorder}`,
                backgroundColor: s.isPrimary ? BRAND.green + "1A" : "var(--rm-bg)",
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 700, color: s.isPrimary ? BRAND.greenLight : BRAND.white }}>
                {s.skillName}
              </span>
              <ProficiencyDots level={s.proficiency} />
              {s.yearsExperience != null && s.yearsExperience !== "" && (
                <span style={{ fontSize: 10.5, color: BRAND.textMuted }}>{s.yearsExperience}y</span>
              )}
              <DeleteButton onClick={() => del.mutate(s.id)} busy={deletingId === s.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────── small reusable card-list section ──────────────── */

interface ListRow {
  id: number;
  title: string;
  subtitle?: string;
  meta?: string;
  detail?: string;
}

function CardListSection({
  icon,
  color,
  title,
  rows,
  emptyText,
  formFields,
  initialForm,
  onAdd,
  onDelete,
  validate,
}: {
  icon: typeof Award;
  color: string;
  title: string;
  rows: ListRow[];
  emptyText: string;
  formFields: { key: string; label: string; type?: string; full?: boolean; checkbox?: boolean }[];
  initialForm: Record<string, string | boolean>;
  onAdd: (form: Record<string, string | boolean>) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
  validate: (form: Record<string, string | boolean>) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean>>(initialForm);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const add = useMutation({
    mutationFn: () => onAdd(form),
    onSuccess: () => {
      setForm(initialForm);
      setOpen(false);
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => onDelete(id),
    onMutate: (id) => setDeletingId(id),
    onSettled: () => setDeletingId(null),
  });

  return (
    <div style={PANEL}>
      <SectionHeader
        icon={icon}
        title={title}
        count={rows.length}
        color={color}
        action={
          <button style={open ? btnGhost() : btnPrimary()} onClick={() => setOpen((o) => !o)}>
            {open ? <X size={14} /> : <Plus size={14} />} {open ? "Close" : "Add"}
          </button>
        }
      />

      {open && (
        <div style={{ marginBottom: 14, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {formFields.map((ff) =>
            ff.checkbox ? (
              <label key={ff.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: BRAND.textSecondary, alignSelf: "end", paddingBottom: 8, gridColumn: ff.full ? "1 / -1" : undefined }}>
                <input
                  type="checkbox"
                  checked={!!form[ff.key]}
                  onChange={(e) => setForm((f) => ({ ...f, [ff.key]: e.target.checked }))}
                />
                {ff.label}
              </label>
            ) : ff.type === "textarea" ? (
              <div key={ff.key} style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: BRAND.textMuted, display: "block", marginBottom: 4 }}>{ff.label}</label>
                <textarea
                  value={String(form[ff.key] ?? "")}
                  onChange={(e) => setForm((f) => ({ ...f, [ff.key]: e.target.value }))}
                  rows={2}
                  style={{ ...INPUT_STYLE, resize: "vertical" }}
                />
              </div>
            ) : (
              <div key={ff.key} style={{ gridColumn: ff.full ? "1 / -1" : undefined }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: BRAND.textMuted, display: "block", marginBottom: 4 }}>{ff.label}</label>
                <FieldInput
                  type={ff.type ?? "text"}
                  value={String(form[ff.key] ?? "")}
                  onChange={(e) => setForm((f) => ({ ...f, [ff.key]: e.target.value }))}
                />
              </div>
            ),
          )}
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
            <button style={btnPrimary(add.isPending || !validate(form))} disabled={add.isPending || !validate(form)} onClick={() => add.mutate()}>
              {add.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
            </button>
            {add.isError && <span style={{ color: BRAND.red, fontSize: 12, alignSelf: "center" }}>Couldn't save</span>}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={icon} text={emptyText} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${BRAND.cardBorder}`,
                backgroundColor: "var(--rm-bg)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: BRAND.white }}>{r.title}</div>
                {r.subtitle && <div style={{ fontSize: 12, color: BRAND.textSecondary, marginTop: 1 }}>{r.subtitle}</div>}
                {r.meta && <div style={{ fontSize: 11, color: BRAND.textMuted, marginTop: 2 }}>{r.meta}</div>}
                {r.detail && <div style={{ fontSize: 12, color: BRAND.textSecondary, marginTop: 4, lineHeight: 1.5 }}>{r.detail}</div>}
              </div>
              <DeleteButton onClick={() => del.mutate(r.id)} busy={deletingId === r.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CertificationsSection({ guid, data, onChanged }: { guid: string; data?: ResourceProfileBundle; onChanged: () => void }) {
  const rows: ListRow[] = (data?.certifications ?? []).map((c) => ({
    id: c.id,
    title: c.name,
    subtitle: c.issuer ?? undefined,
    meta: [c.credentialId ? `ID: ${c.credentialId}` : "", c.issueDate ? `Issued ${fmtDate(c.issueDate)}` : "", c.expiryDate ? `Expires ${fmtDate(c.expiryDate)}` : ""].filter(Boolean).join(" · ") || undefined,
  }));
  return (
    <CardListSection
      icon={Award}
      color={BRAND.greenLight}
      title="Certifications"
      rows={rows}
      emptyText="No certifications yet."
      formFields={[
        { key: "name", label: "Name", full: true },
        { key: "issuer", label: "Issuer" },
        { key: "credentialId", label: "Credential ID" },
        { key: "issueDate", label: "Issue date", type: "date" },
        { key: "expiryDate", label: "Expiry date", type: "date" },
      ]}
      initialForm={{ name: "", issuer: "", credentialId: "", issueDate: "", expiryDate: "" }}
      validate={(f) => !!String(f.name).trim()}
      onAdd={async (f) => {
        await addResourceCertification(guid, {
          name: String(f.name).trim(),
          issuer: String(f.issuer).trim() || undefined,
          credentialId: String(f.credentialId).trim() || undefined,
          issueDate: String(f.issueDate) || undefined,
          expiryDate: String(f.expiryDate) || undefined,
        });
        onChanged();
      }}
      onDelete={async (id) => {
        await deleteResourceCertification(guid, id);
        onChanged();
      }}
    />
  );
}

function EducationSection({ guid, data, onChanged }: { guid: string; data?: ResourceProfileBundle; onChanged: () => void }) {
  const rows: ListRow[] = (data?.education ?? []).map((e) => ({
    id: e.id,
    title: e.institution,
    subtitle: [e.degree, e.fieldOfStudy].filter(Boolean).join(" · ") || undefined,
    meta: [e.startYear && e.endYear ? `${e.startYear} – ${e.endYear}` : e.endYear ? String(e.endYear) : "", e.grade ? `Grade: ${e.grade}` : ""].filter(Boolean).join(" · ") || undefined,
  }));
  return (
    <CardListSection
      icon={GraduationCap}
      color="#38BDF8"
      title="Education"
      rows={rows}
      emptyText="No education records yet."
      formFields={[
        { key: "institution", label: "Institution", full: true },
        { key: "degree", label: "Degree" },
        { key: "fieldOfStudy", label: "Field of study" },
        { key: "startYear", label: "Start year", type: "number" },
        { key: "endYear", label: "End year", type: "number" },
        { key: "grade", label: "Grade" },
      ]}
      initialForm={{ institution: "", degree: "", fieldOfStudy: "", startYear: "", endYear: "", grade: "" }}
      validate={(f) => !!String(f.institution).trim()}
      onAdd={async (f) => {
        await addResourceEducation(guid, {
          institution: String(f.institution).trim(),
          degree: String(f.degree).trim() || undefined,
          fieldOfStudy: String(f.fieldOfStudy).trim() || undefined,
          startYear: f.startYear ? Number(f.startYear) : undefined,
          endYear: f.endYear ? Number(f.endYear) : undefined,
          grade: String(f.grade).trim() || undefined,
        });
        onChanged();
      }}
      onDelete={async (id) => {
        await deleteResourceEducation(guid, id);
        onChanged();
      }}
    />
  );
}

function WorkHistorySection({ guid, data, onChanged }: { guid: string; data?: ResourceProfileBundle; onChanged: () => void }) {
  const rows: ListRow[] = (data?.workHistory ?? []).map((w) => ({
    id: w.id,
    title: [w.title, w.company].filter(Boolean).join(" @ ") || w.company,
    subtitle: w.location ?? undefined,
    meta: `${fmtDate(w.startDate)} – ${w.isCurrent ? "Present" : fmtDate(w.endDate)}`,
    detail: w.description ?? undefined,
  }));
  return (
    <CardListSection
      icon={Briefcase}
      color={BRAND.orange}
      title="Work History"
      rows={rows}
      emptyText="No work history yet."
      formFields={[
        { key: "company", label: "Company" },
        { key: "title", label: "Title" },
        { key: "location", label: "Location" },
        { key: "startDate", label: "Start date", type: "date" },
        { key: "endDate", label: "End date", type: "date" },
        { key: "isCurrent", label: "Current role", checkbox: true },
        { key: "description", label: "Description", type: "textarea" },
      ]}
      initialForm={{ company: "", title: "", location: "", startDate: "", endDate: "", isCurrent: false, description: "" }}
      validate={(f) => !!String(f.company).trim()}
      onAdd={async (f) => {
        await addResourceWorkHistory(guid, {
          company: String(f.company).trim(),
          title: String(f.title).trim() || undefined,
          location: String(f.location).trim() || undefined,
          startDate: String(f.startDate) || undefined,
          endDate: String(f.endDate) || undefined,
          isCurrent: !!f.isCurrent,
          description: String(f.description).trim() || undefined,
        });
        onChanged();
      }}
      onDelete={async (id) => {
        await deleteResourceWorkHistory(guid, id);
        onChanged();
      }}
    />
  );
}

function PortfolioSection({ guid, data, onChanged }: { guid: string; data?: ResourceProfileBundle; onChanged: () => void }) {
  const rows: ListRow[] = (data?.projects ?? []).map((p) => ({
    id: p.id,
    title: p.name,
    subtitle: [p.role, p.client].filter(Boolean).join(" · ") || undefined,
    meta: [
      p.startDate || p.endDate ? `${fmtDate(p.startDate)} – ${fmtDate(p.endDate)}` : "",
      p.skillsUsed && p.skillsUsed.length ? p.skillsUsed.join(", ") : "",
    ].filter(Boolean).join(" · ") || undefined,
    detail: p.description ?? undefined,
  }));
  return (
    <CardListSection
      icon={Target}
      color="#A78BFA"
      title="Project Portfolio"
      rows={rows}
      emptyText="No portfolio projects yet."
      formFields={[
        { key: "name", label: "Project name", full: true },
        { key: "role", label: "Role" },
        { key: "client", label: "Client" },
        { key: "startDate", label: "Start date", type: "date" },
        { key: "endDate", label: "End date", type: "date" },
        { key: "skillsUsed", label: "Skills used (comma-separated)", full: true },
        { key: "description", label: "Description", type: "textarea" },
      ]}
      initialForm={{ name: "", role: "", client: "", startDate: "", endDate: "", skillsUsed: "", description: "" }}
      validate={(f) => !!String(f.name).trim()}
      onAdd={async (f) => {
        await addResourcePortfolioProject(guid, {
          name: String(f.name).trim(),
          role: String(f.role).trim() || undefined,
          client: String(f.client).trim() || undefined,
          startDate: String(f.startDate) || undefined,
          endDate: String(f.endDate) || undefined,
          description: String(f.description).trim() || undefined,
          skillsUsed: String(f.skillsUsed)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        });
        onChanged();
      }}
      onDelete={async (id) => {
        await deleteResourcePortfolioProject(guid, id);
        onChanged();
      }}
    />
  );
}

/* ──────────────── People search list (Profiles tab) ──────────────── */

function PeopleResultRow({ r, onOpen }: { r: PeopleSearchResult; onOpen: () => void }) {
  const disabled = !r.guid;
  return (
    <button
      onClick={onOpen}
      disabled={disabled}
      title={disabled ? "No linked user record (can't enrich)" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 12,
        border: `1px solid ${BRAND.cardBorder}`,
        backgroundColor: BRAND.card,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        textAlign: "left",
        width: "100%",
        color: BRAND.white,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.borderColor = BRAND.green;
      }}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = BRAND.cardBorder)}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          backgroundColor: BRAND.green + "22",
          border: `1px solid ${BRAND.green}55`,
          color: BRAND.greenLight,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        {initialsOf(r.name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {r.name || "Name not recorded"}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: BRAND.textSecondary, marginTop: 2 }}>
          {r.title && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Briefcase size={12} /> {r.title}
            </span>
          )}
          {r.company && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Building2 size={12} /> {r.company}
            </span>
          )}
          {r.email && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Mail size={12} /> {r.email}
            </span>
          )}
        </div>
      </div>
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 800,
          letterSpacing: 0.4,
          color: r.source === "user" ? BRAND.green : BRAND.textMuted,
          backgroundColor: (r.source === "user" ? BRAND.green : BRAND.textMuted) + "1A",
          padding: "3px 7px",
          borderRadius: 5,
          textTransform: "uppercase",
          flexShrink: 0,
        }}
      >
        {r.source}
      </span>
    </button>
  );
}

function ProfilesTab({
  selectedGuid,
  setSelectedGuid,
  selectedMeta,
  setSelectedMeta,
}: {
  selectedGuid: string | null;
  setSelectedGuid: (g: string | null) => void;
  selectedMeta: { name?: string; email?: string };
  setSelectedMeta: (m: { name?: string; email?: string }) => void;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  const searchQ = useQuery({
    queryKey: ["people-search", query],
    queryFn: () => peopleSearch(query, 100),
    staleTime: 60 * 1000,
  });

  if (selectedGuid) {
    return (
      <ProfileDetail
        guid={selectedGuid}
        fallbackName={selectedMeta.name}
        fallbackEmail={selectedMeta.email}
        onBack={() => setSelectedGuid(null)}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(input.trim());
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={16} color={BRAND.textMuted} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search people by name or email…"
            style={{ ...INPUT_STYLE, paddingLeft: 36, height: 42, fontSize: 14 }}
          />
        </div>
        <button type="submit" style={{ ...btnPrimary(), height: 42 }}>
          <Search size={15} /> Search
        </button>
      </form>

      {searchQ.isLoading ? (
        <div style={{ ...PANEL, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: BRAND.textSecondary }}>
          <Loader2 size={18} className="animate-spin" /> Loading people…
        </div>
      ) : searchQ.isError ? (
        <div style={{ ...PANEL, display: "flex", alignItems: "center", gap: 8, color: BRAND.red, fontSize: 13 }}>
          <AlertCircle size={16} /> Search failed.
          <button style={{ ...btnGhost(), marginLeft: 8 }} onClick={() => searchQ.refetch()}>Retry</button>
        </div>
      ) : (searchQ.data ?? []).length === 0 ? (
        <div style={PANEL}>
          <EmptyState icon={Users} text={query.trim() ? `No people found for “${query}”.` : "No people found."} />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(searchQ.data ?? []).map((r, i) => (
            <PeopleResultRow
              key={r.guid ?? `${r.email}-${i}`}
              r={r}
              onOpen={() => {
                if (!r.guid) return;
                setSelectedMeta({ name: r.name, email: r.email });
                setSelectedGuid(r.guid);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────── Skill search tab ──────────────── */

function SkillSearchTab({ onOpenProfile }: { onOpenProfile: (r: SkillSearchResult) => void }) {
  const [input, setInput] = useState("");
  const [minLevel, setMinLevel] = useState(1);
  const [params, setParams] = useState<{ skill: string; minLevel: number } | null>(null);

  const searchQ = useQuery({
    queryKey: ["skill-search", params?.skill, params?.minLevel],
    queryFn: () => searchResourcesBySkill(params!.skill, params!.minLevel),
    enabled: !!params && params.skill.trim().length > 0,
    staleTime: 60 * 1000,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) setParams({ skill: input.trim(), minLevel });
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <Sparkles size={16} color={BRAND.textMuted} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Skill, e.g. AutoCAD, Revit, Scheduling…"
            style={{ ...INPUT_STYLE, paddingLeft: 36, height: 42, fontSize: 14 }}
          />
        </div>
        <div>
          <select
            value={minLevel}
            onChange={(e) => setMinLevel(Number(e.target.value))}
            style={{ ...INPUT_STYLE, height: 42, width: 150 }}
            aria-label="Minimum proficiency"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>Level ≥ {n}</option>
            ))}
          </select>
        </div>
        <button type="submit" style={{ ...btnPrimary(), height: 42 }}>
          <Search size={15} /> Find
        </button>
      </form>

      {!params ? (
        <div style={PANEL}>
          <EmptyState icon={Sparkles} text="Search for people by skill and minimum proficiency level." />
        </div>
      ) : searchQ.isLoading ? (
        <div style={{ ...PANEL, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: BRAND.textSecondary }}>
          <Loader2 size={18} className="animate-spin" /> Searching…
        </div>
      ) : searchQ.isError ? (
        <div style={{ ...PANEL, display: "flex", alignItems: "center", gap: 8, color: BRAND.red, fontSize: 13 }}>
          <AlertCircle size={16} /> Search failed.
          <button style={{ ...btnGhost(), marginLeft: 8 }} onClick={() => searchQ.refetch()}>Retry</button>
        </div>
      ) : (searchQ.data ?? []).length === 0 ? (
        <div style={PANEL}>
          <EmptyState icon={Sparkles} text={`No one matches “${params.skill}” at level ≥ ${params.minLevel}.`} />
        </div>
      ) : (
        <div style={{ ...PANEL, padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: "var(--rm-bg)" }}>
                  {["Name", "Email", "Skill", "Proficiency", "Years", "Last used"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "10px 14px",
                        fontSize: 10.5,
                        fontWeight: 800,
                        letterSpacing: 0.5,
                        textTransform: "uppercase",
                        color: BRAND.textMuted,
                        borderBottom: `1px solid ${BRAND.cardBorder}`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(searchQ.data ?? []).map((r, i) => (
                  <tr
                    key={`${r.resourceGuid}-${r.skillName}-${i}`}
                    onClick={() => onOpenProfile(r)}
                    style={{ cursor: "pointer", borderBottom: `1px solid ${BRAND.cardBorder}` }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--rm-bg)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <td style={{ padding: "10px 14px", fontWeight: 700, color: BRAND.white, whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: "50%",
                            backgroundColor: BRAND.green + "22",
                            color: BRAND.greenLight,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            fontWeight: 800,
                          }}
                        >
                          {initialsOf(r.name ?? "?")}
                        </span>
                        {r.name ?? "Name not recorded"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", color: BRAND.textSecondary, whiteSpace: "nowrap" }}>{r.email ?? "—"}</td>
                    <td style={{ padding: "10px 14px", color: BRAND.white, whiteSpace: "nowrap" }}>{r.skillName}</td>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                      <ProficiencyDots level={r.proficiency} />
                    </td>
                    <td style={{ padding: "10px 14px", color: BRAND.textSecondary, whiteSpace: "nowrap" }}>
                      {r.yearsExperience != null && r.yearsExperience !== "" ? `${r.yearsExperience}y` : "—"}
                    </td>
                    <td style={{ padding: "10px 14px", color: BRAND.textSecondary, whiteSpace: "nowrap" }}>{r.lastUsedYear ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────── Page shell ──────────────── */

export default function Talent() {
  const [tab, setTab] = useState<TalentTab>("Profiles");
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<{ name?: string; email?: string }>({});

  const tabs: TalentTab[] = useMemo(() => ["Profiles", "Skill Search"], []);

  return (
    <div style={{ minHeight: "100%", backgroundColor: BRAND.bg, padding: "20px 18px 60px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              backgroundColor: BRAND.green + "22",
              border: `1px solid ${BRAND.green}40`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <User size={22} color={BRAND.green} />
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: BRAND.white }}>Talent Profiles</div>
            <div style={{ fontSize: 13, color: BRAND.textSecondary }}>
              Resumes, skills, certifications, education, experience &amp; portfolio.
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, borderBottom: `1px solid ${BRAND.cardBorder}` }}>
          {tabs.map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  background: "transparent",
                  border: "none",
                  borderBottom: `2px solid ${active ? BRAND.green : "transparent"}`,
                  color: active ? BRAND.white : BRAND.textSecondary,
                  fontSize: 14,
                  fontWeight: active ? 800 : 600,
                  padding: "10px 14px",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {t === "Profiles" ? <Users size={15} /> : <Sparkles size={15} />}
                {t}
              </button>
            );
          })}
        </div>

        {tab === "Profiles" ? (
          <ProfilesTab
            selectedGuid={selectedGuid}
            setSelectedGuid={setSelectedGuid}
            selectedMeta={selectedMeta}
            setSelectedMeta={setSelectedMeta}
          />
        ) : (
          <SkillSearchTab
            onOpenProfile={(r) => {
              setSelectedMeta({ name: r.name ?? undefined, email: r.email ?? undefined });
              setSelectedGuid(r.resourceGuid);
              setTab("Profiles");
            }}
          />
        )}
      </div>
    </div>
  );
}
