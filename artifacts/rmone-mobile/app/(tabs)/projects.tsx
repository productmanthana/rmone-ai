import { compactUsd } from "@/lib/money";
import { AppTextInput } from "@/components/AppTextInput";
import { Feather } from "@/lib/icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState, useEffect, useRef, useMemo } from "react";
import { EditAllocationModal } from "@/components/EditAllocationModal";
import { AddTeamMemberModal } from "@/components/AddTeamMemberModal";
import { DisabledStaffControl } from "@/components/DisabledStaffControl";
import ProfileMenu from "@/components/ProfileMenu";
import ProjectMap from "@/components/ProjectMap";
import CalendarPopup from "@/components/CalendarPopup";
import { CardInsight } from "@/components/CardInsight";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Animated,
  Easing,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, themed } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { useScreenBeacon } from "@/lib/usageBeacon";
import { setChatPrompt } from "@/lib/chatBridge";
import { nameMatches } from "@/lib/normalize";
import { roleTextMatches } from "@workspace/role-match";
import { globalAlert } from "@/lib/inAppAlert";
import { getSSParam, getQueryParam } from "@/lib/ssParam";
import { getModuleRecords, peekModuleRecords, isCacheFresh, getAvailableRoster, smartUpdate, updateFields, bustCache, bustCacheByPrefix, onCacheBust, getProjectAllocations, getProjectTeam, getResourceAllocations, getProjectDetails, getProjectList, getResourceDemands, debugLog, getApiBase, type ModuleRecord, type SkillsResource, type LiveResource, type ProjectTeamMember, type DemandItem, type OpenRole } from "@/lib/api";
import { fmtHours, fmtPct } from "@/lib/numberFormat";

/* ─── TYPES ─────────────────────────────────────────────────────────────── */
type PipelineView = "Projects" | "Opportunities" | "Leads" | "Companies";
type FilterTab = "All" | "My Open" | "All Open" | "Staffing Needs" | "Closed";
type DateFilter = string;

interface Project {
  id: string;
  ticketNum: string;
  name: string;
  status: string;
  phase: string;
  city: string;
  /** ApproxContractValue — total contract revenue. May be 0 if not set. */
  value: number;
  /** LaborContractAmount — labor portion of the contract. Distinct from value. */
  laborValue: number;
  closed: boolean;
  stageActionUsers: string;
  /** Concatenated GUIDs from every *User field on the record (Owner, PM, lead, etc.) */
  assignedUserGuids: string;
  targetStart: string; targetEnd: string;
  actualStart: string; actualEnd: string;
  closeDate: string;
  groupId: string;
  /** True when a lifecycle template has been assigned to the project (i.e. real schedule exists). */
  hasSchedule: boolean;
  rawTargetStart: string; rawTargetEnd: string;
  rawActualStart: string; rawActualEnd: string;
  rawCloseDate: string;
  forecastCost: number;
  sector: string;
  division: string;
  daysInPhase: number | null;
  note?: string;
  requestCategory?: string;
}

interface Opportunity {
  id: string;
  name: string;
  /** ApproxContractValue — total expected contract revenue. May be 0 if not set. */
  value: number;
  /** LaborContractAmount — labor portion of the contract. Distinct from value. */
  laborValue: number;
  stage: string;
  city: string;
  bu: string;
  daysLeft: number;
  probability: number;
  type: string;
  weightedValue: number;
  closed: boolean;
  assignedUserGuids: string;
  targetStart: string;
  targetEnd: string;
  actualStart: string;
  actualEnd: string;
  bidDate: string;
  rawBidDate: string;
  rawTargetStart: string;
  rawTargetEnd: string;
  rawActualStart: string;
  rawActualEnd: string;
  note?: string;
  requestCategory?: string;
}

interface Lead {
  id: string;
  name: string;
  /** ApproxContractValue — estimated contract revenue. May be 0 if not set. */
  value: number;
  /** LaborContractAmount — labor portion of the contract. Distinct from value. */
  laborValue: number;
  status: string;
  city: string;
  bu: string;
  sector: string;
  closed: boolean;
  assignedUserGuids: string;
  targetStart: string;
  targetEnd: string;
  rawTargetStart: string;
  rawTargetEnd: string;
  rawCreated?: string;
  rawDueDate?: string;
}

/**
 * Collect every GUID stored in the **Key Personnel** user fields the RM ONE web
 * portal uses for "My Open". This is intentionally a strict allow-list so the
 * mobile count matches the web count (e.g. excludes Engineer/Architect/Designer
 * sub-roles which would otherwise inflate the result).
 */
const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const KEY_PERSONNEL_FIELDS = new Set([
  // PMM / OPM / LEM Key Personnel
  "OwnerUser",
  "ProjectManagerUser",
  "SeniorProjectManagerUser",
  "ProgramManagerUser",
  "SeniorMEPManagerUser",
  "SeniorEstimatorUser",
  "EstimatorUser",
  "SuperintendentUser",
  "SeniorSuperintendentUser",
  "ProjectLeadUser",
  "BusinessLeadUser",
  "PreconLeadUser",
  "PrincipalUser",
  "ProjectExecutiveUser",
  "PhaseOwnerUser",
  // also email/username variants RM ONE sometimes uses
  "OwnerUserName", "OwnerUserEmail",
  "ProjectManagerUserName", "ProjectManagerUserEmail",
  "SeniorProjectManagerUserName", "SeniorProjectManagerUserEmail",
]);
function collectAssignedUserGuids(r: unknown): string {
  const obj = r as Record<string, unknown>;
  const tokens: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string" || !v) continue;
    if (!KEY_PERSONNEL_FIELDS.has(k)) continue;
    const found = v.match(GUID_RE);
    if (found) {
      for (const g of found) {
        if (g === "00000000-0000-0000-0000-000000000000") continue;
        tokens.push(g.toLowerCase());
      }
    }
    tokens.push(v.toLowerCase());
  }
  return tokens.join("|");
}

/* ─── HELPERS ────────────────────────────────────────────────────────────── */
const PMM_ACTIVE = new Set(["Under Construction","Awarded in PreCon","Pre-Construction","Awarded Final Pricing Approved","In Design","In Progress","Change Order","Pre-Schematic","Schematic Design","Design Development","Construction Documents","Construction Administration","Bidding & Negotiation","Post-Construction"]);
const PMM_BIDDING = new Set(["Bidding Competitive","Bidding Negotiated","Budgeting Negotiated","Awaiting Drawings","Awaiting Client Response","ROM","Assign","Identify Opportunity"]);
const PMM_CLOSEOUT = new Set(["Close-Out"]);
const PMM_PRECON = new Set(["Awarded in PreCon","Pre-Construction","Awarded Final Pricing Approved","In Design","Pre-Schematic","Schematic Design"]);

const OPM_CLOSED_STATUSES = new Set(["Cancelled","Lost","Declined","Dead"]);
type OpmStatusFilter = "All Open" | "Closed";
const OPM_STATUS_FILTERS: OpmStatusFilter[] = ["All Open", "Closed"];

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}
function fmtShort(d: string | null | undefined): string {
  if (!d || d === "—") return "";
  const raw = d.length === 10 ? d + "T00:00:00" : d;
  const dt = new Date(raw);
  if (isNaN(dt.getTime())) return "";
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${mo[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
}

function fmtM(v: number) {
  if (v == null || isNaN(v)) return "—";
  if (v === 0) return "$0";
  if (v >= 1_000_000_000) return compactUsd(v);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function getDateRange(df: DateFilter): { start: Date; end: Date } | null {
  if (df === "All Time") return null;
  const qm = df.match(/^Q([1-4]) (\d{4})$/);
  if (qm) {
    const qi = parseInt(qm[1]) - 1;
    const yi = parseInt(qm[2]);
    return { start: new Date(yi, qi * 3, 1), end: new Date(yi, qi * 3 + 3, 0, 23, 59, 59) };
  }
  const ym = df.match(/^(\d{4})$/);
  if (ym) {
    const yi = parseInt(ym[1]);
    return { start: new Date(yi, 0, 1), end: new Date(yi, 11, 31, 23, 59, 59) };
  }
  return null;
}

function parseIsoDate(d: string): number | null {
  if (!d) return null;
  const dt = new Date(d.length === 10 ? d + "T00:00:00" : d);
  return isNaN(dt.getTime()) ? null : dt.getTime();
}

function overlapsRange(dates: string[], range: { start: Date; end: Date }): boolean {
  const ps = range.start.getTime();
  const pe = range.end.getTime();
  const parsed = dates.map(parseIsoDate).filter((d): d is number => d !== null);
  if (parsed.length === 0) return false;
  const earliest = Math.min(...parsed);
  const latest = Math.max(...parsed);
  return earliest <= pe && latest >= ps;
}

function pmmPhase(status: string, closed?: boolean): string {
  if (closed === true) return "Closeout";
  if (PMM_PRECON.has(status)) return "PreCon";
  if (PMM_CLOSEOUT.has(status)) return "Closeout";
  if (PMM_BIDDING.has(status)) return "Bidding";
  if (PMM_ACTIVE.has(status)) return "Construction";
  return status || "Open";
}

/** Build a short disambiguator for a team member whose name collides with
 *  another on the same project. Priority: job title (if ≠ role) → email
 *  username → last 4 chars of resource GUID. Returns "" when nothing useful. */
function buildResourceDisambiguator(r: { role: string; email?: string; resourceId?: string; teamData?: { title?: string } }): string {
  const title = r.teamData?.title;
  if (title && title.trim() && title.trim() !== r.role.trim()) return title.trim();
  if (r.email) {
    const username = r.email.split("@")[0];
    if (username) return username;
  }
  if (r.resourceId && r.resourceId.length >= 4) return `·${r.resourceId.slice(-4)}`;
  return "";
}

function rawIso(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  // RM ONE returns "0001-01-01T00:00:00" as the "unset" sentinel for date
  // columns. Anything before 1900 is treated as not-set so the UI doesn't
  // surface stale defaults as if they were real Actual/Target dates.
  if (dt.getFullYear() < 1900) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}

function mapPMM(r: ModuleRecord): Project {
  const effectiveStatus = r.CRMProjectStatusChoice || r.Status || r.ModuleStepLookup || "";
  const isClosed = r.Closed === true;
  return {
    id: r.TicketId ?? "",
    ticketNum: r.ShortName ?? "",
    name: r.Title ?? r.ShortName ?? r.TicketId ?? "",
    status: isClosed ? "Closed" : PMM_ACTIVE.has(effectiveStatus) ? "Active" : "Open",
    phase: pmmPhase(effectiveStatus, isClosed),
    city: getCityField(r),
    value: r.ApproxContractValue ?? 0,
    laborValue: (r as any).LaborContractAmount ?? 0,
    closed: isClosed,
    stageActionUsers: r.StageActionUsersUser ?? "",
    assignedUserGuids: collectAssignedUserGuids(r),
    targetStart: fmtDate(r.TargetStartDate),
    targetEnd: fmtDate(r.TargetCompletionDate),
    actualStart: fmtDate(r.ActualStartDate),
    actualEnd: fmtDate(r.ActualCompletionDate),
    closeDate: fmtDate(r.CloseDate),
    groupId: r.GroupID ?? "",
    hasSchedule: (() => {
      // STRICT rule (per client): a real schedule exists ONLY when a lifecycle
      // template has been assigned. Without an assigned lifecycle the card must
      // fall back to TARGET dates — even if ActualStart/ActualEnd are populated
      // on the record (those are leftover bookkeeping values until a lifecycle
      // turns them into a true phase-driven schedule).
      const lc = (r as any).ProjectLifeCycleLookup
        ?? (r as any).ProjectLifecycleID
        ?? (r as any).ProjectLifeCycleID
        ?? (r as any).ScrumLifeCycle
        ?? (r as any).LifecycleID
        ?? (r as any).LifeCycleID;
      const s = String(lc ?? "").trim();
      return s !== "" && s !== "0" && s !== "false";
    })(),
    rawTargetStart: rawIso(r.TargetStartDate),
    rawTargetEnd: rawIso(r.TargetCompletionDate),
    rawActualStart: rawIso(r.ActualStartDate),
    rawActualEnd: rawIso(r.ActualCompletionDate),
    rawCloseDate: rawIso(r.CloseDate),
    forecastCost: Number((r as any).ForecastedProjectCost ?? 0),
    sector: (r as any).SectorChoice ?? (r as any).MarketSector ?? "",
    division: (r as any).DivisionLookup ?? "",
    note: String((r as any).Comment ?? (r as any).Description ?? (r as any).ProjectSummaryNote ?? "").trim() || undefined,
    requestCategory: String((r as any).RequestCategory ?? "").trim() || undefined,
    daysInPhase: (() => {
      const raw = rawIso((r as any).CurrentStageStartDate);
      if (!raw || raw.startsWith("0001")) return null;
      const ms = Date.now() - new Date(raw).getTime();
      return ms > 0 ? Math.round(ms / 86400000) : null;
    })(),
  };
}

/** Robust city extractor — different tenants populate different fields. */
function getCityField(r: any): string {
  const candidates = [
    r?.City, r?.JobCity, r?.SiteCity, r?.LocationCity, r?.ProjectCity,
    r?.OfficeCity, r?.MailingCity, r?.PhysicalCity, r?.AddressCity, r?.BillingCity,
    r?.CityState, r?.CityChoice, r?.CityName, r?.SiteCityState,
    r?.JobAddressCity, r?.SiteAddressCity, r?.ProjectAddressCity,
    r?.SiteAddress?.City, r?.JobAddress?.City, r?.Address?.City,
    r?.PrimaryAddress?.City, r?.MailingAddress?.City,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  // Last resort: parse "Street, City, ST 12345" out of an address blob.
  const addrCandidates = [r?.SiteAddress, r?.JobAddress, r?.Address, r?.MailingAddress, r?.AddressLine, r?.FullAddress, r?.JobLocation, r?.ProjectLocation];
  for (const a of addrCandidates) {
    if (typeof a === "string" && a.trim()) {
      // Try to grab token before ", ST " or ", ST,"
      const m = a.match(/,\s*([^,]+?)\s*,\s*[A-Z]{2}\b/);
      if (m && m[1]) return m[1].trim();
    }
  }
  return "";
}

function mapOPM(r: ModuleRecord): Opportunity {
  // For construction OPM opportunities, RM ONE rarely has ApproxContractValue
  // populated this early in the pursuit — the project team enters
  // ForecastedProjectCost and/or LaborContractAmount instead. Per user
  // direction (May 2026), surface ForecastedProjectCost as the primary OPM
  // "Value" so cards and roll-ups reflect real numbers, falling back to
  // ApproxContractValue then LaborContractAmount. Mirrors mapOPM in the
  // web pages/projects.tsx and getOppValue in pages/home.tsx.
  const forecast = Number(((r as any).ForecastedProjectCost as number | undefined) ?? 0);
  const apx = Number(r.ApproxContractValue ?? 0);
  const laborValue = Number(((r as any).LaborContractAmount as number | undefined) ?? 0);
  const value = forecast > 0 ? forecast : (apx > 0 ? apx : laborValue);
  const prob = r.SuccessChance ?? 0;
  const bidDate = r.BidDueDate ? new Date(r.BidDueDate) : null;
  const daysLeft = bidDate ? Math.ceil((bidDate.getTime() - Date.now()) / 86_400_000) : 999;
  const stage = r.CRMOpportunityStatusChoice || r.Status || r.ModuleStepLookup || "Unknown";
  return {
    id: r.TicketId ?? "",
    name: r.Title ?? r.ShortName ?? r.TicketId ?? "",
    value,
    laborValue,
    stage,
    city: getCityField(r),
    bu: r.CRMBusinessUnitChoice ?? "",
    daysLeft,
    probability: prob,
    type: r.SectorChoice ?? "—",
    weightedValue: value * (prob / 100),
    closed: r.Closed === true || OPM_CLOSED_STATUSES.has(stage),
    assignedUserGuids: collectAssignedUserGuids(r),
    targetStart: fmtDate(r.TargetStartDate),
    targetEnd: fmtDate(r.TargetCompletionDate),
    actualStart: fmtDate(r.ActualStartDate),
    actualEnd: fmtDate(r.ActualCompletionDate),
    bidDate: fmtDate(r.BidDueDate),
    rawBidDate: rawIso(r.BidDueDate),
    rawTargetStart: rawIso(r.TargetStartDate),
    rawTargetEnd: rawIso(r.TargetCompletionDate),
    rawActualStart: rawIso(r.ActualStartDate),
    rawActualEnd: rawIso(r.ActualCompletionDate),
    note: String((r as any).Note ?? (r as any).Comment ?? "").trim() || undefined,
    requestCategory: String((r as any).RequestCategory ?? "").trim() || undefined,
  };
}

const LEM_CLOSED_STATUSES = new Set(["Lost", "Cancelled", "Declined", "Dead", "Closed", "Awarded"]);
function mapLEM(r: ModuleRecord): Lead {
  const status = r.LeadStatus ?? "—";
  return {
    id: r.TicketId ?? "",
    name: r.Title ?? r.ShortName ?? r.TicketId ?? "",
    value: r.ApproxContractValue ?? 0,
    laborValue: ((r as any).LaborContractAmount as number | undefined) ?? 0,
    status,
    city: getCityField(r),
    bu: r.CRMBusinessUnitChoice ?? "—",
    sector: r.SectorChoice ?? "—",
    closed: r.Closed === true || LEM_CLOSED_STATUSES.has(status),
    assignedUserGuids: collectAssignedUserGuids(r),
    targetStart: fmtDate(r.TargetStartDate),
    targetEnd: fmtDate(r.TargetCompletionDate),
    rawTargetStart: rawIso(r.TargetStartDate),
    rawTargetEnd: rawIso(r.TargetCompletionDate),
  };
}

interface Company {
  id: string;
  name: string;
  city: string;
  state: string;
  type: string;
  status: string;
  phone: string;
  email: string;
}

const COM_ACTIVE_STATUSES = new Set(["Active state", "Initiated"]);

function mapCOM(r: ModuleRecord): Company {
  return {
    id: r.TicketId ?? "",
    name: r.Title ?? r.ShortName ?? r.TicketId ?? "",
    city: getCityField(r),
    state: (r as any).State ?? "",
    type: (r as any).PrimaryRelationshipTypeChoice ?? (r as any).CRMCompanyTypeChoice ?? (r as any).CompanyType ?? "—",
    status: (r as any).Status ?? "",
    phone: (r as any).PhoneNumber ?? (r as any).Phone ?? (r as any).OfficePhone ?? (r as any).Telephone ?? "—",
    email: (r as any).Email ?? (r as any).EmailAddress ?? "—",
  };
}

/* ─── COLOUR HELPERS ────────────────────────────────────────────────────── */
function probColor(p: number) {
  if (p >= 65) return Colors.green;
  if (p >= 45) return Colors.orange;
  return Colors.orangeWarm;
}
function daysUrgency(d: number): { text: string; bg: string } {
  if (d <= 5) return { text: Colors.orange, bg: Colors.orange + "18" };
  if (d <= 10) return { text: Colors.orange, bg: Colors.orange + "18" };
  return { text: Colors.green, bg: Colors.green + "18" };
}
function phaseColor(phase: string) {
  if (phase === "Closed" || phase === "Closeout") return Colors.cardMuted;
  if (phase === "PreCon" || phase === "Pre-Schematic") return Colors.orange;
  if (phase === "Bidding" || phase === "Returned") return Colors.greenLight;
  return Colors.green;
}

function parseYMD(s: string): Date | null {
  if (!s || s.length < 10) return null;
  const d = new Date(s + "T12:00:00");
  return isNaN(d.getTime()) ? null : d;
}
function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function DateField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [show, setShow] = useState(false);
  const [draft, setDraft] = useState<Date | null>(null);
  const parsed = parseYMD(value);
  const displayText = parsed
    ? parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";

  const openPicker = () => {
    if (disabled) return;
    setDraft(parsed || new Date());
    setShow(true);
  };

  return (
    <View style={{ flex: 1 }}>
      <Text style={editStyles.label}>{label}</Text>
      <Pressable
        style={[editStyles.input, { justifyContent: "center" }]}
        onPress={openPicker}
        disabled={disabled}
      >
        <Text style={{ color: parsed ? "#222" : Colors.cardMuted, fontSize: 14 }}>
          {displayText || "Select date"}
        </Text>
      </Pressable>
      {value ? (
        <Pressable onPress={() => { onChange(""); }} style={{ marginTop: 4 }}>
          <Text style={{ color: Colors.orange, fontSize: 11 }}>Clear</Text>
        </Pressable>
      ) : null}

      {show && Platform.OS === "web" && (
        <CalendarPopup
          initialValue={value}
          onPick={(iso) => { onChange(iso); setShow(false); }}
          onClose={() => setShow(false)}
        />
      )}

      {show && Platform.OS === "ios" && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShow(false)}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }} onPress={() => setShow(false)} />
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#fff", paddingBottom: 20 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#eee" }}>
              <Pressable onPress={() => setShow(false)}>
                <Text style={{ color: Colors.cardMuted, fontSize: 15 }}>Cancel</Text>
              </Pressable>
              <Text style={{ fontFamily: "Inter_700Bold", color: Colors.cardText, fontSize: 15 }}>{label}</Text>
              <Pressable onPress={() => { if (draft) onChange(toYMD(draft)); setShow(false); }}>
                <Text style={{ color: Colors.green, fontSize: 15, fontFamily: "Inter_700Bold" }}>Done</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={draft || new Date()}
              mode="date"
              display="spinner"
              themeVariant="light"
              onChange={(_e: any, d?: Date) => { if (d) setDraft(d); }}
            />
          </View>
        </Modal>
      )}
      {show && Platform.OS === "android" && (
        <DateTimePicker
          value={parsed || new Date()}
          mode="date"
          display="default"
          onChange={(_e: any, d?: Date) => {
            setShow(false);
            if (d) onChange(toYMD(d));
          }}
        />
      )}
    </View>
  );
}

/* ── Isolated Edit Schedule Modal (avoids re-rendering 1800+ project list) ── */
const EditScheduleModal = React.memo(function EditScheduleModal({
  project,
  onClose,
  onSaved,
  bottomInset,
}: {
  project: Project | null;
  onClose: () => void;
  onSaved: (p: Project, dates: { targetStart: string; targetEnd: string; actualStart: string; actualEnd: string; closeDate: string; rawTargetStart: string; rawTargetEnd: string; rawActualStart: string; rawActualEnd: string; rawCloseDate: string }) => void;
  bottomInset: number;
}) {
  const [ts, setTs] = useState("");
  const [te, setTe] = useState("");
  const [as_, setAs] = useState("");
  const [ae, setAe] = useState("");
  const [cd, setCd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setTs(project.rawTargetStart); setTe(project.rawTargetEnd);
      setAs(project.rawActualStart); setAe(project.rawActualEnd);
      setCd(project.rawCloseDate);
      setError(null); setSaving(false);
    }
  }, [project]);

  async function doSave() {
    if (!project || saving) return;
    setSaving(true); setError(null);
    try {
      const fields: { FieldName: string; Value: string; IsExcluded: boolean }[] = [];
      if (ts) fields.push({ FieldName: "TargetStartDate", Value: `${ts}T00:00:00`, IsExcluded: false });
      if (te) fields.push({ FieldName: "TargetCompletionDate", Value: `${te}T00:00:00`, IsExcluded: false });
      if (as_) fields.push({ FieldName: "ActualStartDate", Value: `${as_}T00:00:00`, IsExcluded: false });
      if (ae) fields.push({ FieldName: "ActualCompletionDate", Value: `${ae}T00:00:00`, IsExcluded: false });
      if (cd) fields.push({ FieldName: "CloseDate", Value: `${cd}T00:00:00`, IsExcluded: false });
      if (fields.length === 0) { setError("No dates to update"); setSaving(false); return; }
      await smartUpdate(project.id, fields);
      onSaved(project, {
        targetStart: ts ? fmtDate(ts) : project.targetStart, targetEnd: te ? fmtDate(te) : project.targetEnd,
        actualStart: as_ ? fmtDate(as_) : project.actualStart, actualEnd: ae ? fmtDate(ae) : project.actualEnd,
        closeDate: cd ? fmtDate(cd) : project.closeDate,
        rawTargetStart: ts || project.rawTargetStart, rawTargetEnd: te || project.rawTargetEnd,
        rawActualStart: as_ || project.rawActualStart, rawActualEnd: ae || project.rawActualEnd,
        rawCloseDate: cd || project.rawCloseDate,
      });
      bustCache();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(String(e));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally { setSaving(false); }
  }

  return (
    <Modal visible={!!project} transparent animationType="slide" onRequestClose={() => { if (!saving) onClose(); }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={editStyles.overlay} onPress={() => { if (!saving) onClose(); }} />
        <View style={[editStyles.sheet, { paddingBottom: bottomInset + 20 }]}>
          <View style={editStyles.handle} />
          <Text style={editStyles.title}>Adjust Schedule</Text>
          <Text style={editStyles.sub}>{project?.name}</Text>
          <Text style={[editStyles.sub, { fontSize: 11, color: Colors.cardMuted }]}>{project?.id}</Text>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={editStyles.phaseRow}><View style={[editStyles.dot, { backgroundColor: Colors.green }]} /><Text style={editStyles.phaseLabel}>Target</Text></View>
            <View style={editStyles.dateRow}>
              <DateField label="Start" value={ts} onChange={setTs} disabled={saving} />
              <DateField label="Completion" value={te} onChange={setTe} disabled={saving} />
            </View>
            <View style={editStyles.phaseRow}><View style={[editStyles.dot, { backgroundColor: Colors.orange }]} /><Text style={editStyles.phaseLabel}>Schedule</Text></View>
            <View style={editStyles.dateRow}>
              <DateField label="Start" value={as_} onChange={setAs} disabled={saving} />
              <DateField label="Completion" value={ae} onChange={setAe} disabled={saving} />
            </View>
            <View style={editStyles.phaseRow}><View style={[editStyles.dot, { backgroundColor: "#E04F4F" }]} /><Text style={editStyles.phaseLabel}>Close Date</Text></View>
            <View style={editStyles.dateRow}>
              <DateField label="Date" value={cd} onChange={setCd} disabled={saving} />
              <View style={{ flex: 1 }} />
            </View>
          </ScrollView>
          {error && <View style={editStyles.errorBox}><Text style={editStyles.errorText}>{error}</Text></View>}
          <Pressable style={[editStyles.saveBtn, saving && { opacity: 0.6 }]} onPress={doSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={editStyles.saveBtnText}>Save Changes</Text>}
          </Pressable>
          <Pressable style={editStyles.cancelBtn} onPress={() => { if (!saving) onClose(); }}>
            <Text style={editStyles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

const editStyles = themed(() => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, paddingTop: 14 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#ccc", alignSelf: "center", marginBottom: 14 },
  title: { fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.cardText, marginBottom: 2 },
  sub: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.cardText, marginBottom: 2 },
  phaseRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, marginBottom: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  phaseLabel: { fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.cardText },
  dateRow: { flexDirection: "row", gap: 10 },
  label: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted, marginBottom: 4 },
  input: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.cardText, backgroundColor: "#f5f5f5", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: "#e0e0e0" },
  errorBox: { backgroundColor: "#E04F4F15", borderRadius: 8, padding: 10, marginTop: 8 },
  errorText: { fontFamily: "Inter_400Regular", fontSize: 12, color: "#E04F4F" },
  saveBtn: { backgroundColor: Colors.green, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 14 },
  saveBtnText: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" },
  cancelBtn: { alignItems: "center", paddingVertical: 12 },
  cancelBtnText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.cardMuted },
}));

const EditOppScheduleModal = React.memo(function EditOppScheduleModal({
  opp,
  onClose,
  onSaved,
  bottomInset,
}: {
  opp: Opportunity | null;
  onClose: () => void;
  onSaved: (o: Opportunity, dates: { bidDate: string; actualStart: string; actualEnd: string; rawBidDate: string; rawActualStart: string; rawActualEnd: string }) => void;
  bottomInset: number;
}) {
  const [bd, setBd] = useState("");
  const [as_, setAs] = useState("");
  const [ae, setAe] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opp) {
      setBd(opp.rawBidDate); setAs(opp.rawActualStart); setAe(opp.rawActualEnd);
      setError(null); setSaving(false);
    }
  }, [opp]);

  async function doSave() {
    if (!opp || saving) return;
    setSaving(true); setError(null);
    try {
      const fields: { FieldName: string; Value: string; IsExcluded: boolean }[] = [];
      if (bd) fields.push({ FieldName: "BidDueDate", Value: `${bd}T00:00:00`, IsExcluded: false });
      if (as_) fields.push({ FieldName: "ActualStartDate", Value: `${as_}T00:00:00`, IsExcluded: false });
      if (ae) fields.push({ FieldName: "ActualCompletionDate", Value: `${ae}T00:00:00`, IsExcluded: false });
      if (fields.length === 0) { setError("No dates to update"); setSaving(false); return; }
      await smartUpdate(opp.id, fields);
      onSaved(opp, {
        bidDate: bd ? fmtDate(bd) : opp.bidDate, actualStart: as_ ? fmtDate(as_) : opp.actualStart, actualEnd: ae ? fmtDate(ae) : opp.actualEnd,
        rawBidDate: bd || opp.rawBidDate, rawActualStart: as_ || opp.rawActualStart, rawActualEnd: ae || opp.rawActualEnd,
      });
      bustCache();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(String(e));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally { setSaving(false); }
  }

  return (
    <Modal visible={!!opp} transparent animationType="slide" onRequestClose={() => { if (!saving) onClose(); }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={editStyles.overlay} onPress={() => { if (!saving) onClose(); }} />
        <View style={[editStyles.sheet, { paddingBottom: bottomInset + 20 }]}>
          <View style={editStyles.handle} />
          <Text style={editStyles.title}>Opportunity Schedule</Text>
          <Text style={editStyles.sub}>{opp?.name}</Text>
          <Text style={[editStyles.sub, { fontSize: 11, color: Colors.cardMuted }]}>{opp?.id}</Text>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={editStyles.phaseRow}><View style={[editStyles.dot, { backgroundColor: Colors.dark }]} /><Text style={editStyles.phaseLabel}>Bid Due Date</Text></View>
            <View style={editStyles.dateRow}>
              <DateField label="Date" value={bd} onChange={setBd} disabled={saving} />
              <View style={{ flex: 1 }} />
            </View>
            <View style={editStyles.phaseRow}><View style={[editStyles.dot, { backgroundColor: Colors.orange }]} /><Text style={editStyles.phaseLabel}>Schedule</Text></View>
            <View style={editStyles.dateRow}>
              <DateField label="Start" value={as_} onChange={setAs} disabled={saving} />
              <DateField label="Completion" value={ae} onChange={setAe} disabled={saving} />
            </View>
          </ScrollView>
          {error && <View style={editStyles.errorBox}><Text style={editStyles.errorText}>{error}</Text></View>}
          <Pressable style={[editStyles.saveBtn, saving && { opacity: 0.6 }]} onPress={doSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={editStyles.saveBtnText}>Save Changes</Text>}
          </Pressable>
          <Pressable style={editStyles.cancelBtn} onPress={() => { if (!saving) onClose(); }}>
            <Text style={editStyles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

/* ─── SOURCE TYPE OPTIONS (matches web) ─────────────────────────────────── */
const SOURCE_TYPE_OPTIONS = [
  "Government", "Private", "Negotiated", "Competitive Bid",
  "CM at Risk", "Design-Build", "JOC", "IDIQ", "Emergency",
];

/* ─── NOTES MODAL ────────────────────────────────────────────────────────── */
const NotesActionModal = React.memo(function NotesActionModal({
  target,
  onClose,
  onSaved,
  bottomInset,
}: {
  target: { id: string; module: "PMM" | "OPM"; name: string; current: string } | null;
  onClose: () => void;
  onSaved: (id: string, module: "PMM" | "OPM", note: string) => void;
  bottomInset: number;
}) {
  const [text, setText] = useState(target?.current ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) { setText(target.current); setError(null); setSaving(false); }
  }, [target]);

  async function doSave() {
    if (!target || saving) return;
    setSaving(true); setError(null);
    try {
      const fieldName = target.module === "PMM" ? "Comment" : "Note";
      const res = await updateFields(target.id, [{ FieldName: fieldName, Value: text.trim() }]);
      if (!res.ok) throw new Error(res.error ?? "Failed to save note");
      onSaved(target.id, target.module, text.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e) {
      setError(String(e));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally { setSaving(false); }
  }

  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={() => { if (!saving) onClose(); }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={editStyles.overlay} onPress={() => { if (!saving) onClose(); }} />
        <View style={[editStyles.sheet, { paddingBottom: bottomInset + 20 }]}>
          <View style={editStyles.handle} />
          <Text style={editStyles.title}>Notes</Text>
          <Text style={editStyles.sub} numberOfLines={1}>{target?.name}</Text>
          <Text style={[editStyles.sub, { fontSize: 11, color: Colors.cardMuted, marginBottom: 14 }]}>{target?.id}</Text>
          <TextInput
            style={[editStyles.input, { height: 110, textAlignVertical: "top" }]}
            value={text}
            onChangeText={setText}
            placeholder="Enter notes…"
            placeholderTextColor={Colors.cardMuted}
            multiline
            editable={!saving}
          />
          {error && <View style={editStyles.errorBox}><Text style={editStyles.errorText}>{error}</Text></View>}
          <Pressable style={[editStyles.saveBtn, saving && { opacity: 0.6 }, { marginTop: 14 }]} onPress={doSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={editStyles.saveBtnText}>Save Note</Text>}
          </Pressable>
          <Pressable style={editStyles.cancelBtn} onPress={() => { if (!saving) onClose(); }}>
            <Text style={editStyles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

/* ─── HOLD MODAL ─────────────────────────────────────────────────────────── */
const HoldActionModal = React.memo(function HoldActionModal({
  target,
  onClose,
  onSaved,
  bottomInset,
}: {
  target: { id: string; module: "PMM" | "OPM"; name: string } | null;
  onClose: () => void;
  onSaved: (id: string, reason: string) => void;
  bottomInset: number;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) { setReason(""); setError(null); setSaving(false); }
  }, [target]);

  async function doSave() {
    if (!target || saving) return;
    setSaving(true); setError(null);
    try {
      const res = await updateFields(target.id, [
        { FieldName: "Status", Value: "On Hold" },
        ...(reason.trim() ? [{ FieldName: "Comment", Value: reason.trim() }] : []),
      ]);
      if (!res.ok) throw new Error(res.error ?? "Failed to put on hold");
      onSaved(target.id, reason.trim() || "On Hold");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e) {
      // updateFields re-throws non-2xx errors with the server's human-readable
      // message (e.g. "Fill in Department before moving to On Hold" from the
      // stage-rules gate). Show that directly — never a raw JSON blob.
      setError(e instanceof Error ? e.message : String(e));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally { setSaving(false); }
  }

  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={() => { if (!saving) onClose(); }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={editStyles.overlay} onPress={() => { if (!saving) onClose(); }} />
        <View style={[editStyles.sheet, { paddingBottom: bottomInset + 20 }]}>
          <View style={editStyles.handle} />
          <Text style={editStyles.title}>Put on Hold</Text>
          <Text style={editStyles.sub} numberOfLines={1}>{target?.name}</Text>
          <Text style={[editStyles.sub, { fontSize: 11, color: Colors.cardMuted, marginBottom: 14 }]}>{target?.id}</Text>
          <View style={{ backgroundColor: "#FEF3C710", borderRadius: 10, borderWidth: 1, borderColor: "#FDE68A", padding: 12, marginBottom: 14 }}>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#92400E", lineHeight: 18 }}>
              This will set the status to "On Hold". Optionally add a reason below.
            </Text>
          </View>
          <TextInput
            style={[editStyles.input, { height: 80, textAlignVertical: "top" }]}
            value={reason}
            onChangeText={setReason}
            placeholder="Reason (optional)…"
            placeholderTextColor={Colors.cardMuted}
            multiline
            editable={!saving}
          />
          {error && <View style={editStyles.errorBox}><Text style={editStyles.errorText}>{error}</Text></View>}
          <Pressable style={[editStyles.saveBtn, saving && { opacity: 0.6 }, { marginTop: 14, backgroundColor: "#D97706" }]} onPress={doSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={editStyles.saveBtnText}>Confirm Hold</Text>}
          </Pressable>
          <Pressable style={editStyles.cancelBtn} onPress={() => { if (!saving) onClose(); }}>
            <Text style={editStyles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

/* ─── CHANGE SOURCE TYPE MODAL ───────────────────────────────────────────── */
const SourceTypeActionModal = React.memo(function SourceTypeActionModal({
  target,
  onClose,
  onSaved,
  bottomInset,
}: {
  target: { id: string; name: string; current: string } | null;
  onClose: () => void;
  onSaved: (id: string, category: string) => void;
  bottomInset: number;
}) {
  const [selected, setSelected] = useState(target?.current ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) { setSelected(target.current); setError(null); setSaving(false); }
  }, [target]);

  async function doSave() {
    if (!target || saving || !selected) return;
    setSaving(true); setError(null);
    try {
      const res = await updateFields(target.id, [{ FieldName: "RequestCategory", Value: selected }]);
      if (!res.ok) throw new Error(res.error ?? "Failed to update source type");
      onSaved(target.id, selected);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e) {
      setError(String(e));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally { setSaving(false); }
  }

  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={() => { if (!saving) onClose(); }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={editStyles.overlay} onPress={() => { if (!saving) onClose(); }} />
        <View style={[editStyles.sheet, { paddingBottom: bottomInset + 20 }]}>
          <View style={editStyles.handle} />
          <Text style={editStyles.title}>Change Source Type</Text>
          <Text style={editStyles.sub} numberOfLines={1}>{target?.name}</Text>
          <Text style={[editStyles.sub, { fontSize: 11, color: Colors.cardMuted, marginBottom: 14 }]}>{target?.id}</Text>
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 280 }}>
            {SOURCE_TYPE_OPTIONS.map(opt => (
              <Pressable
                key={opt}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 12,
                  paddingHorizontal: 14, paddingVertical: 12,
                  backgroundColor: selected === opt ? Colors.orange + "15" : "transparent",
                  borderRadius: 10, marginBottom: 4,
                  borderWidth: 1,
                  borderColor: selected === opt ? Colors.orange + "60" : "transparent",
                }}
                onPress={() => setSelected(opt)}
              >
                <View style={{
                  width: 18, height: 18, borderRadius: 9,
                  borderWidth: 2,
                  borderColor: selected === opt ? Colors.orange : Colors.cardMuted,
                  alignItems: "center", justifyContent: "center",
                }}>
                  {selected === opt ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.orange }} /> : null}
                </View>
                <Text style={{ fontFamily: selected === opt ? "Inter_600SemiBold" : "Inter_400Regular", fontSize: 14, color: Colors.cardText }}>{opt}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {error && <View style={editStyles.errorBox}><Text style={editStyles.errorText}>{error}</Text></View>}
          <Pressable style={[editStyles.saveBtn, (saving || !selected) && { opacity: 0.6 }, { marginTop: 14 }]} onPress={doSave} disabled={saving || !selected}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={editStyles.saveBtnText}>Save</Text>}
          </Pressable>
          <Pressable style={editStyles.cancelBtn} onPress={() => { if (!saving) onClose(); }}>
            <Text style={editStyles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

/* ══════════════════════════════════════════════════════════════════════════ */
export default function PipelineScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, handleAuthError } = useAuth();
  useScreenBeacon("Projects");
  const ss = getSSParam();

  /* ── Live data ─────────────────────────────────────────────────────────── */
  const initPMM = peekModuleRecords("PMM");
  const initOPM = peekModuleRecords("OPM");
  const initLEM = peekModuleRecords("LEM");
  const initCOM = peekModuleRecords("COM");
  const hasCachedPipeline = !!(initPMM || initOPM || initLEM || initCOM);

  const [dataLoading, setDataLoading] = useState(!hasCachedPipeline);
  const [refreshing, setRefreshing] = useState(false);
  // True when every module fetch came back with apiUnavailable (RM ONE upstream
  // is degraded). Drives the friendly "APIs are under development" empty-state
  // banner instead of the misleading "No projects found" message.
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const refreshSpin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  useEffect(() => {
    if (refreshing) {
      spinAnim.setValue(0);
      Animated.loop(Animated.timing(spinAnim, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true })).start();
    } else {
      spinAnim.stopAnimation();
    }
  }, [refreshing]);
  const [projects, setProjects] = useState<Project[]>(() =>
    initPMM ? (initPMM.data ?? []).map(mapPMM).filter(p => p.id) : []
  );
  const [opps, setOpps] = useState<Opportunity[]>(() =>
    initOPM ? (initOPM.data ?? []).map(mapOPM).filter(o => o.id) : []
  );
  const [leads, setLeads] = useState<Lead[]>(() =>
    initLEM ? (initLEM.data ?? []).map(mapLEM).filter(l => l.id) : []
  );
  const [companies, setCompanies] = useState<Company[]>(() =>
    initCOM ? (initCOM.data ?? []).map(mapCOM).filter(c => c.id && c.name) : []
  );
  // Resource demands feed the per-project staffing summary on each card.
  // Same data source as the home dashboard's resource section.
  const [demands, setDemands] = useState<DemandItem[]>([]);

  const applyRecords = useCallback((
    pmmRes: { data?: ModuleRecord[] },
    opmRes: { data?: ModuleRecord[] },
    lemRes: { data?: ModuleRecord[] },
    comRes: { data?: ModuleRecord[] },
  ) => {
    const pmmRaw = pmmRes?.data ?? [];
    const pmmMapped = pmmRaw.map(mapPMM).filter(p => p.id);
    console.log(`[Pipeline.apply] pmmRaw=${pmmRaw.length} mapped=${pmmMapped.length} opmRaw=${(opmRes?.data ?? []).length} lemRaw=${(lemRes?.data ?? []).length} comRaw=${(comRes?.data ?? []).length}`);

    const opmMapped = (opmRes?.data ?? [])
      .map(mapOPM)
      .filter(o => o.id)
      .sort((a, b) => {
        if (a.daysLeft === 999 && b.daysLeft === 999) return b.value - a.value;
        if (a.daysLeft === 999) return 1;
        if (b.daysLeft === 999) return -1;
        return a.daysLeft - b.daysLeft;
      });

    const lemMapped = (lemRes?.data ?? [])
      .map(mapLEM)
      .filter(l => l.id)
      .sort((a, b) => b.value - a.value);

    const comMapped = (comRes?.data ?? [])
      .map(mapCOM)
      .filter(c => c.id && c.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    setProjects(pmmMapped);
    setOpps(opmMapped);
    setLeads(lemMapped);
    setCompanies(comMapped);
  }, []);

  const loadData = useCallback(async () => {
    const pmmPeek = peekModuleRecords("PMM");
    const opmPeek = peekModuleRecords("OPM");
    const lemPeek = peekModuleRecords("LEM");
    const comPeek = peekModuleRecords("COM");
    console.log(`[Pipeline.load] peek PMM=${!!(pmmPeek?.data)} OPM=${!!(opmPeek?.data)} LEM=${!!(lemPeek?.data)} COM=${!!(comPeek?.data)}`);
    if (pmmPeek || opmPeek || lemPeek || comPeek) {
      applyRecords(
        pmmPeek ?? { Status: true, total: 0, data: [] },
        opmPeek ?? { Status: true, total: 0, data: [] },
        lemPeek ?? { Status: true, total: 0, data: [] },
        comPeek ?? { Status: true, total: 0, data: [] },
      );
      setDataLoading(false);
    } else {
      setDataLoading(true);
    }
    try {
      const results = await Promise.allSettled([
        getModuleRecords("PMM"),
        getModuleRecords("OPM"),
        getModuleRecords("LEM"),
        getModuleRecords("COM"),
      ]);
      const has401 = results.some((r) => r.status === "rejected" && ((r.reason as any)?.status === 401 || String(r.reason).includes("401")));
      if (has401) { handleAuthError(); return; }
      results.forEach((r, i) => { if (r.status === "rejected") console.warn(`[Pipeline] Module ${["PMM","OPM","LEM","COM"][i]} failed:`, String(r.reason)); });
      const anySuccess = results.some(r => r.status === "fulfilled");
      // Detect upstream-unavailable: every module rejected AND at least one
      // rejection carries the apiUnavailable flag from the API server.
      const allRejected = results.every(r => r.status === "rejected");
      const anyUnavailable = results.some(r =>
        r.status === "rejected" && (r.reason as any)?.apiUnavailable === true
      );
      if (allRejected && anyUnavailable) {
        console.warn("[Pipeline] All modules unavailable — RM ONE upstream is degraded");
        setApiUnavailable(true);
      } else if (anySuccess) {
        // Any module came back — clear the banner.
        setApiUnavailable(false);
      }
      if (anySuccess) {
        const fallback = { Status: true, total: 0, data: [] as ModuleRecord[] };
        const pmmRes = results[0].status === "fulfilled" ? results[0].value : (pmmPeek ?? fallback);
        const opmRes = results[1].status === "fulfilled" ? results[1].value : (opmPeek ?? fallback);
        const lemRes = results[2].status === "fulfilled" ? results[2].value : (lemPeek ?? fallback);
        const comRes = results[3].status === "fulfilled" ? results[3].value : (comPeek ?? fallback);
        console.log("[Pipeline] PMM:", (pmmRes?.data ?? []).length, "OPM:", (opmRes?.data ?? []).length, "LEM:", (lemRes?.data ?? []).length, "COM:", (comRes?.data ?? []).length);
        applyRecords(pmmRes, opmRes, lemRes, comRes);
      } else {
        console.warn("[Pipeline] All modules failed — keeping cached data");
      }
    } catch (e) { console.warn("[Pipeline] loadData error:", String(e)); }
    finally { setDataLoading(false); }
  }, [applyRecords, handleAuthError]);

  useEffect(() => { if (user) loadData(); }, [user]);

  // Load resource demands once the user is signed in. Best-effort —
  // failures just mean cards will show "No demand recorded".
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getResourceDemands();
        if (!cancelled) setDemands((res?.data ?? []) as DemandItem[]);
      } catch (e) {
        console.warn("[Pipeline] getResourceDemands failed:", String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Per-project staffing summary keyed by TicketId, using the same
  // forecast-window predicate the web/home dashboard uses (default 30d).
  // Counts demand records that overlap the next windowDays days.
  const STAFFING_WINDOW_DAYS = 30;
  const projectStaffing = useMemo(() => {
    const out: Record<string, { count: number; avgPct: number; fte: number; topRole: string | null; roles: string[] }> = {};
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const horizon = new Date(todayStart.getTime() + STAFFING_WINDOW_DAYS * 86400000);
    const byTid: Record<string, DemandItem[]> = {};
    for (const d of demands) {
      const start = (d as any)?.AllocationStartDate ? new Date((d as any).AllocationStartDate) : null;
      const end = (d as any)?.AllocationEndDate ? new Date((d as any).AllocationEndDate) : null;
      if (start && start > horizon) continue;
      if (end && end < todayStart) continue;
      const tid = String((d as any)?.TicketId ?? "").trim();
      if (!tid) continue;
      (byTid[tid] ??= []).push(d);
    }
    for (const [tid, arr] of Object.entries(byTid)) {
      const sumPct = arr.reduce((s, d) => s + (Number((d as any)?.PctAllocation) || 0), 0);
      const roleSums: Record<string, number> = {};
      for (const d of arr) {
        const role = String((d as any)?.Role ?? "").trim() || "Unassigned";
        roleSums[role] = (roleSums[role] || 0) + (Number((d as any)?.PctAllocation) || 0);
      }
      const sortedRoles = Object.entries(roleSums).sort((a, b) => b[1] - a[1]);
      const topRole = sortedRoles[0]?.[0] || null;
      const uniqueRoles = sortedRoles.map(([r]) => r);
      out[tid] = {
        count: arr.length,
        avgPct: Math.round(arr.length ? sumPct / arr.length : 0),
        fte: Math.round((sumPct / 100) * 10) / 10,
        topRole,
        roles: uniqueRoles,
      };
    }
    return out;
  }, [demands]);

  // Authoritative "My" list from RM ONE (matches what the web shows)
  const [myRecordCodes, setMyRecordCodes] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!user?.username) return;
    let cancelled = false;
    getProjectList(user.username)
      .then(codes => {
        if (cancelled) return;
        const set = new Set(codes.map(c => c.toUpperCase()));
        console.log(`[projects] My-list from RM ONE: ${set.size} records for ${user.username}`);
        setMyRecordCodes(set);
      })
      .catch(e => console.warn("[projects] getProjectList failed:", String(e)));
    return () => { cancelled = true; };
  }, [user?.username]);
  useEffect(() => {
    return onCacheBust(() => { if (user) loadData(); });
  }, [user, loadData]);
  useFocusEffect(useCallback(() => {
    if (!user) return;
    if (isCacheFresh("PMM") && isCacheFresh("OPM") && projects.length > 0) {
      return;
    }
    loadData();
  }, [user, loadData, projects.length]));

  /* ── View + filters ─────────────────────────────────────────────────────── */
  const [view, setView] = useState<PipelineView>(
    ss.includes("opp") ? "Opportunities" : ss.includes("lead") ? "Leads" : "Projects"
  );
  // Deep-link from Home: ?stage=precon|active|bidding|closeout filters PMM list.
  // Use Expo Router's reactive hook so the param updates when navigating from Home with a different stage,
  // even if the screen was previously mounted (web fallback to query string for native code paths).
  const routeParams = useLocalSearchParams<{ stage?: string }>();
  const routeStage = (typeof routeParams.stage === "string" ? routeParams.stage : "").toLowerCase()
                    || getQueryParam("stage").toLowerCase();
  const [stageFilter, setStageFilter] = useState<string>(routeStage);
  // Re-sync stageFilter whenever the URL/route stage param changes (e.g. user taps a different chip on Home).
  useEffect(() => { setStageFilter(routeStage); }, [routeStage]);
  const [filterByView, setFilterByView] = useState<Record<PipelineView, FilterTab>>({
    Projects: stageFilter ? "All Open" : "All",
    Opportunities: "All Open",
    Leads: "All",
    Companies: "All",
  });
  // When stage deep-link arrives (or changes), force Projects view + override any sticky "My Open" filter
  // so the user actually sees all 22 PreCon (or N Active/Bidding/Closeout) projects, not just their own.
  useEffect(() => {
    if (stageFilter) {
      setView("Projects");
      setFilterByView(prev => ({
        ...prev,
        Projects: stageFilter === "closeout" ? "Closed" : "All Open",
      }));
    }
  }, [stageFilter]);
  const filter = (view === "Leads" && filterByView.Leads === "My Open") ? "All" : filterByView[view];
  const setFilter = useCallback((f: FilterTab) => {
    setFilterByView(prev => ({ ...prev, [view]: f }));
  }, [view]);
  const [dateFilter, setDateFilter] = useState<DateFilter>("All Time");
  const [oppStageFilter, setOppStageFilter] = useState("All");
  const [oppStatusFilter, setOppStatusFilter] = useState<OpmStatusFilter>("All Open");
  const [comStatusFilter, setComStatusFilter] = useState<"Clients" | "All">("Clients");
  const [buFilter, setBuFilter] = useState("All");
  const [showBuDropdown, setShowBuDropdown] = useState(false);
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [mapStats, setMapStats] = useState<{ module: string; cities: number; records: number; totalValue: number } | null>(null);
  const [expandedOpp, setExpandedOpp] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingOpp, setEditingOpp] = useState<Opportunity | null>(null);
  const [reallocateProject, setReallocateProject] = useState<Project | null>(null);
  const [findStaffProject, setFindStaffProject] = useState<Project | null>(null);

  const [impactProject, setImpactProject] = useState<Project | null>(null);
  const [impactResources, setImpactResources] = useState<{ name: string; role: string; pct: number; email: string; startDate: string; endDate: string; resourceId?: string; enabled?: boolean; tenantId?: string; teamData?: ProjectTeamMember }[]>([]);
  const [impactOpenRoles, setImpactOpenRoles] = useState<OpenRole[]>([]);
  const [expandedTeamIdx, setExpandedTeamIdx] = useState<number | null>(null);
  const [teamSearch, setTeamSearch] = useState("");
  const [editAllocPerson, setEditAllocPerson] = useState<{ name: string; role: string; pct: number; resourceId?: string; disambiguator?: string } | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [assignOpenRole, setAssignOpenRole] = useState<OpenRole | null>(null);
  const [pendingWeeklyAlloc, setPendingWeeklyAlloc] = useState<{ name: string; resourceId?: string } | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [notifyingSending, setNotifyingSending] = useState(false);
  const [notifyResult, setNotifyResult] = useState<{ sent: number; total: number; failed: { email: string; error?: string }[] } | null>(null);
  const [impactDates, setImpactDates] = useState<{ field: string; old: string; new_: string }[]>([]);
  const [findStaffData, setFindStaffData] = useState<SkillsResource[]>([]);
  const [findStaffLoading, setFindStaffLoading] = useState(false);
  const [findStaffError, setFindStaffError] = useState<string | null>(null);
  const [staffSearch, setStaffSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  /* ── Card action menu (⋮) ──────────────────────────────────────────────── */
  type CardMenuTarget = { id: string; module: "PMM" | "OPM"; name: string; note?: string; requestCategory?: string } | null;
  const [cardMenu, setCardMenu] = useState<CardMenuTarget>(null);
  const [notesPending, setNotesPending] = useState<{ id: string; module: "PMM" | "OPM"; name: string; current: string } | null>(null);
  const [holdPending, setHoldPending] = useState<{ id: string; module: "PMM" | "OPM"; name: string } | null>(null);
  const [sourceTypePending, setSourceTypePending] = useState<{ id: string; name: string; current: string } | null>(null);
  const [holdInfoMap, setHoldInfoMap] = useState<Record<string, string>>({});

  const [companyDetail, setCompanyDetail] = useState<Company | null>(null);
  const [companyTab, setCompanyTab] = useState<"projects" | "contacts">("projects");
  const [companyProjects, setCompanyProjects] = useState<{ id: string; name: string; module: string; status: string; value: number; city: string; sector: string }[]>([]);
  const [companyContacts, setCompanyContacts] = useState<{ id: string; name: string; title: string; email: string; phone: string }[]>([]);
  const [companyLoading, setCompanyLoading] = useState(false);

  const companyCacheRef = useRef<Record<string, { projects: any[]; contacts: any[]; ts: number }>>({});
  const COMPANY_CACHE_TTL = 2 * 60 * 1000;

  const matchCompanyProjects = useCallback((companyName: string) => {
    const cn = companyName.toLowerCase().trim();
    const words = cn.split(/\s+/).filter(Boolean);
    const perms = [cn];
    if (words.length === 2) perms.push(words[1] + " " + words[0]);
    const matchTitle = (title: string) => {
      const t = title.toLowerCase().replace(/[(),"']/g, " ").replace(/\s+/g, " ").trim();
      for (const perm of perms) {
        if (t === perm) return true;
        const idx = t.indexOf(perm);
        if (idx === -1) continue;
        const before = idx === 0 || /[\s\-,/]/.test(t[idx - 1]);
        const after = idx + perm.length >= t.length || /[\s\-,/]/.test(t[idx + perm.length]);
        if (before && after) return true;
      }
      return false;
    };
    const results: { id: string; name: string; module: string; status: string; value: number; city: string; sector: string }[] = [];
    const seen = new Set<string>();
    const modules: { key: "PMM" | "OPM" | "LEM"; statusField: string }[] = [
      { key: "PMM", statusField: "Status" },
      { key: "OPM", statusField: "Status" },
      { key: "LEM", statusField: "LeadStatus" },
    ];
    for (const mod of modules) {
      const raw = peekModuleRecords(mod.key);
      const data = raw?.data ?? [];
      for (const r of data) {
        const title = r.Title ?? r.ShortName ?? "";
        const id = r.TicketId ?? "";
        if (!id || seen.has(id) || !matchTitle(title)) continue;
        seen.add(id);
        results.push({
          id,
          name: title,
          module: mod.key,
          status: (r as any)[mod.statusField] ?? (r as any).LeadStatus ?? "—",
          value: r.ApproxContractValue ?? 0,
          city: getCityField(r),
          sector: (r as any).SectorChoice ?? "—",
        });
      }
    }
    return results;
  }, []);

  const openCompanyDetail = useCallback(async (c: Company, tab: "projects" | "contacts" = "projects") => {
    setCompanyDetail(c);
    setCompanyTab(tab);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (tab === "projects") {
      const localProj = matchCompanyProjects(c.name);
      setCompanyProjects(localProj);
      setCompanyLoading(false);
    } else {
      setCompanyProjects([]);
      const cached = companyCacheRef.current[c.id];
      if (cached && Date.now() - cached.ts < COMPANY_CACHE_TTL) {
        setCompanyContacts(cached.contacts);
        setCompanyLoading(false);
        return;
      }
      setCompanyLoading(true);
      setCompanyContacts([]);
      try {
        const base = getApiBase();
        const authToken = user?.token ?? "";
        const conRes = await fetch(`${base}/api/rmone/company-contacts?companyId=${encodeURIComponent(c.id)}`, { headers: { Authorization: `Bearer ${authToken}` } }).then(r => r.json()).catch(() => ({ data: [] }));
        const cont = conRes.data ?? [];
        companyCacheRef.current[c.id] = { projects: [], contacts: cont, ts: Date.now() };
        setCompanyContacts(cont);
      } catch (e) {
        console.warn("[CompanyDetail] Error:", String(e));
      } finally {
        setCompanyLoading(false);
      }
    }
  }, [user, matchCompanyProjects]);

  const openFindStaff = useCallback(async (p: Project) => {
    setFindStaffProject(p);
    setFindStaffData([]);
    setFindStaffError(null);
    setFindStaffLoading(true);
    setStaffSearch("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      console.log(`[FindStaff] Fetching roster for ${p.id}…`);
      const results = await getAvailableRoster(p.id);
      console.log(`[FindStaff] Got ${results.length} results, first:`, results[0] ? JSON.stringify(results[0]).slice(0, 200) : "none");
      setFindStaffData(results.sort((a, b) => a.currentPct - b.currentPct));
    } catch (e) {
      console.warn(`[FindStaff] Error:`, String(e));
      setFindStaffError(String(e));
      setFindStaffData([]);
    } finally {
      setFindStaffLoading(false);
    }
  }, []);

  const FILTERS: FilterTab[] = ["All", "My Open", "All Open", "Staffing Needs", "Closed"];

  const sq = searchQuery.toLowerCase().trim();

  const normalizeId = (id: string) => {
    const m = id.match(/^([a-z]{2,4})-(\d{2})-0*(\d+)$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : id;
  };
  const sqNorm = normalizeId(sq);

  const idMatch = (id: string) => {
    const lo = id.toLowerCase();
    return lo.includes(sq) || normalizeId(lo) === sqNorm;
  };

  const activeDateRange = getDateRange(dateFilter);

  const userGuid = (user?.userId ?? "").toLowerCase();
  const userName = (user?.username ?? "").toLowerCase();

  // "My Open" = the record is in the user's authoritative project list from RM ONE
  // (same source the web portal uses), OR the user appears in any assignment field.
  const isMine = (assignedUserGuids: string, recordId?: string) => {
    if (recordId && myRecordCodes.has(recordId.toUpperCase())) return true;
    if (!assignedUserGuids) return false;
    const hay = assignedUserGuids.toLowerCase();
    if (userGuid && hay.includes(userGuid)) return true;
    if (userName && hay.includes(userName)) return true;
    return false;
  };

  const filteredProjects = projects.filter(p => {
    if (filter === "All Open") {
      if (p.closed) return false;
    } else if (filter === "Closed") {
      if (!p.closed) return false;
    } else if (filter === "My Open") {
      if (p.closed) return false;
      if (!isMine(p.assignedUserGuids, p.id)) return false;
    } else if (filter === "Staffing Needs") {
      if (p.closed) return false;
      const s = projectStaffing[p.id];
      if (!s || s.count === 0) return false;
    }
    if (stageFilter) {
      const want = stageFilter === "precon" ? "PreCon"
                 : stageFilter === "active" ? "Active"
                 : stageFilter === "closeout" ? "Closeout"
                 : stageFilter === "bidding" ? "Bidding"
                 : "";
      if (want && p.phase !== want) return false;
    }
    if (sq && !nameMatches(p.name, sq) && !nameMatches(p.ticketNum, sq) && !idMatch(p.id) && !nameMatches(p.city, sq)) return false;
    if (activeDateRange && !overlapsRange([p.rawTargetStart, p.rawTargetEnd, p.rawActualStart, p.rawActualEnd, p.rawCloseDate], activeDateRange)) return false;
    return true;
  });

  const allBUs = Array.from(new Set(opps.map(o => o.bu).filter(Boolean))).sort();

  const statusFilteredOpps = opps.filter(o => {
    if (buFilter !== "All" && o.bu !== buFilter) return false;
    if (filter === "My Open") {
      if (o.closed) return false;
      if (!isMine(o.assignedUserGuids, o.id)) return false;
      return true;
    }
    // Opportunities view uses its own dedicated status pill (oppStatusFilter).
    // The shared FilterTab `filter` is not used to gate Open/Closed for opps.
    if (oppStatusFilter === "Closed") return o.closed;
    return !o.closed;
  });
  const oppStages = ["All", ...Array.from(new Set(statusFilteredOpps.map(o => o.stage)))];
  const allFilteredOpps = statusFilteredOpps.filter(o => {
    if (sq && !nameMatches(o.name, sq) && !idMatch(o.id) && !nameMatches(o.city, sq) && !(o.stage && nameMatches(o.stage, sq))) return false;
    if (activeDateRange && !overlapsRange([o.rawBidDate, o.rawTargetStart, o.rawTargetEnd, o.rawActualStart, o.rawActualEnd], activeDateRange)) return false;
    return true;
  });
  const filteredOpps = sq ? allFilteredOpps : allFilteredOpps.slice(0, 200);

  const totalOppValue = allFilteredOpps.reduce((s, o) => s + o.value, 0);
  const weightedOppValue = allFilteredOpps.reduce((s, o) => s + o.weightedValue, 0);

  const allFilteredLeads = leads.filter(l => {
    if (filter === "My Open") {
      if (l.closed) return false;
      if (!isMine(l.assignedUserGuids, l.id)) return false;
    } else if (filter === "All Open") {
      if (l.closed) return false;
    } else if (filter === "Closed") {
      if (!l.closed) return false;
    }
    if (sq && !nameMatches(l.name, sq) && !idMatch(l.id) && !nameMatches(l.city, sq) && !nameMatches(l.sector, sq)) return false;
    if (activeDateRange && !overlapsRange([l.rawTargetStart, l.rawTargetEnd], activeDateRange)) return false;
    return true;
  });
  const filteredLeads = sq ? allFilteredLeads : allFilteredLeads.slice(0, 200);

  const allFilteredCompanies = companies.filter(c => {
    if (comStatusFilter === "Clients" && !COM_ACTIVE_STATUSES.has(c.status)) return false;
    if (sq && !nameMatches(c.name, sq) && !idMatch(c.id) && !nameMatches(c.city, sq) && !nameMatches(c.type, sq)) return false;
    return true;
  });
  const filteredCompanies = sq ? allFilteredCompanies : allFilteredCompanies.slice(0, 200);

  const dateFilterLabel = dateFilter === "All Time" ? "" : dateFilter;

  function openEdit(p: Project) {
    setEditingProject(p);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
  function openOppEdit(o: Opportunity) {
    setEditingOpp(o);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
  const handleOppScheduleSaved = useCallback((opp: Opportunity, dates: { bidDate: string; actualStart: string; actualEnd: string; rawBidDate: string; rawActualStart: string; rawActualEnd: string }) => {
    setOpps(prev => prev.map(o => o.id === opp.id ? { ...o, ...dates } : o));
    setEditingOpp(null);
  }, []);
  const handleScheduleSaved = useCallback((proj: Project, dates: { targetStart: string; targetEnd: string; actualStart: string; actualEnd: string; closeDate: string; rawTargetStart: string; rawTargetEnd: string; rawActualStart: string; rawActualEnd: string; rawCloseDate: string }) => {
    setProjects(prev => prev.map(p => p.id === proj.id ? { ...p, ...dates } : p));
    setEditingProject(null);

    const changedDates: { field: string; old: string; new_: string }[] = [];
    if (dates.rawTargetStart !== proj.rawTargetStart) changedDates.push({ field: "Target Start", old: proj.targetStart, new_: dates.targetStart });
    if (dates.rawTargetEnd !== proj.rawTargetEnd) changedDates.push({ field: "Target End", old: proj.targetEnd, new_: dates.targetEnd });
    if (dates.rawActualStart !== proj.rawActualStart) changedDates.push({ field: "Schedule Start", old: proj.actualStart, new_: dates.actualStart });
    if (dates.rawActualEnd !== proj.rawActualEnd) changedDates.push({ field: "Schedule End", old: proj.actualEnd, new_: dates.actualEnd });
    if (dates.rawCloseDate !== proj.rawCloseDate) changedDates.push({ field: "Close Date", old: proj.closeDate, new_: dates.closeDate });

    setImpactDates(changedDates);
    setImpactProject(proj);
    setImpactLoading(true);
    setImpactResources([]);
    setImpactOpenRoles([]);
    setNotifyResult(null);
    setImpactError(null);

    const ROLE_USER_FIELDS: Record<string, string> = {
      ProjectManagerUser: "Project Manager",
      BusinessLeadUser: "Business Lead",
      ProjectLeadUser: "Project Lead",
      ProjectExecutiveUser: "Project Executive",
      SeniorProjectManagerUser: "Senior Project Manager",
      ElectricalEngineerUser: "Electrical Engineer",
      JuniorEngineerUser: "Junior Engineer",
      SeniorMechanicalEngineerUser: "Senior Mechanical Engineer",
      SeniorPlumbingEngineerUser: "Senior Plumbing Engineer",
      MechanicalEngineerUser: "Mechanical Engineer",
      PlumbingEngineerUser: "Plumbing Engineer",
      PhaseOwnerUser: "Phase Owner",
      ARCHSrProjectArchitectUser: "Sr. Project Architect",
      OwnerUser: "Owner",
    };
    Promise.all([
      getProjectTeam(proj.id).catch(() => ({ team: [] as ProjectTeamMember[], openRoles: [] })),
      getResourceAllocations().catch(() => null),
      getProjectAllocations(proj.id).catch(() => null),
      getProjectDetails(proj.id).catch(() => null),
    ]).then(([teamResp, resData, allocRaw, projDetails]) => {
      const teamData = teamResp?.team ?? (Array.isArray(teamResp) ? teamResp as ProjectTeamMember[] : []);
      const allResources = resData?.resources ?? [];
      const resMap = new Map<string, LiveResource>();
      const resById = new Map<string, LiveResource>();
      allResources.forEach(r => {
        if (r.username) resMap.set(r.username.toLowerCase(), r);
        if (r.name) resMap.set(r.name.toLowerCase(), r);
        if (r.id) resById.set(r.id.toLowerCase(), r);
      });
      const guidToName: Record<string, string> = (resData as any)?.userGuidToName ?? {};

      const teamByIdentity = new Map<string, ProjectTeamMember>();
      if (teamData && teamData.length > 0) {
        for (const tm of teamData) {
          const key = (tm.resourceId || tm.name || "").toLowerCase();
          if (key) teamByIdentity.set(key, tm);
        }
      }

      const impacted: { name: string; role: string; pct: number; email: string; startDate: string; endDate: string; resourceId?: string; enabled?: boolean; tenantId?: string; teamData?: ProjectTeamMember }[] = [];
      const seen = new Set<string>();

      if (teamData && teamData.length > 0) {
        for (const tm of teamData) {
          if (!tm.name) continue;
          const memberKey = (tm.resourceId || tm.name).toLowerCase();
          seen.add(memberKey);
          const match = (tm.resourceId ? resById.get(tm.resourceId.toLowerCase()) : undefined) ?? resMap.get(tm.name.toLowerCase());
          impacted.push({
            name: tm.name,
            role: tm.role || match?.role || "",
            pct: tm.pctAllocation ?? match?.currentPct ?? 0,
            email: match?.username ?? "",
            startDate: "",
            endDate: tm.bu ? `BU: ${tm.bu}` : "",
            resourceId: tm.resourceId ?? "",
            enabled: tm.enabled ?? match?.enabled,
            tenantId: tm.tenantId ?? match?.tenantId,
            teamData: tm,
          });
        }
      }

      if (allocRaw) {
        const allocArr = (() => {
          const arr = (allocRaw as any)?.Allocations ?? (Array.isArray(allocRaw) ? allocRaw : []);
          return Array.isArray(arr) ? arr : [];
        })();
        for (const a of allocArr) {
          let name = String(a.AssignedToName ?? a.ResourceUser ?? a.Name ?? "");
          if (/^[0-9a-f]{8}-/.test(name) || !name) {
            const userId = String(a.AssignedTo ?? "").toLowerCase();
            const res = resById.get(userId) ?? resMap.get(userId);
            if (res) name = res.name;
          }
          const memberKey = String(a.ResourceId ?? a.ResourceID ?? a.AssignedTo ?? name).toLowerCase();
          if (!name || seen.has(memberKey)) continue;
          seen.add(memberKey);
          let role = String(a.TypeName ?? a.RoleName ?? "");
          if (!role) {
            const userId = String(a.AssignedTo ?? "").toLowerCase();
            const resPerson = resById.get(userId) ?? resMap.get(name.toLowerCase());
            if (resPerson) role = resPerson.role || "";
          }
          const tm = teamByIdentity.get(String(a.ResourceId ?? a.ResourceID ?? a.AssignedTo ?? name).toLowerCase());
          const resMember = resById.get(String(a.AssignedTo ?? "").toLowerCase()) ?? resMap.get(name.toLowerCase());
          impacted.push({
            name,
            role,
            pct: Number(a.PctAllocation ?? 0),
            email: resMember?.username ?? "",
            startDate: String(a.AllocationStartDate ?? "").slice(0, 10),
            endDate: String(a.AllocationEndDate ?? "").slice(0, 10),
            resourceId: String(a.ResourceId ?? a.ResourceID ?? a.AssignedTo ?? ""),
            enabled: tm?.enabled ?? resMember?.enabled,
            tenantId: tm?.tenantId ?? resMember?.tenantId,
            teamData: tm,
          });
        }
      }

      if (impacted.length === 0 && projDetails) {
        const d: Record<string, any> = {};
        const dataField = (projDetails as any)?.Data;
        const flat = Array.isArray(dataField) ? dataField[0] : (dataField ?? projDetails);
        if (flat && Array.isArray(flat.Fields)) {
          for (const f of flat.Fields as { FieldName: string; Value: unknown }[]) {
            if (f.FieldName) d[f.FieldName] = f.Value ?? "";
          }
        } else if (flat) {
          Object.assign(d, flat);
        }
        for (const [field, roleName] of Object.entries(ROLE_USER_FIELDS)) {
          const val = d[field];
          if (!val || typeof val !== "string") continue;
          const guids = val.split(",").map((g: string) => g.trim().toLowerCase()).filter(Boolean);
          for (const guid of guids) {
            if (!/^[0-9a-f]{8}-/.test(guid)) continue;
            const resolvedName = guidToName[guid] || resById.get(guid)?.name;
            if (!resolvedName) continue;
            if (seen.has(guid)) continue;
            seen.add(guid);
            const tmr = teamByIdentity.get(guid);
            const resMbr = resById.get(guid) ?? resMap.get(resolvedName.toLowerCase());
            impacted.push({
              name: resolvedName,
              role: roleName,
              pct: tmr?.pctAllocation ?? 0,
              email: resMbr?.username ?? "",
              startDate: "",
              endDate: "",
              resourceId: tmr?.resourceId ?? "",
              enabled: tmr?.enabled ?? resMbr?.enabled,
              tenantId: tmr?.tenantId ?? resMbr?.tenantId,
              teamData: tmr,
            });
          }
        }
      }

      if (impacted.length === 0) {
        setImpactError("No team members found for this project.");
      }
      setExpandedTeamIdx(null);
      setImpactResources(impacted);
      setImpactOpenRoles((teamResp?.openRoles ?? []) as OpenRole[]);
    }).finally(() => setImpactLoading(false));
  }, []);
  function openReallocate(p: Project) {
    setReallocateProject(p);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
  function pushChat(prompt: string) {
    setChatPrompt(prompt);
    setTimeout(() => {
      try { router.navigate("/(tabs)/chat"); } catch (_) {}
    }, 100);
  }
  function modalToChat(prompt: string, context?: string) {
    debugLog("[modalToChat] storing prompt, length=" + prompt.length + (context ? " +context" : ""));
    setChatPrompt(prompt, context);
    setTimeout(() => {
      debugLog("[modalToChat] 800ms elapsed, calling router.navigate");
      try {
        router.navigate("/(tabs)/chat");
        debugLog("[modalToChat] navigate succeeded");
      } catch (e: any) {
        debugLog("[modalToChat] navigate ERROR: " + e?.message);
        globalAlert("Nav Error", e?.message || String(e));
      }
    }, 800);
  }
  function goReallocateAI() {
    const proj = reallocateProject;
    setReallocateProject(null);
    if (!proj) return;
    modalToChat(`Reallocate and optimize staffing for project "${proj.name}" (${proj.id}). First fetch the project details to understand the project type, value, phase, and current team. Then analyze the team composition against what this specific type/size of project needs, identify gaps or issues, and give me 3-5 specific data-driven recommendations for staffing changes (add, remove, increase, reduce). Match candidates from the bench based on their job titles and experience. Be decisive.`);
  }

  return (
    <View style={[styles.root, { backgroundColor: Colors.dark }]}>
      <View style={{ height: Math.max(insets.top, Platform.OS === "web" ? 54 : 0), backgroundColor: Colors.darkDeep }} />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Pipeline</Text>
          <Text style={styles.headerSub}>
            {dataLoading ? "Loading live data…" :
              showMap ? (
                mapStats ? <><Text style={styles.headerSubBold}>{mapStats.records.toLocaleString()}</Text>{` ${mapStats.module === "All" ? "records" : `${mapStats.module} records`} · ${mapStats.cities} cities`}</>
                         : <>Map view</>
              ) :
              view === "Projects" ? <><Text style={styles.headerSubBold}>{filteredProjects.length}</Text>{` projects · PMM${filter !== "All" ? ` · ${filter}` : ""}${dateFilterLabel ? ` · ${dateFilterLabel}` : ""}`}</> :
              view === "Opportunities" ? <><Text style={styles.headerSubBold}>{allFilteredOpps.length}</Text>{` opportunities · OPM · ${oppStatusFilter}${oppStageFilter !== "All" ? ` · ${oppStageFilter}` : ""}${dateFilterLabel ? ` · ${dateFilterLabel}` : ""}`}</> :
              view === "Leads" ? <><Text style={styles.headerSubBold}>{allFilteredLeads.length}</Text>{` leads · LEM${filter !== "All" ? ` · ${filter}` : ""}${dateFilterLabel ? ` · ${dateFilterLabel}` : ""}`}</> :
              <><Text style={styles.headerSubBold}>{allFilteredCompanies.length}</Text>{` companies · COM`}</>}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {/* <Pressable
            style={[styles.addBtn, { backgroundColor: Colors.green }]}
            onPress={() => { router.push("/project/create"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
          >
            <Feather name="plus" size={14} color={Colors.white} />
            <Text style={styles.addBtnText}>New</Text>
          </Pressable> */}
          <Pressable
            style={[styles.addBtn, showMap && { backgroundColor: Colors.green }]}
            onPress={() => { setShowMap(v => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
          >
            <Feather name={showMap ? "list" : "map"} size={14} color={Colors.white} />
          </Pressable>
          <Pressable style={[styles.addBtn, refreshing && { opacity: 0.7 }, { paddingHorizontal: 10 }]} onPress={async () => { if (refreshing) return; setRefreshing(true); bustCache(); await loadData(); setRefreshing(false); }}>
            <Animated.View style={refreshing ? { transform: [{ rotate: refreshSpin }] } : undefined}>
              <Feather name="refresh-cw" size={14} color={Colors.white} />
            </Animated.View>
          </Pressable>
        </View>
      </View>

      {showMap ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
          <ProjectMap
            projects={filteredProjects}
            opps={filteredOpps}
            leads={filteredLeads}
            companies={filteredCompanies}
            onItemPress={(id) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/project/${id}`); }}
            onAskAI={(prompt) => pushChat(prompt)}
            onStatsChange={setMapStats}
          />
        </ScrollView>
      ) : (
      <>

      {/* ── Segment switcher ───────────────────────────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.segmentRow}
        contentContainerStyle={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10 }}
      >
        {([
          { v: "Projects",     label: "Projects",     icon: "layers" as const },
          { v: "Opportunities",label: "Opps",         icon: "trending-up" as const },
          { v: "Leads",        label: "Leads",        icon: "star" as const },
          { v: "Companies",    label: "Companies",    icon: "briefcase" as const },
        ] as const).map(({ v, label, icon }) => (
          <Pressable
            key={v}
            style={[styles.segmentPill, view === v && styles.segmentPillActive]}
            onPress={() => {
              setView(v);
              setSearchQuery("");
              if (v !== "Opportunities") { setBuFilter("All"); setShowBuDropdown(false); }
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
          >
            <Feather name={icon} size={12} color={view === v ? Colors.white : Colors.textSecondary} />
            <Text style={[styles.segmentText, view === v && styles.segmentTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* ── Search bar + date dropdown ─────────────────────────────────── */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: Colors.darkCard, borderRadius: 10, paddingHorizontal: 12, gap: 8 }}>
            <Feather name="search" size={14} color={searchQuery ? Colors.green : Colors.textPrimary} />
            <AppTextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={
                view === "Projects" ? "Search by name, ID or city…" :
                view === "Opportunities" ? "Search opportunities…" :
                view === "Leads" ? "Search leads…" :
                "Search companies…"
              }
              placeholderTextColor={Colors.cardMuted}
              style={{ flex: 1, color: Colors.textPrimary, fontFamily: "Inter_600SemiBold", fontSize: 13, paddingVertical: 10 }}
              returnKeyType="search"
              clearButtonMode="while-editing"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
                <Feather name="x" size={14} color={Colors.textSecondary} />
              </Pressable>
            )}
          </View>
          {view === "Opportunities" && (
            <Pressable
              style={[styles.dateDropdownBtn, buFilter !== "All" && styles.dateDropdownBtnActive, { maxWidth: 120 }]}
              onPress={() => { setShowBuDropdown(!showBuDropdown); setShowDateDropdown(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            >
              <Feather name="briefcase" size={12} color={buFilter !== "All" ? Colors.green : Colors.textSecondary} />
              <Text style={[styles.dateDropdownText, buFilter !== "All" && { color: Colors.green }]} numberOfLines={1} ellipsizeMode="tail">{buFilter === "All" ? "All" : buFilter}</Text>
              <Feather name="chevron-down" size={10} color={buFilter !== "All" ? Colors.green : Colors.textSecondary} />
            </Pressable>
          )}
          {view !== "Companies" && (
            <Pressable
              style={[styles.dateDropdownBtn, dateFilter !== "All Time" && styles.dateDropdownBtnActive]}
              onPress={() => { setShowDateDropdown(!showDateDropdown); setShowBuDropdown(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            >
              <Feather name="calendar" size={13} color={dateFilter !== "All Time" ? Colors.orange : Colors.textSecondary} />
              <Text style={[styles.dateDropdownText, dateFilter !== "All Time" && styles.dateDropdownTextActive]}>{dateFilterLabel || "All"}</Text>
              <Feather name="chevron-down" size={12} color={dateFilter !== "All Time" ? Colors.orange : Colors.textSecondary} />
            </Pressable>
          )}
        </View>
        {showBuDropdown && view === "Opportunities" && (
          <View style={[styles.dateDropdownMenu, { maxHeight: 260 }]}>
            <ScrollView showsVerticalScrollIndicator={true} nestedScrollEnabled>
              {["All", ...allBUs].map(bu => (
                <Pressable
                  key={bu}
                  style={[styles.dateDropdownItem, bu === buFilter && styles.dateDropdownItemActive]}
                  onPress={() => { setBuFilter(bu); setShowBuDropdown(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                >
                  <Text style={[styles.dateDropdownItemText, bu === buFilter && styles.dateDropdownItemTextActive]}>
                    {bu === "All" ? "All Business Units" : bu}
                  </Text>
                  {bu === buFilter && <Feather name="check" size={14} color={Colors.green} />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
        {showDateDropdown && view !== "Companies" && (() => {
          const _now = new Date();
          const _y = _now.getFullYear();
          const _q = Math.floor(_now.getMonth() / 3);
          const options: { key: string; label: string; section?: string }[] = [
            { key: "All Time", label: "All Time" },
          ];
          for (let y = _y; y >= _y - 10; y--) {
            options.push({ key: `${y}`, label: `${y}`, section: "year" });
          }
          for (let y = _y; y >= _y - 10; y--) {
            const maxQ = y === _y ? _q : 3;
            for (let q = maxQ; q >= 0; q--) {
              options.push({ key: `Q${q + 1} ${y}`, label: `Q${q + 1} ${y}` });
            }
          }
          return (
            <View style={[styles.dateDropdownMenu, { maxHeight: 260 }]}>
              <ScrollView showsVerticalScrollIndicator={true} nestedScrollEnabled>
                {options.map(({ key, label }, idx) => {
                  const isYearHeader = key.match(/^\d{4}$/) && idx > 1;
                  return (
                    <React.Fragment key={key}>
                      {isYearHeader && idx === options.findIndex(o => o.section === "year") && (
                        <View style={{ paddingHorizontal: 14, paddingVertical: 6, backgroundColor: Colors.dark }}>
                          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: Colors.textMuted, letterSpacing: 1 }}>BY YEAR</Text>
                        </View>
                      )}
                      {key === `Q${_q + 1} ${_y}` && idx === options.findIndex(o => o.key.startsWith("Q")) && (
                        <View style={{ paddingHorizontal: 14, paddingVertical: 6, backgroundColor: Colors.dark }}>
                          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: Colors.textMuted, letterSpacing: 1 }}>BY QUARTER</Text>
                        </View>
                      )}
                      <Pressable
                        style={[styles.dateDropdownItem, key === dateFilter && styles.dateDropdownItemActive]}
                        onPress={() => { setDateFilter(key); setShowDateDropdown(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                      >
                        {key === dateFilter && <Feather name="check" size={13} color={Colors.orange} style={{ marginRight: 6 }} />}
                        <Text style={[styles.dateDropdownItemText, key === dateFilter && styles.dateDropdownItemTextActive]}>{label}</Text>
                      </Pressable>
                    </React.Fragment>
                  );
                })}
              </ScrollView>
            </View>
          );
        })()}
      </View>

      {/* ══ PROJECTS VIEW ═══════════════════════════════════════════════ */}
      {view === "Projects" && (
        <View style={{ flex: 1 }}>
          <View style={styles.filterRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
            >
              {FILTERS.map(f => (
                <Pressable key={f} style={[styles.filterPill, f === filter && styles.filterPillActive]} onPress={() => setFilter(f)}>
                  <Text style={[styles.filterText, f === filter && styles.filterTextActive]}>{f === "My Open" ? "My Projects" : f}</Text>
                </Pressable>
              ))}
              {stageFilter && (
                <Pressable
                  style={[styles.filterPill, styles.filterPillActive, { flexDirection: "row", alignItems: "center", gap: 6 }]}
                  onPress={() => setStageFilter("")}
                >
                  <Text style={[styles.filterText, styles.filterTextActive]}>
                    {stageFilter === "precon" ? "PreCon" : stageFilter === "active" ? "Active" : stageFilter === "closeout" ? "Closeout" : stageFilter === "bidding" ? "Bidding" : stageFilter}
                  </Text>
                  <Feather name="x" size={12} color={Colors.white} />
                </Pressable>
              )}
            </ScrollView>
          </View>

          {dataLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={Colors.green} size="large" />
              <Text style={styles.emptySub}>Fetching live project data…</Text>
            </View>
          ) : filteredProjects.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name={apiUnavailable ? "cloud-off" : "briefcase"} size={32} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>{apiUnavailable ? "APIs under development" : "No projects"}</Text>
              <Text style={styles.emptySub}>
                {apiUnavailable
                  ? "Our APIs are currently under development and aren't responding right now. Please pull to refresh in a few moments."
                  : (sq ? `No projects matching "${searchQuery}"` : `No ${filter === "All" ? "" : filter.toLowerCase() + " "}projects found`)}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredProjects}
              keyExtractor={p => p.id}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              contentContainerStyle={[styles.scroll, { paddingBottom: 110 }]}
              showsVerticalScrollIndicator={false}
              renderItem={({ item: p }) => {
                const pc = phaseColor(p.phase);
                return (
                  <Pressable style={styles.card} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/project/${p.id}`); }}>
                    <View style={styles.cardTop}>
                      <View style={[styles.phasePill, { backgroundColor: pc + "18", borderColor: pc + "50" }]}>
                        <View style={[styles.phaseDot, { backgroundColor: pc }]} />
                        <Text style={[styles.phaseText, { color: pc }]}>{p.phase}</Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {holdInfoMap[p.id] ? (
                          <View style={styles.holdPill}>
                            <Feather name="pause-circle" size={9} color="#B45309" />
                            <Text style={styles.holdPillText}>On Hold</Text>
                          </View>
                        ) : null}
                        {p.city ? (
                          <View style={styles.riskTags}>
                            <Feather name="map-pin" size={9} color={Colors.cardMuted} />
                            <Text style={styles.riskTagText}>{p.city}</Text>
                          </View>
                        ) : null}
                        <Pressable
                          style={styles.cardMenuBtn}
                          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCardMenu({ id: p.id, module: "PMM", name: p.name, note: p.note, requestCategory: p.requestCategory }); }}
                          hitSlop={8}
                        >
                          <Text style={styles.cardMenuBtnText}>⋮</Text>
                        </Pressable>
                      </View>
                    </View>

                    <Text style={styles.projectName} numberOfLines={2}>{p.name}</Text>
                    <Text style={[styles.allocLabel, { fontSize: 13, color: Colors.cardText, letterSpacing: 0.4, marginTop: 4, marginBottom: 10 }]}>{p.id}</Text>

                    {(() => {
                      // Display rule: Target represents intent BEFORE a schedule
                      // exists. Actual represents the schedule's true range
                      // (phase 1 start → last phase end for PMM; proposal start
                      // → last phase end for OPM). Once Actual is populated a
                      // schedule has been assigned, so Target becomes redundant
                      // — show only Actual to avoid two competing date bands.
                      // ONLY treat Actual as authoritative when a lifecycle/phase
                      // schedule has actually been built on this project. Without
                      // a schedule, Actual* fields on the record are leftover or
                      // bookkeeping values and should NOT replace the Target band
                      // (per client feedback: "project schedule not assigned but
                      // front end showing actual start dates instead of target").
                      const hasActual = p.hasSchedule && !!(p.rawActualStart || p.rawActualEnd);
                      return (
                        <View style={styles.ganttSection}>
                          <Text style={styles.ganttTitle}>PROJECT TIMELINE</Text>
                          {!hasActual && (p.rawTargetStart || p.rawTargetEnd) && (
                            <View style={styles.tlPill}>
                              <View style={[styles.tlDot, { backgroundColor: Colors.green }]} />
                              <Text style={[styles.tlPillLabel, { color: Colors.green }]}>Target:</Text>
                              <Text style={styles.tlPillDate}>{fmtShort(p.rawTargetStart)} – {fmtShort(p.rawTargetEnd)}</Text>
                            </View>
                          )}
                          {hasActual && (
                            <View style={[styles.tlPill, { backgroundColor: "rgba(232,119,34,0.12)", borderColor: Colors.orange + "40" }]}>
                              <View style={[styles.tlDot, { backgroundColor: Colors.orange }]} />
                              <Text style={[styles.tlPillLabel, { color: Colors.orange }]}>Schedule:</Text>
                              <Text style={styles.tlPillDate}>{fmtShort(p.rawActualStart)} – {fmtShort(p.rawActualEnd)}</Text>
                            </View>
                          )}
                          {!hasActual && !p.rawTargetStart && !p.rawTargetEnd && (
                            <View style={[styles.tlPill, { backgroundColor: "rgba(245,158,11,0.10)", borderColor: "rgba(245,158,11,0.30)" }]}>
                              <View style={[styles.tlDot, { backgroundColor: "#F59E0B" }]} />
                              <Text style={[styles.tlPillLabel, { color: "#F59E0B" }]}>Schedule:</Text>
                              <Text style={styles.tlPillDate}>Not set — tap Details to build</Text>
                            </View>
                          )}
                        </View>
                      );
                    })()}

                    <View style={styles.valueRow}>
                      <Text style={styles.allocLabel}>CONTRACT VALUE</Text>
                      <Text style={[styles.valueText, p.value === 0 ? { color: Colors.textMuted } : null]}>
                        {p.value > 0 ? fmtM(p.value) : "—"}
                      </Text>
                    </View>

                    {(() => {
                      if (p.closed) return null;
                      const s = projectStaffing[p.id];
                      const hasStaffing = s && s.count > 0;
                      if (!hasStaffing) return null;
                      return (
                        <View style={styles.staffingRow}>
                          <Text style={styles.staffingLabel}>STAFFING{"\n"}DEMAND</Text>
                          <View style={{ flex: 1, alignItems: "flex-end" }}>
                            <Text style={styles.staffingValue}>
                              {s.count} req{s.count === 1 ? "" : "s"} · avg {s.avgPct}% · ~{s.fte} FTE
                            </Text>
                            {s.roles && s.roles.length > 0 ? (
                              <Text style={styles.staffingTopRole}>
                                {s.roles.slice(0, 3).join(", ")}{s.roles.length > 3 ? ` +${s.roles.length - 3}` : ""}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      );
                    })()}

                    {(() => {
                      const teamCount = p.assignedUserGuids
                        ? p.assignedUserGuids.split(/[,;]/).filter(s => s.trim().length > 0).length
                        : 0;
                      const hasActual = p.hasSchedule && !!(p.rawActualStart || p.rawActualEnd);
                      const hasTarget = !!(p.rawTargetStart || p.rawTargetEnd);
                      const scheduleStatus = hasActual ? "actual" : hasTarget ? "target_only" : "none";
                      const sf = projectStaffing[p.id];
                      return (
                        <CardInsight kind="project" id={p.id} fields={{
                          name: p.name,
                          phase: p.phase,
                          status: p.status,
                          valueUSD: p.value,
                          hasSchedule: p.hasSchedule,
                          scheduleStatus,
                          teamCount,
                          targetStart: p.rawTargetStart || null,
                          targetEnd: p.rawTargetEnd || null,
                          actualStart: p.rawActualStart || null,
                          actualEnd: p.rawActualEnd || null,
                          closed: p.closed,
                          forecastCostUSD: p.forecastCost || null,
                          laborContractUSD: p.laborValue || null,
                          sector: p.sector || null,
                          division: p.division || null,
                          city: p.city || null,
                          daysInCurrentPhase: p.daysInPhase,
                          staffingDemandCount: sf?.count ?? 0,
                          staffingAvgPct: sf?.avgPct ?? 0,
                          staffingFTE: sf?.fte ?? 0,
                          staffingTopRoles: sf?.roles?.slice(0, 3).join(", ") || null,
                        }} />
                      );
                    })()}

                    {p.note ? (
                      <View style={styles.noteSnippet}>
                        <Feather name="file-text" size={11} color={Colors.cardMuted} />
                        <Text style={styles.noteSnippetText} numberOfLines={2}>{p.note}</Text>
                      </View>
                    ) : null}

                    <View style={styles.cardActions}>
                      <Pressable style={styles.actionBtnGreen} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/project/${p.id}`); }}>
                        <Feather name="info" size={11} color={Colors.white} />
                        <Text style={styles.actionBtnGreenText}>Details</Text>
                      </Pressable>
                      <Pressable style={styles.actionBtnOutline} onPress={() => openReallocate(p)}>
                        <Feather name="users" size={11} color={Colors.cardMuted} />
                        <Text style={styles.actionBtnOutlineText}>Reallocate</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.actionBtnOutline, { borderColor: Colors.green + "60" }]}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setImpactDates([]);
                          handleScheduleSaved(p, { targetStart: p.targetStart, targetEnd: p.targetEnd, actualStart: p.actualStart, actualEnd: p.actualEnd, closeDate: p.closeDate, rawTargetStart: p.rawTargetStart, rawTargetEnd: p.rawTargetEnd, rawActualStart: p.rawActualStart, rawActualEnd: p.rawActualEnd, rawCloseDate: p.rawCloseDate } as any);
                        }}
                      >
                        <Feather name="users" size={11} color={Colors.green} />
                        <Text style={[styles.actionBtnOutlineText, { color: Colors.green }]}>Team</Text>
                      </Pressable>
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      )}

      {/* ══ OPPORTUNITIES VIEW ══════════════════════════════════════════ */}
      {view === "Opportunities" && (
        <View style={{ flex: 1 }}>
          <View style={styles.filterRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
            >
              {OPM_STATUS_FILTERS.map(f => (
                <Pressable key={f} style={[styles.filterPill, f === oppStatusFilter && styles.filterPillActive]} onPress={() => { setOppStatusFilter(f); setOppStageFilter("All"); }}>
                  <Text style={[styles.filterText, f === oppStatusFilter && styles.filterTextActive]}>{f}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {dataLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={Colors.green} size="large" />
              <Text style={styles.emptySub}>Fetching live opportunity data…</Text>
            </View>
          ) : (
            <FlatList
              data={filteredOpps}
              keyExtractor={o => o.id}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              contentContainerStyle={[styles.scroll, { paddingBottom: 110 }]}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                <View style={styles.rollupCard}>
                  <Text style={styles.rollupTitle}>PIPELINE ROLL-UP</Text>
                  <View style={styles.rollupRow}>
                    <View style={styles.rollupStat}>
                      <Text style={styles.rollupValue}>{fmtM(totalOppValue)}</Text>
                      <Text style={styles.rollupLabel}>Total Value</Text>
                    </View>
                    <View style={styles.rollupDivider} />
                    <View style={styles.rollupStat}>
                      <Text style={[styles.rollupValue, { color: Colors.green }]}>{fmtM(allFilteredOpps.length > 0 ? totalOppValue / allFilteredOpps.length : 0)}</Text>
                      <Text style={styles.rollupLabel}>Avg Value</Text>
                    </View>
                    <View style={styles.rollupDivider} />
                    <View style={styles.rollupStat}>
                      <Text style={[styles.rollupValue, { color: Colors.green }]}>{allFilteredOpps.length}</Text>
                      <Text style={styles.rollupLabel}>Active Opps</Text>
                    </View>
                  </View>
                </View>
              }
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Feather name={apiUnavailable ? "cloud-off" : "trending-up"} size={32} color={Colors.textMuted} />
                  <Text style={styles.emptyTitle}>{apiUnavailable ? "APIs under development" : "No opportunities"}</Text>
                  <Text style={styles.emptySub}>
                    {apiUnavailable
                      ? "Our APIs are currently under development and aren't responding right now. Please pull to refresh in a few moments."
                      : (sq ? `No opportunities matching "${searchQuery}"` : "No active opportunities found")}
                  </Text>
                </View>
              }
              renderItem={({ item: opp }) => {
                const pc = probColor(opp.probability);
                const urg = daysUrgency(opp.daysLeft);
                const isExpanded = expandedOpp === opp.id;
                const hasBidDate = opp.daysLeft !== 999;
                return (
                  <Pressable
                    style={styles.card}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push(`/project/${opp.id}`);
                    }}
                  >
                    <View style={styles.cardTop}>
                      <View style={styles.oppStagePill}>
                        <Text style={styles.oppStageText}>{opp.stage}</Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        {hasBidDate && (
                          <View style={[styles.daysLeft, { backgroundColor: urg.bg }]}>
                            <Text style={[styles.daysLeftText, { color: urg.text }]}>
                              {opp.daysLeft >= 0 ? `${opp.daysLeft}d left` : `${Math.abs(opp.daysLeft)}d ago`}
                            </Text>
                          </View>
                        )}
                        {opp.city ? <Text style={styles.oppType}>{opp.city}</Text> : null}
                        <Pressable
                          style={styles.cardMenuBtn}
                          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCardMenu({ id: opp.id, module: "OPM", name: opp.name, note: opp.note, requestCategory: opp.requestCategory }); }}
                          hitSlop={8}
                        >
                          <Text style={styles.cardMenuBtnText}>⋮</Text>
                        </Pressable>
                      </View>
                    </View>

                    <View style={styles.oppNameRow}>
                      <Text style={[styles.projectName, { flex: 1 }]} numberOfLines={2}>{opp.name}</Text>
                      <Text style={[styles.oppValue, opp.value === 0 ? { color: Colors.textMuted } : null]}>
                        {opp.value > 0 ? fmtM(opp.value) : "—"}
                      </Text>
                    </View>
                    <Text style={[styles.allocLabel, { marginBottom: 4 }]}>{opp.id}{opp.type ? ` · ${opp.type}` : ""}</Text>

                    {(() => {
                      // Same Target/Actual rule as PMM: show Actual when a
                      // schedule has been built (real Actual dates present),
                      // otherwise fall back to Target. If neither is set, show
                      // a "Not set" placeholder. Bid Due is independent and
                      // always shown when present.
                      const hasActual = !!(opp.rawActualStart || opp.rawActualEnd);
                      const hasTarget = !!(opp.rawTargetStart || opp.rawTargetEnd);
                      const hasBid = !!opp.rawBidDate;
                      return (
                        <View style={{ marginBottom: 14, marginTop: 4, gap: 6 }}>
                          <Text style={styles.ganttTitle}>OPPORTUNITY TIMELINE</Text>
                          {hasBid && (
                            <View style={styles.tlPill}>
                              <View style={[styles.tlDot, { backgroundColor: Colors.green }]} />
                              <Text style={[styles.tlPillLabel, { color: Colors.green }]}>Bid:</Text>
                              <Text style={styles.tlPillDate}>{fmtShort(opp.rawBidDate)}</Text>
                            </View>
                          )}
                          {!hasActual && hasTarget && (
                            <View style={styles.tlPill}>
                              <View style={[styles.tlDot, { backgroundColor: Colors.green }]} />
                              <Text style={[styles.tlPillLabel, { color: Colors.green }]}>Target:</Text>
                              <Text style={styles.tlPillDate}>{fmtShort(opp.rawTargetStart)} – {fmtShort(opp.rawTargetEnd)}</Text>
                            </View>
                          )}
                          {hasActual && (
                            <View style={[styles.tlPill, { backgroundColor: "rgba(232,119,34,0.12)", borderColor: Colors.orange + "40" }]}>
                              <View style={[styles.tlDot, { backgroundColor: Colors.orange }]} />
                              <Text style={[styles.tlPillLabel, { color: Colors.orange }]}>Schedule:</Text>
                              <Text style={styles.tlPillDate}>{fmtShort(opp.rawActualStart)} – {fmtShort(opp.rawActualEnd)}</Text>
                            </View>
                          )}
                          {!hasActual && !hasTarget && !hasBid && (
                            <View style={[styles.tlPill, { backgroundColor: "rgba(245,158,11,0.10)", borderColor: "rgba(245,158,11,0.30)" }]}>
                              <View style={[styles.tlDot, { backgroundColor: "#F59E0B" }]} />
                              <Text style={[styles.tlPillLabel, { color: "#F59E0B" }]}>Schedule:</Text>
                              <Text style={styles.tlPillDate}>Not set — tap Details to build</Text>
                            </View>
                          )}
                        </View>
                      );
                    })()}

                    {opp.probability > 0 && (
                      <View>
                        <View style={styles.probRow}>
                          <Text style={styles.allocLabel}>WIN PROBABILITY</Text>
                          <Text style={[styles.allocPct, { color: pc }]}>{opp.probability}%</Text>
                        </View>
                        <View style={styles.allocBarBg}>
                          <View style={[styles.allocBarFill, { width: `${opp.probability}%` as any, backgroundColor: pc }]} />
                        </View>
                        <View style={styles.weightedRow}>
                          <Text style={styles.weightedLabel}>Weighted Revenue</Text>
                          <Text style={[styles.weightedValue, { color: pc }]}>{fmtM(opp.weightedValue)}</Text>
                        </View>
                      </View>
                    )}

                    {isExpanded && (
                      <View style={[styles.readinessRow, { backgroundColor: Colors.green + "10", borderColor: Colors.green + "30" }]}>
                        <Feather name="info" size={13} color={Colors.green} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.readinessTitle, { color: Colors.green }]}>Opportunity Details</Text>
                          <Text style={styles.readinessNote}>{opp.id} · {opp.type || "No sector"} · {opp.city || "No city"}</Text>
                        </View>
                      </View>
                    )}

                    <CardInsight kind="opportunity" id={opp.id} fields={{
                      name: opp.name,
                      stage: opp.stage,
                      valueUSD: opp.value,
                      weightedValueUSD: opp.weightedValue,
                      probabilityPct: opp.probability,
                      daysToBid: opp.daysLeft,
                      bidDate: opp.rawBidDate || null,
                      bu: opp.bu || null,
                      closed: opp.closed,
                    }} />

                    {opp.note ? (
                      <View style={styles.noteSnippet}>
                        <Feather name="file-text" size={11} color={Colors.cardMuted} />
                        <Text style={styles.noteSnippetText} numberOfLines={2}>{opp.note}</Text>
                      </View>
                    ) : null}

                    <View style={styles.cardActions}>
                      <Pressable
                        style={styles.actionBtnGreen}
                        onPress={(e) => {
                          e.stopPropagation();
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          router.push(`/project/${opp.id}`);
                        }}
                      >
                        <Feather name="eye" size={11} color={Colors.white} />
                        <Text style={styles.actionBtnGreenText}>Details</Text>
                      </Pressable>
                      <Pressable
                        style={styles.actionBtnOutline}
                        onPress={(e) => {
                          e.stopPropagation();
                          openOppEdit(opp);
                        }}
                      >
                        <Feather name="calendar" size={11} color={Colors.cardMuted} />
                        <Text style={styles.actionBtnOutlineText}>Schedule</Text>
                      </Pressable>
                      {/* Team — opens the same Project Team modal used on
                       * Project cards. We coerce the Opportunity into a
                       * Project-shaped object (id/name/dates carry over;
                       * Project-only fields are zero-defaulted) and call
                       * handleScheduleSaved with identical dates so no
                       * "schedule changed" diff is computed — the modal
                       * opens straight on the team list. */}
                      <Pressable
                        style={[styles.actionBtnOutline, { borderColor: Colors.green + "60" }]}
                        onPress={(e) => {
                          e.stopPropagation();
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setImpactDates([]);
                          const oppAsProject: Project = {
                            id: opp.id,
                            ticketNum: "",
                            name: opp.name,
                            status: opp.stage || "",
                            phase: "",
                            city: opp.city || "",
                            value: opp.value || 0,
                            laborValue: opp.laborValue || 0,
                            closed: opp.closed,
                            stageActionUsers: "",
                            assignedUserGuids: opp.assignedUserGuids || "",
                            targetStart: opp.targetStart || "",
                            targetEnd: opp.targetEnd || "",
                            actualStart: opp.actualStart || "",
                            actualEnd: opp.actualEnd || "",
                            closeDate: "",
                            groupId: "",
                            hasSchedule: !!(opp.rawTargetStart || opp.rawActualStart),
                            rawTargetStart: opp.rawTargetStart || "",
                            rawTargetEnd: opp.rawTargetEnd || "",
                            rawActualStart: opp.rawActualStart || "",
                            rawActualEnd: opp.rawActualEnd || "",
                            rawCloseDate: "",
                            forecastCost: 0,
                            sector: "",
                            division: opp.bu || "",
                            daysInPhase: null,
                          };
                          handleScheduleSaved(oppAsProject, {
                            targetStart: oppAsProject.targetStart,
                            targetEnd: oppAsProject.targetEnd,
                            actualStart: oppAsProject.actualStart,
                            actualEnd: oppAsProject.actualEnd,
                            closeDate: oppAsProject.closeDate,
                            rawTargetStart: oppAsProject.rawTargetStart,
                            rawTargetEnd: oppAsProject.rawTargetEnd,
                            rawActualStart: oppAsProject.rawActualStart,
                            rawActualEnd: oppAsProject.rawActualEnd,
                            rawCloseDate: oppAsProject.rawCloseDate,
                          });
                        }}
                      >
                        <Feather name="users" size={11} color={Colors.green} />
                        <Text style={[styles.actionBtnOutlineText, { color: Colors.green }]}>Team</Text>
                      </Pressable>
                      <Pressable style={[styles.actionBtnOutline, { flex: 0, paddingHorizontal: 12 }]} onPress={(e) => { e.stopPropagation(); setExpandedOpp(isExpanded ? null : opp.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}>
                        <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={13} color={Colors.cardMuted} />
                      </Pressable>
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      )}

      {/* ══ LEADS VIEW ══════════════════════════════════════════════════ */}
      {view === "Leads" && (
        <View style={{ flex: 1 }}>
          <View style={styles.filterRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
            >
              {FILTERS.filter(f => f !== "My Open").map(f => (
                <Pressable key={f} style={[styles.filterPill, f === filter && styles.filterPillActive]} onPress={() => setFilter(f)}>
                  <Text style={[styles.filterText, f === filter && styles.filterTextActive]}>{f}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          {dataLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={Colors.green} size="large" />
              <Text style={styles.emptySub}>Fetching live lead data…</Text>
            </View>
          ) : filteredLeads.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name={apiUnavailable ? "cloud-off" : "star"} size={32} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>{apiUnavailable ? "APIs under development" : "No leads"}</Text>
              <Text style={styles.emptySub}>
                {apiUnavailable
                  ? "Our APIs are currently under development and aren't responding right now. Please pull to refresh in a few moments."
                  : (sq ? `No leads matching "${searchQuery}"` : "No active leads found")}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredLeads}
              keyExtractor={l => l.id}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              contentContainerStyle={[styles.scroll, { paddingBottom: 110 }]}
              showsVerticalScrollIndicator={false}
              renderItem={({ item: l }) => (
                <Pressable style={styles.card} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/project/${l.id}`); }}>
                  <View style={styles.cardTop}>
                    <View style={[styles.phasePill, { backgroundColor: Colors.orange + "18", borderColor: Colors.orange + "50" }]}>
                      <View style={[styles.phaseDot, { backgroundColor: Colors.orange }]} />
                      <Text style={[styles.phaseText, { color: Colors.orange }]}>{(l.status && l.status !== "—") ? l.status : "Lead"}</Text>
                    </View>
                    {l.city ? (
                      <View style={styles.riskTags}>
                        <Feather name="map-pin" size={9} color={Colors.cardMuted} />
                        <Text style={styles.riskTagText}>{l.city}</Text>
                      </View>
                    ) : null}
                  </View>

                  <Text style={styles.projectName} numberOfLines={2}>{l.name}</Text>
                  <Text style={[styles.allocLabel, { marginTop: 2, marginBottom: 8 }]}>{l.id}{l.sector ? ` · ${l.sector}` : ""}</Text>

                  <View style={styles.valueRow}>
                    <Text style={styles.allocLabel}>EST. VALUE</Text>
                    <Text style={[styles.valueText, l.value === 0 ? { color: Colors.textMuted } : null]}>
                      {l.value > 0 ? fmtM(l.value) : "—"}
                    </Text>
                  </View>

                  {(l.targetStart !== "—" || l.targetEnd !== "—") && (
                    <View style={styles.ganttSection}>
                      <Text style={styles.ganttTitle}>TARGET TIMELINE</Text>
                      <View style={styles.tlPill}>
                        <View style={[styles.tlDot, { backgroundColor: Colors.green }]} />
                        <Text style={[styles.tlPillLabel, { color: Colors.green }]}>Target:</Text>
                        <Text style={styles.tlPillDate}>{l.targetStart} – {l.targetEnd}</Text>
                      </View>
                    </View>
                  )}

                  {(() => {
                    const now = Date.now();
                    const created = l.rawCreated ? new Date(l.rawCreated).getTime() : NaN;
                    const due = l.rawDueDate ? new Date(l.rawDueDate).getTime() : NaN;
                    const daysSinceCreated = isNaN(created) ? null : Math.round((now - created) / 86400000);
                    const daysToDue = isNaN(due) ? null : Math.round((due - now) / 86400000);
                    return (
                      <CardInsight kind="lead" id={l.id} fields={{
                        name: l.name,
                        status: l.status,
                        sector: l.sector || null,
                        bu: l.bu || null,
                        valueUSD: l.value,
                        daysSinceCreated,
                        daysToDue,
                        closed: l.closed,
                      }} />
                    );
                  })()}

                  <View style={styles.cardActions}>
                    <Pressable
                      style={styles.actionBtnGreen}
                      onPress={() => {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        pushChat(`I want to pursue the lead "${l.name}" (${l.id})${l.value > 0 ? `, estimated at ${fmtM(l.value)}` : ""}${l.sector && l.sector !== "—" ? `, sector: ${l.sector}` : ""}${l.city ? `, location: ${l.city}` : ""}${l.targetStart !== "—" ? `, target start: ${l.targetStart}` : ""}. First fetch the lead details, then analyze our past win history in this sector, identify similar completed/active projects we can reference, find available people with experience in this sector, and give me a data-driven pursuit strategy.`);
                      }}
                    >
                      <Feather name="trending-up" size={11} color={Colors.white} />
                      <Text style={styles.actionBtnGreenText}>Pursue</Text>
                    </Pressable>
                    <Pressable
                      style={styles.actionBtnOutline}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        pushChat(`I want to pre-staff the lead "${l.name}" (${l.id})${l.value > 0 ? `, estimated at ${fmtM(l.value)}` : ""}${l.sector ? `, sector: ${l.sector}` : ""}${l.city ? `, location: ${l.city}` : ""}${l.targetStart !== "—" ? `, target start: ${l.targetStart}` : ""}. First fetch the project details to understand scope and sector, then find available staff ranked by experience in this sector. Recommend specific people by name with their past project experience — no generic roles.`);
                      }}
                    >
                      <Feather name="users" size={11} color={Colors.cardMuted} />
                      <Text style={styles.actionBtnOutlineText}>Pre-Staff</Text>
                    </Pressable>
                    <Pressable
                      style={styles.actionBtnOutline}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        router.push(`/project/${l.id}`);
                      }}
                    >
                      <Feather name="info" size={11} color={Colors.cardMuted} />
                      <Text style={styles.actionBtnOutlineText}>Details</Text>
                    </Pressable>
                  </View>
                </Pressable>
              )}
            />
          )}
        </View>
      )}

      {/* ══ COMPANIES VIEW ══════════════════════════════════════════════ */}
      {view === "Companies" && (
        <View style={{ flex: 1 }}>
          <View style={styles.filterRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
            >
              {(["Clients", "All"] as const).map(f => (
                <Pressable key={f} style={[styles.filterPill, f === comStatusFilter && styles.filterPillActive]} onPress={() => setComStatusFilter(f)}>
                  <Text style={[styles.filterText, f === comStatusFilter && styles.filterTextActive]}>
                    {f === "Clients" ? `Clients (${companies.filter(c => COM_ACTIVE_STATUSES.has(c.status)).length})` : `All (${companies.length})`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          {dataLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={Colors.green} size="large" />
              <Text style={styles.emptySub}>Fetching live company data…</Text>
            </View>
          ) : filteredCompanies.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name={apiUnavailable ? "cloud-off" : "briefcase"} size={32} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>{apiUnavailable ? "APIs under development" : "No companies"}</Text>
              <Text style={styles.emptySub}>
                {apiUnavailable
                  ? "Our APIs are currently under development and aren't responding right now. Please pull to refresh in a few moments."
                  : (sq ? `No companies matching "${searchQuery}"` : "No company records found")}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredCompanies}
              keyExtractor={c => c.id}
              initialNumToRender={15}
              maxToRenderPerBatch={15}
              windowSize={5}
              contentContainerStyle={[styles.scroll, { paddingBottom: 110 }]}
              showsVerticalScrollIndicator={false}
              renderItem={({ item: c }) => (
                <Pressable
                  style={[styles.card, { gap: 8, paddingHorizontal: 16, paddingVertical: 14 }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push(`/project/${c.id}`);
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: Colors.green + "18", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                      <Feather name="briefcase" size={16} color={Colors.green} />
                    </View>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={[styles.projectName, { fontSize: 14, marginBottom: 2 }]} numberOfLines={1}>{c.name}</Text>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted }}>
                        {c.id}{c.type && c.type !== "—" ? ` · ${c.type}` : ""}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
                    {(c.city || c.state) ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Feather name="map-pin" size={10} color={Colors.cardMuted} />
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted }}>{[c.city, c.state].filter(Boolean).join(", ")}</Text>
                      </View>
                    ) : null}
                    {c.phone && c.phone !== "—" ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Feather name="phone" size={10} color={Colors.cardMuted} />
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted }} numberOfLines={1}>{c.phone}</Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                    <Pressable
                      style={styles.actionBtnGreen}
                      onPress={(e) => { e.stopPropagation(); openCompanyDetail(c, "projects"); }}
                    >
                      <Feather name="folder" size={11} color={Colors.white} />
                      <Text style={styles.actionBtnGreenText}>Projects</Text>
                    </Pressable>
                    <Pressable
                      style={styles.actionBtnOutline}
                      onPress={(e) => { e.stopPropagation(); openCompanyDetail(c, "contacts"); }}
                    >
                      <Feather name="users" size={11} color={Colors.cardMuted} />
                      <Text style={styles.actionBtnOutlineText}>Contacts</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.actionBtnOutline, { borderColor: Colors.green + "40" }]}
                      onPress={(e) => {
                        e.stopPropagation();
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        pushChat(`Give me a quick profile of company "${c.name}" (${c.id})${c.city ? `, based in ${[c.city, c.state].filter(Boolean).join(", ")}` : ""}. Use search_projects with query="${c.name}" and exact=true to find projects. Summarize in a brief overview: how many projects, total value, current status, and key contacts. Keep it concise — just the highlights.`);
                      }}
                    >
                      <Feather name="zap" size={11} color={Colors.green} />
                      <Text style={[styles.actionBtnOutlineText, { color: Colors.green }]}>AI Profile</Text>
                    </Pressable>
                  </View>
                </Pressable>
              )}
            />
          )}
        </View>
      )}

      </>
      )}

      {/* ── Edit Schedule Modal (isolated component for performance) ──── */}
      <EditScheduleModal project={editingProject} onClose={() => setEditingProject(null)} onSaved={handleScheduleSaved} bottomInset={insets.bottom} />
      <EditOppScheduleModal opp={editingOpp} onClose={() => setEditingOpp(null)} onSaved={handleOppScheduleSaved} bottomInset={insets.bottom} />

      {/* ── Company Detail Modal ──────────────────────────────────────────── */}
      <Modal visible={!!companyDetail} transparent animationType="slide" onRequestClose={() => setCompanyDetail(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setCompanyDetail(null)} />
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20, maxHeight: "85%", minHeight: "55%" }]}>
            <View style={styles.modalHandle} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: Colors.green + "20", alignItems: "center", justifyContent: "center" }}>
              <Feather name={companyTab === "contacts" ? "users" : "briefcase"} size={18} color={Colors.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle} numberOfLines={1}>{companyDetail?.name}</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted }}>{companyDetail?.id}{companyDetail?.city ? ` · ${companyDetail.city}` : ""}</Text>
            </View>
            <Pressable onPress={() => setCompanyDetail(null)} hitSlop={12}>
              <Feather name="x" size={20} color={Colors.cardMuted} />
            </Pressable>
          </View>

          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.green, marginBottom: 10 }}>
            {companyTab === "projects" ? `Projects (${companyProjects.length})` : `Contacts (${companyContacts.length})`}
          </Text>

          {companyLoading ? (
            <View style={{ alignItems: "center", paddingVertical: 40 }}>
              <ActivityIndicator color={Colors.green} size="large" />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.cardMuted, marginTop: 12 }}>Fetching contacts…</Text>
            </View>
          ) : companyTab === "projects" ? (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {companyProjects.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 30 }}>
                  <Feather name="folder" size={20} color={Colors.cardMuted} />
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.cardMuted, marginTop: 6 }}>No projects linked</Text>
                </View>
              ) : (
                <>
                  <View style={{ backgroundColor: Colors.green + "10", borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: Colors.green + "20" }}>
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.green }}>
                      {companyProjects.length} projects · {fmtM(companyProjects.reduce((s, p) => s + (p.value || 0), 0))} total value
                    </Text>
                  </View>
                  {companyProjects.map(p => {
                    const sl = p.status.toLowerCase();
                    const statusColor = sl.includes("progress") || sl.includes("construction") || sl.includes("active") || sl.includes("awarded") ? Colors.green : sl.includes("close") ? Colors.orange : Colors.cardMuted;
                    return (
                      <View key={p.id} style={{ backgroundColor: Colors.cardBg, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: Colors.green + "25" }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.cardText }} numberOfLines={2}>{p.name}</Text>
                            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted, marginTop: 2 }}>{p.id} · {p.module}</Text>
                          </View>
                          {p.value > 0 && <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.green }}>{fmtM(p.value)}</Text>}
                        </View>
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                          <View style={{ backgroundColor: statusColor + "20", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                            <Text style={{ fontFamily: "Inter_500Medium", fontSize: 10, color: statusColor }}>{p.status || "—"}</Text>
                          </View>
                          {p.city ? <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted }}>📍 {p.city}</Text> : null}
                          {p.sector && p.sector !== "—" ? <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted }}>{p.sector}</Text> : null}
                        </View>
                      </View>
                    );
                  })}
                </>
              )}
            </ScrollView>
          ) : (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {companyContacts.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 30 }}>
                  <Feather name="users" size={20} color={Colors.cardMuted} />
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.cardMuted, marginTop: 6 }}>No contacts linked</Text>
                </View>
              ) : (
                companyContacts.map(ct => (
                  <View key={ct.id} style={{ backgroundColor: Colors.cardBg, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: Colors.green + "25" }}>
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.cardText }}>{ct.name}</Text>
                    {ct.title && ct.title !== "—" ? <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted, marginTop: 2 }}>{ct.title}</Text> : null}
                    <View style={{ marginTop: 6, gap: 4 }}>
                      {ct.email ? (
                        <Pressable onPress={() => Linking.openURL(`mailto:${ct.email}`)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Feather name="mail" size={11} color={Colors.green} />
                          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.green }}>{ct.email}</Text>
                        </Pressable>
                      ) : null}
                      {ct.phone ? (
                        <Pressable onPress={() => Linking.openURL(`tel:${ct.phone}`)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Feather name="phone" size={11} color={Colors.green} />
                          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.green }}>{ct.phone}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          )}

          <Pressable
            style={[styles.saveBtn, { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12 }]}
            onPress={() => {
              const c = companyDetail;
              if (!c) return;
              const loc = c.city ? `, based in ${[c.city, c.state].filter(Boolean).join(", ")}` : "";
              const typ = c.type && c.type !== "—" ? `, type: ${c.type}` : "";
              setCompanyDetail(null);
              if (companyTab === "contacts") {
                pushChat(`Do a deep analysis of ALL contacts for company "${c.name}" (${c.id})${loc}${typ}. Search contacts by EXACT company name "${c.name}". Give me a comprehensive contacts report: every contact with full name, title, email, phone number, and role. Identify key decision-makers, primary points of contact, and any relationship insights.`);
              } else {
                pushChat(`Do a deep analysis of ALL projects for company "${c.name}" (${c.id})${loc}${typ}. Use search_projects with query="${c.name}" and exact=true to find ALL projects/opportunities across every module (PMM, OPM, LEM). Give me a comprehensive projects report: every project with full ID, status, value, sector, and city. Include total business volume, timeline of engagement, active pipeline opportunities, and strategic recommendations.`);
              }
            }}
          >
            <Feather name="zap" size={14} color={Colors.white} />
            <Text style={styles.saveBtnText}>Deep Analysis with AI</Text>
          </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Reallocate Resources Modal ───────────────────────────────────── */}
      <Modal visible={!!reallocateProject} transparent animationType="slide" onRequestClose={() => setReallocateProject(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setReallocateProject(null)} />
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: Colors.green + "20", alignItems: "center", justifyContent: "center" }}>
              <Feather name="users" size={18} color={Colors.green} />
            </View>
            <Text style={styles.modalTitle}>Reallocate Resources</Text>
          </View>
          <Text style={styles.modalSub}>{reallocateProject?.name}</Text>
          <Text style={[styles.modalSub, { marginTop: 2, color: Colors.cardMuted, fontSize: 12 }]}>{reallocateProject?.id}</Text>
          <View style={{ backgroundColor: Colors.green + "10", borderRadius: 12, padding: 14, marginTop: 16, marginBottom: 20, borderWidth: 1, borderColor: Colors.green + "25" }}>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.cardText, lineHeight: 20 }}>
              The AI can suggest available staff, review current allocation across all projects, and recommend optimal team assignments based on skills and capacity.
            </Text>
          </View>
          <Pressable style={[styles.saveBtn, { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }]} onPress={goReallocateAI}>
            <Feather name="message-circle" size={15} color={Colors.white} />
            <Text style={styles.saveBtnText}>Discuss in AI</Text>
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={() => setReallocateProject(null)}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>

      {/* ── Allocation Impact & Notify Modal ─────────────────────────────── */}
      <Modal visible={!!impactProject} transparent animationType="slide" onRequestClose={() => { setImpactProject(null); setTeamSearch(""); }} onShow={() => setTeamSearch("")}>
        <Pressable style={styles.modalOverlay} onPress={() => { setImpactProject(null); setTeamSearch(""); }} />
        <View style={[styles.findStaffSheet, { paddingBottom: insets.bottom + 20, height: "70%" }]}>
          <View style={styles.modalHandle} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#EEF1F5" }}>
            <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: Colors.green + "20", alignItems: "center", justifyContent: "center" }}>
              <Feather name={impactDates.length > 0 ? "alert-circle" : "users"} size={18} color={Colors.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>{impactDates.length > 0 ? "Allocation Impact" : "Project Team"}</Text>
              <Text style={[styles.modalSub, { marginTop: 3 }]} numberOfLines={1}>{impactProject?.name}</Text>
            </View>
            <Pressable style={{ padding: 8 }} onPress={() => setImpactProject(null)}>
              <Feather name="x" size={18} color={Colors.cardMuted} />
            </Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 }}>
            {impactDates.length > 0 && (
              <View style={{ backgroundColor: Colors.orange + "10", borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: Colors.orange + "25" }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: Colors.orange, letterSpacing: 0.8, marginBottom: 8 }}>DATES CHANGED</Text>
                {impactDates.map((d, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 4, gap: 6 }}>
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.cardText, width: 100 }}>{d.field}</Text>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted, textDecorationLine: "line-through" }}>{d.old}</Text>
                    <Feather name="arrow-right" size={10} color={Colors.green} />
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.green }}>{d.new_}</Text>
                  </View>
                ))}
              </View>
            )}

            {impactLoading ? (
              <View style={{ alignItems: "center", paddingVertical: 40, gap: 12 }}>
                <ActivityIndicator size="large" color={Colors.green} />
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary }}>Checking impacted resources…</Text>
              </View>
            ) : impactError ? (
              <View style={{ alignItems: "center", paddingVertical: 30, gap: 10 }}>
                <Feather name="wifi-off" size={28} color="#E03C3C" />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#E03C3C" }}>Failed to Load</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.cardMuted, textAlign: "center" }}>{impactError}</Text>
                <Pressable
                  style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.green, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}
                  onPress={() => { setImpactProject(null); setTimeout(() => { if (impactProject) handleScheduleSaved(impactProject, { targetStart: impactProject.targetStart, targetEnd: impactProject.targetEnd, actualStart: impactProject.actualStart, actualEnd: impactProject.actualEnd, closeDate: impactProject.closeDate, rawTargetStart: impactProject.rawTargetStart, rawTargetEnd: impactProject.rawTargetEnd, rawActualStart: impactProject.rawActualStart, rawActualEnd: impactProject.rawActualEnd, rawCloseDate: impactProject.rawCloseDate } as any); }, 300); }}
                >
                  <Feather name="refresh-cw" size={12} color="#fff" />
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#fff" }}>Retry</Text>
                </Pressable>
              </View>
            ) : impactResources.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 30, gap: 10 }}>
                <Feather name={impactDates.length > 0 ? "check-circle" : "user-x"} size={32} color={impactDates.length > 0 ? Colors.green : Colors.cardMuted} />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.cardMuted }}>No resources allocated</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.cardMuted, textAlign: "center" }}>
                  {impactDates.length > 0 ? "Schedule updated successfully. No team members need to be notified." : "No staff have been allocated to this project in RM ONE yet."}
                </Text>
              </View>
            ) : (
              <>
                <View style={{ flexDirection: "row", backgroundColor: Colors.green + "10", borderRadius: 10, padding: 12, marginBottom: 12, gap: 10, alignItems: "center" }}>
                  <Feather name="users" size={16} color={Colors.green} />
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.cardText, flex: 1 }}>
                    <Text style={{ fontFamily: "Inter_700Bold", color: Colors.green }}>{impactResources.length} resource{impactResources.length !== 1 ? "s" : ""}</Text>
                    {impactDates.length > 0 ? " allocated to this project will be impacted by date changes." : " currently allocated to this project."}
                  </Text>
                </View>

                <Pressable
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: Colors.green, borderRadius: 10, paddingVertical: 12, marginBottom: 8 }}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowAddMember(true); }}
                >
                  <Feather name="user-plus" size={14} color="#fff" />
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: "#fff" }}>Add Member</Text>
                </Pressable>

                <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                  <Pressable
                    style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: Colors.green, borderRadius: 10, paddingVertical: 11 }}
                    onPress={() => {
                      const proj = impactProject;
                      if (!proj) return;
                      const teamMembers = impactResources
                        .filter(r => r.name && !/^[0-9a-f]{8}-/.test(r.name) && r.name !== "Team Member")
                        .map(r => `- ${r.name}${r.role ? ` (${r.role})` : ""}${r.email ? ` — ${r.email}` : ""}${r.pct != null ? ` — ${r.pct}%` : ""}`);
                      if (teamMembers.length === 0) {
                        globalAlert("No Team Members", "No team members found to notify.");
                        return;
                      }
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      const dateChanges = impactDates.length > 0
                        ? `\n\nRecent schedule changes:\n${impactDates.map(d => `- ${d.field}: ${d.old} → ${d.new_}`).join("\n")}`
                        : "";
                      const context = `[NOTIFY_TEAM_CONTEXT] Project: "${proj.name}" (${proj.id}). Team members (${teamMembers.length}):\n${teamMembers.join("\n")}${dateChanges}\n\nThe user wants to send a notification email to this team. Ask the user what they'd like to communicate to the team. Once they provide the message, compose a professional email draft addressed to the team and show it for confirmation with [BUTTONS:YES_SEND,EDIT,CANCEL]. Use send_email to send to ALL team member emails listed above.`;
                      const prompt = `I want to notify the team on project "${proj.name}" (${proj.id}). Here are the ${teamMembers.length} team members:\n${teamMembers.join("\n")}\n\nWhat would you like me to tell them?`;
                      setImpactProject(null);
                      modalToChat(prompt, context);
                    }}
                  >
                    <Feather name="mail" size={13} color="#fff" />
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: "#fff" }}>Notify Team</Text>
                  </Pressable>
                  <Pressable
                    style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: Colors.green, borderRadius: 10, paddingVertical: 11 }}
                    onPress={() => {
                      const proj = impactProject;
                      const dates = [...impactDates];
                      const resources = [...impactResources].filter(r => r.name && !/^[0-9a-f]{8}-/.test(r.name) && r.name !== "Team Member");
                      if (!proj) return;
                      const teamDetails = resources.map(r => `${r.name}${r.role ? ` (${r.role})` : ""}${r.pct != null ? ` ${r.pct}%` : ""}`).join(", ");
                      const context = `[TEAM_CONTEXT] Project: "${proj.name}" (${proj.id}). Current team (${resources.length}): ${teamDetails}. IMPORTANT: You MUST call get_project_details for this project first to understand its type, value, and phase. Then call find_staff_for_project to find actual available bench resources. Base your recommendations on REAL data — name specific available people from the bench who could fill gaps. Do NOT give generic advice.`;
                      const prompt = dates.length > 0
                        ? `Schedule changed for "${proj.name}" (${proj.id}): ${dates.map(d => d.field + " changed").join(", ")}. Fetch project details, then recommend specific staffing adjustments using real available resources.`
                        : `Optimize staffing for "${proj.name}" (${proj.id}). Fetch project details and find available resources to recommend specific changes.`;
                      setImpactProject(null);
                      modalToChat(prompt, context);
                    }}
                  >
                    <Feather name="message-circle" size={13} color="#fff" />
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: "#fff" }}>Manage with AI</Text>
                  </Pressable>
                </View>

                {notifyResult && (() => {
                  const allSent = notifyResult.sent === notifyResult.total;
                  const allFailed = notifyResult.sent === 0 && notifyResult.total > 0;
                  const headerColor = allSent ? Colors.green : allFailed ? "#E03C3C" : Colors.orange;
                  const headerIcon = allSent ? "check-circle" : allFailed ? "x-circle" : "alert-circle";
                  const headerText = allSent ? "All Notifications Sent" : allFailed ? "All Notifications Failed" : `${notifyResult.sent} of ${notifyResult.total} Sent`;
                  const friendlyError = (raw?: string) => {
                    if (!raw) return "Send failed";
                    if (/bounced/i.test(raw)) return "Email bounced";
                    if (/blocked/i.test(raw)) return "Address blocked";
                    if (/rejected/i.test(raw)) return "Email rejected";
                    if (/network/i.test(raw)) return "Network error";
                    return "Send failed";
                  };
                  return (
                  <View style={{ borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: headerColor + "30", backgroundColor: headerColor + "08" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <Feather name={headerIcon as any} size={16} color={headerColor} />
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: headerColor }}>{headerText}</Text>
                    </View>
                    {impactResources.map((r) => {
                      const failEntry = notifyResult.failed.find(f => f.email === r.email);
                      const wasSent = !failEntry;
                      return (
                        <View key={r.email} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#00000008" }}>
                          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: wasSent ? Colors.green + "15" : "#E03C3C15", alignItems: "center", justifyContent: "center" }}>
                            <Feather name={wasSent ? "check" : "x"} size={12} color={wasSent ? Colors.green : "#E03C3C"} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.cardText }} numberOfLines={1}>{r.name}</Text>
                            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "#999" }} numberOfLines={1}>{r.email}</Text>
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: wasSent ? Colors.green : "#E03C3C" }}>
                              {wasSent ? "Sent ✓" : "Failed"}
                            </Text>
                            {!wasSent && (
                              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: "#E03C3C80", marginTop: 1 }}>{friendlyError(failEntry?.error)}</Text>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                  );
                })()}

                <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12, gap: 10, borderWidth: 1.5, borderColor: teamSearch.length > 0 ? Colors.green : "#E0E3E8", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
                  <Feather name="search" size={15} color={teamSearch.length > 0 ? Colors.green : "#AABBC0"} />
                  <AppTextInput
                    style={{ flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.cardText, padding: 0, outlineStyle: "none" as any, borderWidth: 0, backgroundColor: "transparent" }}
                    placeholder="Search by name, role, or email…"
                    placeholderTextColor="#B0BEC5"
                    value={teamSearch}
                    onChangeText={setTeamSearch}
                    returnKeyType="search"
                  />
                  {teamSearch.length > 0 && (
                    <Pressable onPress={() => setTeamSearch("")} style={{ padding: 2, backgroundColor: "#F0F2F5", borderRadius: 10 }}>
                      <Feather name="x" size={13} color="#777" />
                    </Pressable>
                  )}
                </View>

                <View style={{ backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: "#EEF1F5" }}>
                  {(() => {
                    // Detect duplicate display names within this project team so we
                    // can show a disambiguator chip next to each colliding member.
                    const nameCountsImpact = new Map<string, number>();
                    for (const r of impactResources) nameCountsImpact.set(r.name.toLowerCase(), (nameCountsImpact.get(r.name.toLowerCase()) ?? 0) + 1);
                    return impactResources.filter(r => {
                    if (!teamSearch.trim()) return true;
                    const q = teamSearch.toLowerCase();
                    return r.name.toLowerCase().includes(q) || r.role.toLowerCase().includes(q) || r.email.toLowerCase().includes(q);
                  }).map((r, idx) => {
                    const ini = r.name.split(" ").map(w => w[0] ?? "").slice(0, 2).join("").toUpperCase();
                    const td = r.teamData;
                    const impactIsDup = (nameCountsImpact.get(r.name.toLowerCase()) ?? 0) > 1;
                    const impactDisambiguator = impactIsDup ? buildResourceDisambiguator(r) : "";
                    const eac = td?.eacHrs ?? 0;
                    const etc = td?.etcHrs ?? 0;
                    const isExpanded = expandedTeamIdx === idx;
                    const fmtAllocDate = (v?: string) => {
                      if (!v) return "";
                      const d = new Date(v);
                      if (isNaN(d.getTime())) return "";
                      const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                      return `${mo[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
                    };
                    const nonZeroWeeks = (td?.weeklyHours ?? []).filter(w => w.hours !== 0);
                    return (
                      <View key={r.resourceId || `${r.name}-${r.role}-${idx}`} style={{ borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: "#F0F3F6" }}>
                        <Pressable
                          onPress={() => { setExpandedTeamIdx(isExpanded ? null : idx); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                          style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 11, gap: 12, cursor: "pointer" as any }}
                        >
                          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.green + "20", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.green }}>{ini}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#111" }} numberOfLines={1}>{r.name}</Text>
                            <DisabledStaffControl
                              enabled={r.enabled ?? td?.enabled}
                              userGuid={r.resourceId}
                              tenantId={r.tenantId ?? td?.tenantId}
                              onReactivated={async (userGuid) => {
                                setImpactResources(prev => prev.map(member =>
                                  member.resourceId?.toLowerCase() === userGuid.toLowerCase()
                                    ? { ...member, enabled: true, teamData: member.teamData ? { ...member.teamData, enabled: true } : member.teamData }
                                    : member,
                                ));
                                if (!impactProject) return;
                                const response = await getProjectTeam(impactProject.id);
                                const freshById = new Map(response.team.map(member => [member.resourceId?.toLowerCase(), member]));
                                setImpactResources(prev => prev.map(member => {
                                  const fresh = freshById.get(member.resourceId?.toLowerCase());
                                  return fresh ? {
                                    ...member, role: fresh.role || member.role, pct: fresh.pctAllocation ?? member.pct,
                                    enabled: fresh.enabled, tenantId: fresh.tenantId ?? member.tenantId, teamData: fresh,
                                  } : member;
                                }));
                              }}
                            />
                            {r.role ? <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#777", marginTop: 1 }} numberOfLines={1}>{r.role}</Text> : null}
                            {impactDisambiguator ? (
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 }}>
                                <Feather name="tag" size={9} color="#AABBC0" />
                                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "#AABBC0" }} numberOfLines={1}>{impactDisambiguator}</Text>
                              </View>
                            ) : null}
                            {td?.bu ? <Text style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.green, marginTop: 2 }}>BU: {td.bu}</Text> : null}
                            {r.email ? (
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                                <Feather name="mail" size={10} color="#999" />
                                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "#999" }} numberOfLines={1}>{r.email}</Text>
                              </View>
                            ) : null}
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
                              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: r.pct > 0 ? Colors.green : "#E03C3C" }} />
                              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: r.pct > 0 ? Colors.green : "#E03C3C" }}>{fmtPct(r.pct)} allocated</Text>
                            </View>
                          </View>
                          <View style={{ alignItems: "flex-end", gap: 3 }}>
                            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.cardText }}>{eac}</Text>
                            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 9, color: "#999" }}>EAC HRS</Text>
                            <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color="#999" />
                          </View>
                        </Pressable>

                        {isExpanded && (
                          <View style={{ paddingHorizontal: 14, paddingBottom: 14, backgroundColor: "#F8FAFB" }}>
                            {r.email ? (
                              <Pressable onPress={() => Linking.openURL(`mailto:${r.email}`)} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#EEF1F5", alignSelf: "flex-start" }}>
                                <Feather name="mail" size={12} color={Colors.green} />
                                <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.green }}>{r.email}</Text>
                              </Pressable>
                            ) : null}
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                              {[
                                { label: "EAC Hrs", value: String(eac), color: Colors.cardText },
                                { label: "ETC Hrs", value: String(etc), color: Colors.orange },
                                { label: "Cost Rate", value: `$${td?.costRate ?? 0}`, color: "#555" },
                                { label: "EAC Cost", value: `$${(td?.eacCost ?? 0).toLocaleString()}`, color: Colors.green },
                                { label: "ETC Cost", value: `$${(td?.etcCost ?? 0).toLocaleString()}`, color: Colors.orange },
                              ].map(item => (
                                <View key={item.label} style={{ backgroundColor: "#fff", borderRadius: 8, padding: 8, minWidth: 80, borderWidth: 1, borderColor: "#EEF1F5" }}>
                                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: "#666", marginBottom: 2 }}>{item.label}</Text>
                                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: item.color }}>{item.value}</Text>
                                </View>
                              ))}
                            </View>

                            {(r.startDate || r.endDate || td?.startDate || td?.endDate) ? (
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                                <Feather name="calendar" size={12} color="#999" />
                                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#666" }}>
                                  {fmtAllocDate(td?.startDate || r.startDate)}{(td?.startDate || r.startDate) && (td?.endDate || r.endDate) ? " – " : ""}{fmtAllocDate(td?.endDate || r.endDate)}
                                </Text>
                              </View>
                            ) : null}

                            {nonZeroWeeks.length > 0 ? (
                              <View>
                                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.cardText, marginBottom: 6 }}>Weekly Hours</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={true} style={{ marginBottom: 4 }}>
                                  <View>
                                    <View style={{ flexDirection: "row" }}>
                                      {nonZeroWeeks.map(w => (
                                        <View key={w.week} style={{ width: 56, alignItems: "center", paddingVertical: 4, borderRightWidth: 1, borderRightColor: "#EEF1F5" }}>
                                          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 9, color: "#999" }}>{w.week}</Text>
                                        </View>
                                      ))}
                                    </View>
                                    <View style={{ flexDirection: "row" }}>
                                      {nonZeroWeeks.map(w => (
                                        <View key={w.week} style={{ width: 56, alignItems: "center", paddingVertical: 6, backgroundColor: w.hours > 0 ? Colors.green + "10" : "transparent", borderRightWidth: 1, borderRightColor: "#EEF1F5" }}>
                                          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: w.hours > 0 ? Colors.green : "#ccc" }}>{fmtHours(w.hours)}</Text>
                                        </View>
                                      ))}
                                    </View>
                                  </View>
                                </ScrollView>
                              </View>
                            ) : (
                              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#aaa", fontStyle: "italic" }}>No weekly hours allocated</Text>
                            )}

                            <Pressable
                              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: Colors.green, borderRadius: 8, paddingVertical: 9, marginTop: 10 }}
                              onPress={() => {
                                setEditAllocPerson({ name: r.name, role: r.role, pct: r.pct, resourceId: r.resourceId, disambiguator: impactDisambiguator || undefined });
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              }}
                            >
                              <Feather name="edit-2" size={12} color="#FFF" />
                              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#FFF" }}>Edit Allocation</Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    );
                  });
                  })()}
                </View>

                {impactResources.filter(r => r.pct > 100).length > 0 && (
                  <View style={{ backgroundColor: "#E03C3C10", borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: "#E03C3C25", flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                    <Feather name="alert-triangle" size={14} color="#E03C3C" style={{ marginTop: 1 }} />
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#E03C3C", flex: 1, lineHeight: 18 }}>
                      {impactResources.filter(r => r.pct > 100).length} resource{impactResources.filter(r => r.pct > 100).length !== 1 ? "s are" : " is"} overloaded.
                      Consider reallocating to balance workloads.
                    </Text>
                  </View>
                )}

                {impactOpenRoles.length > 0 && (
                  <View style={{ marginTop: 16 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                      <Feather name="users" size={14} color={Colors.orange} />
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.cardText }}>OPEN ROLES ({impactOpenRoles.length})</Text>
                    </View>
                    {impactOpenRoles.filter(slot => {
                      if (!teamSearch.trim()) return true;
                      const q = teamSearch.toLowerCase();
                      // Role matches abbreviation-aware ("PM" ⇄ "Project
                      // Manager") via the shared matcher; BU/title stay
                      // substring. Tiny list, per-row call is fine.
                      return roleTextMatches(q, slot.role) || (slot.bu || "").toLowerCase().includes(q) || (slot.title || "").toLowerCase().includes(q);
                    }).map((slot, idx) => {
                      const roleLabel = slot.role || "Open Role";
                      const buShort = slot.bu || "";
                      const fmtDateShortLocal = (v?: string) => {
                        if (!v) return "";
                        const d = new Date(v);
                        if (isNaN(d.getTime())) return "";
                        const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                        return `${mo[d.getMonth()]} ${d.getDate()}`;
                      };
                      const start = slot.startDate ? slot.startDate.slice(0, 10) : "";
                      const end = slot.endDate ? slot.endDate.slice(0, 10) : "";
                      const dateRange = start && end ? `${fmtDateShortLocal(start)} – ${fmtDateShortLocal(end)}` : (start || end || "");
                      return (
                        <View key={`open-${idx}`} style={{ flexDirection: "row", alignItems: "center", padding: 12, marginBottom: 8, backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: Colors.orange + "40" }}>
                          <View style={{ flex: 1, paddingRight: 10 }}>
                            <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.cardText }}>{roleLabel}</Text>
                            <Text style={{ fontSize: 11, color: "#777", marginTop: 3, fontFamily: "Inter_500Medium" }}>
                              {buShort ? `${buShort} · ` : ""}{slot.pct > 0 ? fmtPct(slot.pct) : "—"}{slot.eacHrs > 0 ? ` · ${fmtHours(slot.eacHrs)}h` : ""}{dateRange ? ` · ${dateRange}` : ""}
                            </Text>
                          </View>
                          <Pressable
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAssignOpenRole(slot); }}
                            style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.green, borderRadius: 8 }}
                          >
                            <Feather name="user-plus" size={12} color="#FFF" />
                            <Text style={{ marginLeft: 6, color: "#FFF", fontFamily: "Inter_700Bold", fontSize: 12 }}>Assign</Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                )}

              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {impactProject && (
        <AddTeamMemberModal
          visible={showAddMember || !!assignOpenRole}
          onClose={() => { setShowAddMember(false); setAssignOpenRole(null); }}
          projectId={impactProject.id}
          projectName={impactProject.name}
          module="PMM"
          projectStartDate={(impactProject.rawTargetStart || new Date().toISOString()).slice(0, 10)}
          projectEndDate={(impactProject.rawTargetEnd || new Date(Date.now() + 365 * 86400000).toISOString()).slice(0, 10)}
          existingAllocations={impactResources
            .filter(r => r.resourceId)
            .map(r => ({
              personId: r.resourceId!, bu: r.teamData?.bu || "", role: r.teamData?.role || r.role || "", title: r.teamData?.title || "", hours: r.teamData?.eacHrs || 0,
              // Merge refs (duplicate add → edit of the existing assignment).
              // teamData dates are authoritative; the loose startDate/endDate
              // fields here can carry non-date strings (e.g. "BU: …").
              allocationId: r.teamData?.rwiId ?? undefined, startDate: r.teamData?.startDate || undefined, endDate: r.teamData?.endDate || undefined,
            }))}
          onAssigned={(name, resourceId) => {
            setPendingWeeklyAlloc({ name, resourceId });
            setAssignOpenRole(null);
            if (impactProject) {
              Promise.all([
                getProjectTeam(impactProject.id).catch(() => ({ team: [] as ProjectTeamMember[], openRoles: [] })),
                getProjectAllocations(impactProject.id).catch(() => null),
              ]).then(([teamResp]) => {
                const teamData = teamResp?.team ?? (Array.isArray(teamResp) ? teamResp as ProjectTeamMember[] : []);
                if (teamData && teamData.length > 0) {
                  const merged = teamData.map(tm => {
                    const existing = impactResources.find(r =>
                      !!tm.resourceId && r.resourceId?.toLowerCase() === tm.resourceId.toLowerCase(),
                    ) ?? impactResources.find(r => !tm.resourceId && r.name?.toLowerCase() === tm.name?.toLowerCase());
                    return {
                      name: tm.name || existing?.name || "",
                      role: tm.role || existing?.role || "",
                      pct: tm.pctAllocation ?? existing?.pct ?? 0,
                      email: tm.email || existing?.email || "",
                      startDate: existing?.startDate || "",
                      endDate: existing?.endDate || "",
                      resourceId: tm.resourceId || existing?.resourceId,
                      enabled: tm.enabled ?? existing?.enabled,
                      tenantId: tm.tenantId ?? existing?.tenantId,
                      teamData: tm,
                    };
                  });
                  setImpactResources(merged);
                }
                setImpactOpenRoles((teamResp?.openRoles ?? []) as OpenRole[]);
              });
            }
          }}
          prefillBuShort={assignOpenRole?.bu}
          prefillRole={assignOpenRole?.role}
          prefillTitle={assignOpenRole?.title || assignOpenRole?.role}
          prefillStartDate={assignOpenRole?.startDate ? assignOpenRole.startDate.slice(0, 10) : undefined}
          prefillEndDate={assignOpenRole?.endDate ? assignOpenRole.endDate.slice(0, 10) : undefined}
          prefillPct={assignOpenRole?.pct}
          canManageStaff={user?.capabilities.manageStaff === true}
        />
      )}
      {pendingWeeklyAlloc && impactProject && (() => {
        const match = (pendingWeeklyAlloc.resourceId
          ? impactResources.find(r => r.resourceId?.toLowerCase() === pendingWeeklyAlloc.resourceId!.toLowerCase())
          : undefined) ?? impactResources.find(r => r.name === pendingWeeklyAlloc.name);
        if (!match) { setPendingWeeklyAlloc(null); return null; }
        const pendingNameCounts = new Map<string, number>();
        for (const r of impactResources) pendingNameCounts.set(r.name.toLowerCase(), (pendingNameCounts.get(r.name.toLowerCase()) ?? 0) + 1);
        const pendingIsDup = (pendingNameCounts.get(match.name.toLowerCase()) ?? 0) > 1;
        return (
          <EditAllocationModal
            person={{ name: match.name, role: match.role, pct: match.pct, resourceId: match.resourceId, disambiguator: pendingIsDup ? buildResourceDisambiguator(match) : undefined }}
            projectId={impactProject.id}
            canManageStaff={user?.capabilities.manageStaff === true}
            onClose={() => setPendingWeeklyAlloc(null)}
            onSaved={() => {
              setPendingWeeklyAlloc(null);
              if (impactProject) {
                setImpactLoading(true);
                getProjectTeam(impactProject.id).catch(() => ({ team: [] as ProjectTeamMember[], openRoles: [] })).then((teamResp) => {
                  const teamData = teamResp?.team ?? (Array.isArray(teamResp) ? teamResp as ProjectTeamMember[] : []);
                  if (teamData && teamData.length > 0) {
                    const updated = impactResources.map(r => {
                    const tm = teamData.find(t => !!r.resourceId && t.resourceId?.toLowerCase() === r.resourceId.toLowerCase())
                      ?? teamData.find(t => !r.resourceId && t.name?.toLowerCase() === r.name.toLowerCase());
                    if (tm) return { ...r, pct: tm.pctAllocation ?? r.pct, enabled: tm.enabled ?? r.enabled, tenantId: tm.tenantId ?? r.tenantId, teamData: tm };
                      return r;
                    });
                    setImpactResources(updated);
                  }
                  setImpactOpenRoles((teamResp?.openRoles ?? []) as OpenRole[]);
                }).finally(() => setImpactLoading(false));
              }
            }}
          />
        );
      })()}
      {editAllocPerson && impactProject && (
        <EditAllocationModal
          person={editAllocPerson}
          projectId={impactProject.id}
          canManageStaff={user?.capabilities.manageStaff === true}
          /* disambiguator is already baked into editAllocPerson at setEditAllocPerson call-site */
          onClose={() => setEditAllocPerson(null)}
          onSaved={() => {
            setEditAllocPerson(null);
            if (impactProject) {
              setImpactLoading(true);
              Promise.all([
                getProjectTeam(impactProject.id).catch(() => ({ team: [] as ProjectTeamMember[], openRoles: [] })),
                getProjectAllocations(impactProject.id).catch(() => null),
              ]).then(([teamResp]) => {
                const teamData = teamResp?.team ?? (Array.isArray(teamResp) ? teamResp as ProjectTeamMember[] : []);
                if (teamData && teamData.length > 0) {
                  const updated = impactResources.map(r => {
                    const tm = teamData.find(t => !!r.resourceId && t.resourceId?.toLowerCase() === r.resourceId.toLowerCase())
                      ?? teamData.find(t => !r.resourceId && t.name?.toLowerCase() === r.name.toLowerCase());
                    if (tm) return { ...r, pct: tm.pctAllocation ?? r.pct, enabled: tm.enabled ?? r.enabled, tenantId: tm.tenantId ?? r.tenantId, teamData: tm };
                    return r;
                  });
                  setImpactResources(updated);
                }
                setImpactOpenRoles((teamResp?.openRoles ?? []) as OpenRole[]);
              }).finally(() => setImpactLoading(false));
            }
          }}
        />
      )}

      {/* ══ CARD ACTION MENU (⋮) ════════════════════════════════════════════ */}
      <Modal visible={!!cardMenu} transparent animationType="fade" onRequestClose={() => setCardMenu(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setCardMenu(null)} />
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: "flex-end" }} behavior={Platform.OS === "ios" ? "padding" : "height"} pointerEvents="box-none">
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { fontSize: 15, marginBottom: 2 }]} numberOfLines={1}>{cardMenu?.name}</Text>
            <Text style={[styles.modalSub, { marginBottom: 8 }]}>{cardMenu?.id}</Text>

            <Pressable
              style={styles.cardMenuAction}
              onPress={() => { setCardMenu(null); setTimeout(() => setNotesPending({ id: cardMenu!.id, module: cardMenu!.module, name: cardMenu!.name, current: cardMenu?.note ?? "" }), 150); }}
            >
              <View style={[styles.cardMenuActionIcon, { backgroundColor: Colors.green + "18" }]}>
                <Feather name="file-text" size={16} color={Colors.green} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardMenuActionLabel}>Notes</Text>
                <Text style={styles.cardMenuActionSub}>{cardMenu?.note ? "Edit existing note" : "Add a note to this record"}</Text>
              </View>
              <Feather name="chevron-right" size={14} color={Colors.cardMuted} />
            </Pressable>

            <Pressable
              style={styles.cardMenuAction}
              onPress={() => { setCardMenu(null); setTimeout(() => { if (holdInfoMap[cardMenu!.id]) { setHoldInfoMap(prev => { const n = { ...prev }; delete n[cardMenu!.id]; return n; }); bustCacheByPrefix("module:"); } else { setHoldPending({ id: cardMenu!.id, module: cardMenu!.module, name: cardMenu!.name }); } }, 150); }}
            >
              <View style={[styles.cardMenuActionIcon, { backgroundColor: "#FEF3C7" }]}>
                <Feather name="pause-circle" size={16} color="#B45309" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardMenuActionLabel}>{cardMenu && holdInfoMap[cardMenu.id] ? "Remove Hold" : "Put on Hold"}</Text>
                <Text style={styles.cardMenuActionSub}>{cardMenu && holdInfoMap[cardMenu.id] ? "Remove hold status from this record" : "Mark as on hold with a reason"}</Text>
              </View>
              <Feather name="chevron-right" size={14} color={Colors.cardMuted} />
            </Pressable>

            {cardMenu?.module === "OPM" ? (
              <Pressable
                style={styles.cardMenuAction}
                onPress={() => { setCardMenu(null); setTimeout(() => setSourceTypePending({ id: cardMenu!.id, name: cardMenu!.name, current: cardMenu?.requestCategory ?? "" }), 150); }}
              >
                <View style={[styles.cardMenuActionIcon, { backgroundColor: Colors.orange + "18" }]}>
                  <Feather name="tag" size={16} color={Colors.orange} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardMenuActionLabel}>Change Source Type</Text>
                  <Text style={styles.cardMenuActionSub}>{cardMenu?.requestCategory ? `Current: ${cardMenu.requestCategory}` : "Set the request category"}</Text>
                </View>
                <Feather name="chevron-right" size={14} color={Colors.cardMuted} />
              </Pressable>
            ) : null}

            <Pressable style={styles.cancelBtn} onPress={() => setCardMenu(null)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══ NOTES MODAL ════════════════════════════════════════════════════════ */}
      {notesPending ? (
        <NotesActionModal
          target={notesPending}
          onClose={() => setNotesPending(null)}
          bottomInset={insets.bottom}
          onSaved={(id, module, newNote) => {
            if (module === "PMM") {
              setProjects(prev => prev.map(p => p.id === id ? { ...p, note: newNote || undefined } : p));
            } else {
              setOpps(prev => prev.map(o => o.id === id ? { ...o, note: newNote || undefined } : o));
            }
            bustCacheByPrefix("module:");
            loadData();
          }}
        />
      ) : null}

      {/* ══ HOLD MODAL ═════════════════════════════════════════════════════════ */}
      {holdPending ? (
        <HoldActionModal
          target={holdPending}
          onClose={() => setHoldPending(null)}
          bottomInset={insets.bottom}
          onSaved={(id, reason) => {
            setHoldInfoMap(prev => ({ ...prev, [id]: reason }));
            bustCacheByPrefix("module:");
            loadData();
          }}
        />
      ) : null}

      {/* ══ CHANGE SOURCE TYPE MODAL ═══════════════════════════════════════════ */}
      {sourceTypePending ? (
        <SourceTypeActionModal
          target={sourceTypePending}
          onClose={() => setSourceTypePending(null)}
          bottomInset={insets.bottom}
          onSaved={(id, cat) => {
            setOpps(prev => prev.map(o => o.id === id ? { ...o, requestCategory: cat || undefined } : o));
            bustCacheByPrefix("module:");
            loadData();
          }}
        />
      ) : null}

      {/* ── Find Staff Modal ─────────────────────────────────────────────── */}
      <Modal visible={!!findStaffProject} transparent animationType="slide" onRequestClose={() => setFindStaffProject(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setFindStaffProject(null)} />
        <View style={[styles.findStaffSheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#EEF1F5" }}>
            <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: Colors.green + "20", alignItems: "center", justifyContent: "center" }}>
              <Feather name="user-plus" size={18} color={Colors.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Find Available Staff</Text>
              <Text style={[styles.modalSub, { marginTop: 3 }]} numberOfLines={1}>{findStaffProject?.name}</Text>
              <Text style={[styles.modalSub, { marginTop: 2, color: Colors.cardMuted, fontSize: 11 }]}>
                {findStaffProject?.targetStart !== "—" ? `${findStaffProject?.targetStart} → ${findStaffProject?.targetEnd}` : findStaffProject?.id}
              </Text>
            </View>
            <Pressable style={{ padding: 8 }} onPress={() => setFindStaffProject(null)}>
              <Feather name="x" size={18} color={Colors.cardMuted} />
            </Pressable>
          </View>

          {/* Body */}
          {findStaffLoading ? (
            <View style={{ alignItems: "center", paddingVertical: 40, gap: 12 }}>
              <ActivityIndicator size="large" color={Colors.green} />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary }}>Scanning workforce availability…</Text>
            </View>
          ) : findStaffError ? (
            <View style={{ alignItems: "center", paddingVertical: 40, gap: 10, paddingHorizontal: 20 }}>
              <Feather name="alert-circle" size={32} color={Colors.orange} />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.cardMuted }}>Could not load staff</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.cardMuted, textAlign: "center" }}>{findStaffError}</Text>
            </View>
          ) : findStaffData.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 40, gap: 10 }}>
              <Feather name="users" size={32} color={Colors.textMuted} />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.cardMuted }}>No available staff found</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.cardMuted, textAlign: "center", paddingHorizontal: 20 }}>
                All team members may be at full capacity for this project period.
              </Text>
            </View>
          ) : (() => {
            const ssq = staffSearch.toLowerCase().trim();
            const displayStaff = ssq
              ? findStaffData.filter(r => r.name.toLowerCase().includes(ssq) || (r.jobTitle || "").toLowerCase().includes(ssq))
              : findStaffData;
            return (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 }}>
              {/* Summary */}
              <View style={{ flexDirection: "row", backgroundColor: Colors.green + "10", borderRadius: 10, padding: 12, marginBottom: 10, gap: 10, alignItems: "center" }}>
                <Feather name="check-circle" size={16} color={Colors.green} />
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.cardText, flex: 1 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", color: Colors.green }}>{findStaffData.length} people</Text>
                  {" "}available — bench + under-utilized (&lt;80%), sorted by capacity.
                </Text>
              </View>

              {/* Search */}
              <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: Colors.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, marginBottom: 14, height: 38 }}>
                <Feather name="search" size={14} color={Colors.cardMuted} />
                <AppTextInput
                  style={{ flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: "#111", marginLeft: 8, paddingVertical: 0 }}
                  placeholder="Search by name or title…"
                  placeholderTextColor={Colors.cardMuted}
                  value={staffSearch}
                  onChangeText={setStaffSearch}
                  autoCorrect={false}
                />
                {staffSearch ? (
                  <Pressable onPress={() => setStaffSearch("")}><Feather name="x" size={14} color={Colors.cardMuted} /></Pressable>
                ) : null}
              </View>

              {!ssq && findStaffData.length > 50 && (
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted, textAlign: "center", marginBottom: 10 }}>
                  Showing top 50 of {findStaffData.length}. Search to find specific people.
                </Text>
              )}

              {/* List */}
              <View style={{ backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: "#EEF1F5" }}>
                {displayStaff.map((r, idx) => {
                  const pct = r.currentPct;
                  const barColor = pct === 0 ? Colors.green : pct < 75 ? Colors.green : pct < 100 ? Colors.orange : Colors.red;
                  const ini = r.name.split(" ").map(w => w[0] ?? "").slice(0, 2).join("").toUpperCase();
                  return (
                    <View key={r.id || String(idx)} style={{ borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: "#F0F3F6" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 11, gap: 12 }}>
                        {/* Avatar */}
                        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: barColor + "20", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: barColor }}>{ini}</Text>
                        </View>
                        {/* Info */}
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#111" }} numberOfLines={1}>{r.name}</Text>
                          {r.jobTitle ? <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#777", marginTop: 1 }} numberOfLines={1}>{r.jobTitle}</Text> : null}
                          {/* Allocation bar */}
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 5 }}>
                            <View style={{ flex: 1, height: 4, backgroundColor: "#EEF1F5", borderRadius: 2, overflow: "hidden" }}>
                              <View style={{ width: `${Math.min(pct, 100)}%` as any, height: 4, backgroundColor: barColor, borderRadius: 2 }} />
                            </View>
                            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: barColor, minWidth: 36, textAlign: "right" }}>{fmtPct(pct)}</Text>
                          </View>
                        </View>
                        {/* Projects + complexity */}
                        <View style={{ alignItems: "center", gap: 4 }}>
                          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.cardText }}>{r.projectCount}</Text>
                          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: Colors.cardMuted }}>proj</Text>
                          {r.complexity > 0 && (
                            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.orange }}>C{r.complexity}</Text>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          ); })()}
        </View>
      </Modal>
    </View>
  );
}

/* ─── STYLES ─────────────────────────────────────────────────────────────── */
const styles = themed(() => StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: Colors.textPrimary },
  headerSub: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textPrimary, marginTop: 2 },
  headerSubBold: { fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.textPrimary },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: Colors.green, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12,
  },
  addBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.cardText },

  /* Segment switcher */
  segmentRow: {
    flexGrow: 0, flexShrink: 0,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  segmentPill: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 12,
    backgroundColor: Colors.darkCard, borderWidth: 1, borderColor: Colors.border,
  },
  segmentPillActive: { backgroundColor: Colors.green, borderColor: Colors.green },
  segmentText: { fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.textPrimary },
  segmentTextActive: { color: "#FFFFFF" },

  /* Filter chips */
  filterRow: {
    flexDirection: "row",
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  filterPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 13, paddingVertical: 7,
    borderRadius: 20, backgroundColor: Colors.darkCard,
    borderWidth: 1, borderColor: Colors.border,
  },
  filterPillActive: { backgroundColor: Colors.green, borderColor: Colors.green },
  filterDot: { width: 6, height: 6, borderRadius: 3 },
  filterText: { fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.textPrimary },
  filterTextActive: { color: "#FFFFFF", fontFamily: "Inter_700Bold" },

  subFilterPill: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 14, backgroundColor: "transparent",
    borderWidth: 1, borderColor: Colors.border,
  },
  subFilterPillActive: { backgroundColor: Colors.darkCard, borderColor: Colors.textSecondary },
  subFilterText: { fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.textMuted },
  subFilterTextActive: { color: Colors.textPrimary, fontFamily: "Inter_600SemiBold" },

  dateDropdownBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 9,
    borderRadius: 10, backgroundColor: Colors.darkCard,
    borderWidth: 1, borderColor: Colors.border,
  },
  dateDropdownBtnActive: { borderColor: Colors.orange, backgroundColor: Colors.orange + "15" },
  dateDropdownText: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary },
  dateDropdownTextActive: { color: Colors.orange, fontFamily: "Inter_600SemiBold" },
  dateDropdownMenu: {
    marginTop: 6, backgroundColor: Colors.darkCard,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    overflow: "hidden" as const,
  },
  dateDropdownItem: {
    flexDirection: "row" as const, alignItems: "center" as const,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  dateDropdownItemActive: { backgroundColor: Colors.orange + "12" },
  dateDropdownItemText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textPrimary },
  dateDropdownItemTextActive: { color: Colors.orange, fontFamily: "Inter_600SemiBold" },

  scroll: { padding: 16, gap: 12 },
  emptyState: { paddingTop: 60, alignItems: "center", gap: 10, paddingHorizontal: 40 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.textPrimary },
  emptySub: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, textAlign: "center" },

  /* Pipeline roll-up card */
  rollupCard: {
    backgroundColor: Colors.darkCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border,
    padding: 18, gap: 12, marginBottom: 4,
  },
  rollupTitle: { fontFamily: "Inter_700Bold", fontSize: 9, color: Colors.textSecondary, letterSpacing: 1.4 },
  rollupRow: { flexDirection: "row", alignItems: "center" },
  rollupStat: { flex: 1, alignItems: "center", gap: 4 },
  rollupDivider: { width: 1, height: 36, backgroundColor: Colors.border },
  rollupValue: { fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.textPrimary },
  rollupLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary },
  rollupAlert: {
    flexDirection: "row", alignItems: "flex-start", gap: 7,
    backgroundColor: Colors.orange + "18", borderWidth: 1, borderColor: Colors.orange + "40",
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
  },
  rollupAlertText: { fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.orange, flex: 1, lineHeight: 16 },

  card: {
    backgroundColor: Colors.cardBg, borderRadius: 20,
    borderWidth: 2.5, borderColor: Colors.cardBorderStrong,
    padding: 18, gap: 12, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    width: "100%" as any,
    alignSelf: "stretch" as const,
  },
  riskAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, borderRadius: 2 },

  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  phasePill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  phaseDot: { width: 5, height: 5, borderRadius: 3 },
  phaseText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  riskTags: { flexDirection: "row", gap: 5 },
  riskTag: {
    flexDirection: "row", alignItems: "center", gap: 3,
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3,
  },
  riskTagText: { fontFamily: "Inter_600SemiBold", fontSize: 9 },

  projectName: { fontFamily: "Inter_700Bold", fontSize: 17, color: Colors.cardText },

  allocRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  allocLabel: { fontFamily: "Inter_700Bold", fontSize: 9, color: Colors.cardMuted, letterSpacing: 1.2 },
  allocPct: { fontFamily: "Inter_700Bold", fontSize: 15 },
  allocBarBg: { height: 6, backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 3, overflow: "hidden" },
  allocBarFill: { height: 6, borderRadius: 3 },

  ganttSection: { gap: 6 },
  ganttTitle: { fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.cardMuted, letterSpacing: 1.2, marginBottom: 2 },
  ganttBar: { flexDirection: "row", height: 26, borderRadius: 6, overflow: "hidden", gap: 2 },
  ganttSegment: { alignItems: "center", justifyContent: "center", borderRadius: 4 },
  tlPill: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(107,165,57,0.12)", borderRadius: 20, borderWidth: 1, borderColor: Colors.green + "40", paddingHorizontal: 14, paddingVertical: 8 },
  tlDot: { width: 7, height: 7, borderRadius: 4, marginRight: 8 },
  tlPillLabel: { fontFamily: "Inter_700Bold", fontSize: 11, marginRight: 5 },
  tlPillDate: {
    // The pill background is a fixed light green/orange tint in both themes,
    // so the date text needs a dark slate (`cardText`) that stays readable
    // in both. `Colors.dark` is the *page bg* token — it became the light
    // page color in light mode and made the date invisible.
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: Colors.cardText,
    flex: 1,
  },
  ganttSegLabel: { fontFamily: "Inter_700Bold", fontSize: 11, color: Colors.cardText },
  ganttDates: { flexDirection: "row", justifyContent: "space-between" },
  ganttDate: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted },

  riskOverlay: { gap: 6 },
  riskImpact: {
    flexDirection: "row", alignItems: "flex-start", gap: 7,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
  },
  riskImpactText: { fontFamily: "Inter_500Medium", fontSize: 11, flex: 1, lineHeight: 16 },

  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 2 },
  actionBtnGreen: {
    flexGrow: 1, flexBasis: "22%", flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4, backgroundColor: Colors.green, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 4,
  },
  actionBtnGreenText: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: Colors.cardText },
  actionBtnOutline: {
    flexGrow: 1, flexBasis: "22%", flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4, backgroundColor: Colors.surfaceAlt,
    borderWidth: 1, borderColor: Colors.cardBorder,
    borderRadius: 10, paddingVertical: 8, paddingHorizontal: 4,
  },
  actionBtnOutlineText: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: Colors.cardMuted },

  /* Value display */
  valueRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  valueLabel: { fontFamily: "Inter_700Bold", fontSize: 9, color: Colors.cardMuted, letterSpacing: 1.2 },
  valueText: { fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.green },

  /* Staffing demand row */
  staffingRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 8, marginBottom: 4, gap: 12,
    borderTopWidth: 1, borderTopColor: "#F1F4F7",
  },
  staffingLabel: { fontFamily: "Inter_700Bold", fontSize: 9, color: "#2F6E1F", letterSpacing: 1.2, flexShrink: 0, lineHeight: 14 },
  staffingValue: { fontFamily: "Inter_700Bold", fontSize: 13, color: "#2F6E1F" },
  staffingTopRole: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.cardMuted, textAlign: "right", marginTop: 3 },

  /* Opp-specific */
  oppStagePill: {
    backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.cardBorder,
    borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4,
  },
  oppStageText: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: Colors.cardMuted },
  daysLeft: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  daysLeftText: { fontFamily: "Inter_700Bold", fontSize: 10 },
  oppType: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted },
  oppNameRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  oppValue: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.green, flexShrink: 0 },
  probRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  weightedRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: Colors.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  weightedLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted },
  weightedValue: { fontFamily: "Inter_700Bold", fontSize: 13 },
  readinessRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 9,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  readinessTitle: { fontFamily: "Inter_700Bold", fontSize: 12, marginBottom: 2 },
  readinessNote: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted, lineHeight: 15 },

  /* Modal */
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  modalSheet: {
    backgroundColor: Colors.cardBg, borderTopLeftRadius: 26,
    borderTopRightRadius: 26, padding: 24, paddingTop: 12, gap: 14,
  },
  findStaffSheet: {
    backgroundColor: Colors.cardBg, borderTopLeftRadius: 26,
    borderTopRightRadius: 26, paddingTop: 12, maxHeight: "80%",
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 20,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.cardBorder, alignSelf: "center", marginBottom: 6,
  },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 19, color: Colors.cardText },
  modalSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.cardMuted, marginTop: -6 },
  modalField: { gap: 6 },
  modalLabel: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.cardMuted, letterSpacing: 0.5 },
  modalInput: {
    backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.cardBorder,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.cardText,
  },
  saveBtn: { backgroundColor: Colors.green, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  saveBtnText: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.cardText },
  cancelBtn: { borderRadius: 14, paddingVertical: 12, alignItems: "center" },
  cancelBtnText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.cardMuted },

  /* Card ⋮ menu button */
  cardMenuBtn: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.cardBorder,
    alignItems: "center", justifyContent: "center",
  },
  cardMenuBtnText: {
    fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.cardMuted,
    lineHeight: 20, letterSpacing: -1,
  },

  /* Note snippet on card */
  noteSnippet: {
    flexDirection: "row", alignItems: "flex-start", gap: 7,
    backgroundColor: Colors.surfaceAlt, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.cardBorder,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  noteSnippetText: {
    fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.cardMuted,
    flex: 1, lineHeight: 17,
  },

  /* On Hold pill */
  holdPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#FEF3C7", borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: "#FDE68A",
  },
  holdPillText: { fontFamily: "Inter_700Bold", fontSize: 9, color: "#B45309" },

  /* Card action menu items */
  cardMenuAction: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  cardMenuActionIcon: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  cardMenuActionLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.cardText },
  cardMenuActionSub: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted, marginTop: 1 },
}));
