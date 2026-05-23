import { PostgresConfig, QueryResult } from '../types';

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
