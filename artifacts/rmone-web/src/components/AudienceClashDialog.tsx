/**
 * Conflict popup shown at SAVE time when two audiences overlap — the same
 * person (directly or via a group) sits in two phase sets / stage sets, so
 * first-match-wins would silently give them the higher-priority list.
 *
 * Per clash row the admin can remove the covering id from EITHER side (a
 * form-state edit saved by the same Save press — or an immediate scope write
 * for stage sets), or keep both on purpose via "Save anyway". Clashes are
 * recomputed live by the parent, so rows disappear as they get resolved.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, UserRound, Users } from "lucide-react";
import type { AudienceClash } from "@/lib/audienceClash";

const MAX_ROWS = 8;

function ViaPhrase({ via }: { via: string | null }) {
  return via
    ? <> (via group &ldquo;<b>{via}</b>&rdquo;)</>
    : <> (picked directly)</>;
}

export function AudienceClashDialog({
  open, clashes, nounSingular, resolutionHint, onRemove, onContinue, onCancel, removalNote,
}: {
  open: boolean;
  clashes: AudienceClash[];
  /** "schedule" / "stage set" — used in copy. */
  nounSingular: string;
  /** One sentence explaining how ties are broken (shown under the title). */
  resolutionHint: string;
  onRemove: (clash: AudienceClash, side: "winner" | "loser") => void;
  /** Proceed with the save (either "Save anyway" or, once resolved, "Save now"). */
  onContinue: () => void;
  onCancel: () => void;
  /** Extra note under the remove buttons (e.g. stage-set removals apply immediately). */
  removalNote?: string;
}) {
  const shown = clashes.slice(0, MAX_ROWS);
  const extra = clashes.length - shown.length;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      {/* z-[11000]: must stack above the Save As… dialog (also 11000 — later
          mount wins the tie) AND above custom fixed openers like the audience
          popovers (z-10000); default z-50 hides it behind them → frozen look. */}
      <DialogContent className="z-[11000]" style={{ maxWidth: 620, maxHeight: "82vh", overflowY: "auto" }}>
        <DialogHeader>
          <DialogTitle style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15 }}>
            {clashes.length > 0
              ? <><AlertTriangle style={{ width: 16, height: 16, color: "#d97706" }} /> Same people in more than one {nounSingular}</>
              : <><CheckCircle2 style={{ width: 16, height: 16, color: "#16a34a" }} /> All overlaps resolved</>}
          </DialogTitle>
        </DialogHeader>

        <p style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))", margin: "0 0 12px", lineHeight: 1.55 }}>
          {clashes.length > 0
            ? <>Each row below is covered by two different {nounSingular} audiences. {resolutionHint} You can remove one side now, or keep both on purpose.</>
            : <>Every overlap has been removed — press <b>Save now</b> to apply your changes.</>}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shown.map((c, i) => (
            <div key={`${c.subjectKind}-${c.subjectName}-${c.winner.key}-${c.loser.key}-${i}`}
              style={{ border: "1px solid rgba(217,119,6,0.35)", background: "rgba(217,119,6,0.06)", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                {c.subjectKind === "person"
                  ? <UserRound style={{ width: 14, height: 14, color: "#92400e", flexShrink: 0, marginTop: 2 }} />
                  : <Users style={{ width: 14, height: 14, color: "#92400e", flexShrink: 0, marginTop: 2 }} />}
                <span style={{ fontSize: 12.5, color: "hsl(var(--foreground))", lineHeight: 1.55 }}>
                  {c.subjectKind === "person" ? (
                    <><b>{c.subjectName}</b> is in &ldquo;<b>{c.winner.label}</b>&rdquo;<ViaPhrase via={c.winnerViaName} /> and in &ldquo;<b>{c.loser.label}</b>&rdquo;<ViaPhrase via={c.loserViaName} />.{" "}
                      &ldquo;{c.winner.label}&rdquo; <b>wins</b> for them — it&rsquo;s checked first.</>
                  ) : c.subjectKind === "group" ? (
                    <>The whole group &ldquo;<b>{c.subjectName}</b>&rdquo; is in both &ldquo;<b>{c.winner.label}</b>&rdquo; and &ldquo;<b>{c.loser.label}</b>&rdquo;.{" "}
                      &ldquo;{c.winner.label}&rdquo; <b>wins</b> for everyone in it.</>
                  ) : (
                    <>The org unit audience &ldquo;<b>{c.subjectName}</b>&rdquo; is in both &ldquo;<b>{c.winner.label}</b>&rdquo; and &ldquo;<b>{c.loser.label}</b>&rdquo;.{" "}
                      &ldquo;{c.winner.label}&rdquo; <b>wins</b> for everyone in it.</>
                  )}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, marginLeft: 22 }}>
                {(["winner", "loser"] as const).map((side) => {
                  const entry = side === "winner" ? c.winner : c.loser;
                  const viaName = side === "winner" ? c.winnerViaName : c.loserViaName;
                  const what = viaName ? `group “${viaName}”` : c.subjectKind === "person" ? c.subjectName : c.subjectName;
                  return (
                    <Button key={side} variant="outline" size="sm" style={{ height: 26, fontSize: 11.5 }}
                      title={viaName
                        ? `Removes the whole group “${viaName}” from “${entry.label}” — affects everyone in that group.`
                        : `Removes ${c.subjectName} from “${entry.label}”.`}
                      onClick={() => onRemove(c, side)}>
                      Remove {what} from &ldquo;{entry.label}&rdquo;
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
          {extra > 0 && (
            <span style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))" }}>
              …and {extra} more overlap{extra === 1 ? "" : "s"} — resolving the ones above usually clears these too.
            </span>
          )}
        </div>

        {removalNote && clashes.length > 0 && (
          <p style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", margin: "10px 0 0", lineHeight: 1.5 }}>{removalNote}</p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          {clashes.length > 0 ? (() => {
            const winners = [...new Set(clashes.map(c => c.winner.label))];
            const winLabel = winners.length === 1
              ? `"${winners[0]}" wins`
              : `${winners.slice(0, 2).map(w => `"${w}"`).join(", ")} win`;
            return (
              <Button size="sm" variant="secondary" onClick={onContinue}>
                Save — {winLabel}
              </Button>
            );
          })()
            : <Button size="sm" onClick={onContinue}>Save now</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
