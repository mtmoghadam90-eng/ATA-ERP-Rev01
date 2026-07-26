import sql from "mssql";
import { buildReportingTables, FlatDataset, Row, StoreCollections } from "./flatten";

/**
 * One-way sync of the application store into SQL Server reporting tables.
 *
 * The app keeps running on its own store; this only *writes out* a flat,
 * relational copy for Power BI. Every run replaces the contents of each table
 * inside a single transaction, so a failed run never leaves partial data and
 * readers never see a half-loaded model. Volumes here are small enough that
 * replace-all is simpler and safer than incremental deltas.
 */

const SCHEMA = process.env.ERP_SQL_SCHEMA || "rpt";

export interface SqlSyncConfig {
  server: string;
  database: string;
  user?: string;
  password?: string;
  port?: number;
  /** Windows/NTLM instead of SQL auth. */
  trustedConnection?: boolean;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

export function readConfigFromEnv(): SqlSyncConfig | null {
  const server = process.env.ERP_SQL_SERVER;
  const database = process.env.ERP_SQL_DATABASE;
  if (!server || !database) return null;
  return {
    server,
    database,
    user: process.env.ERP_SQL_USER,
    password: process.env.ERP_SQL_PASSWORD,
    port: process.env.ERP_SQL_PORT ? Number(process.env.ERP_SQL_PORT) : undefined,
    trustedConnection: process.env.ERP_SQL_TRUSTED === "true",
    // SQL Server 2017 commonly uses a self-signed cert on a LAN.
    encrypt: process.env.ERP_SQL_ENCRYPT === "true",
    trustServerCertificate: process.env.ERP_SQL_TRUST_CERT !== "false",
  };
}

function toPoolConfig(cfg: SqlSyncConfig): sql.config {
  return {
    server: cfg.server,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    port: cfg.port || 1433,
    options: {
      encrypt: !!cfg.encrypt,
      trustServerCertificate: cfg.trustServerCertificate !== false,
      trustedConnection: !!cfg.trustedConnection,
      enableArithAbort: true,
    },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 120000,
    connectionTimeout: 30000,
  };
}

/* ------------------------- schema inference ------------------------- */

type ColType = "nvarchar" | "float" | "bit";

/** Infers each column's type from the data, defaulting to text. */
function inferColumns(rows: Row[]): Record<string, ColType> {
  const cols: Record<string, ColType> = {};
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) {
        if (!(k in cols)) cols[k] = "nvarchar";
        continue;
      }
      const t: ColType =
        typeof v === "number" ? "float" : typeof v === "boolean" ? "bit" : "nvarchar";
      const prev = cols[k];
      if (!prev) cols[k] = t;
      // Mixed types degrade to text so nothing is lost.
      else if (prev !== t) cols[k] = "nvarchar";
    }
  }
  return cols;
}

const sqlTypeOf = (t: ColType): string =>
  t === "float" ? "FLOAT" : t === "bit" ? "BIT" : "NVARCHAR(MAX)";

const bracket = (name: string) => `[${name.replace(/]/g, "]]")}]`;

/* ------------------------- sync ------------------------- */

export interface SyncResult {
  ok: boolean;
  syncedAt: string;
  tables: { table: string; rows: number }[];
  totalRows: number;
  error?: string;
}

/**
 * Loads every reporting table. `store` must already be parsed into arrays.
 */
export async function syncToSqlServer(
  store: StoreCollections,
  cfg: SqlSyncConfig,
): Promise<SyncResult> {
  const datasets = buildReportingTables(store);
  const syncedAt = new Date().toISOString();
  let pool: sql.ConnectionPool | null = null;

  try {
    pool = await new sql.ConnectionPool(toPoolConfig(cfg)).connect();

    // Schema is created outside the transaction (DDL + DML in one tx is brittle here).
    await pool
      .request()
      .query(
        `IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = '${SCHEMA}') EXEC('CREATE SCHEMA ${SCHEMA}')`,
      );

    for (const ds of datasets) {
      await ensureTable(pool, ds);
    }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const ds of datasets) {
        await loadTable(tx, ds, syncedAt);
      }
      await writeSyncLog(tx, datasets, syncedAt);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    return {
      ok: true,
      syncedAt,
      tables: datasets.map((d) => ({ table: d.table, rows: d.rows.length })),
      totalRows: datasets.reduce((a, d) => a + d.rows.length, 0),
    };
  } catch (err: any) {
    return {
      ok: false,
      syncedAt,
      tables: [],
      totalRows: 0,
      error: err?.message || String(err),
    };
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
}

/** Creates the table if missing, and adds any column that appeared since. */
async function ensureTable(pool: sql.ConnectionPool, ds: FlatDataset) {
  const cols = inferColumns(ds.rows);
  // A table with no rows yet still needs to exist so Power BI sees the model.
  const columnDefs = Object.entries(cols).map(
    ([name, t]) => `${bracket(name)} ${sqlTypeOf(t)} NULL`,
  );
  columnDefs.push(`[_synced_at] NVARCHAR(40) NULL`);

  const full = `${bracket(SCHEMA)}.${bracket(ds.table)}`;

  if (columnDefs.length === 1) {
    // No inferable columns (empty dataset with unknown shape) — placeholder table.
    await pool.request().query(
      `IF OBJECT_ID('${SCHEMA}.${ds.table}', 'U') IS NULL
         CREATE TABLE ${full} ([_synced_at] NVARCHAR(40) NULL)`,
    );
    return;
  }

  await pool.request().query(
    `IF OBJECT_ID('${SCHEMA}.${ds.table}', 'U') IS NULL
       CREATE TABLE ${full} (${columnDefs.join(", ")})`,
  );

  // Add columns introduced by newer app versions.
  const existing = await pool
    .request()
    .input("t", sql.NVarChar, ds.table)
    .input("s", sql.NVarChar, SCHEMA)
    .query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @t AND TABLE_SCHEMA = @s`,
    );
  const have = new Set(
    existing.recordset.map((r: any) => String(r.COLUMN_NAME).toLowerCase()),
  );
  for (const [name, t] of Object.entries(cols)) {
    if (!have.has(name.toLowerCase())) {
      await pool
        .request()
        .query(`ALTER TABLE ${full} ADD ${bracket(name)} ${sqlTypeOf(t)} NULL`);
    }
  }
}

/** Replaces a table's contents, inserting in batches. */
async function loadTable(tx: sql.Transaction, ds: FlatDataset, syncedAt: string) {
  const full = `${bracket(SCHEMA)}.${bracket(ds.table)}`;
  await new sql.Request(tx).query(`DELETE FROM ${full}`);
  if (ds.rows.length === 0) return;

  const cols = Object.keys(inferColumns(ds.rows));
  if (cols.length === 0) return;

  const BATCH = 200;
  for (let start = 0; start < ds.rows.length; start += BATCH) {
    const chunk = ds.rows.slice(start, start + BATCH);
    const req = new sql.Request(tx);
    const valueGroups: string[] = [];

    chunk.forEach((row, i) => {
      const params: string[] = [];
      cols.forEach((c, ci) => {
        const p = `p${i}_${ci}`;
        const v = row[c];
        if (v === null || v === undefined) req.input(p, sql.NVarChar(sql.MAX), null);
        else if (typeof v === "number") req.input(p, sql.Float, v);
        else if (typeof v === "boolean") req.input(p, sql.Bit, v);
        else req.input(p, sql.NVarChar(sql.MAX), String(v));
        params.push(`@${p}`);
      });
      const sp = `s${i}`;
      req.input(sp, sql.NVarChar, syncedAt);
      params.push(`@${sp}`);
      valueGroups.push(`(${params.join(", ")})`);
    });

    const colList = [...cols.map(bracket), bracket("_synced_at")].join(", ");
    await req.query(`INSERT INTO ${full} (${colList}) VALUES ${valueGroups.join(", ")}`);
  }
}

/** Records each run so report authors can see data freshness. */
async function writeSyncLog(
  tx: sql.Transaction,
  datasets: FlatDataset[],
  syncedAt: string,
) {
  const full = `${bracket(SCHEMA)}.${bracket("_sync_log")}`;
  await new sql.Request(tx).query(
    `IF OBJECT_ID('${SCHEMA}._sync_log', 'U') IS NULL
       CREATE TABLE ${full} (
         [synced_at] NVARCHAR(40) NULL,
         [table_name] NVARCHAR(200) NULL,
         [row_count] INT NULL
       )`,
  );
  await new sql.Request(tx).query(`DELETE FROM ${full}`);
  for (const ds of datasets) {
    await new sql.Request(tx)
      .input("a", sql.NVarChar, syncedAt)
      .input("t", sql.NVarChar, ds.table)
      .input("c", sql.Int, ds.rows.length)
      .query(`INSERT INTO ${full} ([synced_at],[table_name],[row_count]) VALUES (@a,@t,@c)`);
  }
}

/** Quick connectivity probe for diagnostics. */
export async function testConnection(
  cfg: SqlSyncConfig,
): Promise<{ ok: boolean; version?: string; error?: string }> {
  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await new sql.ConnectionPool(toPoolConfig(cfg)).connect();
    const r = await pool.request().query("SELECT @@VERSION AS v");
    return { ok: true, version: String(r.recordset?.[0]?.v || "").split("\n")[0] };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
}
