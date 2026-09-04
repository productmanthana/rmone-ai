/**
 * Decision-Support action endpoints.
 *
 * Each chip in the SITREP card (Apply / Defer / Engage / Open) calls into one
 * of these routes. Where RM ONE exposes a real write API we perform the actual
 * mutation against the user's tenant; where it does not, we send an audit
 * email and clearly say so in the response so the chip never claims a write
 * that didn't happen.
 *
 * Capability matrix (May 2026):
 *   Apply  → REAL  via POST /api/rmmapi/UpdateBatchCRMAllocations
 *   Defer  → REAL  via PUT  /api/module/UpdateRecord (TargetCompletionDate / CloseDate)
 *   Engage → AUDIT EMAIL ONLY (RM ONE SaveAllocation API not yet available)
 *   Open   → AUDIT EMAIL ONLY (no exposed CreateDemand path)
 *
 * Every response uses the uniform shape
 *   { ok: boolean, message: string, detail?: string }
 * which the mobile + web chip rows render directly.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { sendEmail } from "../lib/agentmail.js";
import { bustAllProjectCaches, blockIfReadOnly, blockIfStagePermissionDenied } from "./rmone-proxy.js";
import { insertDecisionAck, getDecisionAcks } from "@workspace/db";
import { getBusinessRulesForTenant } from "../lib/business-rules.js";
import { resolveRequestSource } from "../lib/rds-auth.js";
import { boundedAuditChanges, handoffTrustedAuditChanges, setAuditTarget, setTrustedAuditChanges } from "../lib/auditTrail.js";
import {
  getRecords,
  getRecordDetail,
  getResourceAllocations,
  updateRecordFieldsRds,
  reduceAllocationRds,
} from "../lib/rds-provider.js";

const router: IRouter = Router();

function recordEntityType(ticketId: string): string {
  const prefix = ticketId.trim().toUpperCase().match(/^[A-Z]{2,4}/)?.[0] ?? "";
  if (prefix === "PMM") return "project";
  if (prefix === "OPM") return "opportunity";
  if (prefix === "LEM" || prefix === "LD") return "lead";
  if (prefix === "COM") return "company";
  if (prefix === "CON") return "contact";
  return "record";
}

function getUsername(req: Request): string | undefined {
  const headerUser = req.header("x-username") || req.header("X-Username");
  if (headerUser) return String(headerUser);
  const bodyUser = (req.body as { username?: string } | undefined)?.username;
  return bodyUser ? String(bodyUser) : undefined;
}

function getBearer(req: Request): string {
  const h = req.headers.authorization ?? "";
  if (!h) return "";
  return h.startsWith("Bearer ") ? h : `Bearer ${h}`;
}

/** Best-effort audit email so every chip tap leaves a paper trail even when
 *  the RM ONE write succeeds. Never throws — failures are logged and ignored. */
async function sendAudit(opts: {
  to: string[]; subject: string; body: string; sentBy?: string;
}) {
  try {
    const r = await sendEmail({
      to: opts.to,
      subject: opts.subject,
      body: opts.body,
      sentBy: opts.sentBy,
      senderDisplayName: "RM ONE Decision Support",
    });
    return r.ok;
  } catch (e) {
    console.warn("[decision] audit email failed:", String(e));
    return false;
  }
}

/** People directory derived from GetResourceAllocations.
 *
 *  GetBenchAllocationData returns [] for our session under multiple body
 *  shapes, so we instead source the picker dropdowns from the same feed
 *  that already powers chat.ts/fetchResourceContext, /person-profile and
 *  the Resources page. We dedupe by name and pick the first non-empty
 *  title we see across each person's weekly allocation rows.
 *
 *  Cached for 60s per bearer to keep picker open snappy without sticking
 *  on stale data after sign-in.
 */
type ProjectMix = { projectId: string; projectName: string; pct: number };
type DirectoryRow = {
  Name: string; Email: string; UserName: string; Id: string;
  JobTitle: string; DivisionName: string; CurrentPct: number;
  Projects: ProjectMix[];
};
const __dirCache = new Map<string, { rows: DirectoryRow[]; expiresAt: number }>();
const DIR_CACHE_TTL = 60_000;
async function fetchResourceDirectory(tid: string, tenantLabel?: string): Promise<DirectoryRow[]> {
  const cached = __dirCache.get(tid);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  // RDS-only: source the people directory from core2 via getResourceAllocations,
  // which starts from the full AspNetUsers roster (every enabled user, bench
  // included) and carries each person's role (AspNetUsers.Title). Same feed the
  // Resources page / chat resource context use. Title coverage replaces the old
  // GetUserList upstream; AspNetUsers.UserName is email-formatted so we derive
  // Email from it when it looks like an address.
  let resources: Record<string, unknown>[] = [];
  try {
    const data = (await getResourceAllocations(tid, tenantLabel)) as { resources?: Record<string, unknown>[] };
    resources = Array.isArray(data.resources) ? data.resources : [];
  } catch (e) {
    console.log(`[directory] getResourceAllocations error: ${String(e)}`);
    return [];
  }
  const byName = new Map<string, DirectoryRow>();
  for (const u of resources) {
    const name = String(u.name ?? "").trim();
    if (!name) continue;
    const title = String(u.role ?? "").trim();
    const userName = String(u.username ?? "").trim();
    const id = String(u.id ?? "").trim();
    // currentPct = sum of this person's active-allocation pct from core2.
    const pctRaw = Number(u.currentPct ?? 0);
    const currentPct = Number.isFinite(pctRaw) ? Math.max(0, pctRaw) : 0;
    // AspNetUsers.UserName is usually email-formatted; only keep email-looking values.
    const email = /@/.test(userName) && /\./.test(userName) ? userName : "";
    // Active project mix from core2 (getResourceAllocations.activeAllocations).
    // Each entry is one currently-running allocation for this person.
    const allocsRaw = u.activeAllocations as unknown;
    const projects: ProjectMix[] = Array.isArray(allocsRaw)
      ? (allocsRaw as Record<string, unknown>[])
          .map((a) => ({
            projectId: String(a.projectId ?? "").trim(),
            projectName: String(a.projectName ?? "").trim(),
            pct: Math.round(Number(a.pct ?? 0) || 0),
          }))
          .filter((p) => p.projectId)
      : [];
    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, { Name: name, Email: email, UserName: userName, Id: id || name, JobTitle: title, DivisionName: "", CurrentPct: currentPct, Projects: projects });
    } else {
      if (!existing.JobTitle && title) existing.JobTitle = title;
      if (!existing.Email && email) existing.Email = email;
      if (!existing.UserName && userName) existing.UserName = userName;
      if ((!existing.Id || existing.Id === existing.Name) && id) existing.Id = id;
      // Duplicate name across user rows: keep the busier (higher) allocation,
      // and adopt that row's project mix so the % and projects stay consistent.
      if (currentPct > existing.CurrentPct) { existing.CurrentPct = currentPct; existing.Projects = projects; }
      else if (existing.Projects.length === 0 && projects.length > 0) existing.Projects = projects;
    }
  }
  const rows = Array.from(byName.values());
  console.log(`[directory] built ${rows.length} unique people from ${resources.length} RDS resources (titled=${rows.filter(r => r.JobTitle).length})`);
  __dirCache.set(tid, { rows, expiresAt: Date.now() + DIR_CACHE_TTL });
  return rows;
}

/* ── 1. APPLY: shift a person's allocation by N hours/week ─────────────────
 *
 * Reduces an existing allocation's PctAllocation. Hours/wk are converted
 * using a 40h work-week (the same convention RM ONE uses elsewhere). If the
 * person has multiple active allocations on the project the reduction is
 * taken off the largest one. If the requested reduction exceeds the current
 * pct the allocation is zeroed (not negated).
 */
router.post("/shift-allocation", async (req: Request, res: Response) => {
  const { personName, projectId, hoursPerWeek } = req.body as {
    personName?: string; projectId?: string; hoursPerWeek?: number;
  };
  if (!personName || !projectId || !hoursPerWeek) {
    res.status(400).json({ ok: false, message: "Missing personName, projectId, or hoursPerWeek." });
    return;
  }
  if (!Number.isFinite(hoursPerWeek) || hoursPerWeek <= 0) {
    res.status(400).json({ ok: false, message: "hoursPerWeek must be a positive number." });
    return;
  }
  const rds = resolveRequestSource(req);
  if (!rds) {
    res.status(401).json({ ok: false, message: "Not signed in." });
    return;
  }
  // #87: decision actions write tenant data — same edit gate as every other
  // write route (view-only built-ins AND custom levels without editData).
  if (await blockIfReadOnly(req, res)) return;
  const sentBy = getUsername(req);
  console.log(`[shift-allocation] in: personName="${personName}" projectId=${projectId} hoursPerWeek=${hoursPerWeek} by=${sentBy}`);

  try {
    // Reduce the person's largest active allocation on this project directly in
    // core2 (tenant-scoped UPDATE). Hours/wk → pct via the configured work week.
    const { workWeekHours } = await getBusinessRulesForTenant(rds.tenant);
    const reduceByPct = Math.min(100, (hoursPerWeek / workWeekHours) * 100);
    const result = await reduceAllocationRds(rds.tid, projectId, personName, reduceByPct);
    if (!result.found) {
      console.warn(`[shift-allocation] no active allocation for "${personName}" on ${projectId}`);
      res.status(404).json({
        ok: false,
        message: `${personName} has no active allocation on ${projectId}.`,
      });
      return;
    }
    if (!result.ok) {
      console.warn(`[shift-allocation] ${projectId} UPDATE affected 0 rows for "${personName}"`);
      res.status(502).json({ ok: false, message: `Could not update allocation for ${personName}.` });
      return;
    }
    const currentPct = result.oldPct ?? 0;
    const newPct = result.newPct ?? 0;
    setAuditTarget(res, {
      entityType: "allocation",
      entityId: projectId,
      entityName: `${result.resolvedName ?? personName} on ${projectId}`,
    });
    setTrustedAuditChanges(res, boundedAuditChanges([
      { FieldName: "PctAllocation", OldValue: currentPct, NewValue: newPct },
    ]));
    console.log(`[shift-allocation] ${personName} on ${projectId} OK: ${currentPct}% → ${newPct.toFixed(0)}%`);

    // 3b. Bust proxy caches so the next /resource-allocations / project-team
    //     read returns the freshly-saved %, not the 2-min-old snapshot.
    const _auth = req.header("authorization") ?? "";
    if (_auth) bustAllProjectCaches(_auth);

    // 4. Audit email — best effort.
    const audit = await sendAudit({
      to: ["resourcing-ops@example.com"],
      sentBy,
      subject: `Allocation shift: ${personName} on ${projectId} · -${hoursPerWeek}h/wk`,
      body:
        `Decision Support reduced an allocation in RM ONE.\n\n` +
        `Person: ${personName}\nProject: ${projectId}\n` +
        `Reduced by: ${hoursPerWeek}h/wk (${currentPct}% → ${newPct.toFixed(0)}%)\n\n` +
        `Generated from the Decision Support SITREP.`,
    });

    res.json({
      ok: true,
      message: `RM ONE updated: ${personName} on ${projectId} ${currentPct}% → ${newPct.toFixed(0)}%.`,
      detail: `${hoursPerWeek}h/wk freed${audit ? " · audit email sent" : ""}`,
    });
  } catch (e) {
    res.status(502).json({ ok: false, message: e instanceof Error ? e.message : String(e) });
  }
});

/* ── 2. DEFER: push a pursuit's expected close date by N days ──────────────
 *
 * Resolves the pursuit by recordId (preferred) or by name lookup against
 * the PMM/COM module list, then pushes TargetCompletionDate (and CloseDate
 * if the field exists) by N days via /api/module/UpdateRecord.
 */
router.post("/defer-pursuit", async (req: Request, res: Response) => {
  const { pursuitName, days, recordId } = req.body as {
    pursuitName?: string; days?: number; recordId?: string;
  };
  if (!pursuitName || !days) {
    res.status(400).json({ ok: false, message: "Missing pursuitName or days." });
    return;
  }
  const rds = resolveRequestSource(req);
  if (!rds) {
    res.status(401).json({ ok: false, message: "Not signed in." });
    return;
  }
  // #87: deferring writes record dates — same edit gate as every other write route.
  if (await blockIfReadOnly(req, res)) return;
  const sentBy = getUsername(req);
  console.log(`[defer-pursuit] in: pursuitName="${pursuitName}" days=${days} recordId=${recordId ?? ""} by=${sentBy}`);

  try {
    // 1. Resolve record ID.
    let resolvedId = recordId && /^[A-Z]{2,4}-\d{2}-\d{4,}$/i.test(recordId) ? recordId : "";
    if (!resolvedId) {
      const norm = (s: string) => s.trim().toLowerCase();
      const target = norm(pursuitName);
      for (const mod of ["PMM", "COM", "OPM"]) {
        const listBody = (await getRecords(mod, rds.tid, rds.tenant)) as { data?: Record<string, unknown>[] };
        const rows = listBody.data ?? [];
        const match = rows.find(r => {
          const t = norm(String(r.Title ?? r.ShortName ?? ""));
          return t === target || (t.length > 0 && (t.includes(target) || target.includes(t)));
        });
        if (match) { resolvedId = String(match.TicketId ?? ""); break; }
      }
    }
    if (!resolvedId) {
      console.warn(`[defer-pursuit] could not resolve "${pursuitName}" in PMM/COM/OPM`);
      res.status(404).json({
        ok: false,
        message: `Could not find pursuit "${pursuitName}".`,
      });
      return;
    }
    console.log(`[defer-pursuit] resolved id=${resolvedId}`);

    // 1b. Gate on module support. Only PMM (projects) and OPM (opportunities)
    //     are RDS-backed for date writes; COM (Companies) and LEM (Leads) are
    //     intentionally not connected after the RDS-only conversion. Catch them
    //     here and return an explicit, user-friendly message instead of letting
    //     updateRecordFieldsRds fail with a generic "Unsupported record type"
    //     502 the picker would render as a raw error string.
    const idUpper = resolvedId.toUpperCase();
    const modPrefix = idUpper.match(/^[A-Z]{2,4}/)?.[0] ?? "";
    const RDS_DEFERRABLE = new Set(["PMM", "OPM"]);
    if (!RDS_DEFERRABLE.has(modPrefix)) {
      const label =
        modPrefix === "COM" ? "Company" :
        modPrefix === "LEM" ? "Lead" :
        "this type of";
      console.warn(`[defer-pursuit] ${resolvedId} module ${modPrefix || "?"} not deferrable (RDS-only)`);
      res.status(422).json({
        ok: false,
        message: `Deferring ${label} pursuits isn't supported yet.`,
        detail: `${resolvedId} lives in a module that isn't connected for date changes. Adjust its dates directly in the RM ONE portal.`,
      });
      return;
    }

    // 2. Read current dates so we can compute new ones.
    const detail = (await getRecordDetail(resolvedId, rds.tid, rds.tenant)) as
      { Status?: boolean; Data?: Record<string, unknown> } | null;
    const data: Record<string, unknown> = (detail && detail.Status && detail.Data) ? detail.Data : {};

    const readField = (k: string): string => {
      if (data[k]) return String(data[k]);
      if (Array.isArray(data.Fields)) {
        const f = (data.Fields as Record<string, unknown>[]).find(x => String(x.FieldName) === k);
        if (f && f.Value) return String(f.Value);
      }
      return "";
    };

    const pushDays = (iso: string): string => {
      if (!iso) return "";
      const ms = new Date(iso).getTime();
      if (isNaN(ms)) return "";
      const d = new Date(ms + days * 86400000);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}T00:00:00`;
    };

    const candidateFields = ["TargetCompletionDate", "CloseDate"];
    const fields: { FieldName: string; Value: string; IsExcluded: boolean }[] = [];
    const oldVals: Record<string, string> = {};
    const newVals: Record<string, string> = {};
    for (const k of candidateFields) {
      const cur = readField(k);
      const next = pushDays(cur);
      if (next) {
        fields.push({ FieldName: k, Value: next, IsExcluded: false });
        oldVals[k] = cur.split("T")[0];
        newVals[k] = next.split("T")[0];
      }
    }
    if (fields.length === 0) {
      console.warn(`[defer-pursuit] record ${resolvedId} has no Target/Close date to push`);
      res.status(422).json({
        ok: false,
        message: `Record ${resolvedId} has no Target/Close date to push.`,
      });
      return;
    }
    console.log(`[defer-pursuit] ${resolvedId} pushing: ${fields.map(f => `${f.FieldName}=${f.Value.split("T")[0]}`).join(", ")} (was: ${Object.entries(oldVals).map(([k,v]) => `${k}=${v}`).join(", ")})`);

    // #87: per-stage permission rules apply to this write path too — same 403
    // + plain-language reason as the regular update-fields route.
    if (await blockIfStagePermissionDenied(req, res, resolvedId, fields)) return;

    // 3. Persist the pushed dates directly in core2 (tenant-scoped UPDATE on the
    //    PMM/OPM row). Only PMM/OPM records are RDS-backed; a resolved COM record
    //    returns an explicit error from the provider. The actor is passed so the
    //    provider-level #87 backstop re-checks fail-closed as well.
    const up = await updateRecordFieldsRds(
      resolvedId,
      fields.map((f) => ({ FieldName: f.FieldName, Value: f.Value })),
      rds.tid,
      rds.tenant,
      { actor: { userId: rds.userId, acl: rds.accessLevel, username: rds.username } },
    );
    if (!up.ok) {
      console.warn(`[defer-pursuit] ${resolvedId} UPDATE failed: ${up.error ?? "unknown"}`);
      res.status(502).json({ ok: false, message: (up.error ?? "Could not update the record.").slice(0, 300) });
      return;
    }
    const trustedChanges = up.auditChanges ?? [];
    handoffTrustedAuditChanges(res, up);
    setAuditTarget(res, {
      entityType: recordEntityType(resolvedId),
      entityId: resolvedId,
      entityName: readField("Title") || readField("ShortName") || pursuitName,
    });
    console.log(`[defer-pursuit] ${resolvedId} OK: updated cols=${up.updated.join(", ")}`);

    // 3b. Bust the rmone-proxy record/module caches for THIS user so the
    //     project card re-fetches the live TargetCompletionDate on next
    //     render instead of serving the cached pre-defer value for up to
    //     5 minutes (recordCache TTL). Without this the user sees a green
    //     "RM ONE updated" toast but the timeline still shows the old end
    //     date — exactly the bug the user just reported.
    const auditAuth = req.header("authorization") ?? "";
    if (auditAuth) bustAllProjectCaches(auditAuth);

    // 4. Audit email — best effort.
    const audit = await sendAudit({
      to: ["pursuit-pmo@example.com"],
      sentBy,
      subject: `Pursuit deferral: ${pursuitName} (${resolvedId}) · +${days}D`,
      body:
        `Decision Support pushed pursuit dates by ${days} days in RM ONE.\n\n` +
        `Pursuit: ${pursuitName} (${resolvedId})\n` +
        trustedChanges.map((change) => `${change.FieldName}: ${String(change.OldValue ?? "blank")} → ${String(change.NewValue ?? "blank")}`).join("\n") +
        `\n\nGenerated from the Decision Support SITREP.`,
    });

    res.json({
      ok: true,
      message: `RM ONE updated: ${pursuitName} pushed ${days} days.`,
      detail: `${resolvedId} · ${trustedChanges.length} persisted field${trustedChanges.length === 1 ? "" : "s"} changed${audit ? " · audit email sent" : ""}`,
    });
  } catch (e) {
    res.status(502).json({ ok: false, message: e instanceof Error ? e.message : String(e) });
  }
});

/* ── 3. ENGAGE: outreach to N candidates ──────────────────────────────────
 *
 * RM ONE does not yet expose a SaveAllocation / candidate-engagement API
 * (see rmone-proxy.ts /assign-person → 501). Until that endpoint ships, the
 * chip dispatches an audit email so the action is recorded; the response
 * makes the limitation explicit so the user knows a manual follow-up is
 * still required in the RM ONE web portal.
 */
router.post("/engage-candidates", async (req: Request, res: Response) => {
  const { role, count, recipients, recordId, projectId, ticketId } = req.body as {
    role?: string; count?: number; recipients?: string[];
    recordId?: string; projectId?: string; ticketId?: string;
  };
  if (!getBearer(req)) {
    res.status(401).json({ ok: false, message: "Not signed in to RM ONE." });
    return;
  }
  if (!role || !count) {
    res.status(400).json({ ok: false, message: "Missing role or count." });
    return;
  }
  const sentBy = getUsername(req);
  const slug = role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "candidate";
  const list: string[] = recipients && recipients.length > 0
    ? recipients.slice(0, count)
    : Array.from({ length: count }, (_, i) => `${slug}-candidate-${i + 1}@example.com`);
  const resolvedTicket = String(recordId ?? projectId ?? ticketId ?? "").trim();
  const candidateNames = new Map<string, string>();
  const rds = resolveRequestSource(req);
  if (rds) {
    try {
      const directory = await fetchResourceDirectory(rds.tid, rds.tenant);
      for (const candidate of directory) {
        if (candidate.Email) candidateNames.set(candidate.Email.trim().toLowerCase(), candidate.Name);
      }
    } catch {
      // Audit enrichment is best-effort and must never affect outreach.
    }
  }
  console.log(`[engage-candidates] in: role="${role}" count=${count} recipients=[${list.join(", ")}] by=${sentBy}`);
  const subject = `${role} engagement opportunity`;
  const body =
    `Hello,\n\n` +
    `RM ONE has identified a ${role} need with an immediate start. We'd like to discuss a short engagement.\n\n` +
    `If you are available, please reply and a member of our team will follow up to align on scope, timing, and rate.\n\n` +
    `— RM ONE Resourcing\n(Generated from the Decision Support SITREP)`;
  let sent = 0;
  const sentRecipients: string[] = [];
  for (const to of list) {
    try {
      const r = await sendEmail({
        to: [to], subject, body, sentBy,
        senderDisplayName: "RM ONE Resourcing",
      });
      if (r.ok) {
        sent++;
        sentRecipients.push(to);
      }
    } catch { /* logged below */ }
  }
  if (sent === 0) {
    console.warn(`[engage-candidates] all ${list.length} sends FAILED`);
    res.status(502).json({
      ok: false,
      message: `Failed to send any candidate outreach emails.`,
    });
    return;
  }
  setAuditTarget(res, {
    entityType: "allocation",
    entityId: resolvedTicket || null,
    entityName: resolvedTicket || role,
  });
  // Candidate identities (names/emails) are third-party PII and must never be
  // persisted in the audit ledger — record only the aggregate outcome.
  setTrustedAuditChanges(res, [
    { FieldName: "Candidates engaged", OldValue: null, NewValue: `${sent} of ${list.length}` },
    { FieldName: "Role", OldValue: null, NewValue: role || null },
  ]);
  console.log(`[engage-candidates] OK: sent=${sent}/${list.length}`);
  res.json({
    ok: true,
    message: `Engaged ${sent} of ${list.length} ${role} candidate${sent === 1 ? "" : "s"}.`,
    detail: `Outreach sent · RM ONE candidate-assignment API not yet available, complete the staffing in the RM ONE portal`,
  });
});

/* ── 4. OPEN: open a new requisition ──────────────────────────────────────
 *
 * RM ONE does not currently expose a "create demand / requisition" endpoint
 * (the demand module is read-only via GetResourceDemandItems). Until a write
 * path is exposed the chip dispatches an audit email to Talent Acquisition;
 * the response is explicit that the requisition must still be opened
 * manually in the RM ONE portal.
 */
router.post("/open-requisition", async (req: Request, res: Response) => {
  const { title, closeInDays, manager, recordId, projectId, ticketId, count } = req.body as {
    title?: string; closeInDays?: number; manager?: string;
    recordId?: string; projectId?: string; ticketId?: string; count?: number;
  };
  if (!getBearer(req)) {
    res.status(401).json({ ok: false, message: "Not signed in to RM ONE." });
    return;
  }
  if (!title || !closeInDays) {
    res.status(400).json({ ok: false, message: "Missing title or closeInDays." });
    return;
  }
  const sentBy = getUsername(req);
  console.log(`[open-requisition] in: title="${title}" closeInDays=${closeInDays} manager=${manager ?? ""} by=${sentBy}`);
  const audit = await sendAudit({
    to: ["talent-acquisition@example.com"],
    sentBy,
    subject: `Open requisition: ${title} (close +${closeInDays}D)`,
    body:
      `A new requisition has been requested by Decision Support.\n\n` +
      `Title: ${title}\nTarget close: ${closeInDays} days from today\n` +
      (manager ? `Hiring manager: ${manager}\n` : "") +
      `\nPlease post the role and begin sourcing.\n` +
      `Generated from the Decision Support SITREP.`,
  });
  if (!audit) {
    console.warn(`[open-requisition] audit email FAILED`);
    res.status(502).json({ ok: false, message: "Failed to dispatch the requisition email." });
    return;
  }
  const resolvedTicket = String(recordId ?? projectId ?? ticketId ?? "").trim();
  setAuditTarget(res, {
    entityType: "allocation",
    entityId: resolvedTicket || null,
    entityName: resolvedTicket || title,
  });
  setTrustedAuditChanges(res, boundedAuditChanges([
    { FieldName: "Requisition role", OldValue: null, NewValue: title },
    { FieldName: "Requisition count", OldValue: null, NewValue: Math.max(1, Number(count) || 1) },
  ]));
  console.log(`[open-requisition] OK: TA email dispatched`);
  res.json({
    ok: true,
    message: `Requisition queued: ${title}.`,
    detail: `TA notified · RM ONE create-demand API not yet available, open the req in the RM ONE portal to track it`,
  });
});

/* ── 5. CANDIDATES (GET): list people the user can engage ─────────────────
 *
 * Reads the same bench-resource feed used elsewhere in the app and filters
 * to people whose role/title/department matches the requested role token
 * AND who have at least `minFreeHours` of free capacity / week. Used by
 * the Engage picker so the chip can show real RM ONE names instead of
 * fabricated `pm-candidate-N@example.com` placeholders.
 */
router.get("/candidates", async (req: Request, res: Response) => {
  const role = String(req.query.role ?? "").trim();
  const minFreeHours = Math.max(0, Number(req.query.minFreeHours ?? 0));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 25)));
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ candidates: [], message: "Not signed in." }); return; }
  // role is optional — when omitted, return all bench resources so callers
  // (e.g. the Apply picker's "pick a person" step) can present the full
  // list without forcing the user to guess a role keyword first.

  try {
    // RDS-only people directory (core2 via getResourceAllocations), deduped by Name.
    const people = await fetchResourceDirectory(rds.tid, rds.tenant);
    const arr = people; // alias so the existing matcher loop below stays generic

    /* Role matcher: tokenise the requested role and expand common
     * abbreviations so a chip that says "Sr PM" still matches RM ONE
     * titles like "Senior Project Manager" or "Sr. Project Mgr". A
     * resource matches when ALL of the requested role tokens appear
     * (as substrings) in the haystack of title + dept. If only one
     * weak token (e.g. "PM") survives expansion we fall back to
     * substring-matching that single token so the picker isn't empty. */
    const SYN: Record<string, string[]> = {
      sr: ["sr", "senior", "snr"],
      senior: ["senior", "sr", "snr"],
      jr: ["jr", "junior", "jnr"],
      junior: ["junior", "jr", "jnr"],
      pm: ["pm", "project manager", "project mgr", "proj mgr"],
      "project manager": ["project manager", "pm", "project mgr"],
      eng: ["eng", "engineer", "engineering"],
      engineer: ["engineer", "eng", "engineering"],
      mgr: ["mgr", "manager"],
      manager: ["manager", "mgr"],
      ba: ["ba", "business analyst"],
      qa: ["qa", "quality", "tester"],
      arch: ["arch", "architect"],
      architect: ["architect", "arch"],
      dev: ["dev", "developer", "engineer"],
      coord: ["coord", "coordinator"],
    };
    const roleTokensRaw = role.toLowerCase().replace(/[.,]/g, "").split(/\s+/).filter(Boolean);
    const roleTokens = roleTokensRaw.map(t => SYN[t] ?? [t]);
    const matchesRole = (hay: string): boolean => {
      if (roleTokens.length === 0) return true;
      return roleTokens.every(syns => syns.some(s => hay.includes(s)));
    };
    const out: Array<{
      id: string; name: string; email: string; role: string; dept: string;
      currentPct?: number; freeHours?: number;
      projects?: ProjectMix[];
    }> = [];

    const { workWeekHours } = await getBusinessRulesForTenant(rds.tenant);

    for (const r of arr) {
      const name = r.Name.trim();
      if (!name) continue;
      const title = r.JobTitle.trim();
      const dept = r.DivisionName.trim();
      const hay = `${title} ${dept} ${name}`.toLowerCase();
      if (!matchesRole(hay)) continue;

      // currentPct = the person's summed active-allocation % from core2
      // (getResourceAllocations). freeHours is derived from the configured
      // work week so the picker shows real allocation/availability per person
      // instead of omitting it.
      const currentPct = Math.round(Math.max(0, Math.min(200, r.CurrentPct)));
      const freeHours = Math.round(Math.max(0, workWeekHours * (1 - currentPct / 100)));
      if (minFreeHours > 0 && freeHours < minFreeHours) continue;

      const email = (r.Email || r.UserName).trim();
      // Short list of the person's active projects (name + pct), busiest first,
      // so the picker can show the project mix inline without a second lookup.
      const projects = r.Projects
        .slice()
        .sort((a, b) => b.pct - a.pct)
        .map((p) => ({ projectId: p.projectId, projectName: p.projectName || p.projectId, pct: p.pct }));
      out.push({
        id: (r.Id || name).trim(),
        name, email, role: title || "—", dept: dept || "—",
        currentPct,
        freeHours,
        projects,
      });
    }
    // Sort: people with free-hour data first (desc by freeHours), then the
    // rest alphabetically — keeps the picker stable when the directory has
    // no allocation data at all.
    out.sort((a, b) => {
      if (a.freeHours != null && b.freeHours != null) return b.freeHours - a.freeHours;
      if (a.freeHours != null) return -1;
      if (b.freeHours != null) return 1;
      return a.name.localeCompare(b.name);
    });
    const totalScanned = arr.length;
    const totalMatched = out.length;
    const message = totalMatched === 0
      ? `No "${role}" matches in ${totalScanned} bench resources. Try a broader role like "PM" or "Engineer".`
      : undefined;
    res.json({ candidates: out.slice(0, limit), totalScanned, totalMatched, message });
  } catch (e) {
    res.status(502).json({ candidates: [], message: e instanceof Error ? e.message : String(e) });
  }
});

/* ── 5b. CANDIDATE-ROLES (GET): distinct role/title values on the bench ──
 *
 * Powers the Engage / Apply picker dropdowns so users pick from real
 * RM ONE titles instead of guessing keywords. Returns titles ordered by
 * frequency, with an "All roles" sentinel injected client-side.
 */
router.get("/candidate-roles", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ roles: [], message: "Not signed in." }); return; }
  try {
    // Source from the same RDS feed as /candidates (core2 resource directory
    // dedup'd by Name). Each unique person contributes one count to their role.
    const people = await fetchResourceDirectory(rds.tid, rds.tenant);
    const counts = new Map<string, number>();
    for (const p of people) {
      if (!p.JobTitle) continue;
      counts.set(p.JobTitle, (counts.get(p.JobTitle) ?? 0) + 1);
    }
    const roles = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, value: label, count }));
    console.log(`[candidate-roles] people=${people.length} distinctTitles=${roles.length}`);
    res.json({ roles, totalScanned: people.length });
  } catch (e) {
    res.status(502).json({ roles: [], message: e instanceof Error ? e.message : String(e) });
  }
});

/* ── 6. PERSON-ALLOCATIONS (GET): list a person's active allocations ──────
 *
 * Used by the Apply picker so the user can see the person's current
 * project mix and pick which row to reduce. Scans the bench feed for that
 * person and unpacks any per-project allocation breakdown the row carries
 * (RM ONE calls these CRMAllocations / Allocations / ProjectAllocations
 * depending on the response shape).
 */
router.get("/person-allocations", async (req: Request, res: Response) => {
  const personName = String(req.query.personName ?? "").trim();
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ allocations: [], message: "Not signed in." }); return; }
  if (!personName) { res.status(400).json({ allocations: [], message: "Missing personName." }); return; }

  const norm = (s: string) => s.trim().toLowerCase().replace(/,\s*/g, " ");
  const flip = (s: string) => { const p = s.split(/\s+/); return p.length === 2 ? `${p[1]} ${p[0]}` : s; };
  const target = norm(personName);
  const targetFlip = flip(target);

  try {
    // RDS-only: source the person's active allocations from core2 via
    // getResourceAllocations (per-resource activeAllocations breakdown). core2
    // has no per-week hours, so derive hours/wk from pct × the work week.
    const data = (await getResourceAllocations(rds.tid, rds.tenant)) as {
      resources?: Array<Record<string, unknown>>;
    };
    const resources = Array.isArray(data.resources) ? data.resources : [];
    const personRow = resources.find(r => {
      const n = norm(String(r.name ?? ""));
      return n === target || n === targetFlip;
    });
    const out: Array<{
      id: string; projectId: string; projectName: string;
      pct: number; hoursPerWeek: number; start: string; end: string;
    }> = [];

    if (personRow) {
      const { workWeekHours } = await getBusinessRulesForTenant(rds.tenant);
      const allocsRaw = personRow.activeAllocations as unknown;
      const allocs = Array.isArray(allocsRaw) ? allocsRaw as Record<string, unknown>[] : [];
      for (const a of allocs) {
        const pid = String(a.projectId ?? "").trim();
        if (!pid) continue;
        const pct = Number(a.pct ?? 0);
        const hpw = workWeekHours * pct / 100;
        out.push({
          id: `${pid}-${String(a.startDate ?? "").split("T")[0]}`,
          projectId: pid,
          projectName: String(a.projectName ?? pid).trim(),
          pct: Math.round(isFinite(pct) ? pct : 0),
          hoursPerWeek: Math.round(isFinite(hpw) ? hpw : 0),
          start: String(a.startDate ?? "").split("T")[0],
          end: String(a.endDate ?? "").split("T")[0],
        });
      }
    }
    out.sort((a, b) => b.pct - a.pct);
    res.json({ allocations: out });
  } catch (e) {
    res.status(502).json({ allocations: [], message: e instanceof Error ? e.message : String(e) });
  }
});

/* ── 7. PURSUITS (GET): list open pursuits the user can defer ─────────────
 *
 * Reads the PMM/COM module record lists, filters out closed/won/lost
 * pursuits, and returns the slim shape the Defer picker needs. Stages are
 * normalized to lowercase so the client can match on substrings.
 */
router.get("/pursuits", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ pursuits: [], message: "Not signed in." }); return; }
  const status = String(req.query.status ?? "open").trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));

  try {
    const out: Array<{
      recordId: string; title: string; module: string;
      stage: string; targetDate: string; closeDate: string; value: string;
    }> = [];

    // COM is not RDS-backed (returns empty); PMM comes from core2 via getRecords.
    for (const mod of ["PMM", "COM"]) {
      const body = (await getRecords(mod, rds.tid, rds.tenant)) as { data?: Record<string, unknown>[] };
      const rows = body.data ?? [];
      for (const row of rows) {
        const stage = String(row.Stage ?? row.StageName ?? row.Status ?? row.Phase ?? "").toLowerCase();
        if (status === "open") {
          if (/closed|won|lost|complete|cancel/.test(stage)) continue;
        }
        const recordId = String(row.TicketId ?? row.ID ?? row.Id ?? "").trim();
        if (!recordId) continue;
        out.push({
          recordId,
          title: String(row.Title ?? row.ShortName ?? row.ProjectName ?? recordId).trim(),
          module: mod,
          stage: stage || "—",
          targetDate: String(row.TargetCompletionDate ?? row.TargetDate ?? "").split("T")[0],
          closeDate: String(row.CloseDate ?? row.ExpectedCloseDate ?? "").split("T")[0],
          value: String(row.EstimatedValue ?? row.Value ?? row.Amount ?? "").trim(),
        });
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
    res.json({ pursuits: out });
  } catch (e) {
    res.status(502).json({ pursuits: [], message: e instanceof Error ? e.message : String(e) });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Decision-acknowledgement endpoints (non-SITREP buttons)
//
// These three routes back the "dummy" buttons that were previously hand-off-
// only — they now persist a real audit row before optionally handing the
// context to AI Chat. The uniform response shape matches the SITREP chip
// rows so the UI can render success/error strips with the same component.
// ──────────────────────────────────────────────────────────────────────────

type AckBody = {
  refId?: string;
  label?: string;
  note?: string;
  payload?: Record<string, unknown>;
  username?: string;
  tenant?: string;
};

async function insertAck(
  kind: "risk" | "action" | "draft",
  req: Request,
  body: AckBody,
): Promise<{ id: number; createdAt: string; username: string }> {
  // Trust ONLY the authenticated identity — never body.username, never
  // a fallback like "anonymous". Audit rows must be attributable.
  const username = getUsername(req);
  if (!username) {
    throw new Error("unauthorized: missing username");
  }
  const tenant = req.header("x-tenant") || null;
  const refId = String(body.refId ?? "").slice(0, 256);
  const label = String(body.label ?? "").slice(0, 512);
  const note = body.note ? String(body.note).slice(0, 2000) : null;
  if (!refId || !label) {
    throw new Error("refId and label are required");
  }
  const ack = await insertDecisionAck({ tenant, username, kind, refId, label, note, payload: body.payload ?? {} });
  return { id: ack.id, createdAt: ack.createdAt.toISOString(), username };
}

// Shared auth gate for the new ack endpoints. Mirrors the pattern used
// by /engage-candidates and /open-requisition: any caller without a
// bearer token is rejected outright (401), and the username must come
// from the authenticated header set — never the request body.
function requireAckAuth(req: Request, res: Response): string | null {
  if (!getBearer(req)) {
    res.status(401).json({
      ok: false,
      message: "Sign in required to record this decision",
      detail: "Missing bearer token — please sign in and try again.",
    });
    return null;
  }
  const username = getUsername(req);
  if (!username) {
    res.status(401).json({
      ok: false,
      message: "Sign in required to record this decision",
      detail: "Missing X-Username header — please sign in and try again.",
    });
    return null;
  }
  return username;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

router.post("/acknowledge-risk", async (req: Request, res: Response) => {
  const username = requireAckAuth(req, res);
  if (!username) return;
  try {
    const body = (req.body ?? {}) as AckBody & { riskTitle?: string; level?: string };
    const label = body.label || body.riskTitle || "Risk";
    const ack = await insertAck("risk", req, { ...body, label });
    const refId = String(body.refId ?? "").trim();
    setAuditTarget(res, {
      entityType: refId ? recordEntityType(refId) : "record",
      entityId: refId || null,
      entityName: label,
      action: "update.record",
    });
    setTrustedAuditChanges(res, boundedAuditChanges([
      { FieldName: "Risk identifier", OldValue: null, NewValue: refId || `decision-ack:${ack.id}` },
      { FieldName: "Acknowledged", OldValue: "pending", NewValue: "acknowledged" },
    ]));
    void sendAudit({
      to: ["audit@rmone.local"],
      subject: `Risk acknowledged: ${label}`,
      body: `${username} acknowledged risk "${label}" (${body.refId ?? "—"}) at ${ack.createdAt}.${body.note ? `\n\nNote: ${body.note}` : ""}`,
      sentBy: username,
    });
    res.json({
      ok: true,
      message: `Risk acknowledged · logged at ${fmtTime(ack.createdAt)}`,
      detail: `Audit row #${ack.id} recorded for "${label}". The row will stay on your feed but is now marked acknowledged in your trail.`,
    });
  } catch (e) {
    res.status(400).json({
      ok: false,
      message: "Could not record risk acknowledgement",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

router.post("/confirm-action", async (req: Request, res: Response) => {
  const username = requireAckAuth(req, res);
  if (!username) return;
  try {
    const body = (req.body ?? {}) as AckBody & { actionLabel?: string; actionKind?: string };
    const label = body.label || body.actionLabel || "Action";
    const ack = await insertAck("action", req, { ...body, label });
    const refId = String(body.refId ?? "").trim();
    setAuditTarget(res, {
      entityType: refId ? recordEntityType(refId) : "record",
      entityId: refId || null,
      entityName: label,
      action: "update.record",
    });
    setTrustedAuditChanges(res, boundedAuditChanges([
      { FieldName: "Decision identifier", OldValue: null, NewValue: `decision-ack:${ack.id}` },
      { FieldName: "Action confirmed", OldValue: "pending", NewValue: "confirmed" },
    ]));
    void sendAudit({
      to: ["audit@rmone.local"],
      subject: `Action confirmed: ${label}`,
      body: `${username} confirmed action "${label}" (${body.refId ?? "—"}) at ${ack.createdAt}.${body.note ? `\n\nNote: ${body.note}` : ""}`,
      sentBy: username,
    });
    res.json({
      ok: true,
      message: `Action confirmed · logged at ${fmtTime(ack.createdAt)}`,
      detail: `Audit row #${ack.id} recorded for "${label}". RM ONE does not yet expose a write endpoint for this action, so the audit trail is the system of record.`,
    });
  } catch (e) {
    res.status(400).json({
      ok: false,
      message: "Could not record action confirmation",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

router.post("/accept-draft", async (req: Request, res: Response) => {
  const username = requireAckAuth(req, res);
  if (!username) return;
  try {
    const body = (req.body ?? {}) as AckBody & { title?: string; prompt?: string };
    const label = body.label || body.title || "Draft request";
    const ack = await insertAck("draft", req, { ...body, label });
    const refId = String(body.refId ?? "").trim();
    setAuditTarget(res, {
      entityType: refId ? recordEntityType(refId) : "record",
      entityId: refId || null,
      entityName: label,
      action: "update.record",
    });
    setTrustedAuditChanges(res, boundedAuditChanges([
      { FieldName: "Draft decision", OldValue: null, NewValue: `decision-ack:${ack.id}` },
      { FieldName: "Draft status", OldValue: null, NewValue: "accepted" },
    ]));
    void sendAudit({
      to: ["audit@rmone.local"],
      subject: `Draft accepted: ${label}`,
      body: `${username} accepted draft "${label}" (${body.refId ?? "—"}) at ${ack.createdAt}.`,
      sentBy: username,
    });
    res.json({
      ok: true,
      message: `Draft queued · logged at ${fmtTime(ack.createdAt)}`,
      detail: `Audit row #${ack.id} recorded for "${label}". The AI is composing the draft now.`,
    });
  } catch (e) {
    res.status(400).json({
      ok: false,
      message: "Could not queue draft",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

router.get("/acks", async (req: Request, res: Response) => {
  const username = requireAckAuth(req, res);
  if (!username) return;
  try {
    const kind = String(req.query.kind ?? "").trim();
    const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50)));
    const rows = await getDecisionAcks(username, kind || undefined, limit);
    res.json({
      acks: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        refId: row.refId,
        label: row.label,
        note: row.note,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    res.status(500).json({ acks: [], message: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
