import * as vscode from 'vscode';
import * as path from 'path';
import { MapperFile, ParsedQuery } from './types';
import { parseFile } from './mapperScanner';

// ---------------------------------------------------------------------------
// Tree items
// ---------------------------------------------------------------------------

export class MapperFileItem extends vscode.TreeItem {
  constructor(public readonly mapperFile: MapperFile) {
    super(mapperFile.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = path.basename(mapperFile.filePath);
    this.tooltip = mapperFile.filePath;
    this.contextValue = 'mapperFile';
    this.iconPath = new vscode.ThemeIcon(
      mapperFile.source === 'java' ? 'symbol-class' : 'file-code'
    );
  }
}

export class MapperQueryItem extends vscode.TreeItem {
  constructor(
    public readonly query: ParsedQuery,
    public readonly mapperFile: MapperFile
  ) {
    super(query.id, vscode.TreeItemCollapsibleState.None);
    this.description = query.kind;
    this.tooltip = query.sql.slice(0, 200);
    this.contextValue = 'mapperQuery';
    this.command = {
      command: 'mybatisUtility.openQuery',
      title: 'Open Query',
      arguments: [this],
    };
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type MapperTreeItem = MapperFileItem | MapperQueryItem;

// Directories excluded from search — matches VSCode's default search.exclude
const EXCLUDE = '{**/node_modules/**,**/target/**,**/build/**,**/out/**,**/dist/**,.git/**}';

export class MapperProvider implements vscode.TreeDataProvider<MapperTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MapperTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private mapperFiles: MapperFile[] = [];
  private _scanning = false;

  constructor() {
    // Kick off async scan without blocking activation
    void this._scan();
  }

  /** Trigger a fresh scan (e.g. from the Refresh button or file watcher). */
  refresh(): void {
    void this._scan();
  }

  getTreeItem(element: MapperTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: MapperTreeItem): MapperTreeItem[] {
    if (!element) {
      return this.mapperFiles.map(f => new MapperFileItem(f));
    }
    if (element instanceof MapperFileItem) {
      return element.mapperFile.queries.map(q => new MapperQueryItem(q, element.mapperFile));
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // Async scan — uses VSCode's file index, does NOT block the event loop
  // ---------------------------------------------------------------------------

  private async _scan(): Promise<void> {
    if (this._scanning) { return; }
    this._scanning = true;
    try {
      const config = vscode.workspace.getConfiguration('mybatisUtility');
      const scanFolders: string[] = config.get<string[]>('scanFolders', []);

      // No folders configured → show empty tree (no scan)
      if (scanFolders.length === 0) {
        this.mapperFiles = [];
        this._onDidChangeTreeData.fire();
        return;
      }

      const javaGlob = makeGlob(scanFolders, '*.java');
      const xmlGlob  = makeGlob(scanFolders, '*.xml');

      // findFiles uses VSCode's built-in watcher/index → much faster than manual walk
      const [javaUris, xmlUris] = await Promise.all([
        vscode.workspace.findFiles(javaGlob, EXCLUDE),
        vscode.workspace.findFiles(xmlGlob,  EXCLUDE),
      ]);

      const results: MapperFile[] = [];
      // Process files concurrently in batches to avoid flooding the FS
      await Promise.all([...javaUris, ...xmlUris].map(async (uri) => {
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const content = Buffer.from(bytes).toString('utf8');
          const mf = parseFile(uri.fsPath, content);
          if (mf) { results.push(mf); }
        } catch {
          // Ignore unreadable files
        }
      }));

      // Sort by source then label for stable tree order
      results.sort((a, b) =>
        a.source.localeCompare(b.source) || a.label.localeCompare(b.label)
      );
      this.mapperFiles = results;
    } finally {
      this._scanning = false;
      this._onDidChangeTreeData.fire();
    }
  }
}

// ---------------------------------------------------------------------------
// Glob helpers
// ---------------------------------------------------------------------------

/**
 * Build a glob string from user-configured patterns.
 *
 * Each entry may be:
 *   - A plain folder path: "src/main/java"    → "src/main/java/**\/*.java"
 *   - A glob with wildcards: "**", "src/**"   → appends "/*.java" only if needed
 *     (** / ** collapses to ** in all glob engines, so doubling is harmless)
 *
 * Multiple entries are combined with {a,b} syntax.
 */
function makeGlob(folders: string[], ext: string): string {
  const patterns = folders.map(f => {
    const p = f.replace(/\\/g, '/').replace(/\/+$/, ''); // normalise separators + trailing slash
    // If the pattern ends with a wildcard segment, just append the file extension glob.
    // Otherwise treat it as a plain directory and add the recursive wildcard.
    return p.endsWith('*') ? `${p}/${ext}` : `${p}/**/${ext}`;
  });
  return patterns.length === 1 ? patterns[0] : `{${patterns.join(',')}}`;
}
