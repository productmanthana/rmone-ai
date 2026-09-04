import { getPool } from "../src/lib/db.js";
const pool = await getPool();
const r = await pool.request().query(`
  SELECT t.name AS tbl, i.name AS idx, i.type_desc,
    STUFF((SELECT ','+c.name FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
      WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.is_included_column=0 ORDER BY ic.key_ordinal FOR XML PATH('')),1,1,'') AS keys_,
    STUFF((SELECT ','+c.name FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
      WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.is_included_column=1 FOR XML PATH('')),1,1,'') AS incl
  FROM sys.indexes i JOIN sys.tables t ON t.object_id=i.object_id
  WHERE t.name IN ('ResourceAllocation','ResourceWorkItems') AND i.type>0
  ORDER BY t.name, i.name`);
for (const row of r.recordset) console.log(`${row.tbl} :: ${row.idx} [${row.type_desc}] keys=(${row.keys_}) incl=(${row.incl ?? ""})`);
process.exit(0);
