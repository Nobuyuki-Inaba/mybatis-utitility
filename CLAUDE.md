# CLAUDE.md — MyBatis Utility development guide

## Project overview

VSCode extension (`mybatis-utility`, publisher `nobuyuki-inaba`) that lets MyBatis developers browse Mapper files and run SQL queries against configured databases from inside VSCode.

## Build commands

```powershell
npm run build      # full build (type-check + esbuild for extension + webviews)
npm run package    # build + vsce package → produces *.vsix
```

The build is split into two esbuild passes:
- **Extension** (`src/extension.ts` → `out/extension.js`): Node CJS, `--external:vscode --external:sql.js`
- **Webviews** (`media/src/*.ts` → `media/*.js`): IIFE for browser, no Node APIs

Type-checking uses two tsconfig files to handle the DOM / Node split:
- `tsconfig.build.json` — Node types, `src/` only
- `tsconfig.webview.json` — DOM types, `media/src/` + `src/types.ts`, `rootDir: "."`

## Key files

```
src/
  extension.ts              # activation, command registration, quick-add wizard
  types.ts                  # shared type definitions (DbConnectionConfig, ParamEntry, ExtToWebMsg, …)
  configManager.ts          # read/write DB connections + passwords (VSCode Secret Storage)
  mapperWebviewProvider.ts  # WebviewViewProvider — Mappers panel (filter input + scan logic)
  mapperProvider.ts         # TreeDataProvider helpers (FolderItem, MapperFileItem, MapperQueryItem)
  mapperScanner.ts          # pure parsing logic (no VSCode API — unit-testable via FileReader interface)
  queryParser.ts            # extract #{} placeholders, buildExecutableSql(), formatValue()
  queryPanel.ts             # WebviewPanel for query execution (singleton); handles execute/explain/preview
  configPanel.ts            # WebviewPanel for DB connection management (singleton)
  databaseProvider.ts       # TreeDataProvider for the Databases sidebar view
  dbManager.ts              # driver registry — registerDriver(type, driver); also bulkLoad()
  extensionContext.ts       # setExtensionPath() / getExtensionPath() for sql.js WASM location
  datasetWebviewProvider.ts # WebviewViewProvider — Dataset panel (filter input, flat/tree toggle, scans CSV/XLSX fixture files)
  datasetLoaderPanel.ts     # WebviewPanel for bulk-loading a fixture file into a table (singleton)
  datasetLoader.ts          # readSheetData() via ExcelJS; loadSheetToDb() via dbManager.bulkLoad()
  datasetScanner.ts         # scanDatasetFiles() — finds CSV/XLSX under configured directories
  drivers/
    sqlite.ts               # sql.js (pure WASM, no native build required); implements bulkLoad
    postgresql.ts           # pg (pure JS); implements bulkLoad
    mysql.ts                # mysql2/promise (pure JS); implements bulkLoad

media/src/
  queryPanel.ts             # webview script — DOM only, no Node APIs; Preview SQL + Explain buttons
  configPanel.ts            # webview script for DB config panel
  mapperPanel.ts            # webview script for Mappers panel (filter, flat/tree render)
  datasetPanel.ts           # webview script for Dataset panel (filter input, flat/tree render, lists CSV/XLSX files)
  datasetLoaderPanel.ts     # webview script for Dataset Loader (preview table, sheet→table mapping)

sample/                     # test fixtures
  src/main/java/…/          # Java @Mapper samples (SampleMapper, UserMapper)
  src/main/resources/mapper/  # XML mapper samples
  fixtures/                 # sample CSV/XLSX files for dataset loader testing
  test.db                   # SQLite test database (sample + users + wide_table)
```

## Architecture decisions

### Extensibility patterns

**Adding a new DB type** (e.g., Oracle):
1. Add literal to `DbType` in `types.ts`
2. Add config interface + union in `types.ts`
3. Create `src/drivers/oracle.ts` implementing `execute(config, password, sql, maxRows)`
4. Call `registerDriver('oracle', { execute: … })` in `dbManager.ts`
5. Add field definitions to `DB_FIELDS` in `media/src/configPanel.ts`

**Adding a new parameter type** (e.g., `uuid`):
1. Add to `ParamType` union in `types.ts`
2. Handle in `formatValue()` switch in `queryParser.ts`
(The webview param-type dropdown auto-reads from the union via the `PARAM_TYPES` array)

**CSV export (all rows, bypassing fetchLimit)**:
The current Export CSV exports fetched rows (up to fetchLimit). For true unlimited export: add `{ type: 'exportCsvAll' }` to `WebToExtMsg`, store last params/sql in `QueryPanel._lastExecContext`, re-run `executeQuery` with `maxRows = Infinity`, write file via `vscode.window.showSaveDialog`.

**Adding a new bulk-loadable driver**:
Each driver must also export `bulkLoad(config, password, tableName, columns, rows)` which deletes all rows from the table and re-inserts them. See existing drivers for the pattern. Register with `registerDriver()` in `dbManager.ts`.

### Row limits
- `fetchLimit` (default 5000): read from `mybatisUtility.fetchLimit` setting at execute time
- `pageSize` (default 200): sent to webview via `settings` message; webview re-renders on change
- Both are configurable in VSCode Settings

### Mappers panel (WebviewView)

`mapperWebviewProvider.ts` implements `vscode.WebviewViewProvider` (view type `mybatisUtility.mapperView`, declared as `"type": "webview"` in `package.json`).

- `resolveWebviewView()` sets the HTML and kicks off `_scan()`. Scan results are sent to the webview via `{ type: 'setMappers', items }`.
- `setDisplayMode('flat'|'tree')` sends `{ type: 'setDisplayMode', mode }` — called by the title-bar toggle commands in `extension.ts`.
- The webview script (`media/src/mapperPanel.ts`) handles all filtering and rendering client-side (150 ms debounce). No round-trip to the extension for filter changes.
- Clicking a query in the webview posts `{ type: 'openQuery', query, mapperFile }` → `MapperWebviewProvider` calls `QueryPanel.show()` directly.

### Webview message protocol

Query/Config panels (`src/types.ts`):
- `ExtToWebMsg` — extension → webview (setQuery, queryResult, queryError, connections, connectionSaved, connectionDeleted, **settings**)
- `WebToExtMsg` — extension ← webview (execute `{mode:'all'|'range'|'explain'}`, getConnections, saveConnection, deleteConnection)

Mapper panel (ad-hoc, not in types.ts):
- Extension → webview: `{ type: 'setMappers', items: MapperFile[] }`, `{ type: 'setDisplayMode', mode }`
- Webview → extension: `{ type: 'openQuery', query, mapperFile }`, `{ type: 'openSettings' }`

Dataset panel (`DatasetToWebMsg` / `WebToDatasetMsg` in `types.ts`):
- Extension → webview: `{ type: 'setFiles', items: DatasetFile[] }`, `{ type: 'setDisplayMode', mode }`
- Webview → extension: `{ type: 'openLoader', file }`, `{ type: 'refresh' }`

Dataset loader panel (`LoaderExtToWebMsg` / `LoaderWebToExtMsg` in `types.ts`):
- Extension → webview: `init`, `preview { sheet, columns, rows }`, `loadResult { success, message }`
- Webview → extension: `getPreview { sheet }`, `load { connectionId, mappings }`

### SQL execution flow

1. User clicks query in Mappers panel → webview posts `openQuery` → `QueryPanel.show()`
2. User clicks execute → webview posts `execute` with `displayedSql` (editable div content) and `mode` (`'all'` | `'range'` | `'explain'`)
3. Extension reads `fetchLimit` from settings, calls `buildExecutableSql()` → `executeQuery()` or `explainQuery()`
4. Result posted back as `queryResult` → webview paginates display

**Live SQL preview** is entirely client-side: the webview's `buildPreviewSql()` substitutes parameters using `_formatPreviewValue()` and renders the result as `<pre>`. No round-trip to the extension.

**Explain plan**: `mode: 'explain'` in `execute` message → extension calls `explainQuery(conn, password, sql)` in `dbManager.ts` (each driver implements its own `EXPLAIN` syntax) → result returned as a normal `queryResult` table.

### Webview lifecycle

- `domReady` flag + `pendingSetQuery` guard: the `setQuery` message can arrive before `DOMContentLoaded`
- `buildLayout()` must be called **before** wiring event listeners
- Result table uses `max-height: 60vh; overflow: auto` so horizontal scroll bar stays visible

### Security

- Webview CSP: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'`
- Passwords: VSCode SecretStorage, key `mybatisUtility.${id}.password`
- SQL is user-supplied — no sanitization (intended: this is a developer tool)

## Release process

Tag `v*` on main triggers `.github/workflows/release.yml`:
- Runs `npm run package` → produces `mybatis-utility-{version}.vsix`
- Creates GitHub Release with the VSIX as attachment and auto-generated release notes

```powershell
git tag v0.4.0
git push origin v0.4.0
```

To publish to VS Code Marketplace:
```powershell
npx vsce publish
```
(requires `VSCE_PAT` personal access token)
