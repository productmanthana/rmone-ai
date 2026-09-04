import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authHeaders } from "@/lib/api";
import {
  RefreshCw, ChevronRight, ChevronDown, Search, FileCode2,
  Package, ArrowRight, Loader2, AlertTriangle, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const API = "/api/codebase-graph";

interface GraphFile {
  path: string;
  sizeBytes: number;
  exports: string[];
  imports: string[];
}

interface GraphPackage {
  name: string;
  root: string;
  totalFiles: number;
  totalSizeBytes: number;
  files: GraphFile[];
}

interface CrossImport {
  from: string;
  to: string;
  count: number;
}

interface GraphData {
  generatedAt: string;
  packages: GraphPackage[];
  crossPackageImports: CrossImport[];
}

function fmtBytes(b: number): string {
  if (b >= 1_048_576) return (b / 1_048_576).toFixed(1) + " MB";
  if (b >= 1_024)     return (b / 1_024).toFixed(0) + " KB";
  return b + " B";
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch { return iso; }
}

const PKG_COLORS: Record<string, { bg: string; border: string; dot: string }> = {
  "@workspace/api-server":    { bg: "#eff6ff", border: "#3b82f6", dot: "#3b82f6" },
  "@workspace/rmone-web":     { bg: "#f0fdf4", border: "#22c55e", dot: "#22c55e" },
  "@workspace/rmone-mobile":  { bg: "#faf5ff", border: "#a855f7", dot: "#a855f7" },
  "@workspace/db":            { bg: "#fff7ed", border: "#f97316", dot: "#f97316" },
  "@workspace/rmone-features":{ bg: "#fef9c3", border: "#eab308", dot: "#eab308" },
  "@workspace/mockup-sandbox":{ bg: "#f0fdfa", border: "#14b8a6", dot: "#14b8a6" },
  "@workspace/codebase-graph":{ bg: "#fdf2f8", border: "#ec4899", dot: "#ec4899" },
  "@workspace/health":        { bg: "#f1f5f9", border: "#64748b", dot: "#64748b" },
  "@workspace/api-zod":       { bg: "#fff1f2", border: "#f43f5e", dot: "#f43f5e" },
};

const FALLBACK_COLOR = { bg: "#f8fafc", border: "#94a3b8", dot: "#94a3b8" };

function pkgColor(name: string) {
  return PKG_COLORS[name] ?? FALLBACK_COLOR;
}

function shortName(name: string) {
  return name.replace("@workspace/", "");
}

function relPath(full: string) {
  return full.replace(/^artifacts\/[^/]+\//, "").replace(/^[^/]+\//, "");
}

function FileRow({ file, pkg }: { file: GraphFile; pkg: GraphPackage }) {
  const [open, setOpen] = useState(false);
  const col = pkgColor(pkg.name);
  const hasDetail = file.exports.length > 0 || file.imports.filter(i => i.startsWith(".")).length > 0;
  return (
    <div className="border rounded" style={{ borderColor: "var(--rm-panel-border)" }}>
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 transition-colors rounded"
        onClick={() => hasDetail && setOpen(o => !o)}
        style={{ cursor: hasDetail ? "pointer" : "default" }}
      >
        {hasDetail
          ? (open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: col.dot }} /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: col.dot }} />)
          : <FileCode2 className="w-3.5 h-3.5 shrink-0" style={{ color: col.dot }} />
        }
        <span className="flex-1 font-mono truncate" style={{ color: "var(--rm-fg)" }}>{relPath(file.path)}</span>
        <span className="text-xs shrink-0" style={{ color: "var(--rm-muted)" }}>{fmtBytes(file.sizeBytes)}</span>
      </button>
      {open && hasDetail && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t" style={{ borderColor: "var(--rm-panel-border)" }}>
          {file.exports.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-1" style={{ color: "var(--rm-muted)" }}>Exports</p>
              <div className="flex flex-wrap gap-1">
                {file.exports.map(e => (
                  <span key={e} className="px-1.5 py-0.5 rounded text-xs font-mono" style={{ background: col.bg, color: col.border, border: `1px solid ${col.border}44` }}>{e}</span>
                ))}
              </div>
            </div>
          )}
          {file.imports.filter(i => i.startsWith(".")).length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-1" style={{ color: "var(--rm-muted)" }}>Local imports</p>
              <div className="flex flex-wrap gap-1">
                {file.imports.filter(i => i.startsWith(".")).map(i => (
                  <span key={i} className="px-1.5 py-0.5 rounded text-xs font-mono" style={{ background: "var(--rm-panel-bg)", color: "var(--rm-muted)", border: "1px solid var(--rm-panel-border)" }}>{i}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PackageCard({ pkg, onClick, isSelected }: { pkg: GraphPackage; onClick: () => void; isSelected: boolean }) {
  const col = pkgColor(pkg.name);
  return (
    <button
      onClick={onClick}
      className="rounded-xl p-4 text-left transition-all w-full"
      style={{
        background: isSelected ? col.bg : "var(--rm-panel-bg)",
        border: `2px solid ${isSelected ? col.border : "var(--rm-panel-border)"}`,
        boxShadow: isSelected ? `0 0 0 3px ${col.border}33` : undefined,
      }}
    >
      <div className="flex items-start gap-2 mb-3">
        <div className="w-2.5 h-2.5 rounded-full mt-0.5 shrink-0" style={{ background: col.dot }} />
        <span className="text-sm font-bold leading-tight break-all" style={{ color: "var(--rm-fg)" }}>{shortName(pkg.name)}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-center">
          <p className="text-xl font-bold tabular-nums" style={{ color: col.border }}>{pkg.totalFiles}</p>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--rm-muted)" }}>files</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-bold tabular-nums" style={{ color: col.border }}>{fmtBytes(pkg.totalSizeBytes)}</p>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--rm-muted)" }}>size</p>
        </div>
      </div>
    </button>
  );
}

function DependencyMap({ imports, packages }: { imports: CrossImport[]; packages: GraphPackage[] }) {
  if (!imports.length) {
    return (
      <p className="text-sm py-4 text-center" style={{ color: "var(--rm-muted)" }}>No cross-package imports detected</p>
    );
  }

  const grouped = useMemo(() => {
    const map: Record<string, { to: string; count: number }[]> = {};
    for (const ci of imports) {
      if (!map[ci.from]) map[ci.from] = [];
      map[ci.from].push({ to: ci.to, count: ci.count });
    }
    return map;
  }, [imports]);

  return (
    <div className="space-y-3">
      {Object.entries(grouped).map(([from, targets]) => (
        <div key={from} className="rounded-lg p-3" style={{ background: "var(--rm-panel-bg)", border: "1px solid var(--rm-panel-border)" }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold px-2 py-1 rounded" style={{ background: pkgColor(from).bg, color: pkgColor(from).border, border: `1px solid ${pkgColor(from).border}55` }}>
              {shortName(from)}
            </span>
            <ArrowRight className="w-4 h-4 shrink-0" style={{ color: "var(--rm-muted)" }} />
            <div className="flex flex-wrap gap-2">
              {targets.map(t => (
                <div key={t.to} className="flex items-center gap-1">
                  <span className="text-xs font-bold px-2 py-1 rounded" style={{ background: pkgColor(t.to).bg, color: pkgColor(t.to).border, border: `1px solid ${pkgColor(t.to).border}55` }}>
                    {shortName(t.to)}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--rm-panel-border)", color: "var(--rm-muted)" }}>
                    {t.count} file{t.count !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FileDrillDown({ pkg, onClose }: { pkg: GraphPackage; onClose: () => void }) {
  const [q, setQ] = useState("");
  const col = pkgColor(pkg.name);

  const filtered = useMemo(() => {
    if (!q.trim()) return pkg.files;
    const lq = q.toLowerCase();
    return pkg.files.filter(f => f.path.toLowerCase().includes(lq));
  }, [pkg, q]);

  return (
    <div className="rounded-xl flex flex-col" style={{ background: "var(--rm-panel-bg)", border: `2px solid ${col.border}`, maxHeight: 520 }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0" style={{ borderColor: "var(--rm-panel-border)" }}>
        <div className="w-2 h-2 rounded-full" style={{ background: col.dot }} />
        <span className="font-bold text-sm" style={{ color: "var(--rm-fg)" }}>{shortName(pkg.name)}</span>
        <span className="text-xs" style={{ color: "var(--rm-muted)" }}>— {pkg.totalFiles} files · {fmtBytes(pkg.totalSizeBytes)}</span>
        <div className="flex-1" />
        <button onClick={onClose} className="p-1 rounded hover:bg-black/10" title="Close">
          <X className="w-4 h-4" style={{ color: "var(--rm-muted)" }} />
        </button>
      </div>
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: "var(--rm-muted)" }} />
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Filter files…"
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg outline-none"
            style={{ background: "var(--rm-panel-bg)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-fg)" }}
          />
        </div>
        {q && (
          <p className="text-xs mt-1" style={{ color: "var(--rm-muted)" }}>{filtered.length} of {pkg.totalFiles} files</p>
        )}
      </div>
      <div className="px-4 pb-4 overflow-y-auto space-y-1.5">
        {filtered.map(f => <FileRow key={f.path} file={f} pkg={pkg} />)}
        {!filtered.length && (
          <p className="text-sm py-4 text-center" style={{ color: "var(--rm-muted)" }}>No files match "{q}"</p>
        )}
      </div>
    </div>
  );
}

export function CodebaseGraphPanel() {
  const qc = useQueryClient();
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<GraphData>({
    queryKey: ["codebase-graph"],
    queryFn: () => fetch(`${API}/data`, { headers: authHeaders() }).then(r => r.json()),
    staleTime: 5 * 60_000,
  });

  const regen = useMutation({
    mutationFn: () => fetch(`${API}/regenerate`, { method: "POST", headers: authHeaders() }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["codebase-graph"] }),
  });

  const openPkg = data?.packages.find(p => p.name === selectedPkg) ?? null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 gap-2" style={{ color: "var(--rm-muted)" }}>
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading graph…</span>
      </div>
    );
  }

  if (isError || (data as any)?.error) {
    return (
      <div className="rounded-xl p-8 text-center" style={{ background: "var(--rm-panel-bg)", border: "1px solid var(--rm-panel-border)" }}>
        <AlertTriangle className="w-8 h-8 mx-auto mb-3" style={{ color: "#f59e0b" }} />
        <p className="text-sm font-medium mb-1" style={{ color: "var(--rm-fg)" }}>Graph not available</p>
        <p className="text-xs mb-4" style={{ color: "var(--rm-muted)" }}>{(data as any)?.error ?? "Could not load graph data"}</p>
        <Button size="sm" variant="outline" onClick={() => regen.mutate()} disabled={regen.isPending}>
          {regen.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Generate now
        </Button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--rm-muted)" }}>Codebase Graph</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--rm-muted)" }}>
            {data.packages.length} packages · {data.packages.reduce((s, p) => s + p.totalFiles, 0)} files · generated {fmtDate(data.generatedAt)}
          </p>
        </div>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          onClick={() => regen.mutate()}
          disabled={regen.isPending}
          title="Re-scan workspace and rebuild graph"
        >
          {regen.isPending
            ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
          Regenerate
        </Button>
      </div>

      {/* Package grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {data.packages.map(pkg => (
          <PackageCard
            key={pkg.name}
            pkg={pkg}
            isSelected={selectedPkg === pkg.name}
            onClick={() => setSelectedPkg(prev => prev === pkg.name ? null : pkg.name)}
          />
        ))}
      </div>

      {/* File drill-down (appears when a card is selected) */}
      {openPkg && (
        <FileDrillDown pkg={openPkg} onClose={() => setSelectedPkg(null)} />
      )}

      {/* Dependency map */}
      <div className="rounded-xl p-5" style={{ background: "var(--rm-panel-bg)", border: "1px solid var(--rm-panel-border)" }}>
        <div className="flex items-center gap-2 mb-4">
          <Package className="w-4 h-4" style={{ color: "#6BA539" }} />
          <span className="text-sm font-bold" style={{ color: "var(--rm-fg)" }}>Cross-Package Dependencies</span>
          <span className="text-xs" style={{ color: "var(--rm-muted)" }}>({data.crossPackageImports.length} links)</span>
        </div>
        <DependencyMap imports={data.crossPackageImports} packages={data.packages} />

        {/* Cross-package import summary table */}
        {data.crossPackageImports.length > 0 && (
          <div className="mt-4 rounded-lg overflow-hidden" style={{ border: "1px solid var(--rm-panel-border)" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "var(--rm-panel-bg)" }}>
                  <th className="text-left px-3 py-2 font-semibold" style={{ color: "var(--rm-muted)" }}>From</th>
                  <th className="px-2 py-2" />
                  <th className="text-left px-3 py-2 font-semibold" style={{ color: "var(--rm-muted)" }}>To</th>
                  <th className="text-right px-3 py-2 font-semibold" style={{ color: "var(--rm-muted)" }}>Files</th>
                </tr>
              </thead>
              <tbody>
                {data.crossPackageImports.map((ci, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--rm-panel-border)" }}>
                    <td className="px-3 py-2">
                      <span className="font-bold px-1.5 py-0.5 rounded" style={{ background: pkgColor(ci.from).bg, color: pkgColor(ci.from).border }}>{shortName(ci.from)}</span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <ArrowRight className="w-3 h-3 inline" style={{ color: "var(--rm-muted)" }} />
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-bold px-1.5 py-0.5 rounded" style={{ background: pkgColor(ci.to).bg, color: pkgColor(ci.to).border }}>{shortName(ci.to)}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--rm-fg)" }}>{ci.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
