/** Module-level singleton that stores the extension installation path. */
let _extensionPath = '';

export function setExtensionPath(p: string): void {
  _extensionPath = p;
}

export function getExtensionPath(): string {
  return _extensionPath;
}
