import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { MapperWebviewProvider } from './mapperWebviewProvider';
import { DatabaseProvider, ConnectionItem } from './databaseProvider';
import { ConfigPanel } from './configPanel';
import { setExtensionPath } from './extensionContext';
import { NewDbConnectionConfig, DbType } from './types';

export function activate(context: vscode.ExtensionContext): void {
  setExtensionPath(context.extensionPath);

  // --- Shared services ---
  const onDidChangeConnections = new vscode.EventEmitter<void>();
  context.subscriptions.push(onDidChangeConnections);

  const configMgr = new ConfigManager(
    context.globalState,
    context.secrets,
    onDidChangeConnections
  );

  // --- Mapper webview panel ---
  const mapperProvider = new MapperWebviewProvider(context.extensionUri, configMgr);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MapperWebviewProvider.viewType, mapperProvider)
  );

  // Set initial context key for toggle button display
  void vscode.commands.executeCommand('setContext', 'mybatisUtility.mapperViewMode', 'flat');

  const dbProvider = new DatabaseProvider(configMgr);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('mybatisUtility.databaseView', dbProvider)
  );

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand('mybatisUtility.refreshMappers', () => {
      mapperProvider.refresh();
    })
  );

  // ⚙ gear — open the full management panel (list + edit)
  context.subscriptions.push(
    vscode.commands.registerCommand('mybatisUtility.openConfig', () => {
      ConfigPanel.show(context.extensionUri, configMgr);
    })
  );

  // + button — quick-add via InputBox wizard (no panel needed)
  context.subscriptions.push(
    vscode.commands.registerCommand('mybatisUtility.addDatabase', async () => {
      await quickAddDatabase(configMgr);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mybatisUtility.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'mybatisUtility');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mybatisUtility.setFlatView', () => {
      mapperProvider.setDisplayMode('flat');
      void vscode.commands.executeCommand('setContext', 'mybatisUtility.mapperViewMode', 'flat');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mybatisUtility.setTreeView', () => {
      mapperProvider.setDisplayMode('tree');
      void vscode.commands.executeCommand('setContext', 'mybatisUtility.mapperViewMode', 'tree');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mybatisUtility.deleteDatabase', async (item: ConnectionItem) => {
      const answer = await vscode.window.showWarningMessage(
        `Delete connection "${item.config.label}"?`,
        { modal: true },
        'Delete'
      );
      if (answer === 'Delete') {
        await configMgr.deleteConnection(item.config.id);
      }
    })
  );

  // Re-scan when the user changes mybatisUtility.scanFolders
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('mybatisUtility.scanFolders')) {
        mapperProvider.refresh();
      }
    })
  );

  // Auto-refresh mapper tree on workspace file changes
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{java,xml}');
  watcher.onDidCreate(() => mapperProvider.refresh());
  watcher.onDidChange(() => mapperProvider.refresh());
  watcher.onDidDelete(() => mapperProvider.refresh());
  context.subscriptions.push(watcher);
}

// ---------------------------------------------------------------------------
// Quick-add wizard using VSCode's built-in input UI
// ---------------------------------------------------------------------------

async function quickAddDatabase(configMgr: ConfigManager): Promise<void> {
  // Step 1: DB type
  const typeItem = await vscode.window.showQuickPick(
    [
      { label: 'SQLite',     description: 'Local file-based database', value: 'sqlite' as DbType },
      { label: 'PostgreSQL', description: 'Host/port connection',      value: 'postgresql' as DbType },
      { label: 'MySQL',      description: 'Host/port connection',      value: 'mysql' as DbType },
    ],
    { title: 'Add Database Connection (1/2)', placeHolder: 'Select database type' }
  );
  if (!typeItem) { return; }

  // Step 2: Label
  const label = await vscode.window.showInputBox({
    title: 'Add Database Connection (2/2)',
    prompt: 'Connection label (displayed in the tree)',
    placeHolder: 'e.g. localhost(sqlite)',
    validateInput: v => v.trim() ? undefined : 'Label is required',
  });
  if (label === undefined) { return; }

  if (typeItem.value === 'sqlite') {
    await quickAddSqlite(configMgr, label.trim());
  } else {
    await quickAddHostDb(configMgr, label.trim(), typeItem.value);
  }
}

async function quickAddSqlite(configMgr: ConfigManager, label: string): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    title: 'Select SQLite database file',
    filters: { 'SQLite': ['db', 'sqlite', 'sqlite3'], 'All files': ['*'] },
    canSelectMany: false,
  });
  if (!uris || uris.length === 0) { return; }

  const cfg = { type: 'sqlite' as const, label, filePath: uris[0].fsPath };
  await configMgr.addConnection(cfg);
  vscode.window.showInformationMessage(`Added SQLite connection: ${label}`);
}

async function quickAddHostDb(
  configMgr: ConfigManager,
  label: string,
  type: 'postgresql' | 'mysql'
): Promise<void> {
  const defaultPort = type === 'postgresql' ? '5432' : '3306';

  const host = await prompt('Host', 'localhost');
  if (host === undefined) { return; }

  const portStr = await prompt('Port', defaultPort, v =>
    /^\d+$/.test(v) ? undefined : 'Port must be a number'
  );
  if (portStr === undefined) { return; }

  const database = await prompt('Database name', '');
  if (database === undefined) { return; }

  let schema = 'public';
  if (type === 'postgresql') {
    const s = await prompt('Schema', 'public');
    if (s === undefined) { return; }
    schema = s;
  }

  const username = await prompt('Username', type === 'postgresql' ? 'postgres' : 'root');
  if (username === undefined) { return; }

  const password = await vscode.window.showInputBox({
    prompt: 'Password (stored in VSCode Secret Storage)',
    password: true,
    ignoreFocusOut: true,
  });
  // password can be empty string — that's valid

  const base = { label, host, port: Number(portStr), database, username };
  const config: NewDbConnectionConfig =
    type === 'postgresql'
      ? { ...base, type: 'postgresql' as const, schema }
      : { ...base, type: 'mysql' as const };

  await configMgr.addConnection(config, password ?? undefined);
  vscode.window.showInformationMessage(`Added ${type} connection: ${label}`);
}

async function prompt(
  promptText: string,
  placeHolder: string,
  validate?: (v: string) => string | undefined
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: promptText,
    placeHolder,
    ignoreFocusOut: true,
    validateInput: validate,
  });
}

export function deactivate(): void {
  // nothing
}
