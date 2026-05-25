import * as vscode from 'vscode';
import { DatasetFile, DatasetToWebMsg, WebToDatasetMsg } from './types';
import { scanDatasetFiles } from './datasetScanner';
import { DatasetLoaderPanel } from './datasetLoaderPanel';
import { ConfigManager } from './configManager';

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export class DatasetWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mybatisUtility.datasetView';

  private _view?: vscode.WebviewView;
  private _files: DatasetFile[] = [];
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

    webviewView.webview.onDidReceiveMessage((msg: WebToDatasetMsg) => {
      if (msg.type === 'ready') {
        // Webview script is loaded — send initial data
        this._sendDisplayMode();
        if (this._scanned) {
          const cached: DatasetToWebMsg = { type: 'setFiles', items: this._files };
          void this._view?.webview.postMessage(cached);
        } else {
          void this._scan();
        }
      } else if (msg.type === 'openLoader') {
        DatasetLoaderPanel.show(this._extensionUri, this._configMgr, msg.file);
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
    void this._view.webview.postMessage({ type: 'setDisplayMode', mode: this._displayMode });
  }

  private async _scan(): Promise<void> {
    if (this._scanning) { return; }
    this._scanning = true;
    void this._view?.webview.postMessage({ type: 'setLoading', loading: true } satisfies DatasetToWebMsg);
    try {
      const config = vscode.workspace.getConfiguration('mybatisUtility');
      const datasetDirectories: string[] = config.get<string[]>('datasetDirectories', [
        '**/fixture/**',
        '**/fixtures/**',
        '**/testdata/**',
        '**/test-data/**',
        '**/dataset/**',
        '**/datasets/**',
        '**/src/test/resources/**',
      ]);
      this._files = await scanDatasetFiles(datasetDirectories);
      const msg: DatasetToWebMsg = { type: 'setFiles', items: this._files };
      void this._view?.webview.postMessage(msg);
    } finally {
      this._scanning = false;
      this._scanned = true;
    }
  }

  private _buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'datasetPanel.js')
    );
    const nonce = randomNonce();

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>Dataset</title>
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
    #filter-input:focus { border-color: var(--vscode-focusBorder); }
    #list { padding: 4px 0; }
    .empty {
      padding: 12px 16px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.6;
    }
    .file-row, .folder-row {
      display: flex;
      align-items: center;
      padding: 2px 8px;
      cursor: pointer;
      user-select: none;
      gap: 6px;
      height: 22px;
    }
    .file-row:hover { background: var(--vscode-list-hoverBackground); }
    .file-row.indent { padding-left: 24px; }
    .folder-row {
      font-weight: 600;
      color: var(--vscode-sideBarSectionHeader-foreground);
      gap: 6px;
    }
    .folder-chevron {
      font-size: 10px;
      width: 12px;
      flex-shrink: 0;
      color: var(--vscode-descriptionForeground);
    }
    .type-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 1px 3px;
      border-radius: 2px;
      flex-shrink: 0;
      min-width: 28px;
      text-align: center;
    }
    .type-badge.csv  { background: #388a34; color: #fff; }
    .type-badge.xlsx { background: #0078d4; color: #fff; }
    .file-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sheet-count {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
    }
  </style>
</head>
<body data-display-mode="${this._displayMode}">
  <div id="filter-wrap">
    <input id="filter-input" type="text" placeholder="Filter dataset files…" />
  </div>
  <div id="list"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
