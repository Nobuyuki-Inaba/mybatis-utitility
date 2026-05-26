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
- `tsconfig.build.json` — Node types, `src/` only (excludes `test/`)
- `tsconfig.webview.json` — DOM types, `media/src/` + `src/types.ts`, `rootDir: "."`
- `tsconfig.test.json` — Node types + jest, includes `src/` + `test/`, `moduleResolution: node`

Unit tests run with jest + ts-jest:
```powershell
npm test    # runs test/**/*.test.ts
```

## Key files

```
src/
  extension.ts              # activation, command registration, quick-add wizard; addIncludePattern() / addExcludePattern() QuickPick commands
  types.ts                  # shared type definitions (DbConnectionConfig, ParamEntry, ExtToWebMsg, …)
  configManager.ts          # read/write DB connections + passwords (VSCode Secret Storage)
  mapperWebviewProvider.ts  # WebviewViewProvider — Mappers panel; _scan() iterates workspaceFolders with per-folder config (scanFolders + scanExclude)
  mapperProvider.ts         # TreeDataProvider helpers (FolderItem, MapperFileItem, MapperQueryItem)
  mapperScanner.ts          # pure parsing logic; isProviderMapper() skips @SelectProvider/@InsertProvider etc. files
  scanUtils.ts              # pure helpers: makeGlob(), buildExcludeGlob(), MAPPER_DEFAULT_EXCLUDE, DATASET_DEFAULT_EXCLUDE
  sheetReader.ts            # SheetReader interface + CsvReader + XlsxReader + getSheetReader() registry; registerSheetReader() for new formats
  queryParser.ts            # extract #{} placeholders, buildExecutableSql(), formatValue()
  queryPanel.ts             # WebviewPanel for query execution (singleton); handles execute/explain/preview
  configPanel.ts            # WebviewPanel for DB connection management (singleton)
  databaseProvider.ts       # TreeDataProvider for the Databases sidebar view
  dbManager.ts              # driver registry — registerDriver(type, driver); also bulkLoad()
  extensionContext.ts       # setExtensionPath() / getExtensionPath() for sql.js WASM location
  datasetWebviewProvider.ts # WebviewViewProvider — Dataset panel; _scan() builds per-folder FolderScanConfig[] from datasetDirectories + datasetExclude
  datasetLoaderPanel.ts     # WebviewPanel for bulk-loading; _sendInit() reads XLSX sheet names via getSheetReader().listSheets() before sending init to webview
  datasetLoader.ts          # readSheetData() delegates to getSheetReader(); loadSheetToDb() via dbManager.bulkLoad()
  datasetScanner.ts         # scanDatasetFiles(FolderScanConfig[]) — per-folder include+exclude; xlsx sheet names deferred to DatasetLoaderPanel
  queryParser.ts            # JAVA_ANNOTATION_RE supports single-quoted strings AND Java 15+ text blocks ("""); parseJavaMapperMethods() handles @Mapper interfaces with no inline SQL
  drivers/
    sqlite.ts               # sql.js (pure WASM, no native build required); implements bulkLoad
    postgresql.ts           # pg (pure JS); implements bulkLoad
    mysql.ts                # mysql2/promise (pure JS); implements bulkLoad

media/src/
  queryPanel.ts             # webview script — DOM only, no Node APIs; Preview SQL + Explain buttons; SQL syntax highlighting via highlight.js (hljs.highlight(sql, {language:'sql'}))
  configPanel.ts            # webview script for DB config panel
  mapperPanel.ts            # webview script for Mappers panel (filter, flat/tree render)
  datasetPanel.ts           # webview script for Dataset panel (filter input, flat/tree render, lists CSV/XLSX files)
  datasetLoaderPanel.ts     # webview script for Dataset Loader (preview table, sheet→table mapping)

test/
  queryParser.test.ts       # unit tests for queryParser.ts — not included in VSIX
  datasetLoader.test.ts     # unit tests for CsvReader, XlsxReader, getSheetReader, readSheetData
  scanPatterns.test.ts      # unit tests for makeGlob, buildExcludeGlob, isProviderMapper, parseFile(provider skip)

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

**Adding a new dataset file format** (e.g., JSON, Parquet):
1. Create a class implementing `SheetReader` in `src/sheetReader.ts` (or a separate file)
2. Call `registerSheetReader(new MyReader())` on activation
3. Add the extension to `datasetScanner.ts` alongside `'csv'` and `'xlsx'`
No other changes needed — `readSheetData()`, `DatasetLoaderPanel`, and `getSheetReader()` all work via the registry.

### Row limits
- `fetchLimit` (default 5000): read from `mybatisUtility.fetchLimit` setting at execute time
- `pageSize` (default 200): sent to webview via `settings` message; webview re-renders on change
- Both are configurable in VSCode Settings

### Mappers panel (WebviewView)

`mapperWebviewProvider.ts` implements `vscode.WebviewViewProvider` (view type `mybatisUtility.mapperView`, declared as `"type": "webview"` in `package.json`).

- `resolveWebviewView()` sets the HTML but sends **no postMessage**. It waits for the `{ type: 'ready' }` message from the webview script (sent on DOMContentLoaded) before delivering data. This avoids lost messages when the script hasn't loaded yet.
- **Scan caching**: `_scanned` flag and `_mappers` / `_hasFolders` cache. First `ready` triggers `_scan()`; subsequent `ready` (panel re-shown) sends cached results immediately — no rescan. `refresh()` resets `_scanned = false` before rescanning.
- `_scan()` sends `{ type: 'setLoading', loading: true }` first, then processes URIs **folder-by-folder** (sorted by parent dir) and sends partial results after each folder so the panel populates progressively.
- `hasFolders` distinguishes "scan folders not configured" from "configured but no mappers found" — the webview shows different empty-state messages for each.
- `makeGlob()` (in `scanUtils.ts`) strips trailing `/**` / `/*` then emits both `folder/ext` (direct children) and `folder/**/ext` (nested). Handles patterns like `**/mapper/**` and `**/mapper` identically.
- **Per-folder settings**: `_scan()` iterates `vscode.workspace.workspaceFolders` and calls `getConfiguration('mybatisUtility', folder.uri)` per folder. Include (`scanFolders`) and exclude (`scanExclude`) can differ per folder. All settings have `"scope": "resource"` in `package.json`.
- **Exclude priority**: `scanExclude` user patterns are appended after `MAPPER_DEFAULT_EXCLUDE` constants. Since VSCode `findFiles` excludes anything matched by the glob, both defaults and user patterns apply equally.
- `parseJavaMapper()` supports single-quoted strings and Java 15+ text blocks (`"""`). Falls back to `parseJavaMapperMethods()` when no inline SQL is found (XML-mapped or annotation-only interfaces with no SQL yet).
- `parseJavaMapperMethods()` in `queryParser.ts` extracts method signatures from `@Mapper` interfaces; infers `QueryKind` from method-name prefix; extracts `@Param` values as placeholder names.
- **`@*Provider` skip**: `isProviderMapper()` in `mapperScanner.ts` detects `@SelectProvider` / `@InsertProvider` / `@UpdateProvider` / `@DeleteProvider`. If no inline SQL is found AND the file has Provider annotations, `parseFile()` returns `null` (MyBatis Generator output, no SQL to browse).
- Excluded by default: `target/`, `build/`, `out/`, `dist/`, `.gradle/`, `src/test/`, `src/test-**/`.
- **Initial display mode**: the HTML `<body data-display-mode="...">` attribute carries the persisted mode so the webview script reads the correct initial value without waiting for a postMessage.
- `setDisplayMode('flat'|'tree')` sends `{ type: 'setDisplayMode', mode }` — called by the title-bar toggle commands in `extension.ts`.
- The webview script (`media/src/mapperPanel.ts`) handles all filtering and rendering client-side (150 ms debounce). No round-trip to the extension for filter changes.
- Clicking a query in the webview posts `{ type: 'openQuery', query, mapperFile }` → `MapperWebviewProvider` calls `QueryPanel.show()` directly.

### Webview message protocol

Query/Config panels (`src/types.ts`):
- `ExtToWebMsg` — extension → webview (setQuery, queryResult, queryError, connections, connectionSaved, connectionDeleted, **settings**)
- `WebToExtMsg` — extension ← webview (execute `{mode:'all'|'range'|'explain'}`, getConnections, saveConnection, deleteConnection)

Mapper panel (ad-hoc, not in types.ts):
- Extension → webview: `{ type: 'setLoading', loading: boolean }`, `{ type: 'setMappers', items: MapperFile[], hasFolders: boolean }`, `{ type: 'setDisplayMode', mode }`
- Webview → extension: **`{ type: 'ready' }`** (on DOMContentLoaded — triggers initial data delivery), `{ type: 'openQuery', query, mapperFile }`, `{ type: 'openSettings' }`

Dataset panel (`DatasetToWebMsg` / `WebToDatasetMsg` in `types.ts`):
- Extension → webview: `{ type: 'setLoading', loading: boolean }`, `{ type: 'setFiles', items: DatasetFile[] }`, `{ type: 'setDisplayMode', mode }`
- Webview → extension: **`{ type: 'ready' }`** (on DOMContentLoaded), `{ type: 'openLoader', file }`, `{ type: 'refresh' }`

Dataset loader panel (`LoaderExtToWebMsg` / `LoaderWebToExtMsg` in `types.ts`):
- Extension → webview: `init` (file with populated `sheets` array), `preview { sheet, columns, rows }`, `loadResult { success, message }`
- Webview → extension: `getPreview { sheet }`, `load { connectionId, mappings }`
- **XLSX sheet loading**: `_sendInit()` in `datasetLoaderPanel.ts` is async; for xlsx files with `sheets = []`, it calls `getSheetReader(file.path).listSheets(file.path)` before sending `init`. The scanner defers sheet reading; the loader panel is the point where sheets are actually populated.

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
