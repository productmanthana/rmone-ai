export const BRAND = {
  bg: "#253746",
  bgDeep: "#1B2B38",
  card: "#2E4557",
  green: "#6BA539",
  greenLight: "#A9C23F",
  orange: "#E87722",
  orangeWarm: "#FF9425",
  red: "#F87171",
  white: "#FFFFFF",
  textSecondary: "rgba(255,255,255,0.55)",
  textMuted: "rgba(255,255,255,0.35)",
  cardWhite: "#FFFFFF",
  cardText: "#253746",
  cardMuted: "#6B7E8A",
};

export const PROJECTS = [
  {
    id: "P-10847",
    name: "Bayfront Medical Tower – Phase II Expansion",
    phase: "Construction Documents",
    phaseColor: "#3B82F6",
    city: "Tampa, FL",
    targetRange: "Mar 2026 – Aug 2027",
    actualRange: null as string | null,
    value: "$148.2M",
    health: 82,
    healthLabel: "On Track",
    staffing: { count: 4, avg: 78, fte: 3.1, roles: ["Sr Architect", "Mech Engr", "Cost Estr"] },
  },
  {
    id: "P-10912",
    name: "Riverside Logistics Hub – Tilt-Up",
    phase: "Pre-Construction",
    phaseColor: "#A855F7",
    city: "Memphis, TN",
    targetRange: "May 2026 – Jan 2027",
    actualRange: null,
    value: "$62.5M",
    health: 71,
    healthLabel: "Watch",
    staffing: { count: 2, avg: 50, fte: 1.0, roles: ["PMM Lead", "Field Sup"] },
  },
  {
    id: "P-10733",
    name: "Northbrook Mixed-Use Tower",
    phase: "Under Construction",
    phaseColor: "#F59E0B",
    city: "Chicago, IL",
    targetRange: "Sep 2025 – Dec 2026",
    actualRange: "Oct 2025 – Feb 2027",
    value: "$214.0M",
    health: 58,
    healthLabel: "At Risk",
    staffing: { count: 6, avg: 88, fte: 5.3, roles: ["Sr PM", "Sched", "QA Lead"] },
  },
];

export const KPIS = [
  { label: "Schedule Health",   value: 84, tone: "good" as const },
  { label: "Staffing Coverage", value: 76, tone: "warn" as const },
  { label: "Cost Variance",     value: 91, tone: "good" as const },
  { label: "Pipeline Velocity", value: 54, tone: "bad"  as const },
  { label: "Forecast Accuracy", value: 79, tone: "warn" as const },
  { label: "Risk Burndown",     value: 88, tone: "good" as const },
];

export const valueColor = (v: number) =>
  v < 60 ? "#DC2626" : v < 80 ? "#B45309" : "#15803D";
export const barColor = (v: number) =>
  v >= 80 ? BRAND.green : BRAND.orange;

export type Section = "home" | "projects" | "both";
export function useSection(): Section {
  if (typeof window === "undefined") return "both";
  const s = new URLSearchParams(window.location.search).get("section");
  return s === "home" || s === "projects" ? s : "both";
}
