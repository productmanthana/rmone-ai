// Resumable SQL Server -> SQL Server logical migration over TDS.
// Usage: node scripts/migrate-to-aws.mjs <ddl|load|fk|verify|status>
// Source: CLIENT_DB_URL env — injected EXPLICITLY by scripts/migrate-to-aws.sh
// from MIGRATION_SOURCE_DB_URL. Deliberately NOT the app's APP_DATABASE_URL
// chain: this must point at the migration SOURCE server, never the live app DB.
// Target: /tmp/target_aws.json {host,user,pw}.
// State: /tmp/aws-migrate-state.json — safe to re-invoke until phase reports DONE.
import sql from "mssql";
import fs from "fs";

const DBS = (process.env.MIGRATE_DBS || "core2,rmoneapp").split(",").map((s) => s.trim()).filter(Boolean);
const STATE_FILE = "/tmp/aws-migrate-state.json";
const SCHEMA_FILE = (db) => `/tmp/aws-migrate-schema-${db}.json`;
const TIME_BUDGET_MS = 88_000;
const PAGE_ROWS = parseInt(process.env.MIGRATE_PAGE_ROWS || "4000", 10);
const MAX_BATCH_ROWS = Math.min(1000, parseInt(process.env.MIGRATE_BATCH_ROWS || "500", 10));
const MAX_BATCH_CHARS = parseInt(process.env.MIGRATE_BATCH_CHARS || "2000000", 10);
const started = Date.now();
const timeLeft = () => TIME_BUDGET_MS - (Date.now() - started);

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { ddl: {}, load: {}, fk: {}, verify: {} }; }
}
function saveState(st) { fs.writeFileSync(STATE_FILE, JSON.stringify(st)); }

function srcCfg(database) {
  const u = new URL(process.env.CLIENT_DB_URL);
  return {
    server: u.hostname, port: u.port ? parseInt(u.port, 10) : 1433, database,
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 20_000, requestTimeout: 110_000, packetSize: 32_768 },
    pool: { max: 2, min: 0, idleTimeoutMillis: 30_000 },
  };
}
function tgtCfg(database) {
  const t = JSON.parse(fs.readFileSync("/tmp/target_aws.json", "utf8"));
  return {
    server: t.host, port: 1433, database,
    user: t.user, password: t.pw,
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 20_000, requestTimeout: 110_000, packetSize: 32_768 },
    pool: { max: 2, min: 0, idleTimeoutMillis: 30_000 },
  };
}
const pools = new Map();
async function pool(kind, db) {
  const key = kind + "|" + db;
  if (pools.has(key)) return pools.get(key);
  const p = await new sql.ConnectionPool(kind === "src" ? srcCfg(db) : tgtCfg(db)).connect();
  pools.set(key, p);
  return p;
}
async function closeAll() { for (const p of pools.values()) { try { await p.close(); } catch {} } }

const id = (n) => "[" + String(n).replace(/]/g, "]]") + "]";
const qt = (s, t) => id(s) + "." + id(t);
const lit = (s) => "N'" + String(s).replace(/'/g, "''") + "'";

// ---------- schema extraction ----------
async function extractSchema(db) {
  const p = await pool("src", db);
  // NOTE: the combined join (types + identity_columns + ORDER BY) is pathologically
  // slow on this source server (>110s). Split into 4 fast queries and join in JS.
  const colsBase = (await p.request().query(`
    SELECT c.object_id oid, c.name col, c.column_id ord, c.user_type_id utid,
           c.max_length maxlen, c.precision prec, c.scale scal, c.is_nullable nullable,
           c.is_identity isident, c.is_computed iscomp, c.collation_name coll
    FROM sys.columns c JOIN sys.tables t ON t.object_id=c.object_id
    WHERE t.is_ms_shipped=0`)).recordset;
  const typRows = (await p.request().query(`SELECT user_type_id utid, name typ FROM sys.types`)).recordset;
  const tblRows = (await p.request().query(`
    SELECT t.object_id oid, s.name sch, t.name tbl
    FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
    WHERE t.is_ms_shipped=0`)).recordset;
  const identRows = (await p.request().query(`
    SELECT object_id oid, column_id cid,
           CAST(ISNULL(seed_value,0) AS bigint) seed, CAST(ISNULL(increment_value,0) AS bigint) incr
    FROM sys.identity_columns`)).recordset;
  const typMap = new Map(typRows.map((r) => [r.utid, r.typ]));
  const tblMap = new Map(tblRows.map((r) => [r.oid, r]));
  const identMap = new Map(identRows.map((r) => [r.oid + "|" + r.cid, r]));
  const cols = colsBase
    .filter((c) => tblMap.has(c.oid))
    .map((c) => {
      const t = tblMap.get(c.oid);
      const idn = identMap.get(c.oid + "|" + c.ord);
      return {
        sch: t.sch, tbl: t.tbl, col: c.col, ord: c.ord, typ: typMap.get(c.utid),
        maxlen: c.maxlen, prec: c.prec, scal: c.scal, nullable: c.nullable,
        isident: c.isident, iscomp: c.iscomp, coll: c.coll,
        seed: idn ? idn.seed : 0, incr: idn ? idn.incr : 0,
      };
    })
    .sort((a, b) => a.sch.localeCompare(b.sch) || a.tbl.localeCompare(b.tbl) || a.ord - b.ord);
  const kcs = (await p.request().query(`
    SELECT s.name sch, t.name tbl, kc.name cname, kc.type ctype, i.type_desc itype,
           c.name col, icx.key_ordinal ko, icx.is_descending_key dsc
    FROM sys.key_constraints kc
    JOIN sys.tables t ON t.object_id=kc.parent_object_id
    JOIN sys.schemas s ON s.schema_id=t.schema_id
    JOIN sys.indexes i ON i.object_id=kc.parent_object_id AND i.index_id=kc.unique_index_id
    JOIN sys.index_columns icx ON icx.object_id=i.object_id AND icx.index_id=i.index_id
    JOIN sys.columns c ON c.object_id=icx.object_id AND c.column_id=icx.column_id
    WHERE t.is_ms_shipped=0 AND icx.is_included_column=0
    ORDER BY s.name, t.name, kc.name, icx.key_ordinal`)).recordset;
  const idxs = (await p.request().query(`
    SELECT s.name sch, t.name tbl, i.name iname, i.type_desc itype, i.is_unique isuniq,
           i.filter_definition filt, c.name col, icx.key_ordinal ko,
           icx.is_descending_key dsc, icx.is_included_column incl
    FROM sys.indexes i
    JOIN sys.tables t ON t.object_id=i.object_id
    JOIN sys.schemas s ON s.schema_id=t.schema_id
    JOIN sys.index_columns icx ON icx.object_id=i.object_id AND icx.index_id=i.index_id
    JOIN sys.columns c ON c.object_id=icx.object_id AND c.column_id=icx.column_id
    WHERE t.is_ms_shipped=0 AND i.is_primary_key=0 AND i.is_unique_constraint=0 AND i.type IN (1,2)
    ORDER BY s.name, t.name, i.name, icx.is_included_column, icx.key_ordinal`)).recordset;
  const dfts = (await p.request().query(`
    SELECT s.name sch, t.name tbl, dc.name cname, c.name col, dc.definition defn
    FROM sys.default_constraints dc
    JOIN sys.tables t ON t.object_id=dc.parent_object_id
    JOIN sys.schemas s ON s.schema_id=t.schema_id
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE t.is_ms_shipped=0`)).recordset;
  const chks = (await p.request().query(`
    SELECT s.name sch, t.name tbl, cc.name cname, cc.definition defn, cc.is_not_trusted nt, cc.is_disabled dis
    FROM sys.check_constraints cc
    JOIN sys.tables t ON t.object_id=cc.parent_object_id
    JOIN sys.schemas s ON s.schema_id=t.schema_id
    WHERE t.is_ms_shipped=0`)).recordset;
  const fks = (await p.request().query(`
    SELECT fk.name fname, ps.name psch, pt.name ptbl, rs.name rsch, rt.name rtbl,
           fk.is_not_trusted nt, fk.is_disabled dis,
           fk.delete_referential_action_desc delact, fk.update_referential_action_desc updact,
           pc.name pcol, rc.name rcol, fkc.constraint_column_id ord
    FROM sys.foreign_keys fk
    JOIN sys.tables pt ON pt.object_id=fk.parent_object_id
    JOIN sys.schemas ps ON ps.schema_id=pt.schema_id
    JOIN sys.tables rt ON rt.object_id=fk.referenced_object_id
    JOIN sys.schemas rs ON rs.schema_id=rt.schema_id
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id
    JOIN sys.columns pc ON pc.object_id=fkc.parent_object_id AND pc.column_id=fkc.parent_column_id
    JOIN sys.columns rc ON rc.object_id=fkc.referenced_object_id AND rc.column_id=fkc.referenced_column_id
    ORDER BY fk.name, fkc.constraint_column_id`)).recordset;
  const procs = (await p.request().query(`
    SELECT s.name sch, o.name pname, m.definition defn
    FROM sys.sql_modules m
    JOIN sys.objects o ON o.object_id=m.object_id
    JOIN sys.schemas s ON s.schema_id=o.schema_id
    WHERE o.type IN ('P','V','TR','FN','TF','IF') AND o.is_ms_shipped=0`)).recordset;
  const seqs = (await p.request().query(`SELECT COUNT(*) n FROM sys.sequences`)).recordset[0].n;
  if (seqs > 0) throw new Error(`source ${db} has ${seqs} sequences — unsupported`);
  const counts = (await p.request().query(`
    SELECT s.name sch, t.name tbl, SUM(pr.rows) rws
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id=t.schema_id
    JOIN sys.partitions pr ON pr.object_id=t.object_id AND pr.index_id IN (0,1)
    WHERE t.is_ms_shipped=0
    GROUP BY s.name, t.name`)).recordset;

  const tables = new Map();
  for (const c of cols) {
    const key = c.sch + "." + c.tbl;
    if (!tables.has(key)) tables.set(key, { sch: c.sch, tbl: c.tbl, cols: [], pk: null, uniques: [], indexes: [], defaults: [], checks: [], approxRows: 0 });
    if (c.iscomp) throw new Error(`computed column ${key}.${c.col} — unsupported`);
    tables.get(key).cols.push(c);
  }
  for (const r of counts) { const t = tables.get(r.sch + "." + r.tbl); if (t) t.approxRows = Number(r.rws); }
  for (const k of kcs) {
    const t = tables.get(k.sch + "." + k.tbl);
    if (!t) continue;
    if (k.ctype.trim() === "PK") {
      if (!t.pk) t.pk = { name: k.cname, clustered: k.itype === "CLUSTERED", cols: [] };
      t.pk.cols.push({ col: k.col, dsc: !!k.dsc });
    } else {
      let u = t.uniques.find((x) => x.name === k.cname);
      if (!u) { u = { name: k.cname, cols: [] }; t.uniques.push(u); }
      u.cols.push({ col: k.col, dsc: !!k.dsc });
    }
  }
  for (const x of idxs) {
    const t = tables.get(x.sch + "." + x.tbl);
    if (!t) continue;
    let ix = t.indexes.find((y) => y.name === x.iname);
    if (!ix) { ix = { name: x.iname, clustered: x.itype === "CLUSTERED", unique: !!x.isuniq, filter: x.filt, keys: [], incl: [] }; t.indexes.push(ix); }
    if (x.incl) ix.incl.push(x.col); else ix.keys.push({ col: x.col, dsc: !!x.dsc });
  }
  for (const d of dfts) { const t = tables.get(d.sch + "." + d.tbl); if (t) t.defaults.push(d); }
  for (const c of chks) { const t = tables.get(c.sch + "." + c.tbl); if (t) t.checks.push(c); }
  const fkMap = new Map();
  for (const f of fks) {
    if (!fkMap.has(f.fname)) fkMap.set(f.fname, { name: f.fname, psch: f.psch, ptbl: f.ptbl, rsch: f.rsch, rtbl: f.rtbl, nt: !!f.nt, dis: !!f.dis, delact: f.delact, updact: f.updact, pcols: [], rcols: [] });
    const m = fkMap.get(f.fname);
    m.pcols.push(f.pcol); m.rcols.push(f.rcol);
  }
  const out = { tables: [...tables.values()], fks: [...fkMap.values()], procs };
  fs.writeFileSync(SCHEMA_FILE(db), JSON.stringify(out));
  return out;
}
const readSchema = (db) => JSON.parse(fs.readFileSync(SCHEMA_FILE(db), "utf8"));

// ---------- type rendering ----------
function renderType(c) {
  const t = c.typ.toLowerCase();
  const nul = c.nullable ? " NULL" : " NOT NULL";
  const ident = c.isident ? ` IDENTITY(${c.seed},${c.incr})` : "";
  const n = (len) => (len === -1 ? "MAX" : String(len));
  let core;
  switch (t) {
    case "nvarchar": case "nchar": core = `${t}(${n(c.maxlen === -1 ? -1 : c.maxlen / 2)})`; break;
    case "varchar": case "char": case "varbinary": case "binary": core = `${t}(${n(c.maxlen)})`; break;
    case "decimal": case "numeric": core = `${t}(${c.prec},${c.scal})`; break;
    case "datetime2": case "datetimeoffset": case "time": core = `${t}(${c.scal})`; break;
    case "float": core = c.prec === 53 ? "float" : `float(${c.prec})`; break;
    case "timestamp": core = "rowversion"; break;
    default: core = t;
  }
  return `${id(c.col)} ${core}${ident}${nul}`;
}
const isRowversion = (c) => ["timestamp", "rowversion"].includes(c.typ.toLowerCase());
const isBinary = (c) => ["binary", "varbinary", "image"].includes(c.typ.toLowerCase());
const isDateish = (c) => ["datetime", "datetime2", "smalldatetime", "date", "time", "datetimeoffset"].includes(c.typ.toLowerCase());
const isFloatish = (c) => ["float", "real"].includes(c.typ.toLowerCase());
const isLob = (c) => c.maxlen === -1 || ["text", "ntext", "image", "xml"].includes(c.typ.toLowerCase());

function selExpr(c) {
  const t = c.typ.toLowerCase();
  if (isRowversion(c)) return null;
  if (isBinary(c)) return `CONVERT(varchar(max), ${id(c.col)}, 1) AS ${id(c.col)}`;
  if (isDateish(c)) return `CONVERT(nvarchar(60), ${id(c.col)}, 121) AS ${id(c.col)}`;
  if (isFloatish(c)) return `CONVERT(nvarchar(60), ${id(c.col)}, 3) AS ${id(c.col)}`;
  if (["decimal", "numeric", "money", "smallmoney", "bigint", "int", "smallint", "tinyint", "bit"].includes(t)) return `CAST(${id(c.col)} AS nvarchar(60)) AS ${id(c.col)}`;
  if (t === "uniqueidentifier") return `CAST(${id(c.col)} AS nvarchar(36)) AS ${id(c.col)}`;
  if (["nvarchar", "nchar", "varchar", "char", "text", "ntext", "xml", "sysname"].includes(t)) return `CAST(${id(c.col)} AS nvarchar(max)) AS ${id(c.col)}`;
  throw new Error(`unsupported type ${t} on column ${c.col}`);
}
function insLiteral(c, v) {
  if (v === null || v === undefined) return "NULL";
  if (isBinary(c)) {
    if (!/^0x[0-9A-Fa-f]*$/.test(v)) throw new Error(`bad hex for ${c.col}`);
    return v === "0x" ? "0x" : v;
  }
  return lit(v);
}

// ---------- phases ----------
async function phaseDdl(st) {
  for (const db of DBS) {
    if (st.ddl[db] === "done") continue;
    let sc;
    if (fs.existsSync(SCHEMA_FILE(db))) {
      console.log(`[ddl] ${db}: using cached schema`);
      sc = readSchema(db);
    } else {
      console.log(`[ddl] ${db}: extracting live schema...`);
      sc = await extractSchema(db);
    }
    const master = await new sql.ConnectionPool({ ...tgtCfg("master") }).connect();
    await master.request().query(`IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name=N'${db}') CREATE DATABASE ${id(db)} COLLATE SQL_Latin1_General_CP1_CI_AS`);
    await master.request().query(`ALTER DATABASE ${id(db)} SET COMPATIBILITY_LEVEL = 150`);
    await master.close();
    const tp = await pool("tgt", db);
    const schemas = [...new Set(sc.tables.map((t) => t.sch))].filter((s) => s !== "dbo");
    for (const s of schemas) await tp.request().query(`IF SCHEMA_ID(N'${s.replace(/'/g, "''")}') IS NULL EXEC('CREATE SCHEMA ${id(s)}')`);
    let made = 0;
    const existing = new Set(
      (await tp.request().query(`SELECT s.name + '.' + t.name f FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id`)).recordset.map((r) => r.f)
    );
    for (const t of sc.tables) {
      if (existing.has(t.sch + "." + t.tbl)) continue;
      const colDefs = t.cols.map(renderType);
      let ddl = `CREATE TABLE ${qt(t.sch, t.tbl)} (\n  ${colDefs.join(",\n  ")}`;
      if (t.pk) ddl += `,\n  CONSTRAINT ${id(t.pk.name)} PRIMARY KEY ${t.pk.clustered ? "CLUSTERED" : "NONCLUSTERED"} (${t.pk.cols.map((k) => id(k.col) + (k.dsc ? " DESC" : "")).join(",")})`;
      for (const u of t.uniques) ddl += `,\n  CONSTRAINT ${id(u.name)} UNIQUE (${u.cols.map((k) => id(k.col) + (k.dsc ? " DESC" : "")).join(",")})`;
      ddl += "\n)";
      const stmts = [ddl];
      for (const d of t.defaults) stmts.push(`ALTER TABLE ${qt(t.sch, t.tbl)} ADD CONSTRAINT ${id(d.cname)} DEFAULT ${d.defn} FOR ${id(d.col)}`);
      for (const ix of t.indexes) {
        const cols = ix.keys.map((k) => id(k.col) + (k.dsc ? " DESC" : "")).join(",");
        const incl = ix.incl.length ? ` INCLUDE (${ix.incl.map(id).join(",")})` : "";
        const filt = ix.filter ? ` WHERE ${ix.filter}` : "";
        stmts.push(`CREATE ${ix.unique ? "UNIQUE " : ""}${ix.clustered ? "CLUSTERED" : "NONCLUSTERED"} INDEX ${id(ix.name)} ON ${qt(t.sch, t.tbl)} (${cols})${incl}${filt}`);
      }
      // Single round-trip per table: high per-request latency dominates otherwise.
      await tp.request().batch(stmts.join(";\n"));
      made++;
      if (timeLeft() < 15_000) { console.log(`[ddl] ${db}: time budget hit after ${made} tables — RERUN`); saveState(st); return false; }
    }
    for (const pr of sc.procs) {
      try { await tp.request().batch(pr.defn); } catch (e) { if (!/already exists/i.test(e.message)) console.warn(`[ddl] proc ${pr.pname}: ${e.message}`); }
    }
    st.ddl[db] = "done";
    saveState(st);
    console.log(`[ddl] ${db}: done (${made} tables created this run)`);
  }
  return true;
}

function pageableKey(t) {
  if (!t.pk || t.pk.cols.length !== 1) return null;
  const col = t.cols.find((c) => c.col === t.pk.cols[0].col);
  if (!col) return null;
  const ty = col.typ.toLowerCase();
  if (["int", "bigint", "smallint", "tinyint", "decimal", "numeric"].includes(ty)) return { col: col.col, numeric: true };
  if (["uniqueidentifier", "nvarchar", "varchar", "char", "nchar"].includes(ty) && col.maxlen !== -1) return { col: col.col, numeric: false };
  return null;
}

async function insertRows(tp, t, insertCols, rows) {
  const hasIdent = t.cols.some((c) => c.isident);
  let i = 0;
  while (i < rows.length) {
    const parts = [];
    let chars = 0;
    while (i < rows.length && parts.length < MAX_BATCH_ROWS && chars < MAX_BATCH_CHARS) {
      const row = rows[i];
      const vals = insertCols.map((c) => insLiteral(c, row[c.col]));
      const tuple = "(" + vals.join(",") + ")";
      chars += tuple.length;
      parts.push(tuple);
      i++;
    }
    const colList = insertCols.map((c) => id(c.col)).join(",");
    let q = "SET XACT_ABORT ON;\n";
    if (hasIdent) q += `SET IDENTITY_INSERT ${qt(t.sch, t.tbl)} ON;\n`;
    q += `INSERT INTO ${qt(t.sch, t.tbl)} (${colList}) VALUES\n${parts.join(",\n")};\n`;
    if (hasIdent) q += `SET IDENTITY_INSERT ${qt(t.sch, t.tbl)} OFF;`;
    await tp.request().batch(q);
  }
}

async function phaseLoad(st) {
  for (const db of DBS) {
    if (st.ddl[db] !== "done") { console.log(`[load] ${db}: ddl not done — run ddl first`); return false; }
    const sc = readSchema(db);
    const sp = await pool("src", db);
    const tp = await pool("tgt", db);
    const tabs = [...sc.tables].sort((a, b) => a.approxRows - b.approxRows);
    for (const t of tabs) {
      const key = db + "|" + t.sch + "." + t.tbl;
      const tst = st.load[key] || { done: false, lastKey: null, rows: 0 };
      if (tst.done) continue;
      const insertCols = t.cols.filter((c) => !isRowversion(c));
      const exprs = insertCols.map(selExpr);
      const pk = pageableKey(t);
      if (!pk) {
        // Always clear: a killed run may have inserted rows without saving state.
        await tp.request().query(`DELETE FROM ${qt(t.sch, t.tbl)}`);
        tst.rows = 0; tst.lastKey = null;
      }
      while (true) {
        if (timeLeft() < 12_000) { st.load[key] = tst; saveState(st); console.log(`[load] time budget hit at ${key} (${tst.rows} rows) — RERUN`); return false; }
        let q;
        if (pk) {
          const kexpr = pk.numeric ? `CAST(${id(pk.col)} AS nvarchar(60))` : `CAST(${id(pk.col)} AS nvarchar(450))`;
          const where = tst.lastKey === null ? "" : ` WHERE ${id(pk.col)} > ${pk.numeric ? tst.lastKey : lit(tst.lastKey)}`;
          // ORDER BY must be qualified with the table alias: selExpr aliases every
          // column to its own name (e.g. CAST([ID] AS nvarchar) AS [ID]), and an
          // unqualified ORDER BY binds to the SELECT alias -> string sort -> broken
          // paging (duplicates + silently skipped rows).
          q = `SELECT TOP (${PAGE_ROWS}) ${exprs.join(",")}, ${kexpr} AS __k FROM ${qt(t.sch, t.tbl)} AS t0${where} ORDER BY t0.${id(pk.col)}`;
        } else {
          q = `SELECT ${exprs.join(",")} FROM ${qt(t.sch, t.tbl)}`;
        }
        const rows = (await sp.request().query(q)).recordset;
        if (rows.length === 0) break;
        if (pk) {
          // Idempotency: a prior run may have inserted this page without saving
          // state (process killed between insert and saveState). Clear the range.
          const k0 = rows[0].__k, k1 = rows[rows.length - 1].__k;
          const lo = pk.numeric ? k0 : lit(k0);
          const hi = pk.numeric ? k1 : lit(k1);
          const delR = await tp.request().query(`DELETE FROM ${qt(t.sch, t.tbl)} WHERE ${id(pk.col)} >= ${lo} AND ${id(pk.col)} <= ${hi}`);
          if (delR.rowsAffected[0] > 0) console.log(`[load] ${key}: cleared ${delR.rowsAffected[0]} stale rows in [${k0}..${k1}]`);
        }
        await insertRows(tp, t, insertCols, rows);
        tst.rows += rows.length;
        if (pk) {
          tst.lastKey = rows[rows.length - 1].__k;
          st.load[key] = tst; saveState(st);
          if (rows.length < PAGE_ROWS) break;
        } else {
          break;
        }
      }
      tst.done = true;
      st.load[key] = tst;
      saveState(st);
      if (tst.rows > 0) console.log(`[load] ${key}: ${tst.rows} rows`);
    }
    console.log(`[load] ${db}: all tables done`);
  }
  return true;
}

async function phaseFk(st) {
  for (const db of DBS) {
    if (st.fk[db] === "done") continue;
    const sc = readSchema(db);
    const tp = await pool("tgt", db);
    const failed = [];
    let n = 0;
    for (const f of sc.fks) {
      const exists = (await tp.request().query(`SELECT OBJECT_ID(N'${(f.psch + "." + f.name).replace(/'/g, "''")}','F') o`)).recordset[0].o;
      if (exists) { n++; continue; }
      const del = f.delact && f.delact !== "NO_ACTION" ? ` ON DELETE ${f.delact.replace(/_/g, " ")}` : "";
      const upd = f.updact && f.updact !== "NO_ACTION" ? ` ON UPDATE ${f.updact.replace(/_/g, " ")}` : "";
      const body = `CONSTRAINT ${id(f.name)} FOREIGN KEY (${f.pcols.map(id).join(",")}) REFERENCES ${qt(f.rsch, f.rtbl)} (${f.rcols.map(id).join(",")})${del}${upd}`;
      const withCheck = f.nt || f.dis ? "WITH NOCHECK" : "WITH CHECK";
      try {
        await tp.request().query(`ALTER TABLE ${qt(f.psch, f.ptbl)} ${withCheck} ADD ${body}`);
      } catch (e1) {
        try {
          await tp.request().query(`ALTER TABLE ${qt(f.psch, f.ptbl)} WITH NOCHECK ADD ${body}`);
          failed.push(f.name + " (added NOCHECK: " + e1.message.slice(0, 80) + ")");
        } catch (e2) {
          failed.push(f.name + " FAILED: " + e2.message.slice(0, 120));
        }
      }
      if (f.dis) { try { await tp.request().query(`ALTER TABLE ${qt(f.psch, f.ptbl)} NOCHECK CONSTRAINT ${id(f.name)}`); } catch {} }
      n++;
      if (timeLeft() < 10_000) { saveState(st); console.log(`[fk] ${db}: budget hit at ${n}/${sc.fks.length} — RERUN`); return false; }
    }
    for (const t of sc.tables) {
      for (const c of t.checks) {
        try {
          await tp.request().query(`ALTER TABLE ${qt(t.sch, t.tbl)} ${c.nt || c.dis ? "WITH NOCHECK" : "WITH CHECK"} ADD CONSTRAINT ${id(c.cname)} CHECK ${c.defn}`);
        } catch (e) { if (!/already exists/i.test(e.message)) failed.push(c.cname + ": " + e.message.slice(0, 80)); }
      }
    }
    st.fk[db] = "done";
    st.fk[db + "_issues"] = failed;
    saveState(st);
    console.log(`[fk] ${db}: done, ${sc.fks.length} FKs, issues: ${failed.length}`);
    for (const f of failed) console.log("   !", f);
  }
  return true;
}

async function phaseVerify(st) {
  let allOk = true;
  for (const db of DBS) {
    const sp = await pool("src", db);
    const tp = await pool("tgt", db);
    const q = `SELECT s.name sch, t.name tbl, SUM(pr.rows) rws FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.partitions pr ON pr.object_id=t.object_id AND pr.index_id IN (0,1) WHERE t.is_ms_shipped=0 GROUP BY s.name, t.name`;
    const [a, b] = await Promise.all([sp.request().query(q), tp.request().query(q)]);
    const am = new Map(a.recordset.map((r) => [r.sch + "." + r.tbl, Number(r.rws)]));
    const bm = new Map(b.recordset.map((r) => [r.sch + "." + r.tbl, Number(r.rws)]));
    let bad = 0;
    for (const [k, v] of am) {
      const w = bm.has(k) ? bm.get(k) : -1;
      if (v !== w) { console.log(`[verify] ${db} MISMATCH ${k}: src=${v} tgt=${w}`); bad++; }
    }
    for (const k of bm.keys()) if (!am.has(k)) { console.log(`[verify] ${db} EXTRA on target: ${k}`); bad++; }
    console.log(`[verify] ${db}: ${am.size} tables, mismatches: ${bad}`);
    if (bad) allOk = false;
    const sc = readSchema(db);
    const big = [...sc.tables].sort((x, y) => y.approxRows - x.approxRows).slice(0, 10).filter((t) => t.approxRows > 0);
    for (const t of big) {
      const cols = t.cols.filter((c) => !isRowversion(c) && !isLob(c) && !isFloatish(c)).map((c) => id(c.col));
      if (!cols.length) continue;
      const cq = `SELECT CHECKSUM_AGG(BINARY_CHECKSUM(${cols.join(",")})) ck FROM ${qt(t.sch, t.tbl)}`;
      try {
        const [x, y] = await Promise.all([sp.request().query(cq), tp.request().query(cq)]);
        const ok = x.recordset[0].ck === y.recordset[0].ck;
        if (!ok) { console.log(`[verify] ${db} CHECKSUM MISMATCH ${t.sch}.${t.tbl}`); allOk = false; }
        else console.log(`[verify] ${db} checksum ok: ${t.sch}.${t.tbl} (${t.approxRows} rows)`);
      } catch (e) { console.log(`[verify] ${db} checksum skipped ${t.tbl}: ${e.message.slice(0, 80)}`); }
    }
  }
  st.verify.result = allOk ? "PASS" : "FAIL";
  saveState(st);
  console.log(`[verify] overall: ${st.verify.result}`);
  return allOk;
}

// ---------- main ----------
const phase = process.argv[2];
const st = loadState();
try {
  let complete = false;
  if (phase === "ddl") complete = await phaseDdl(st);
  else if (phase === "load") complete = await phaseLoad(st);
  else if (phase === "fk") complete = await phaseFk(st);
  else if (phase === "verify") complete = await phaseVerify(st);
  else if (phase === "status") {
    console.log("ddl:", JSON.stringify(st.ddl));
    const done = Object.values(st.load).filter((x) => x.done).length;
    console.log("load tables done:", done, "| fk:", JSON.stringify(st.fk).slice(0, 200), "| verify:", JSON.stringify(st.verify));
    complete = true;
  } else { console.log("usage: migrate-to-aws.mjs <ddl|load|fk|verify|status>"); process.exit(1); }
  await closeAll();
  console.log(complete ? "PHASE_COMPLETE" : "PHASE_INCOMPLETE_RERUN");
  process.exit(complete ? 0 : 2);
} catch (e) {
  saveState(st);
  console.error("ERROR:", e.message);
  await closeAll();
  process.exit(1);
}
