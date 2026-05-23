import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { ParamPreset } from './types';

export class ParamPresetManager {
  private get filePath(): string {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { return ''; }
    return path.join(root, '.vscode', 'mybatis-utility', 'params.yaml');
  }

  private readAll(): Record<string, ParamPreset[]> {
    const fp = this.filePath;
    if (!fp) { return {}; }
    try {
      const content = fs.readFileSync(fp, 'utf8');
      return (yaml.load(content) as Record<string, ParamPreset[]>) ?? {};
    } catch {
      return {};
    }
  }

  private writeAll(data: Record<string, ParamPreset[]>): void {
    const fp = this.filePath;
    if (!fp) { return; }
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(fp, yaml.dump(data, { lineWidth: -1 }), 'utf8');
  }

  getPresets(queryKey: string): ParamPreset[] {
    return this.readAll()[queryKey] ?? [];
  }

  savePreset(queryKey: string, preset: ParamPreset): void {
    const all = this.readAll();
    const list = all[queryKey] ?? [];
    const idx = list.findIndex(p => p.name === preset.name);
    if (idx >= 0) {
      list[idx] = preset;
    } else {
      list.push(preset);
    }
    all[queryKey] = list;
    this.writeAll(all);
  }

  deletePreset(queryKey: string, presetName: string): void {
    const all = this.readAll();
    const list = (all[queryKey] ?? []).filter(p => p.name !== presetName);
    if (list.length === 0) {
      delete all[queryKey];
    } else {
      all[queryKey] = list;
    }
    this.writeAll(all);
  }
}
