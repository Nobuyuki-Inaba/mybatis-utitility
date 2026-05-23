import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { ExtToWebMsg, WebToExtMsg } from './types';

export class ConfigPanel {
  private static _instance: ConfigPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri, configMgr: ConfigManager): void {
    if (ConfigPanel._instance) {
      ConfigPanel._instance._panel.reveal(vscode.ViewColumn.One);
    } else {
      ConfigPanel._instance = new ConfigPanel(extensionUri, configMgr);
    }
  }

  private constructor(
    extensionUri: vscode.Uri,
    private readonly configMgr: ConfigManager
  ) {
    this._panel = vscode.window.createWebviewPanel(
      'mybatisUtility.configPanel',
      'Database Connections',
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
      (msg: WebToExtMsg) => this._handleMessage(msg),
      null,
      this._disposables
    );

    setTimeout(() => this._sendConnections(), 200);
  }

  private _sendConnections(): void {
    const msg: ExtToWebMsg = {
      type: 'connections',
      items: this.configMgr.getConnections(),
    };
    this._panel.webview.postMessage(msg);
  }

  private async _handleMessage(msg: WebToExtMsg): Promise<void> {
    switch (msg.type) {
      case 'getConnections':
        this._sendConnections();
        break;

      case 'saveConnection': {
        await this.configMgr.addConnection(msg.config, msg.password);
        const done: ExtToWebMsg = { type: 'connectionSaved' };
        this._panel.webview.postMessage(done);
        this._sendConnections();
        break;
      }

      case 'deleteConnection': {
        await this.configMgr.deleteConnection(msg.id);
        this._sendConnections();
        break;
      }

      default:
        break;
    }
  }

  private _buildHtml(extensionUri: vscode.Uri): string {
    const scriptUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'configPanel.js')
    );
    const nonce = randomNonce();
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>Database Connections</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private _dispose(): void {
    ConfigPanel._instance = undefined;
    for (const d of this._disposables) { d.dispose(); }
    this._disposables = [];
  }
}

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
