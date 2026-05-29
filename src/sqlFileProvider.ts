import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { QueryPanel } from './queryPanel';
import { extractPlaceholders, detectSqlKind } from './queryParser';
import { buildExcludeGlob, SQL_DEFAULT_EXCLUDE } from './scanUtils';
import { SqlFile, SqlToWebMsg, WebToSqlMsg, MapperFile, ParsedQuery, QueryKind } from './types';

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}


export class SqlFileProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mybatisUtility.sqlView';

  private _view?: vscode.WebviewView;
  private _files: SqlFile[] = [];
  private _scanned = false;
  private _scanning = false;
  private _hasFolders = false;
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

    webviewView.webview.onDidReceiveMessage((msg: WebToSqlMsg) => {
      if (msg.type === 'ready') {
        this._sendDisplayMode();
        if (this._scanned) {
          this._postFiles();
        } else {
          void this._scan();
        }
      } else if (msg.type === 'openFile') {
        this._openSqlFile(msg.path);
      } else if (msg.type === 'refresh') {
        this._scanned = false;
        void this._scan();
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

  private _sendDisplayMode(): void {
    if (!this._view) { return; }
    void this._view.webview.postMessage({ type: 'setDisplayMode', mode: this._displayMode } satisfies SqlToWebMsg);
  }

  private _postFiles(): void {
    const msg: SqlToWebMsg = { type: 'setFiles', items: this._files, hasFolders: this._hasFolders };
    void this._view?.webview.postMessage(msg);
  }

  private async _scan(): Promise<void> {
    if (this._scanning) { return; }
    this._scanning = true;
    void this._view?.webview.postMessage({ type: 'setLoading', loading: true } satisfies SqlToWebMsg);

    try {
      const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
      this._hasFolders = workspaceFolders.length > 0;

      if (!this._hasFolders) {
        this._files = [];
        this._postFiles();
        return;
      }

      // Collect user exclude patterns across all workspace folders
      const userExclude = new Set<string>();
      for (const folder of workspaceFolders) {
        const config = vscode.workspace.getConfiguration('mybatisUtility', folder.uri);
        for (const p of config.get<string[]>('sqlExclude', [])) {
          userExclude.add(p);
        }
      }
      const excludeGlob = buildExcludeGlob(SQL_DEFAULT_EXCLUDE, [...userExclude]);

      const uris = await vscode.workspace.findFiles('**/*.sql', excludeGlob);
      uris.sort((a, b) => a.fsPath.localeCompare(b.fsPath));

      const root = workspaceFolders[0]?.uri.fsPath ?? '';
      this._files = uris.map(uri => {
        const rel = path.relative(root, uri.fsPath).replace(/\\/g, '/');
        const dir = rel.split('/').slice(0, -1).join('/') || '.';
        return { path: uri.fsPath, label: path.basename(uri.fsPath), folder: dir };
      });

      this._postFiles();
    } finally {
      this._scanning = false;
      this._scanned = true;
    }
  }

  private _openSqlFile(filePath: string): void {
    let sql: string;
    try {
      sql = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Cannot read SQL file: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    const id = path.basename(filePath, '.sql');
    const query: ParsedQuery = {
      id,
      kind: detectSqlKind(sql),
      sql: sql.trim(),
      params: extractPlaceholders(sql),
    };
    const mapperFile: MapperFile = {
      source: 'sql',
      filePath,
      label: path.basename(filePath),
      queries: [query],
    };

    QueryPanel.show(this._extensionUri, this._configMgr, query, mapperFile);
  }

  private _buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'sqlFilePanel.js')
    );
    const nonce = randomNonce();

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>SQL Files</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    #filter-wrap {
      position: sticky; top: 0; z-index: 10;
      padding: 6px 8px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
    }
    #filter-input {
      width: 100%; padding: 4px 8px;
      font-size: var(--vscode-font-size);
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px; outline: none;
    }
    #filter-input:focus { border-color: var(--vscode-focusBorder); }
    #list { padding: 4px 0; }
    .empty {
      padding: 12px 16px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.6;
    }
    .file-row, .folder-row {
      display: flex; align-items: center;
      padding: 2px 8px; cursor: pointer; user-select: none; gap: 6px; height: 22px;
    }
    .file-row:hover { background: var(--vscode-list-hoverBackground); }
    .file-row.indent { padding-left: 24px; }
    .folder-row {
      font-weight: 600;
      color: var(--vscode-sideBarSectionHeader-foreground);
    }
    .folder-chevron { font-size: 10px; width: 12px; flex-shrink: 0; color: var(--vscode-descriptionForeground); }
    .sql-icon { font-size: 11px; font-weight: 700; color: #f0a500; flex-shrink: 0; }
    .file-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-dir { font-size: 11px; color: var(--vscode-descriptionForeground); flex-shrink: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  </style>
</head>
<body data-display-mode="${this._displayMode}">
  <div id="filter-wrap">
    <input id="filter-input" type="text" placeholder="Filter SQL files…" />
  </div>
  <div id="list"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
