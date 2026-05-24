import { Readable } from 'stream';
import { PostgresConfig, QueryResult } from '../types';

export function explainSql(sql: string): string {
  return `EXPLAIN ${sql}`;
}

function quoteId(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function toCsvField(v: unknown): string {
  if (v === null || v === undefined) { return '\\N'; }
  const s = String(v instanceof Date ? v.toISOString() : v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r') || s === '\\N') {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function bulkLoad(
  config: PostgresConfig,
  password: string | undefined,
  tableName: string,
  columns: string[],
  rows: unknown[][]
): Promise<{ inserted: number }> {
  if (columns.length === 0) { return { inserted: 0 }; }

  const { Client } = await import('pg');
  const { from: copyFrom } = await import('pg-copy-streams');

  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password,
    ssl: false,
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const tbl = quoteId(tableName);
    await client.query(`DELETE FROM ${tbl}`);

    if (rows.length > 0) {
      const colList = columns.map(quoteId).join(', ');
      const copyQuery = `COPY ${tbl} (${colList}) FROM STDIN WITH (FORMAT csv, NULL '\\N')`;
      const copyStream = client.query(copyFrom(copyQuery));

      const csvData = rows.map(row => row.map(toCsvField).join(',') + '\n').join('');
      const readable = Readable.from([csvData]);

      await new Promise<void>((resolve, reject) => {
        readable.on('error', reject);
        copyStream.on('error', reject);
        copyStream.on('finish', resolve);
        readable.pipe(copyStream);
      });
    }

    await client.query('COMMIT');
    return { inserted: rows.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* ignore */ });
    throw err;
  } finally {
    await client.end();
  }
}

export async function execute(config: PostgresConfig, password: string | undefined, sql: string, maxRows: number): Promise<QueryResult> {
  const start = Date.now();
  const { Client } = await import('pg');
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password,
    ssl: false,
  });
  await client.connect();
  try {
    const res = await client.query(sql);
    const columns: string[] = res.fields.map((f: { name: string }) => f.name);
    const allRows = (res.rows as Record<string, unknown>[]).map(r => columns.map(c => r[c]));
    const truncated = allRows.length > maxRows;
    const rows = truncated ? allRows.slice(0, maxRows) : allRows;
    return {
      columns,
      rows,
      rowCount: rows.length,
      durationMs: Date.now() - start,
      truncated,
    };
  } finally {
    await client.end();
  }
}
