import { Router, type Request, type Response } from "express";
import {
  getAllocationTemplates,
  createAllocationTemplate,
  updateAllocationTemplate,
  deleteAllocationTemplate,
  type AllocationTemplateSlot,
} from "@workspace/db";
import { resolveRequestSource } from "../lib/rds-auth.js";
import { setAuditTarget, setTrustedAuditChanges, trustedAuditDiff } from "../lib/auditTrail.js";

const router = Router();

function auditTemplateSnapshot(
  template: Awaited<ReturnType<typeof getAllocationTemplates>>[number],
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    name: template.name,
    entryCount: template.slots.length,
  };
  template.slots.forEach(({ id: _id, ...slot }, index) => {
    snapshot[`entry.${index + 1}`] = slot;
  });
  return snapshot;
}

function ctx(req: Request, res: Response): { tid: string; username: string } | null {
  const rds = resolveRequestSource(req);
  if (!rds) {
    res.status(401).json({ ok: false, message: "Not signed in." });
    return null;
  }
  return { tid: rds.tid, username: rds.username ?? "" };
}

router.get("/", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  try {
    const templates = await getAllocationTemplates(c.tid);
    res.json(templates);
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.post("/", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  const name = String(req.body?.name ?? "").trim();
  if (!name) { res.status(400).json({ ok: false, message: "name required" }); return; }
  const rawSlots: any[] = Array.isArray(req.body?.slots) ? req.body.slots : [];
  const slots: Omit<AllocationTemplateSlot, "id">[] = rawSlots.map((s, i) => ({
    buName:       String(s.buName ?? "").trim() || null,
    divisionName: String(s.divisionName ?? "").trim() || null,
    deptName:     String(s.deptName ?? "").trim() || null,
    roleName:     String(s.roleName ?? "").trim() || null,
    jobTitleName: String(s.jobTitleName ?? "").trim() || null,
    defaultPct:   Number(s.defaultPct ?? 100),
    sortOrder:    i,
    resourceId:   String(s.resourceId ?? "").trim() || null,
  }));
  try {
    const id = await createAllocationTemplate(c.tid, name, c.username, slots);
    const templates = await getAllocationTemplates(c.tid);
    const created = templates.find((template) => template.id === id);
    setAuditTarget(res, {
      entityType: "configuration",
      entityId: String(id),
      entityName: created?.name,
    });
    if (created) {
      setTrustedAuditChanges(res, [
        { FieldName: "name", OldValue: null, NewValue: created.name },
        { FieldName: "entryCount", OldValue: null, NewValue: created.slots.length },
      ]);
    }
    res.json({ ok: true, id, templates });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.put("/:id", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ ok: false, message: "bad id" }); return; }
  setAuditTarget(res, { entityType: "configuration", entityId: String(id) });
  const name = String(req.body?.name ?? "").trim();
  if (!name) { res.status(400).json({ ok: false, message: "name required" }); return; }
  const rawSlots: any[] = Array.isArray(req.body?.slots) ? req.body.slots : [];
  const slots: Omit<AllocationTemplateSlot, "id">[] = rawSlots.map((s, i) => ({
    buName:       String(s.buName ?? "").trim() || null,
    divisionName: String(s.divisionName ?? "").trim() || null,
    deptName:     String(s.deptName ?? "").trim() || null,
    roleName:     String(s.roleName ?? "").trim() || null,
    jobTitleName: String(s.jobTitleName ?? "").trim() || null,
    defaultPct:   Number(s.defaultPct ?? 100),
    sortOrder:    i,
    resourceId:   String(s.resourceId ?? "").trim() || null,
  }));
  let before: Awaited<ReturnType<typeof getAllocationTemplates>>[number] | null = null;
  try {
    before = (await getAllocationTemplates(c.tid)).find((template) => template.id === id) ?? null;
    if (before) setAuditTarget(res, { entityName: before.name });
  } catch { /* audit is best-effort */ }
  try {
    await updateAllocationTemplate(c.tid, id, name, slots);
    const templates = await getAllocationTemplates(c.tid);
    const after = templates.find((template) => template.id === id);
    if (after) {
      setAuditTarget(res, { entityName: after.name });
      if (before) {
        setTrustedAuditChanges(res, trustedAuditDiff(
          auditTemplateSnapshot(before),
          auditTemplateSnapshot(after),
        ));
      }
    }
    res.json({ ok: true, templates });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

router.delete("/:id", async (req, res) => {
  const c = ctx(req, res); if (!c) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ ok: false, message: "bad id" }); return; }
  setAuditTarget(res, {
    entityType: "configuration",
    entityId: String(id),
    action: "delete.configuration",
  });
  let before: Awaited<ReturnType<typeof getAllocationTemplates>>[number] | null = null;
  try {
    before = (await getAllocationTemplates(c.tid)).find((template) => template.id === id) ?? null;
    if (before) setAuditTarget(res, { entityName: before.name });
  } catch { /* audit is best-effort */ }
  try {
    await deleteAllocationTemplate(c.tid, id);
    const templates = await getAllocationTemplates(c.tid);
    if (before) {
      setTrustedAuditChanges(res, [
        { FieldName: "name", OldValue: before.name, NewValue: null },
        { FieldName: "entryCount", OldValue: before.slots.length, NewValue: null },
      ]);
    }
    res.json({ ok: true, templates });
  } catch (e) { res.status(500).json({ ok: false, message: String(e) }); }
});

export default router;
