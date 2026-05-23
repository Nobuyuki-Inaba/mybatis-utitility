import * as vscode from 'vscode';
import * as path from 'path';
import { MapperFile, ParsedQuery } from './types';
import { parseFile } from './mapperScanner';

// ---------------------------------------------------------------------------
// Tree items
// ---------------------------------------------------------------------------

export class FolderItem extends vscode.TreeItem {
  constructor(
    public readonly folderPath: string,
    label: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.tooltip = folderPath;
    this.contextValue = 'mapperFolder';
    this.iconPath = new vscode.ThemeIcon('folder-opened');
  }
}

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

type MapperTreeItem = FolderItem | MapperFileItem | MapperQueryItem;

const EXCLUDE = '{**/node_modules/**,**/target/**,**/build/**,**/out/**,**/dist/**,.git/**}';

export class MapperProvider implements vscode.TreeDataProvider<MapperTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MapperTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private mapperFiles: MapperFile[] = [];
  private _scanning = false;
  private _filterText = '';
  private _displayMode: 'flat' | 'tree' = 'flat';

  constructor() {
    void this._scan();
  }

  getFilterText(): string { return this._filterText; }
  getDisplayMode(): 'flat' | 'tree' { return this._displayMode; }

  setFilter(text: string): void {
    this._filterText = text.toLowerCase().trim();
    this._onDidChangeTreeData.fire();
  }

  setDisplayMode(mode: 'flat' | 'tree'): void {
    this._displayMode = mode;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    void this._scan();
  }

  getTreeItem(element: MapperTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: MapperTreeItem): MapperTreeItem[] {
    if (!element) {
      const files = this._filteredFiles();
      if (this._displayMode === 'flat') {
        return files.map(f => new MapperFileItem(f));
      }
      return this._buildFolderNodes(files);
    }
    if (element instanceof FolderItem) {
      return this._filteredFiles()
        .filter(f => path.dirname(f.filePath) === element.folderPath)
        .map(f => new MapperFileItem(f));
    }
    if (element instanceof MapperFileItem) {
      return this._queriesFor(element.mapperFile);
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // Filter helpers
  // ---------------------------------------------------------------------------

  private _filteredFiles(): MapperFile[] {
    if (!this._filterText) { return this.mapperFiles; }
    return this.mapperFiles.filter(f =>
      f.label.toLowerCase().includes(this._filterText) ||
      path.basename(f.filePath).toLowerCase().includes(this._filterText) ||
      f.queries.some(q => q.id.toLowerCase().includes(this._filterText))
    );
  }

  private _queriesFor(mf: MapperFile): MapperQueryItem[] {
    // If the file itself matched by name, show all its queries
    const fileNameMatch = !this._filterText ||
      mf.label.toLowerCase().includes(this._filterText) ||
      path.basename(mf.filePath).toLowerCase().includes(this._filterText);
    const queries = fileNameMatch
      ? mf.queries
      : mf.queries.filter(q => q.id.toLowerCase().includes(this._filterText));
    return queries.map(q => new MapperQueryItem(q, mf));
  }

  // ---------------------------------------------------------------------------
  // Hierarchical folder grouping
  // ---------------------------------------------------------------------------

  private _buildFolderNodes(files: MapperFile[]): FolderItem[] {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const folderMap = new Map<string, string>(); // absPath → display label
    for (const f of files) {
      const dir = path.dirname(f.filePath);
      if (!folderMap.has(dir)) {
        const rel = workspaceRoot
          ? path.relative(workspaceRoot, dir).replace(/\\/g, '/')
          : dir;
        folderMap.set(dir, rel || '.');
      }
    }
    return [...folderMap.entries()]
      .sort(([, a], [, b]) => a.localeCompare(b))
      .map(([absPath, label]) => new FolderItem(absPath, label));
  }

  // ---------------------------------------------------------------------------
  // Async scan
  // ---------------------------------------------------------------------------

  private async _scan(): Promise<void> {
    if (this._scanning) { return; }
    this._scanning = true;
    try {
      const config = vscode.workspace.getConfiguration('mybatisUtility');
      const scanFolders: string[] = config.get<string[]>('scanFolders', []);

      if (scanFolders.length === 0) {
        this.mapperFiles = [];
        this._onDidChangeTreeData.fire();
        return;
      }

      const javaGlob = makeGlob(scanFolders, '*.java');
      const xmlGlob  = makeGlob(scanFolders, '*.xml');

      const [javaUris, xmlUris] = await Promise.all([
        vscode.workspace.findFiles(javaGlob, EXCLUDE),
        vscode.workspace.findFiles(xmlGlob,  EXCLUDE),
      ]);

      const results: MapperFile[] = [];
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

function makeGlob(folders: string[], ext: string): string {
  const patterns = folders.map(f => {
    const p = f.replace(/\\/g, '/').replace(/\/+$/, '');
    return p.endsWith('*') ? `${p}/${ext}` : `${p}/**/${ext}`;
  });
  return patterns.length === 1 ? patterns[0] : `{${patterns.join(',')}}`;
}
