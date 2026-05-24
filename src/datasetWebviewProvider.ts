import * as vscode from 'vscode';
import { DatasetToWebMsg, WebToDatasetMsg } from './types';
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
  private _scanning = false;

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
      if (msg.type === 'openLoader') {
        DatasetLoaderPanel.show(this._extensionUri, this._configMgr, msg.file);
      } else if (msg.type === 'refresh') {
        void this._scan();
      }
    });

    void this._scan();
  }

  refresh(): void {
    void this._scan();
  }

  private async _scan(): Promise<void> {
    if (this._scanning) { return; }
    this._scanning = true;
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
      const files = await scanDatasetFiles(datasetDirectories);
      const msg: DatasetToWebMsg = { type: 'setFiles', items: files };
      void this._view?.webview.postMessage(msg);
    } finally {
      this._scanning = false;
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
    #toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
      padding: 6px 8px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #toolbar button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 3px 8px;
      font-size: var(--vscode-font-size);
      cursor: pointer;
      border-radius: 2px;
    }
    #toolbar button:hover { filter: brightness(1.15); }
    #list { padding: 4px 0; }
    .empty {
      padding: 12px 16px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.6;
    }
    .file-row {
      display: flex;
      align-items: center;
      padding: 2px 8px;
      cursor: pointer;
      user-select: none;
      gap: 6px;
      height: 22px;
    }
    .file-row:hover { background: var(--vscode-list-hoverBackground); }
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
<body>
  <div id="toolbar">
    <button id="btn-refresh">&#x21BB; Refresh</button>
  </div>
  <div id="list"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
