import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { executeQuery, explainQuery } from './dbManager';
import { buildExecutableSql, defaultParamEntries } from './queryParser';
import { ParsedQuery, MapperFile, ExtToWebMsg, WebToExtMsg } from './types';
import { ParamPresetManager } from './paramPresetManager';

export class QueryPanel {
  private static _instance: QueryPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _currentQuery: ParsedQuery | undefined;
  private _queryKey = '';
  private readonly _presetMgr = new ParamPresetManager();

  static show(
    extensionUri: vscode.Uri,
    configMgr: ConfigManager,
    query: ParsedQuery,
    mapperFile: MapperFile
  ): void {
    if (QueryPanel._instance) {
      QueryPanel._instance._panel.reveal(vscode.ViewColumn.One);
      QueryPanel._instance._sendQuery(query, mapperFile);
    } else {
      QueryPanel._instance = new QueryPanel(extensionUri, configMgr, query, mapperFile);
    }
  }

  private constructor(
    extensionUri: vscode.Uri,
    private readonly configMgr: ConfigManager,
    query: ParsedQuery,
    mapperFile: MapperFile
  ) {
    this._panel = vscode.window.createWebviewPanel(
      'mybatisUtility.queryPanel',
      'MyBatis Query',
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

    // Push updated connection list to webview whenever connections change
    configMgr.onDidChange(() => this._sendConnections(), null, this._disposables);

    // Re-send settings when fetchLimit or pageSize changes
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('mybatisUtility.fetchLimit') ||
          e.affectsConfiguration('mybatisUtility.pageSize')) {
        this._sendSettings();
      }
    }, null, this._disposables);

    // Send initial data after webview is ready (small delay ensures JS is loaded)
    setTimeout(() => {
      this._sendQuery(query, mapperFile);
      this._sendConnections();
      this._sendSettings();
    }, 200);
  }

  private _sendQuery(query: ParsedQuery, mapperFile: MapperFile): void {
    this._currentQuery = query;
    this._panel.title = `Query: ${query.id}`;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    this._queryKey = `${path.relative(root, mapperFile.filePath).replace(/\\/g, '/')}#${query.id}`;
    const msg: ExtToWebMsg = {
      type: 'setQuery',
      query,
      mapperLabel: mapperFile.label,
    };
    this._panel.webview.postMessage(msg);
    this._postPresets();
  }

  private _postPresets(): void {
    const msg: ExtToWebMsg = {
      type: 'presets',
      presets: this._presetMgr.getPresets(this._queryKey),
    };
    this._panel.webview.postMessage(msg);
  }

  private _sendSettings(): void {
    const config = vscode.workspace.getConfiguration('mybatisUtility');
    const msg: ExtToWebMsg = {
      type: 'settings',
      fetchLimit: config.get<number>('fetchLimit', 5000),
      pageSize: config.get<number>('pageSize', 200),
    };
    this._panel.webview.postMessage(msg);
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

      case 'execute': {
        if (!this._currentQuery) {
          this._postError('No query loaded.');
          return;
        }
        const conn = this.configMgr.getConnections().find(c => c.id === msg.connectionId);
        if (!conn) {
          this._postError('No database connection selected. Please add and select one.');
          return;
        }
        const password = await this.configMgr.getPassword(conn.id);
        // Range: use selection. All: use the displayed (possibly edited) SQL, fallback to original.
        const sqlTemplate =
          msg.mode === 'range' && msg.selectedText
            ? msg.selectedText
            : (msg.displayedSql?.trim() || this._currentQuery.sql);
        const execSql = buildExecutableSql(sqlTemplate, msg.params);
        if (!execSql.trim()) {
          this._postError('No SQL to execute.');
          return;
        }
        try {
          const fetchLimit = vscode.workspace.getConfiguration('mybatisUtility').get<number>('fetchLimit', 5000);
          const result = msg.mode === 'explain'
            ? await explainQuery(conn, password, execSql)
            : await executeQuery(conn, password, execSql, fetchLimit);
          const resMsg: ExtToWebMsg = { type: 'queryResult', result };
          this._panel.webview.postMessage(resMsg);
        } catch (err) {
          this._postError(err instanceof Error ? err.message : String(err));
        }
        break;
      }

      case 'saveConnection': {
        await this.configMgr.addConnection(msg.config, msg.password);
        const doneMsg: ExtToWebMsg = { type: 'connectionSaved' };
        this._panel.webview.postMessage(doneMsg);
        this._sendConnections();
        break;
      }

      case 'deleteConnection': {
        await this.configMgr.deleteConnection(msg.id);
        const delMsg: ExtToWebMsg = { type: 'connectionDeleted', id: msg.id };
        this._panel.webview.postMessage(delMsg);
        this._sendConnections();
        break;
      }

      case 'savePreset':
        this._presetMgr.savePreset(this._queryKey, { name: msg.presetName, params: msg.params });
        this._postPresets();
        break;

      case 'deletePreset':
        this._presetMgr.deletePreset(this._queryKey, msg.presetName);
        this._postPresets();
        break;
    }
  }

  private _postError(message: string): void {
    const msg: ExtToWebMsg = { type: 'queryError', message };
    this._panel.webview.postMessage(msg);
  }

  private _buildHtml(extensionUri: vscode.Uri): string {
    const webview = this._panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'queryPanel.js')
    );
    const nonce = randomNonce();

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>MyBatis Query</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private _dispose(): void {
    QueryPanel._instance = undefined;
    for (const d of this._disposables) { d.dispose(); }
    this._disposables = [];
  }
}

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
