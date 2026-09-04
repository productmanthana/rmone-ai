import { Router, type Request, type Response } from "express";
import { getStageCfg, saveStageCfg } from "@workspace/db";
import { resolveRequestSource } from "../lib/rds-auth.js";
import { blockIfReadOnly } from "./rmone-proxy.js";
import { setAuditTarget, setTrustedAuditChanges, trustedAuditDiff } from "../lib/auditTrail.js";

const router = Router();

// Status-field allowlist. Keeps the key space bounded and prevents arbitrary
// column names from being stored/fetched (injection-safety + schema clarity).
const ALLOWED_STATUS_FIELDS = new Set([
  "Status",
  "StatusChoice",
  "CRMProjectStatusChoice",       // PMM projects
  "CRMOpportunityStatusChoice",   // OPM opportunities
  "LeadStatus",                   // LEM leads
  "Phase",
]);

// Maximum sizes — prevents storing oversized payloads.
const MAX_STAGES     = 200;  // order/custom/removed arrays
const MAX_STAGE_LEN  = 300;  // characters per stage name
const MAX_SUB_KEYS   = 100;  // parent keys in subStatuses
const MAX_SUBS_EACH  = 100;  // sub-status values per parent

/** Validates and sanitizes a raw StageCfg-shaped object from the request body.
 *  Returns the cleaned object on success or null if the shape is unacceptable. */
function parseStageCfgBody(raw: unknown): {
  order: string[];
  custom: string[];
  removed: string[];
  subStatuses: Record<string, string[]>;
} | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  // All three arrays are required.
  if (!Array.isArray(r.order) || !Array.isArray(r.custom) || !Array.isArray(r.removed)) return null;

  const cleanArr = (arr: unknown[], maxLen = MAX_STAGE_LEN): string[] | null => {
    if (arr.length > MAX_STAGES) return null;
    const out: string[] = [];
    for (const v of arr) {
      if (typeof v !== "string") return null;
      if (v.length > maxLen) return null;
      out.push(v);
    }
    return out;
  };

  const order   = cleanArr(r.order);   if (!order)   return null;
  const custom  = cleanArr(r.custom);  if (!custom)  return null;
  const removed = cleanArr(r.removed); if (!removed) return null;

  // subStatuses is optional; default to empty.
  const subStatuses: Record<string, string[]> = {};
  if (r.subStatuses !== undefined) {
    if (typeof r.subStatuses !== "object" || Array.isArray(r.subStatuses) || r.subStatuses === null) return null;
    const entries = Object.entries(r.subStatuses as Record<string, unknown>);
    if (entries.length > MAX_SUB_KEYS) return null;
    for (const [k, v] of entries) {
      if (typeof k !== "string" || k.length > MAX_STAGE_LEN) return null;
      if (!Array.isArray(v)) return null;
      const subs = cleanArr(v); if (!subs) return null;
      if (subs.length > MAX_SUBS_EACH) return null;
      subStatuses[k] = subs;
    }
  }

  return { order, custom, removed, subStatuses };
}

function ctx(req: Request, res: Response): { tid: string } | null {
  const rds = resolveRequestSource(req);
  if (!rds) {
    res.status(401).json({ ok: false, message: "Not signed in." });
    return null;
  }
  return { tid: rds.tid };
}

// GET /stage-cfg/:field/:recordId
// Returns the stored StageCfg JSON for the tenant+record+field triple, or
// null if none has been saved yet (client falls back to localStorage).
router.get("/:field/:recordId", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  const field    = String(req.params.field ?? "").trim();
  const recordId = String(req.params.recordId ?? "").trim();
  setAuditTarget(res, { entityType: "schedule", entityId: recordId });
  if (!ALLOWED_STATUS_FIELDS.has(field) || !recordId) {
    res.status(400).json({ ok: false, message: "Invalid field or recordId." }); return;
  }
  try {
    const cfg = await getStageCfg(c.tid, recordId, field);
    res.json({ ok: true, cfg });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

// PUT /stage-cfg/:field/:recordId
// Upserts the StageCfg JSON. Requires edit access (not read-only).
router.put("/:field/:recordId", async (req, res) => {
  // Auth: same gate as all other record-write paths — read-only users blocked.
  if (await blockIfReadOnly(req, res)) return;

  const c = ctx(req, res); if (!c) return;
  const field    = String(req.params.field ?? "").trim();
  const recordId = String(req.params.recordId ?? "").trim();
  if (!ALLOWED_STATUS_FIELDS.has(field) || !recordId) {
    res.status(400).json({ ok: false, message: "Invalid field or recordId." }); return;
  }
  const cfg = parseStageCfgBody(req.body?.cfg);
  if (!cfg) {
    res.status(400).json({ ok: false, message: "cfg must be a valid StageCfg object." }); return;
  }
  let before: Record<string, unknown> | null | undefined;
  try {
    const stored = await getStageCfg(c.tid, recordId, field);
    before = stored && typeof stored === "object" && !Array.isArray(stored)
      ? stored as Record<string, unknown>
      : null;
  } catch { /* audit is best-effort */ }
  try {
    await saveStageCfg(c.tid, recordId, field, cfg);
    if (before !== undefined) {
      try {
        const stored = await getStageCfg(c.tid, recordId, field);
        const after = stored && typeof stored === "object" && !Array.isArray(stored)
          ? stored as Record<string, unknown>
          : null;
        if (after) {
          setTrustedAuditChanges(res, trustedAuditDiff(before, after, {
            fields: ["order", "custom", "removed", "subStatuses"],
          }));
        }
      } catch { /* audit is best-effort */ }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

export default router;
