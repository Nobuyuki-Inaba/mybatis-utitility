import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { DbConnectionConfig, NewDbConnectionConfig } from './types';

const STORAGE_KEY = 'mybatisUtility.connections';

/**
 * Persists DB connection configs in globalState (non-sensitive fields) and
 * VSCode SecretStorage (passwords).  Never touches workspace settings so that
 * credentials are not accidentally committed.
 */
export class ConfigManager {
  readonly onDidChange: vscode.Event<void>;

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly secrets: vscode.SecretStorage,
    private readonly _onDidChange: vscode.EventEmitter<void>
  ) {
    this.onDidChange = _onDidChange.event;
  }

  getConnections(): DbConnectionConfig[] {
    return this.globalState.get<DbConnectionConfig[]>(STORAGE_KEY, []);
  }

  async addConnection(
    config: NewDbConnectionConfig,
    password?: string
  ): Promise<DbConnectionConfig> {
    const conn = { ...config, id: randomUUID() } as DbConnectionConfig;
    const list = [...this.getConnections(), conn];
    await this.globalState.update(STORAGE_KEY, list);
    if (password) {
      await this.secrets.store(secretKey(conn.id), password);
    }
    this._onDidChange.fire();
    return conn;
  }

  async updateConnection(
    id: string,
    patch: Partial<Omit<DbConnectionConfig, 'id' | 'type'>>,
    password?: string
  ): Promise<void> {
    const list = this.getConnections().map(c =>
      c.id === id ? ({ ...c, ...patch } as DbConnectionConfig) : c
    );
    await this.globalState.update(STORAGE_KEY, list);
    if (password !== undefined) {
      await this.secrets.store(secretKey(id), password);
    }
    this._onDidChange.fire();
  }

  async deleteConnection(id: string): Promise<void> {
    const list = this.getConnections().filter(c => c.id !== id);
    await this.globalState.update(STORAGE_KEY, list);
    await this.secrets.delete(secretKey(id));
    this._onDidChange.fire();
  }

  getPassword(id: string): Promise<string | undefined> {
    return Promise.resolve(this.secrets.get(secretKey(id)));
  }
}

function secretKey(id: string): string {
  return `mybatisUtility.${id}.password`;
}
