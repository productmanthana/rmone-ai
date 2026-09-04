/**
 * ImportWizardOverlay — full-screen wizard shell for the import upload flow.
 *
 * Replaces the chain of individual popup modals (column audit → review matches
 * → fix issues → new groups) with one consistent page-like experience:
 *   • opaque full-page background (not a semi-transparent modal backdrop)
 *   • numbered step pills at the top showing which stage you're in
 *   • slide animation between steps (right → left for forward, left → right for back)
 *   • a Back button on every step except the first
 *   • a locked "Processing" state that blocks browser back navigation
 */
import { useEffect, useRef } from "react";
import { ArrowLeft, FileUp } from "lucide-react";
import { Z } from "@/lib/zLayers";

export interface WizardStepDef {
  num: number;
  label: string;
}

interface Props {
  open: boolean;
  /** All steps in this run (computed dynamically; shown as pills). */
  steps: WizardStepDef[];
  /** 1-based current step number. */
  currentStep: number;
  /** Large headline rendered above children. */
  title: string;
  /** Small subheading below the title. */
  subtitle?: string;
  /** Called when Back is clicked. Absent → no Back button shown. */
  onBack?: () => void;
  /**
   * When true (processing / uploading): hides the Back button and adds a
   * `beforeunload` + `popstate` blocker so the user cannot accidentally
   * leave while the upload is in flight.
   */
  locked?: boolean;
  /** Max width (px) of the headline + step content column. Default 800. */
  contentMaxWidth?: number;
  children: React.ReactNode;
}

let _cssInjected = false;
function ensureCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    @keyframes iwz-in-right  { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: none; } }
    @keyframes iwz-in-left   { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: none; } }
    @keyframes iwz-fade-in   { from { opacity: 0; } to { opacity: 1; } }
    @keyframes iwz-dot-flow  { from { background-position-x: 0; } to { background-position-x: 10px; } }
    .iwz-slide-right { animation: iwz-in-right 0.22s cubic-bezier(0.22,1,0.36,1) both; }
    .iwz-slide-left  { animation: iwz-in-left  0.22s cubic-bezier(0.22,1,0.36,1) both; }
    .iwz-fade        { animation: iwz-fade-in  0.18s ease both; }
  `;
  document.head.appendChild(s);
}

export function ImportWizardOverlay({
  open, steps, currentStep, title, subtitle, onBack, locked, children,
  contentMaxWidth = 800,
}: Props) {
  ensureCSS();

  // Track direction for slide animation.
  const prevStepRef = useRef(currentStep);
  const dirClass = currentStep > prevStepRef.current ? "iwz-slide-right" : "iwz-slide-left";
  useEffect(() => { prevStepRef.current = currentStep; }, [currentStep]);

  // Block accidental navigation when processing.
  useEffect(() => {
    if (!locked) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onPop = (e: PopStateEvent) => {
      e.preventDefault();
      // Push a new state so the user is stuck on this "page".
      history.pushState(null, "", location.href);
    };
    window.addEventListener("beforeunload", onBefore);
    window.addEventListener("popstate", onPop);
    history.pushState(null, "", location.href);
    return () => {
      window.removeEventListener("beforeunload", onBefore);
      window.removeEventListener("popstate", onPop);
    };
  }, [locked]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: Z.GRID_POPUP,
        background: "hsl(var(--background))",
        display: "flex", flexDirection: "column",
        overflowY: "auto",
      }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div style={{
        borderBottom: "1px solid hsl(var(--border))",
        padding: "12px 24px",
        display: "flex", alignItems: "center", gap: 14,
        flexShrink: 0,
        background: "hsl(var(--background))",
        position: "sticky", top: 0, zIndex: 1,
      }}>
        {/* Back button */}
        {onBack && !locked ? (
          <button
            type="button"
            onClick={onBack}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 12px", borderRadius: 8,
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--muted) / 0.4)",
              fontSize: 12.5, fontWeight: 600,
              color: "hsl(var(--foreground))",
              cursor: "pointer", flexShrink: 0,
            }}
          >
            <ArrowLeft style={{ width: 13, height: 13 }} />
            Back
          </button>
        ) : (
          <div style={{ width: 84, flexShrink: 0 }} />
        )}

        {/* Step strip — full-width bordered container matching the workflow
            stages card: numbered chips joined by animated flowing-dot
            connectors that stretch to fill the whole row equally. */}
        <div style={{
          flex: 1, minWidth: 0,
          display: "flex", alignItems: "center",
          padding: "7px 12px",
          borderRadius: 12,
          background: "hsl(var(--muted) / 0.4)",
          border: "1px solid hsl(var(--border))",
          overflowX: "auto",
        }}>
          {steps.flatMap((s, i) => {
            const done   = s.num < currentStep;
            const active = s.num === currentStep;
            const future = s.num > currentStep;
            const chip = (
              <div key={`chip-${s.num}`} style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "4px 11px 4px 5px", borderRadius: 999, flexShrink: 0,
                background: active ? "hsl(var(--primary) / 0.08)" : "hsl(var(--background))",
                border: `1px solid ${active ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
                opacity: future ? 0.55 : 1,
                transition: "background 0.3s, border-color 0.3s, opacity 0.3s",
              }}>
                <span style={{
                  width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10.5, fontWeight: 800,
                  background: future ? "hsl(var(--muted))" : "hsl(var(--primary))",
                  color: future ? "hsl(var(--muted-foreground))" : "hsl(var(--primary-foreground))",
                  transition: "background 0.3s, color 0.3s",
                }}>
                  {done ? "✓" : s.num}
                </span>
                <span style={{
                  fontSize: 12, fontWeight: active ? 700 : 600, whiteSpace: "nowrap",
                  color: future ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                }}>
                  {s.label}
                </span>
              </div>
            );
            if (i === 0) return [chip];
            // Continuous dotted line filling the whole gap (repeating dot
            // pattern) flowing left→right — same connector recipe as the
            // workflow stages card.
            const reached = s.num <= currentStep;
            const connector = (
              <span key={`conn-${s.num}`} style={{
                flex: 1, minWidth: 14, height: 4, alignSelf: "center", margin: "0 8px",
                backgroundImage: `radial-gradient(circle, ${reached ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.35)"} 1.5px, transparent 1.6px)`,
                backgroundSize: "10px 4px", backgroundRepeat: "repeat-x", backgroundPosition: "0 center",
                animation: "iwz-dot-flow 0.9s linear infinite",
              }} />
            );
            return [connector, chip];
          })}
        </div>

        {/* Right: import label */}
        <div style={{
          display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
          color: "hsl(var(--muted-foreground))", fontSize: 12, fontWeight: 600,
          width: 84, justifyContent: "flex-end",
        }}>
          <FileUp style={{ width: 14, height: 14 }} />
          Import
        </div>
      </div>

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div
        key={currentStep}
        className={dirClass}
        style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", padding: "32px 24px 48px",
          minHeight: 0,
        }}
      >
        {/* Headline */}
        <div style={{ width: "100%", maxWidth: contentMaxWidth, marginBottom: 24 }}>
          <h1 style={{
            fontSize: 22, fontWeight: 800,
            color: "hsl(var(--foreground))",
            margin: 0, lineHeight: 1.25,
          }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{
              fontSize: 13, color: "hsl(var(--muted-foreground))",
              margin: "6px 0 0", lineHeight: 1.5,
            }}>
              {subtitle}
            </p>
          )}
        </div>

        {/* Step content */}
        <div style={{ width: "100%", maxWidth: contentMaxWidth }}>
          {children}
        </div>
      </div>
    </div>
  );
}
