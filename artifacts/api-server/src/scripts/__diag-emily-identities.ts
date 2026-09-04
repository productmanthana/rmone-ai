import sql from 'mssql';
import { getPool } from '../lib/db';
import { getResourceAllocations } from '../lib/rds-provider';
import { getUsersByTenant } from '@workspace/db';

void (async () => {
  const tid = '95f49c6a-b98b-5ffb-99d1-f777bb86b66b';
  const users = await getUsersByTenant(tid);
  const names = new Map(users.map((u: any) => [String(u.id).toLowerCase(), { name: u.name, deleted: u.deleted, enabled: u.enabled }]));
  const pool = await getPool();
  const q = await pool.request().input('tid', sql.VarChar, tid).input('pid', sql.VarChar, 'testtt').query(`
    SELECT ra.ID AS RaId, ra.ResourceUser AS RaUser, ra.AllocationStartDate, ra.AllocationEndDate,
           ra.AllocationHour, ra.PctAllocation, ra.Deleted AS RaDeleted,
           rwi.ID AS RwiId, rwi.ResourceUser AS RwiUser, rwi.WorkItem, rwi.Deleted AS RwiDeleted
    FROM core2.dbo.ResourceAllocation ra
    LEFT JOIN core2.dbo.ResourceWorkItems rwi ON rwi.ID=ra.ResourceWorkItemLookup AND rwi.TenantID=ra.TenantID
    WHERE ra.TenantID=@tid AND (LTRIM(RTRIM(ra.TicketId))=LTRIM(RTRIM(@pid)) OR LTRIM(RTRIM(rwi.WorkItem))=LTRIM(RTRIM(@pid)))
      AND (ra.Deleted=0 OR ra.Deleted IS NULL)
    ORDER BY COALESCE(ra.ResourceUser,rwi.ResourceUser), ra.ID;
  `);
  console.log('active-db-rows');
  console.table(q.recordset.map((r: any) => {
    const uid = String(r.RaUser ?? r.RwiUser ?? '').toLowerCase();
    return { ...r, PersonName: names.get(uid)?.name ?? '(unknown)', UserEnabled: names.get(uid)?.enabled, UserDeleted: names.get(uid)?.deleted };
  }));
  const payload = await getResourceAllocations(tid, 'test21') as any;
  console.log('resource-feed-emily-rows');
  console.log(JSON.stringify((payload.resources ?? []).filter((r: any) => String(r.name).toLowerCase().includes('emily')).map((r: any) => ({
    id: r.id, name: r.name,
    testtt: (r.allAllocations ?? []).filter((a: any) => a.projectId === 'testtt'),
  })), null, 2));
  process.exit(0);
})().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
