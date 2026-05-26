import * as path from 'path';
import * as vscode from 'vscode';
import { MapperFile } from './types';
import { parseFile } from './mapperScanner';
import { QueryPanel } from './queryPanel';
import { ConfigManager } from './configManager';
import { makeGlob, buildExcludeGlob, MAPPER_DEFAULT_EXCLUDE } from './scanUtils';

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export class MapperWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mybatisUtility.mapperView';

  private _view?: vscode.WebviewView;
  private _mappers: MapperFile[] = [];
  private _hasFolders = false;
  private _scanned = false;
  private _scanning = false;
  private _displayMode: 'flat' | 'tree' = 'flat';

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _configMgr: ConfigManager
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
    };

    webviewView.webview.html = this._buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: { type: string; query?: unknown; mapperFile?: unknown }) => {
      if (msg.type === 'ready') {
        // Webview script is loaded — send initial data
        this._sendDisplayMode();
        if (this._scanned) {
          this._sendMappers(this._hasFolders);
        } else {
          void this._scan();
        }
      } else if (msg.type === 'openQuery') {
        const { query, mapperFile } = msg as { type: 'openQuery'; query: import('./types').ParsedQuery; mapperFile: MapperFile };
        QueryPanel.show(this._extensionUri, this._configMgr, query, mapperFile);
      } else if (msg.type === 'openSettings') {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'mybatisUtility');
      }
    });
  }

  refresh(): void {
    this._scanned = false;
    void this._scan();
  }

  setDisplayMode(mode: 'flat' | 'tree'): void {
    this._displayMode = mode;
    this._sendDisplayMode();
  }

  private _sendMappers(hasFolders: boolean): void {
    if (!this._view) { return; }
    void this._view.webview.postMessage({ type: 'setMappers', items: this._mappers, hasFolders });
  }

  private _sendDisplayMode(): void {
    if (!this._view) { return; }
    void this._view.webview.postMessage({ type: 'setDisplayMode', mode: this._displayMode });
  }

  private async _scan(): Promise<void> {
    if (this._scanning) { return; }
    this._scanning = true;
    void this._view?.webview.postMessage({ type: 'setLoading', loading: true });
    let hasFolders = false;
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
      const allUris: vscode.Uri[] = [];

      // Collect URIs per workspace folder using per-folder settings
      for (const folder of workspaceFolders) {
        const folderConfig = vscode.workspace.getConfiguration('mybatisUtility', folder.uri);
        const scanFolders: string[] = folderConfig.get<string[]>('scanFolders', []);
        const scanExclude: string[] = folderConfig.get<string[]>('scanExclude', []);

        if (scanFolders.length === 0) { continue; }
        hasFolders = true;

        const excludeGlob = buildExcludeGlob(MAPPER_DEFAULT_EXCLUDE, scanExclude);
        const javaPattern = new vscode.RelativePattern(folder, makeGlob(scanFolders, '*.java'));
        const xmlPattern  = new vscode.RelativePattern(folder, makeGlob(scanFolders, '*.xml'));

        const [javaUris, xmlUris] = await Promise.all([
          vscode.workspace.findFiles(javaPattern, excludeGlob),
          vscode.workspace.findFiles(xmlPattern,  excludeGlob),
        ]);
        allUris.push(...javaUris, ...xmlUris);
      }

      if (!hasFolders) {
        this._mappers = [];
        return;
      }

      // Group URIs by parent directory so results can be streamed folder by folder
      const byDir = new Map<string, vscode.Uri[]>();
      for (const uri of allUris) {
        const dir = path.dirname(uri.fsPath);
        if (!byDir.has(dir)) { byDir.set(dir, []); }
        byDir.get(dir)!.push(uri);
      }

      this._mappers = [];
      const results: MapperFile[] = [];
      for (const [, uris] of [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        await Promise.all(uris.map(async (uri) => {
          try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const content = Buffer.from(bytes).toString('utf8');
            const mf = parseFile(uri.fsPath, content);
            if (mf) { results.push(mf); }
          } catch {
            // ignore unreadable files
          }
        }));

        // Send partial results after each folder so the panel updates progressively
        const sorted = [...results].sort((a, b) =>
          a.source.localeCompare(b.source) || a.label.localeCompare(b.label)
        );
        this._mappers = sorted;
        this._sendMappers(true);
      }
    } finally {
      this._scanning = false;
      this._hasFolders = hasFolders;
      this._scanned = true;
      this._sendMappers(hasFolders);
    }
  }

  private _buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'mapperPanel.js')
    );
    const nonce = randomNonce();

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>Mappers</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    #filter-wrap {
      position: sticky;
      top: 0;
      z-index: 10;
      padding: 6px 8px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
    }
    #filter-input {
      width: 100%;
      padding: 4px 8px;
      font-size: var(--vscode-font-size);
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      outline: none;
    }
    #filter-input:focus {
      border-color: var(--vscode-focusBorder);
    }
    #tree { padding: 4px 0; }
    .empty {
      padding: 12px 16px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.6;
    }
    .empty a { color: var(--vscode-textLink-foreground); cursor: pointer; }
    .file-row, .query-row, .folder-row {
      display: flex;
      align-items: center;
      padding: 2px 8px;
      cursor: pointer;
      user-select: none;
      gap: 4px;
      height: 22px;
    }
    .file-row:hover, .query-row:hover, .folder-row:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .file-row.indent, .query-row.indent { padding-left: 24px; }
    .query-row { padding-left: 28px; }
    .query-row.indent { padding-left: 44px; }
    .chevron, .folder-chevron {
      font-size: 10px;
      width: 12px;
      flex-shrink: 0;
      color: var(--vscode-descriptionForeground);
    }
    .src-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 1px 3px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .src-badge.java { background: #c07a00; color: #fff; }
    .src-badge.xml  { background: #0078d4; color: #fff; }
    .file-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .file-desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .kind-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 1px 3px;
      border-radius: 2px;
      flex-shrink: 0;
      min-width: 14px;
      text-align: center;
    }
    .kind-badge.select { background: #388a34; color: #fff; }
    .kind-badge.insert { background: #0078d4; color: #fff; }
    .kind-badge.update { background: #c07a00; color: #fff; }
    .kind-badge.delete { background: #c0392b; color: #fff; }
    .kind-badge.unknown { background: #666; color: #fff; }
    .query-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .query-desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
    }
    .folder-row {
      font-weight: 600;
      color: var(--vscode-sideBarSectionHeader-foreground);
      gap: 6px;
    }
  </style>
</head>
<body data-display-mode="${this._displayMode}">
  <div id="filter-wrap">
    <input id="filter-input" type="text" placeholder="Filter mappers and queries…" />
  </div>
  <div id="tree"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
