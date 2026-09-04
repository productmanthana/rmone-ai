/**
 * Synonym mapping CRUD routes.
 *
 * GET    /api/synonyms                — list all (built-in + custom)
 * GET    /api/synonyms/canonical-fields — per-tab canonical field lists
 * POST   /api/synonyms               — add custom synonym (stores createdBy from JWT)
 * PUT    /api/synonyms/:id           — update custom synonym (only the creator)
 * DELETE /api/synonyms/:id           — delete custom synonym (only the creator)
 */
import { Router } from "express";
import {
  getAllSynonymMappings, getSynonymMappingById,
  upsertSynonymMapping, updateSynonymMapping, deleteSynonymMapping,
} from "@workspace/db";
import { SYNONYM_MAP, SIMPLIFIED_CANONICAL_FIELDS } from "../lib/pipeline.js";
import { resolveRequestSource } from "../lib/rds-auth.js";
import { setAuditTarget, setTrustedAuditChanges, trustedAuditDiff } from "../lib/auditTrail.js";
import type { Request, Response } from "express";

const router = Router();

function auditRow(row: object | null | undefined): Record<string, unknown> | null | undefined {
  return row as Record<string, unknown> | null | undefined;
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const custom = await getAllSynonymMappings();
    const builtin = Object.entries(SYNONYM_MAP).map(([alias, canonicalField]) => ({
      id:             null as null,
      alias,
      canonicalField,
      tabType:        null as null,
      isBuiltin:      true,
      createdBy:      null as null,
      createdAt:      null as null,
      updatedAt:      null as null,
    }));
    const all = [
      ...custom.map(r => ({ ...r, isBuiltin: false })),
      ...builtin,
    ];
    res.json({ synonyms: all, total: all.length, customCount: custom.length, builtinCount: builtin.length });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get("/canonical-fields", (_req: Request, res: Response) => {
  res.json({ fields: SIMPLIFIED_CANONICAL_FIELDS });
});

router.post("/", async (req: Request, res: Response) => {
  const requester = resolveRequestSource(req);
  if (!requester) return res.status(401).json({ error: "Authentication required" });
  setAuditTarget(res, { entityType: "configuration", entityId: "synonym-map" });
  try {
    const { alias, canonicalField, tabType } = req.body as {
      alias?: string; canonicalField?: string; tabType?: string;
    };
    if (!alias?.trim() || !canonicalField?.trim()) {
      return res.status(400).json({ error: "alias and canonicalField are required" });
    }
    const normAlias = alias.trim().toLowerCase();
    if (SYNONYM_MAP[normAlias]) {
      return res.status(409).json({
        error: `"${normAlias}" is already a built-in synonym → ${SYNONYM_MAP[normAlias]}. ` +
               `Built-in synonyms cannot be overridden here.`,
      });
    }
    let before: Awaited<ReturnType<typeof getSynonymMappingById>> | undefined;
    try {
      before = (await getAllSynonymMappings()).find((mapping) =>
        mapping.alias === normAlias && (mapping.tabType ?? "") === (tabType || "")) ?? null;
    } catch { /* audit is best-effort */ }
    const row = await upsertSynonymMapping({
      alias: normAlias,
      canonicalField: canonicalField.trim(),
      tabType: tabType || null,
      isBuiltin: false,
      hitCount: 1,
      createdBy: requester.username ?? null,
    });
    setAuditTarget(res, { entityName: row.alias });
    if (before !== undefined) {
      setTrustedAuditChanges(res, trustedAuditDiff(auditRow(before), auditRow(row), {
        fields: ["alias", "canonicalField", "tabType"],
      }));
    }
    res.status(201).json({ synonym: { ...row, isBuiltin: false } });
  } catch (e: unknown) {
    const msg = (e as Error).message ?? "";
    if (msg.includes("already exists") || msg.includes("UQ_") || msg.includes("Violation of UNIQUE")) {
      return res.status(409).json({ error: "A synonym with this alias already exists" });
    }
    res.status(500).json({ error: msg });
  }
  return;
});

router.put("/:id", async (req: Request, res: Response) => {
  const requester = resolveRequestSource(req);
  if (!requester) return res.status(401).json({ error: "Authentication required" });
  setAuditTarget(res, { entityType: "configuration", entityId: "synonym-map" });
  try {
    const id = parseInt(String(req.params.id), 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await getSynonymMappingById(id);
    if (!existing) return res.status(404).json({ error: "Synonym not found" });
    setAuditTarget(res, { entityName: existing.alias });
    if (existing.createdBy !== null && existing.createdBy !== (requester.username ?? null)) {
      return res.status(403).json({ error: "You can only edit synonyms you added" });
    }
    const { alias, canonicalField, tabType } = req.body as {
      alias?: string; canonicalField?: string; tabType?: string;
    };
    const patch: { alias?: string; canonicalField?: string; tabType?: string | null } = {};
    if (alias)          patch.alias          = alias.trim().toLowerCase();
    if (canonicalField) patch.canonicalField  = canonicalField.trim();
    if (tabType !== undefined) patch.tabType  = tabType || null;
    const row = await updateSynonymMapping(id, patch);
    if (!row) return res.status(404).json({ error: "Synonym not found" });
    setAuditTarget(res, { entityName: row.alias });
    setTrustedAuditChanges(res, trustedAuditDiff(auditRow(existing), auditRow(row), {
      fields: ["alias", "canonicalField", "tabType"],
    }));
    res.json({ synonym: { ...row, isBuiltin: false } });
  } catch (e: unknown) {
    const msg = (e as Error).message ?? "";
    if (msg.includes("already exists") || msg.includes("UQ_") || msg.includes("Violation of UNIQUE")) {
      return res.status(409).json({ error: "A synonym with this alias already exists" });
    }
    res.status(500).json({ error: msg });
  }
  return;
});

router.delete("/:id", async (req: Request, res: Response) => {
  const requester = resolveRequestSource(req);
  if (!requester) return res.status(401).json({ error: "Authentication required" });
  setAuditTarget(res, { entityType: "configuration", entityId: "synonym-map" });
  try {
    const id = parseInt(String(req.params.id), 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await getSynonymMappingById(id);
    if (!existing) return res.status(404).json({ error: "Synonym not found" });
    setAuditTarget(res, { entityName: existing.alias });
    if (existing.createdBy !== null && existing.createdBy !== (requester.username ?? null)) {
      return res.status(403).json({ error: "You can only delete synonyms you added" });
    }
    await deleteSynonymMapping(id);
    setTrustedAuditChanges(res, trustedAuditDiff(auditRow(existing), null, {
      fields: ["alias", "canonicalField", "tabType"],
    }));
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
  return;
});

export default router;
