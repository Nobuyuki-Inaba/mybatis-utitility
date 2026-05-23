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
  extension.ts          # activation, command registration, quick-add wizard
  types.ts              # shared type definitions (DbConnectionConfig, ParamEntry, ExtToWebMsg, …)
  configManager.ts      # read/write DB connections + passwords (VSCode Secret Storage)
  mapperProvider.ts     # TreeDataProvider — scans mapper files via vscode.workspace.findFiles()
  mapperScanner.ts      # pure parsing logic (no VSCode API — unit-testable via FileReader interface)
  queryParser.ts        # extract #{} placeholders, buildExecutableSql(), formatValue()
  queryPanel.ts         # WebviewPanel for query execution (singleton)
  configPanel.ts        # WebviewPanel for DB connection management (singleton)
  databaseProvider.ts   # TreeDataProvider for the Databases sidebar view
  dbManager.ts          # driver registry — registerDriver(type, driver)
  extensionContext.ts   # setExtensionPath() / getExtensionPath() for sql.js WASM location
  drivers/
    sqlite.ts           # sql.js (pure WASM, no native build required)
    postgresql.ts       # pg (pure JS)
    mysql.ts            # mysql2/promise (pure JS)

media/src/
  queryPanel.ts         # webview script — DOM only, no Node APIs
  configPanel.ts        # webview script for DB config panel

sample/                 # test fixtures
  src/main/java/…/      # Java @Mapper samples (SampleMapper, UserMapper)
  src/main/resources/mapper/  # XML mapper samples
  test.db               # SQLite test database (sample + users + wide_table)
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

### Row limits
- `fetchLimit` (default 5000): read from `mybatisUtility.fetchLimit` setting at execute time
- `pageSize` (default 200): sent to webview via `settings` message; webview re-renders on change
- Both are configurable in VSCode Settings

### Webview message protocol

All types are in `src/types.ts`:
- `ExtToWebMsg` — extension → webview (setQuery, queryResult, queryError, connections, connectionSaved, connectionDeleted, **settings**)
- `WebToExtMsg` — webview → extension (execute, getConnections, saveConnection, deleteConnection)

### SQL execution flow

1. User clicks query item → `QueryPanel.show()` → `_sendQuery()` + `_sendSettings()` + `_sendConnections()`
2. User clicks execute → webview posts `execute` with `displayedSql` (editable div content)
3. Extension reads `fetchLimit` from settings, calls `buildExecutableSql()` → `executeQuery()`
4. Result posted back as `queryResult` → webview paginates display

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
git tag v0.1.0
git push origin v0.1.0
```

To publish to VS Code Marketplace:
```powershell
npx vsce publish
```
(requires `VSCE_PAT` personal access token)
