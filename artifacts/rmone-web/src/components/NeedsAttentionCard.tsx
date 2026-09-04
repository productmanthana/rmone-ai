// NeedsAttentionCard — the "Needs your attention" review queue: spellings /
// project references an upload refused to guess about, held back for one
// explicit answer. Extracted from onboarding-status.tsx so BOTH the status
// page and the import wizard's finished panel (ImportRunPanel) show it —
// previously the wizard flow ended with no hint that rows were held.
//
// Two exports:
//  - NeedsAttentionCard: presentational card (items + callbacks supplied).
//  - NeedsAttentionInline: self-contained wrapper that owns the fetch +
//    resolve lifecycle against /api/onboarding/review. Drop it anywhere.
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Building2, Check, FolderKanban, Loader2, Plus, UserPlus, Users, X } from "lucide-react";
import { authHeaders } from "@/lib/api";

const API = "/api/onboarding";

export interface ReviewSuggestion { key: string; label: string; detail?: string | null; }
export interface ReviewItem {
  id:           number;
  uploadId?:    string | null;
  kind:         string; // 'person-match' | 'project-ref' | 'project-collision' | 'company-ref'
  rowKey:       string;
  displayLabel: string | null;
  reason:       string | null;
  suggestions:  ReviewSuggestion[];
  rowCount:     number;
  sheetName:    string | null;
  status:       string;
}

// "Needs your attention" — quarantined spellings the upload refused to guess
// about. Answer once; the choice is remembered for every future upload.
export function NeedsAttentionCard({
  items, busyId, justResolved, onAction,
}: {
  items: ReviewItem[];
  busyId: number | null;
  justResolved: number;
  onAction: (item: ReviewItem, action: string, targetKey?: string, targetLabel?: string) => void;
}) {
  if (!items.length && !justResolved) return null;
  return (
    <Card className="border-amber-500/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-amber-600 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Needs your attention{items.length ? ` (${items.length})` : ""}
        </CardTitle>
        <CardDescription>
          These didn't match anything exactly, so their rows were <strong>held back</strong> —
          nothing was guessed, nothing was removed. Answer once and RM ONE remembers
          your choice for every future upload.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {justResolved > 0 && (
          <div className="text-xs rounded border border-green-500/30 bg-green-500/5 text-green-600 px-3 py-2">
            Saved. To bring in the held-back rows, upload the same file again — your
            answers are applied automatically.
          </div>
        )}
        {items.map(it => {
          const busy = busyId === it.id;
          const isPerson = it.kind === "person-match";
          const isCollision = it.kind === "project-collision";
          const isCompany = it.kind === "company-ref";
          const Icon = isPerson ? Users : isCompany ? Building2 : FolderKanban;
          return (
            <div key={it.id} className="rounded border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Icon className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-sm font-medium break-all">{it.displayLabel || it.rowKey}</span>
                <Badge variant="outline" className="border-amber-500/50 text-amber-600 text-[10px]">
                  {isPerson ? "Person" : isCollision ? "Duplicate name" : isCompany ? "Company" : "Project"}
                </Badge>
                {it.rowCount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {it.rowCount} row{it.rowCount === 1 ? "" : "s"} held
                  </span>
                )}
              </div>
              {it.reason && <p className="text-xs text-muted-foreground">{it.reason}</p>}
              <div className="flex flex-wrap gap-1.5">
                {(it.suggestions ?? []).map((s, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-amber-500/40"
                    disabled={busy}
                    onClick={() => onAction(
                      it,
                      isPerson ? "merge-person" : isCompany ? "map-company" : "map-project",
                      s.key,
                      s.label,
                    )}
                  >
                    <Check className="w-3 h-3 mr-1" />
                    {isPerson ? `Same as ${s.label}` : isCollision ? `Belongs to ${s.detail || s.key}` : `It's ${s.label}`}
                    {!isCollision && s.detail ? <span className="text-muted-foreground ml-1">({s.detail})</span> : null}
                  </Button>
                ))}
                {isPerson && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy}
                    onClick={() => onAction(it, "new-person")}>
                    <UserPlus className="w-3 h-3 mr-1" /> Add as new person
                  </Button>
                )}
                {isCompany && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy}
                    onClick={() => onAction(it, "create-company")}>
                    <Plus className="w-3 h-3 mr-1" /> Create as new company
                  </Button>
                )}
                {!isPerson && !isCollision && !isCompany && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy}
                    onClick={() => onAction(it, "create-project")}>
                    <Plus className="w-3 h-3 mr-1" /> Create as new project
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" disabled={busy}
                  onClick={() => onAction(it, "dismiss")}>
                  <X className="w-3 h-3 mr-1" /> Skip for now
                </Button>
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600 mt-1.5" />}
              </div>
            </div>
          );
        })}
        {items.length === 0 && justResolved > 0 && (
          <p className="text-xs text-muted-foreground">All questions answered.</p>
        )}
      </CardContent>
    </Card>
  );
}

// Self-contained fetch + resolve wrapper. Shows ALL open review items for the
// tenant (not just this upload's) on purpose: a re-upload can merge held rows
// into an item created by an earlier upload, so filtering by uploadId would
// hide exactly the row the user is looking for. Renders nothing while there
// is nothing to show (fail-quiet — non-admins simply see no card).
export function NeedsAttentionInline() {
  const [items, setItems]               = useState<ReviewItem[]>([]);
  const [busyId, setBusyId]             = useState<number | null>(null);
  const [justResolved, setJustResolved] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/review?status=open`, { headers: authHeaders() as Record<string, string> });
      if (!res.ok) return;
      const j = await res.json();
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch { /* fail-quiet */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onAction = useCallback(async (item: ReviewItem, action: string, targetKey?: string, targetLabel?: string) => {
    setBusyId(item.id);
    try {
      const res = await fetch(`${API}/review/${item.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authHeaders() as Record<string, string>) },
        body: JSON.stringify({ action, targetKey, targetLabel }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { error?: string }));
        // 409 = already handled elsewhere — just refresh the list silently.
        if (res.status !== 409) alert(j?.error || "Could not save this decision — please try again.");
      } else if (action !== "dismiss") {
        setJustResolved(n => n + 1);
      }
      await load();
    } catch {
      alert("Could not save this decision — please try again.");
    } finally {
      setBusyId(null);
    }
  }, [load]);

  return (
    <NeedsAttentionCard
      items={items}
      busyId={busyId}
      justResolved={justResolved}
      onAction={onAction}
    />
  );
}
