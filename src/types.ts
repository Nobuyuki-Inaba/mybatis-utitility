// ---------------------------------------------------------------------------
// Database connection configuration
//
// To add a new database type:
//   1. Add a new literal to DbType.
//   2. Add a new Config interface with `type` discriminant.
//   3. Add it to DbConnectionConfig union.
//   4. Create src/drivers/<type>.ts implementing DbDriver.
//   5. Register the driver in src/dbManager.ts.
// That's it — no other files need changing.
// ---------------------------------------------------------------------------

export type DbType = 'sqlite' | 'postgresql' | 'mysql';

export interface SqliteConfig {
  id: string;
  label: string;
  type: 'sqlite';
  filePath: string;
}

export interface PostgresConfig {
  id: string;
  label: string;
  type: 'postgresql';
  host: string;
  port: number;
  database: string;
  schema: string;
  username: string;
}

export interface MysqlConfig {
  id: string;
  label: string;
  type: 'mysql';
  host: string;
  port: number;
  database: string;
  username: string;
}

export type DbConnectionConfig = SqliteConfig | PostgresConfig | MysqlConfig;

/** Distributive Omit — use this instead of Omit<DbConnectionConfig, 'id'> */
export type NewDbConnectionConfig =
  | Omit<SqliteConfig,   'id'>
  | Omit<PostgresConfig, 'id'>
  | Omit<MysqlConfig,    'id'>;

// ---------------------------------------------------------------------------
// Parameter types
// Each entry in this union maps 1-to-1 to a dropdown option in the webview.
// To support a new SQL type, add a new entry here and handle it in
// queryParser.ts#buildExecutableSql and the webview param table renderer.
// ---------------------------------------------------------------------------

export type ParamType =
  | 'string'   // wrapped in single quotes
  | 'number'   // written as-is (integer or decimal)
  | 'boolean'  // written as TRUE / FALSE
  | 'date'     // written as DATE 'YYYY-MM-DD'
  | 'null';    // written as NULL regardless of value

export const PARAM_TYPES: ParamType[] = ['string', 'number', 'boolean', 'date', 'null'];

export interface ParamEntry {
  name: string;
  value: string;
  type: ParamType;
}

export interface ParamPreset {
  name: string;
  params: ParamEntry[];
}

// ---------------------------------------------------------------------------
// Parsed mapper / query items
// ---------------------------------------------------------------------------

export type QueryKind = 'select' | 'insert' | 'update' | 'delete' | 'unknown';

export interface ParsedQuery {
  id: string;          // method name or XML id attribute
  kind: QueryKind;
  sql: string;         // raw SQL (with #{}/${} placeholders intact)
  params: string[];    // ordered list of placeholder names (deduplicated)
}

export interface MapperFile {
  source: 'java' | 'xml' | 'sql';
  filePath: string;
  label: string;       // class name or file basename
  queries: ParsedQuery[];
}

// ---------------------------------------------------------------------------
// Query execution result
// ---------------------------------------------------------------------------

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
  truncated?: boolean; // true when row count hit the fetch limit
}

// ---------------------------------------------------------------------------
// Webview ↔ Extension message protocol
// ---------------------------------------------------------------------------

// Extension → Webview
export type ExtToWebMsg =
  | { type: 'setQuery'; query: ParsedQuery; mapperLabel: string; canWriteBack: boolean; mapperSource: MapperFile['source'] }
  | { type: 'queryResult'; result: QueryResult }
  | { type: 'queryError'; message: string }
  | { type: 'connections'; items: DbConnectionConfig[] }
  | { type: 'connectionSaved' }
  | { type: 'connectionDeleted'; id: string }
  | { type: 'settings'; fetchLimit: number; pageSize: number }
  | { type: 'presets'; presets: ParamPreset[] };

// Webview → Extension
export type WebToExtMsg =
  | { type: 'execute'; mode: 'range' | 'all' | 'explain'; params: ParamEntry[]; selectedText?: string; displayedSql?: string; connectionId: string }
  | { type: 'getConnections' }
  | { type: 'saveConnection'; config: NewDbConnectionConfig; password?: string }
  | { type: 'deleteConnection'; id: string }
  | { type: 'savePreset'; presetName: string; params: ParamEntry[] }
  | { type: 'deletePreset'; presetName: string }
  | { type: 'saveSql'; sql: string }
  | { type: 'previewWriteBack'; sql: string }
  | { type: 'reloadSql' };

// ---------------------------------------------------------------------------
// SQL Files panel
// ---------------------------------------------------------------------------

export interface SqlFile {
  path: string;     // full file system path
  label: string;    // filename (e.g. "selectUsers.sql")
  folder: string;   // relative directory path for tree-view grouping
}

// Extension → SQL Files sidebar webview
export type SqlToWebMsg =
  | { type: 'setFiles'; items: SqlFile[]; hasFolders: boolean }
  | { type: 'setDisplayMode'; mode: 'flat' | 'tree' }
  | { type: 'setLoading'; loading: boolean };

// SQL Files sidebar webview → Extension
export type WebToSqlMsg =
  | { type: 'ready' }
  | { type: 'openFile'; path: string }
  | { type: 'refresh' };

// ---------------------------------------------------------------------------
// Dataset panel
// ---------------------------------------------------------------------------

export interface DatasetFile {
  path: string;
  label: string;
  fileType: 'csv' | 'xlsx';
  /** xlsx: sheet names; csv: [basename without extension] */
  sheets: string[];
}

export interface SheetMapping {
  sheetName: string;
  tableName: string;
  enabled: boolean;
}

// Extension → Dataset sidebar webview
export type DatasetToWebMsg =
  | { type: 'setFiles'; items: DatasetFile[] }
  | { type: 'setDisplayMode'; mode: 'flat' | 'tree' }
  | { type: 'setLoading'; loading: boolean };

// Dataset sidebar webview → Extension
export type WebToDatasetMsg =
  | { type: 'ready' }
  | { type: 'openLoader'; file: DatasetFile }
  | { type: 'refresh' };

// Extension → Dataset loader panel webview
export type LoaderExtToWebMsg =
  | { type: 'init'; file: DatasetFile; connections: DbConnectionConfig[] }
  | { type: 'preview'; sheet: string; columns: string[]; rows: unknown[][] }
  | { type: 'loadResult'; success: boolean; message: string };

// Dataset loader panel webview → Extension
export type LoaderWebToExtMsg =
  | { type: 'getPreview'; sheet: string }
  | { type: 'load'; connectionId: string; mappings: SheetMapping[] };
