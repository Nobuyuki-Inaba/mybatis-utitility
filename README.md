# MyBatis Utility

![MyBatis Utility overview](docs/screenshots/snapshot.png)

VSCode extension for MyBatis developers. Browse Mapper files, fill query parameters, and execute SQL against configured databases — all without leaving the editor.

## Features

- **Mapper panel** — Scans Java (`@Mapper`) and XML mapper files, lists every query by name and type. Includes a real-time filter input and flat / hierarchical view toggle
- **Query panel** — Click a query to open it, edit SQL inline, fill typed parameters (`#{param}`), and execute
- **Live SQL preview** — Click **Preview SQL** to see the final SQL with all parameters substituted inline, before executing
- **Explain plan** — Click **Explain** to run `EXPLAIN` on the current SQL and inspect the query plan
- **Dataset loader** — **Dataset** panel scans for CSV / XLSX fixture files in your workspace. Filter files in real time with the search input, switch between flat and hierarchical views, click any file to open the loader, preview data, map sheets to database tables, and bulk-load with one click (clears and reloads the target table)
- **Parameter presets** — Save named sets of parameter values to `.vscode/mybatis-utility/params.yaml`. Load them from a dropdown to re-fill values instantly. The file can be committed and shared across the team
- **Multi-database support** — SQLite, PostgreSQL, MySQL (extensible driver registry)
- **Pagination** — Large result sets paginated (configurable page size)
- **CSV export** — Export query results to CSV with one click
- **Keyboard shortcuts** — `Ctrl+Enter` / `Ctrl+Shift+Enter` to execute without touching the mouse

## Requirements

- VSCode 1.85 or later
- For PostgreSQL / MySQL: a running database server (no extra drivers needed — pure JS)
- For SQLite: a `.db` / `.sqlite` file (WASM-based, no native compilation)

## Getting Started

### 1. Configure scan folders

Open Settings (`Ctrl+,`) and search for **MyBatis Utility**.

Set **Scan Folders** to the directories that contain your Mapper files:

```json
"mybatisUtility.scanFolders": [
  "src/main/java",
  "src/main/resources/mapper"
]
```

Default: `["**/mapper", "**/repository"]` — works for most Spring Boot projects out of the box.

The **Mappers** panel in the sidebar will populate automatically. Use the filter input at the top to narrow results in real time, and use the list/tree icon in the title bar to switch between flat and hierarchical views.

### 2. Add a database connection

In the **Databases** panel, click **+** to add a connection via a quick wizard, or click the gear icon to open the full configuration panel.

Supported types:

| Type | Connection info |
|------|----------------|
| SQLite | Path to `.db` file |
| PostgreSQL | host / port / database / schema / user / password |
| MySQL | host / port / database / user / password |

Passwords are stored in VSCode's Secret Storage (never in plain text).

### 3. Run a query

1. Click any query in the **Mappers** panel (use the filter input to find it quickly)
2. The **Query** panel opens — the SQL from the mapper file is shown and is editable
3. Select a database from the dropdown
4. Fill in parameter values (choose type: string / number / boolean / date / null)
5. Press **Ctrl+Enter** to execute, or click **execute(all)**

To execute only part of the SQL, select it and press **Ctrl+Shift+Enter** (or click **execute(range)**).

Click **Preview SQL** to see the fully-substituted SQL without executing it — useful for reviewing the final query before sending it to the database.

Click **Explain** to run `EXPLAIN` on the current SQL and display the query plan returned by the database.

If you edited the SQL and want to revert it, click **reset SQL**.

#### Parameter presets

To save the current parameter values as a preset, type a name in the **Preset name** field and click **Save**. To restore saved values, select a preset from the dropdown. Click **Delete** to remove the selected preset, or **Clear params** to reset all values.

Presets are saved to `.vscode/mybatis-utility/params.yaml` in your workspace. Add the file to `.gitignore` to keep values local, or commit it to share with your team.

### 4. Load test data (Dataset panel)

The **Dataset** panel (in the sidebar) automatically scans for CSV and XLSX fixture files in common locations (`fixtures/`, `testdata/`, `dataset/`, `src/test/resources/`, etc.). Use the filter input at the top to narrow results in real time, and use the list/tree icon in the title bar to switch between flat and hierarchical views. Both view preferences are saved across sessions.

1. Click any file in the **Dataset** panel to open the loader
2. Select a sheet (XLSX) or the file (CSV) and enter the target table name
3. Click **Preview** to inspect the first 100 rows before loading
4. Click **Load** — this will **delete all existing rows** from the target table and re-insert data from the file

> **Warning**: The load operation is destructive. Always use it against a development/test database, not production.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | execute(all) — run the full displayed SQL |
| `Ctrl+Shift+Enter` | execute(range) — run only the selected text |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `mybatisUtility.scanFolders` | `["**/mapper", "**/repository"]` | Glob patterns for mapper file search. Empty = no scan. |
| `mybatisUtility.fetchLimit` | `5000` | Max rows fetched per query. Reduce to save memory. |
| `mybatisUtility.pageSize` | `200` | Rows displayed per page in the result panel. |
| `mybatisUtility.datasetDirectories` | `["**/fixture/**", "**/fixtures/**", ...]` | Glob patterns for fixture files shown in the Dataset panel. |

Open settings with the **gear icon** (⚙) in the Mappers panel title bar.

## Supported Mapper Formats

### Java — annotation-based

```java
@Mapper
public interface UserMapper {
    @Select("SELECT * FROM users WHERE id = #{id}")
    User findById(String id);
}
```

### XML — MyBatis mapper XML

```xml
<mapper namespace="com.example.UserMapper">
  <select id="findById" resultType="User">
    SELECT * FROM users WHERE id = #{id}
  </select>
</mapper>
```

Both `#{param}` and `${param}` placeholders are detected and shown in the parameter table.

## Notes

- **No transaction** — queries run outside a transaction. There is no rollback. Be careful with INSERT / UPDATE / DELETE.
- **fetchLimit warning** — if results are truncated, a warning is shown. Add `LIMIT` to your SQL or increase `fetchLimit` in settings.
- The SQL panel is editable — changes affect execution but not the source file. Use **reset SQL** to restore the original.

## License

MIT — see [LICENSE](LICENSE)
