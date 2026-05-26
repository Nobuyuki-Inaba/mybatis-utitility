import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { DatasetFile, LoaderExtToWebMsg, LoaderWebToExtMsg } from './types';
import { readSheetData, loadSheetToDb } from './datasetLoader';
import { getSheetReader } from './sheetReader';

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export class DatasetLoaderPanel {
  private static _instance: DatasetLoaderPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _file: DatasetFile;

  static show(
    extensionUri: vscode.Uri,
    configMgr: ConfigManager,
    file: DatasetFile
  ): void {
    if (DatasetLoaderPanel._instance) {
      DatasetLoaderPanel._instance._panel.reveal(vscode.ViewColumn.One);
      DatasetLoaderPanel._instance._reinit(file, configMgr);
    } else {
      DatasetLoaderPanel._instance = new DatasetLoaderPanel(extensionUri, configMgr, file);
    }
  }

  private constructor(
    extensionUri: vscode.Uri,
    private readonly configMgr: ConfigManager,
    file: DatasetFile
  ) {
    this._file = file;
    this._panel = vscode.window.createWebviewPanel(
      'mybatisUtility.datasetLoaderPanel',
      `Load: ${file.label}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        retainContextWhenHidden: true,
      }
    );

    this._panel.webview.html = this._buildHtml(extensionUri);
    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg: LoaderWebToExtMsg) => this._handleMessage(msg),
      null,
      this._disposables
    );

    setTimeout(() => { void this._sendInit(); }, 200);
  }

  private _reinit(file: DatasetFile, _configMgr: ConfigManager): void {
    this._file = file;
    this._panel.title = `Load: ${file.label}`;
    void this._sendInit();
  }

  private async _sendInit(): Promise<void> {
    let file = this._file;
    // Scanner defers sheet reading for non-CSV formats — populate sheet names here
    if (file.sheets.length === 0) {
      try {
        const sheets = await getSheetReader(file.path).listSheets(file.path);
        file = { ...file, sheets };
      } catch {
        // leave sheets empty; the webview will show an empty mapping table
      }
    }
    const msg: LoaderExtToWebMsg = {
      type: 'init',
      file,
      connections: this.configMgr.getConnections(),
    };
    void this._panel.webview.postMessage(msg);
  }

  private async _handleMessage(msg: LoaderWebToExtMsg): Promise<void> {
    switch (msg.type) {
      case 'getPreview': {
        try {
          const { columns, rows } = await readSheetData(this._file.path, msg.sheet);
          const preview: LoaderExtToWebMsg = {
            type: 'preview',
            sheet: msg.sheet,
            columns,
            rows: rows.slice(0, 100),
          };
          void this._panel.webview.postMessage(preview);
        } catch (err) {
          const errMsg: LoaderExtToWebMsg = {
            type: 'loadResult',
            success: false,
            message: `Preview failed: ${err instanceof Error ? err.message : String(err)}`,
          };
          void this._panel.webview.postMessage(errMsg);
        }
        break;
      }

      case 'load': {
        const enabledMappings = msg.mappings.filter(m => m.enabled);
        if (enabledMappings.length === 0) {
          void this._panel.webview.postMessage({ type: 'loadResult', success: false, message: 'No sheets selected.' } as LoaderExtToWebMsg);
          return;
        }

        const conn = this.configMgr.getConnections().find(c => c.id === msg.connectionId);
        if (!conn) {
          void this._panel.webview.postMessage({ type: 'loadResult', success: false, message: 'No database connection selected.' } as LoaderExtToWebMsg);
          return;
        }

        const tableNames = enabledMappings.map(m => m.tableName).join(', ');
        const answer = await vscode.window.showWarningMessage(
          `This will DELETE ALL rows in table(s): ${tableNames}, then re-insert from "${this._file.label}". Continue?`,
          { modal: true },
          'Load'
        );
        if (answer !== 'Load') { return; }

        try {
          const password = await this.configMgr.getPassword(conn.id);
          let totalInserted = 0;
          for (const mapping of enabledMappings) {
            const { columns, rows } = await readSheetData(this._file.path, mapping.sheetName);
            const { inserted } = await loadSheetToDb(conn, password, mapping.tableName, columns, rows);
            totalInserted += inserted;
          }
          const doneMsg: LoaderExtToWebMsg = {
            type: 'loadResult',
            success: true,
            message: `Loaded ${totalInserted} row(s) into ${enabledMappings.length} table(s).`,
          };
          void this._panel.webview.postMessage(doneMsg);
        } catch (err) {
          const errMsg: LoaderExtToWebMsg = {
            type: 'loadResult',
            success: false,
            message: err instanceof Error ? err.message : String(err),
          };
          void this._panel.webview.postMessage(errMsg);
        }
        break;
      }
    }
  }

  private _buildHtml(extensionUri: vscode.Uri): string {
    const webview = this._panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'datasetLoaderPanel.js')
    );
    const nonce = randomNonce();

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>Dataset Loader</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private _dispose(): void {
    DatasetLoaderPanel._instance = undefined;
    for (const d of this._disposables) { d.dispose(); }
    this._disposables = [];
  }
}
