import type { ChangeEvent, CSSProperties, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  BriefcaseBusiness,
  FileText,
  Flag,
  Search,
  SlidersHorizontal,
  Target,
  UserPlus,
} from "lucide-react";
import "./quick-actions-flow-landing.css";

type ActionNode = {
  id: string;
  title: string;
  desc: string;
  hint: string;
  icon: typeof Search;
  color: string;
};

/** What you can DO — displayed as non-clickable hint cards on the right rail. */
const ACTION_NODES: readonly ActionNode[] = [
  {
    id: "team",
    title: "Add a team member",
    desc: "Bring someone onto a project or opportunity.",
    hint: "Projects · Opportunities",
    icon: UserPlus,
    color: "#5E9637",
  },
  {
    id: "position",
    title: "Add open position",
    desc: "Reserve a role before the right person is found.",
    hint: "Projects · Opportunities",
    icon: BriefcaseBusiness,
    color: "#2879A8",
  },
  {
    id: "status",
    title: "Update a status",
    desc: "Advance the stage or override the current phase.",
    hint: "Projects · Opportunities · Leads",
    icon: Target,
    color: "#7C5CB4",
  },
  {
    id: "convert",
    title: "Convert",
    desc: "Move a lead to an opportunity, or a win into a project.",
    hint: "Lead → Opportunity · Opportunity → Project",
    icon: ArrowRightLeft,
    color: "#2D7DA9",
  },
  {
    id: "allocation",
    title: "Edit allocation",
    desc: "Adjust weekly hours for any team member inline.",
    hint: "Projects · Opportunities",
    icon: SlidersHorizontal,
    color: "#1A8A7C",
  },
  {
    id: "notes",
    title: "Notes & description",
    desc: "Update the working note or project description.",
    hint: "Projects · Opportunities · Leads",
    icon: FileText,
    color: "#B75B18",
  },
  {
    id: "close",
    title: "Close project",
    desc: "Mark as lost, cancelled, or complete.",
    hint: "Projects · Opportunities",
    icon: Flag,
    color: "#C74545",
  },
];

// Fallback canvas size until the first measurement. The SVG viewBox is set to
// the canvas's REAL pixel size (1 unit = 1 CSS px) — never a fixed box
// stretched with preserveAspectRatio="none". Stretching kept the geometry
// correct but scaled stroke widths, dot radii, and the glow blur with the
// window, so production windows with different proportions than the dev
// preview showed fat blurry ribbons and blown-up flow dots.
const VB_W = 1200;
const VB_H = 800;

// Fallback endpoints used until the card rail has been measured.
const DEFAULT_NODE_ENDS = [110, 194, 278, 390, 502, 586, 670];
const DEFAULT_END_X = 816;

const FLOW_DOT_CONFIG = ACTION_NODES.map((n, i) => ({
  pathId: `qaf-path-${n.id}`,
  color: n.color,
  delay: `${i * 0.55}s`,
}));

function buildPath(cx: number, cy: number, ex: number, endY: number): string {
  // Control-point insets are capped by the available horizontal span so the
  // curve never backtracks when the hub and card rail sit close together
  // (narrow two-column layouts). 0.45 + 0.52 < 1 keeps cp1x < cp2x.
  const span = Math.max(0, ex - cx);
  const cp1x = cx + Math.min(135, span * 0.45);
  const cp1y = cy;
  const cp2x = ex - Math.min(156, span * 0.52);
  const cp2y = endY;
  return `M ${cx} ${cy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${ex} ${endY}`;
}

export function QuickActionsFlowLanding({
  query,
  onQueryChange,
  onClear,
  searchLoading,
  inputRef,
  results,
}: {
  query: string;
  onQueryChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  searchLoading: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  results?: ReactNode;
}) {
  const canvasRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState({ cx: 515, cy: 400 });
  const [box, setBox] = useState({ w: VB_W, h: VB_H });
  const [ends, setEnds] = useState<{ ys: number[]; ex: number }>({
    ys: DEFAULT_NODE_ENDS,
    ex: DEFAULT_END_X,
  });

  useEffect(() => {
    const measure = () => {
      const canvas = canvasRef.current;
      const search = searchRef.current;
      const rail = railRef.current;
      if (!canvas || !search || !rail) return;
      const cr = canvas.getBoundingClientRect();
      const sr = search.getBoundingClientRect();
      if (cr.width === 0 || cr.height === 0) return;

      // All coordinates below are plain CSS pixels inside the canvas — the
      // viewBox matches the canvas size, so nothing is ever stretched.
      setBox({ w: Math.round(cr.width), h: Math.round(cr.height) });

      const searchCenterPx = sr.top + sr.height / 2 - cr.top;
      setOrigin({ cx: Math.round(sr.right - cr.left), cy: Math.round(searchCenterPx) });

      // Stacked layout hides the lines — skip endpoint calculation.
      if (window.matchMedia("(max-width: 1120px)").matches) return;

      const cards = Array.from(rail.children) as HTMLElement[];
      if (cards.length === 0) return;

      const cardCenters = cards.map((card) => {
        const r = card.getBoundingClientRect();
        return r.top + r.height / 2 - cr.top;
      });

      const railLeftPx = rail.getBoundingClientRect().left - cr.left;
      setEnds({
        ys: cardCenters.map((c) => Math.round(c)),
        ex: Math.round(railLeftPx + 4),
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    if (canvasRef.current) ro.observe(canvasRef.current);
    if (searchRef.current) ro.observe(searchRef.current);
    if (railRef.current) ro.observe(railRef.current);
    return () => ro.disconnect();
  }, []);

  const { cx, cy } = origin;

  return (
    <section className="qaf-canvas" aria-label="Quick Actions command center" ref={canvasRef}>
      <div className="qaf-cross qaf-cross--one" aria-hidden="true">+</div>
      <div className="qaf-cross qaf-cross--two" aria-hidden="true">+</div>
      <div className="qaf-cross qaf-cross--three" aria-hidden="true">+</div>

      <svg
        className="qaf-lines"
        viewBox={`0 0 ${box.w} ${box.h}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <filter id="qaf-soft-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>

        {ACTION_NODES.map((node, i) => {
          const d = buildPath(cx, cy, ends.ex, ends.ys[i] ?? cy);
          const pathId = `qaf-path-${node.id}`;
          return (
            <g key={node.id}>
              <path
                className="qaf-ribbon"
                style={{ "--qaf-node": node.color } as CSSProperties}
                d={d}
              />
              <path
                className="qaf-ribbon-core"
                style={{ "--qaf-node": node.color } as CSSProperties}
                id={pathId}
                d={d}
              />
            </g>
          );
        })}

        <g className="qaf-hub-dot">
          <circle cx={cx} cy={cy} r="15" />
          <circle cx={cx} cy={cy} r="5" />
        </g>

        {FLOW_DOT_CONFIG.map(({ pathId, color, delay }) => (
          <circle key={pathId} className="qaf-flow-dot" r="4.5" fill={color}>
            <animate attributeName="opacity" values="0;0;1;1;0" dur="4.4s" begin={delay} repeatCount="indefinite" />
            <animateMotion dur="4.4s" begin={delay} repeatCount="indefinite">
              <mpath href={`#${pathId}`} />
            </animateMotion>
          </circle>
        ))}
      </svg>

      <div className="qaf-workspace">
        <div className="qaf-hub">
          {/* Text sits just above the search bar; flex-end pushes it to bottom of top half */}
          <div className="qaf-hub-above">
            <p className="qaf-eyebrow">Quick Actions · Ready · One Click Action</p>
            <h1>
              Search, select,
              <em> and act.</em>
            </h1>
            <p className="qaf-intro">
              Search projects, opportunities, leads, companies, and people — then take the next useful action.
            </p>
          </div>

          <div className="qaf-search-shell" ref={searchRef}>
            <div className="qaf-search">
              {searchLoading
                ? <span className="qaf-search-spinner" aria-label="Searching" />
                : <Search aria-hidden="true" />}
              <input
                ref={inputRef}
                value={query}
                onChange={onQueryChange}
                autoComplete="off"
                aria-label="Search records and staff"
                placeholder="Search by name, ID, client, or person…"
                data-testid="quick-actions-search"
              />
              {query && (
                <button type="button" className="qaf-clear" onClick={onClear} aria-label="Clear search">
                  Clear
                </button>
              )}
            </div>
            {results}
          </div>
          {/* Spacer: mirrors the text block above so search bar sits at vertical center */}
          <div className="qaf-hub-below" aria-hidden="true" />
        </div>

        {/* Non-clickable action hint rail */}
        <div
          className="qaf-node-rail"
          aria-hidden="true"
          ref={railRef}
        >
          {ACTION_NODES.map((node) => {
            const Icon = node.icon;
            return (
              <div
                key={node.id}
                className="qaf-node qaf-node--static"
                style={{ "--qaf-node": node.color } as CSSProperties}
              >
                <span className="qaf-node-icon">
                  <Icon aria-hidden="true" />
                </span>
                <span className="qaf-node-copy">
                  <strong>{node.title}</strong>
                  <span className="qaf-node-desc">{node.desc}</span>
                  <em>{node.hint}</em>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="qaf-calibration" aria-hidden="true">
        <span>Quick Actions</span>
        <span>Live workspace</span>
      </div>
    </section>
  );
}
