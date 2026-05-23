import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { DbConnectionConfig } from './types';

// ---------------------------------------------------------------------------
// Tree items
// ---------------------------------------------------------------------------

export class ConnectionItem extends vscode.TreeItem {
  constructor(public readonly config: DbConnectionConfig) {
    super(
      `${config.label}  (${config.type})`,
      vscode.TreeItemCollapsibleState.Collapsed
    );
    this.contextValue = 'connection';
    this.iconPath = new vscode.ThemeIcon('database');
    this.tooltip = connectionTooltip(config);
  }
}

export class ConnectionDetailItem extends vscode.TreeItem {
  constructor(label: string, description: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.contextValue = 'connectionDetail';
    this.iconPath = new vscode.ThemeIcon('symbol-field');
  }
}

function connectionTooltip(c: DbConnectionConfig): string {
  if (c.type === 'sqlite') { return `SQLite: ${c.filePath}`; }
  if (c.type === 'postgresql') { return `${c.host}:${c.port} / ${c.database} (${c.schema}) — ${c.username}`; }
  return `${c.host}:${c.port} / ${c.database} — ${c.username}`;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type DbTreeItem = ConnectionItem | ConnectionDetailItem;

export class DatabaseProvider implements vscode.TreeDataProvider<DbTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DbTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly config: ConfigManager) {
    config.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(element: DbTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DbTreeItem): DbTreeItem[] {
    if (!element) {
      return this.config.getConnections().map(c => new ConnectionItem(c));
    }
    if (element instanceof ConnectionItem) {
      return detailItems(element.config);
    }
    return [];
  }
}

function detailItems(c: DbConnectionConfig): ConnectionDetailItem[] {
  if (c.type === 'sqlite') {
    return [new ConnectionDetailItem('file', c.filePath)];
  }
  if (c.type === 'postgresql') {
    return [
      new ConnectionDetailItem('host', `${c.host}:${c.port}`),
      new ConnectionDetailItem('database', c.database),
      new ConnectionDetailItem('schema', c.schema),
      new ConnectionDetailItem('user', c.username),
    ];
  }
  // mysql
  return [
    new ConnectionDetailItem('host', `${c.host}:${c.port}`),
    new ConnectionDetailItem('database', c.database),
    new ConnectionDetailItem('user', c.username),
  ];
}
