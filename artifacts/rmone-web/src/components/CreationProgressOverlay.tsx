import { Check, CheckCircle2, FileText, Loader2, Sparkles, Users } from "lucide-react";

type CreationProgressOverlayProps = {
  entity: "project" | "opportunity";
  step: string;
  pct: number;
};

type ProgressStage = {
  label: string;
  icon: typeof FileText;
  threshold: number;
};

function getStages(entity: CreationProgressOverlayProps["entity"]): ProgressStage[] {
  return entity === "project"
    ? [
        { label: "Record", icon: FileText, threshold: 8 },
        { label: "Details", icon: Sparkles, threshold: 76 },
        { label: "Workspace", icon: Users, threshold: 85 },
        { label: "Ready", icon: CheckCircle2, threshold: 100 },
      ]
    : [
        { label: "Record", icon: FileText, threshold: 8 },
        { label: "Details", icon: Sparkles, threshold: 76 },
        { label: "Workspace", icon: Users, threshold: 90 },
        { label: "Ready", icon: CheckCircle2, threshold: 100 },
      ];
}

function getSupportText(entity: CreationProgressOverlayProps["entity"], step: string): string {
  const lower = step.toLowerCase();
  if (lower.includes("team") || lower.includes("member")) {
    return "Setting up the people and roles connected to this record.";
  }
  if (lower.includes("schedule") || lower.includes("phase")) {
    return "Preparing the schedule so the record is ready to use.";
  }
  if (lower.includes("detail")) {
    return "Applying the information you entered and checking the record.";
  }
  if (lower.includes("convert")) {
    return "Linking the original record and carrying its information across.";
  }
  if (lower.includes("ready")) {
    return `Your ${entity} workspace is ready to open.`;
  }
  return `Building your ${entity} workspace with the information you provided.`;
}

export default function CreationProgressOverlay({ entity, step, pct }: CreationProgressOverlayProps) {
  const stages = getStages(entity);
  const safePct = Math.min(100, Math.max(0, pct));
  const activeStage = stages.reduce((current, stage, index) =>
    safePct >= stage.threshold ? index : current, 0);
  const currentStep = step || `Creating ${entity}…`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      style={{
        background: "rgba(248, 250, 252, 0.82)",
        backdropFilter: "blur(9px)",
      }}
      role="status"
      aria-live="polite"
      aria-label={`Creating ${entity}`}
    >
      <div
        className="w-full max-w-[430px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.16)]"
      >
        <div
          className="h-1.5"
          style={{
            background: "linear-gradient(90deg, #6da834, #9aca52, #d5eaa9)",
            width: `${Math.max(16, safePct)}%`,
            transition: "width 500ms ease-out",
          }}
        />
        <div className="px-7 pb-7 pt-6 sm:px-8">
          <div className="mb-6 flex items-start gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
              style={{
                color: "#5f962d",
                background: "linear-gradient(145deg, #eff8e6, #dcefc8)",
                boxShadow: "inset 0 0 0 1px rgba(95,150,45,0.12)",
              }}
            >
              {safePct >= 100
                ? <CheckCircle2 className="h-6 w-6" />
                : <Loader2 className="h-6 w-6 animate-spin" />}
            </div>
            <div className="min-w-0 pt-0.5">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                RM ONE · Operational Intelligence
              </div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                {safePct >= 100 ? `${entity === "project" ? "Project" : "Opportunity"} created` : `Creating your ${entity}`}
              </h2>
              <p className="mt-1 text-sm leading-5 text-slate-500">{getSupportText(entity, currentStep)}</p>
            </div>
          </div>

          <div className="mb-5 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7fb844] opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#6da834]" />
                </span>
                <span className="truncate">{currentStep}</span>
              </div>
              <span className="shrink-0 text-xs font-bold tabular-nums text-[#679d32]">
                {Math.round(safePct)}%
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200/80">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${safePct}%`,
                  background: "linear-gradient(90deg, #679d32, #93c94c)",
                  transition: "width 500ms ease-out",
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {stages.map((stage, index) => {
              const complete = safePct >= stage.threshold;
              const active = index === activeStage && !complete;
              const Icon = stage.icon;
              return (
                <div key={stage.label} className="flex min-w-0 flex-col items-center gap-1.5">
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-full border"
                    style={{
                      borderColor: complete || active ? "#8fc45b" : "#e2e8f0",
                      background: complete ? "#eaf6df" : active ? "#f5faef" : "#fff",
                      color: complete || active ? "#679d32" : "#94a3b8",
                    }}
                  >
                    {complete ? <Check className="h-3.5 w-3.5" /> : <Icon className={`h-3.5 w-3.5 ${active ? "animate-pulse" : ""}`} />}
                  </div>
                  <span
                    className="truncate text-[10px] font-semibold"
                    style={{ color: complete || active ? "#679d32" : "#94a3b8" }}
                  >
                    {stage.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}