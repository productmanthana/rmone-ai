import { useEffect, useMemo, useState } from "react";
import { X, UserPlus, Loader2 } from "lucide-react";
import { addOpenPosition, getJobTitles, getUserList, type JobTitleRow } from "@/lib/api";
import { STANDARD_JOB_TITLES } from "@/lib/standardTitles";
import { getWindowAvailability } from "@/lib/availability";
import { getBusinessRules } from "@/lib/businessRules";
import DateField from "@/components/DateField";
import { Z } from "@/lib/zLayers";

const C = {
  bg: "#FFFFFF",
  card: "#F5F8FA",
  border: "#D5DEE5",
  green: "#6BA539",
  orange: "#E87722",
  text: "#253746",
  muted: "#6B7E8A",
};

export function AddOpenPositionModal({
  open, onClose, projectId, projectName, defaultStartDate, defaultEndDate, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  /** Record target dates (YYYY-MM-DD or ISO) used to seed the date inputs. */
  defaultStartDate?: string;
  defaultEndDate?: string;
  onCreated: (role: string) => void;
}) {
  const [role, setRole] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hours, setHours] = useState("");
  const [titles, setTitles] = useState<JobTitleRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "N people with this title look free" hint — shown ONLY when both the
  // user list AND the availability feed loaded (a failed fetch shows nothing,
  // never a wrong count).
  const [freeHint, setFreeHint] = useState<{ text: string; tone: "free" | "none" } | null>(null);

  useEffect(() => {
    if (!open) return;
    setRole("");
    setHours("");
    setError(null);
    setFreeHint(null);
    setStartDate(toDateInput(defaultStartDate));
    setEndDate(toDateInput(defaultEndDate));
    getJobTitles().then(setTitles).catch(() => setTitles([]));
  }, [open, projectId, defaultStartDate, defaultEndDate]);

  // Debounced availability lookup for the typed role/title over the position's
  // date window. Contains-match on staff job titles; a person counts as "free"
  // when they average ≥8h/wk free or have no allocations in the window.
  useEffect(() => {
    if (!open) { setFreeHint(null); return; }
    const roleName = role.trim();
    if (roleName.length < 2) { setFreeHint(null); return; }
    const s = startDate || toDateInput(defaultStartDate);
    const e = endDate || toDateInput(defaultEndDate);
    if (!s || !e || e < s) { setFreeHint(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const [users, avail] = await Promise.all([getUserList(), getWindowAvailability(s, e)]);
        if (!alive) return;
        const needle = roleName.toLowerCase();
        let matched = 0, free = 0;
        for (const u of Array.isArray(users) ? users : []) {
          const jt = String((u as Record<string, unknown>).JobProfile ?? "").trim().toLowerCase();
          const nm = String((u as Record<string, unknown>).Name ?? "").trim();
          if ((u as Record<string, unknown>).Deleted === true) continue;
          if (!jt || !nm || /^[0-9a-f]{8}-/.test(nm)) continue;
          if (!(jt.includes(needle) || needle.includes(jt))) continue;
          matched++;
          const id = String((u as Record<string, unknown>).Id ?? "").trim().toLowerCase();
          const entry = (id ? avail.byId.get(id) : undefined) ?? avail.byName.get(nm.toLowerCase());
          if (!entry || entry.freeHrsPerWk >= 8) free++;
        }
        if (!alive) return;
        if (matched === 0) { setFreeHint(null); return; }
        setFreeHint(
          free === 0
            ? { text: `${matched} ${matched === 1 ? "person has" : "people have"} this title, but none look free in this window.`, tone: "none" }
            : { text: `${free} of ${matched} ${matched === 1 ? "person" : "people"} with this title look free in this window.`, tone: "free" }
        );
      } catch {
        if (alive) setFreeHint(null);
      }
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [open, role, startDate, endDate, defaultStartDate, defaultEndDate]);

  const titleNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of titles) {
      const n = (t.Title || t.JobTitleName || "").trim();
      if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n); }
    }
    out.sort((a, b) => a.localeCompare(b));
    // Standard titles lead the suggestion list (client ask): catalogue names
    // that match a standard title (their casing wins), then standard titles
    // the catalogue lacks, then the remaining catalogue names alphabetically.
    // The datalist respects this order until the user starts typing.
    const stdLower = new Set(STANDARD_JOB_TITLES.map(s => s.toLowerCase()));
    const stdExtra = STANDARD_JOB_TITLES.filter(n => !seen.has(n.toLowerCase()));
    return [
      ...out.filter(n => stdLower.has(n.toLowerCase())),
      ...stdExtra,
      ...out.filter(n => !stdLower.has(n.toLowerCase())),
    ];
  }, [titles]);

  if (!open) return null;

  // Date inputs are shown in "no-schedule" and both "no weekly grid" display
  // modes (free-form member dates). In "full" mode the open position's dates
  // follow the phase schedule — the seeded startDate/endDate (defaultStartDate
  // = scheduleStart || target) still submit unchanged; in
  // "no-schedule-no-hours" dates are meaningless to the user. Hiding the
  // inputs never changes what gets saved.
  // Intentional (v1): add-member/open-position modals follow the PROJECT-side
  // display mode even on OPM/LEM records — kept tenant-wide until the modals
  // grow a module prop. See getDisplayModeFor() for module-aware reads.
  const dmMode = getBusinessRules().projectDisplayMode;
  const hideDates = dmMode !== "no-schedule" && dmMode !== "no-schedule-no-grid" && dmMode !== "schedule-no-grid";

  async function submit() {
    const roleName = role.trim();
    if (!roleName) { setError("Enter a role or job title for the position."); return; }
    if (startDate && endDate && endDate < startDate) {
      setError("End date must be after the start date.");
      return;
    }
    const hrs = hours.trim() === "" ? undefined : Number(hours);
    if (hrs !== undefined && (!isFinite(hrs) || hrs < 0)) {
      setError("Total hours must be a positive number.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Pass the numeric JobTitleId when the typed role matches a known title
      // exactly — the server then links the demand row to the real title record.
      const match = titles.find(t => (t.Title || t.JobTitleName || "").trim().toLowerCase() === roleName.toLowerCase());
      const res = await addOpenPosition({
        ProjectID: projectId,
        Role: roleName,
        ...(match ? { JobTitleId: match.ID } : {}),
        ...(startDate ? { StartDate: startDate } : {}),
        ...(endDate ? { EndDate: endDate } : {}),
        ...(hrs !== undefined ? { TotalHours: hrs } : {}),
      });
      if (res && res.Status === false) throw new Error(res.error || "Could not create the open position.");
      onCreated(roleName);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not create the open position.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL,
        backgroundColor: "rgba(15,25,35,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 440, backgroundColor: C.bg, borderRadius: 14,
          border: `1px solid ${C.border}`, boxShadow: "0 18px 48px rgba(0,0,0,0.3)",
          padding: 20, color: C.text,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, backgroundColor: C.orange + "1A",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <UserPlus size={17} color={C.orange} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Add Open Position</div>
            <div style={{ fontSize: 11, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {projectName}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, padding: 4 }}>
            <X size={17} />
          </button>
        </div>

        <div style={{ fontSize: 11.5, color: C.muted, margin: "6px 0 14px" }}>
          Creates an unfilled slot on the team. It shows in orange until someone is assigned to it.
        </div>

        <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 5 }}>
          ROLE / JOB TITLE <span style={{ color: C.orange }}>*</span>
        </label>
        <input
          list="open-pos-title-suggestions"
          value={role}
          onChange={e => setRole(e.target.value)}
          placeholder="e.g. Project Engineer"
          autoFocus
          style={inputStyle}
        />
        <datalist id="open-pos-title-suggestions">
          {titleNames.map(n => <option key={n} value={n} />)}
        </datalist>
        {freeHint && (
          <div style={{
            marginTop: 7, fontSize: 11.5, fontWeight: 600,
            color: freeHint.tone === "none" ? C.orange : C.green,
          }}>
            {freeHint.text}
          </div>
        )}

        {!hideDates && (
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 5 }}>START DATE</label>
            <DateField value={startDate} onChange={setStartDate} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 5 }}>END DATE</label>
            <DateField value={endDate} onChange={setEndDate} style={inputStyle} />
          </div>
        </div>
        )}
        {hideDates && getBusinessRules().projectDisplayMode === "full" && (startDate || endDate) && (
          <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>
            Position dates follow the project's schedule{startDate && endDate ? ` (${fmtNice(startDate)} – ${fmtNice(endDate)})` : ""}.
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 5 }}>TOTAL HOURS (OPTIONAL)</label>
          <input
            type="number"
            min={0}
            value={hours}
            onChange={e => setHours(e.target.value)}
            placeholder="e.g. 320"
            style={inputStyle}
          />
        </div>

        {error && (
          <div style={{
            marginTop: 12, padding: "8px 12px", borderRadius: 8, fontSize: 12,
            backgroundColor: "#FDECEA", color: "#B3261E", border: "1px solid #F5C6C0",
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: "9px 16px", borderRadius: 9, border: `1px solid ${C.border}`,
              backgroundColor: C.bg, color: C.muted, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !role.trim()}
            style={{
              padding: "9px 18px", borderRadius: 9, border: "none",
              backgroundColor: submitting || !role.trim() ? C.orange + "70" : C.orange,
              color: "#FFF", fontSize: 12.5, fontWeight: 700,
              cursor: submitting || !role.trim() ? "default" : "pointer",
              display: "inline-flex", alignItems: "center", gap: 7,
            }}
          >
            {submitting && <Loader2 size={13} className="animate-spin" />}
            {submitting ? "Creating…" : "Create Open Position"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 9,
  border: `1px solid ${C.border}`, backgroundColor: C.card,
  color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box",
};

function fmtNice(ymd: string): string {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toDateInput(v?: string): string {
  if (!v) return "";
  const d = new Date(v.length === 10 ? v + "T00:00:00" : v);
  if (isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
