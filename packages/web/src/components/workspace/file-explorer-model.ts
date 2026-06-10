export interface FileExplorerEntry {
  name: string;
  path: string;
  isDir: boolean;
  previewable?: boolean;
}

export interface FileBrowseResponse {
  path: string;
  root?: string;
  entries: FileExplorerEntry[];
}

export interface FilePreviewResponse {
  path: string;
  content: string;
  truncated: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFileExplorerEntry(value: unknown): value is FileExplorerEntry {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    typeof value.isDir === 'boolean' &&
    (typeof value.previewable === 'boolean' || value.previewable === undefined)
  );
}

export function isFileBrowseResponse(value: unknown): value is FileBrowseResponse {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    (typeof value.root === 'string' || value.root === undefined) &&
    Array.isArray(value.entries) &&
    value.entries.every(isFileExplorerEntry)
  );
}

export function isFilePreviewResponse(value: unknown): value is FilePreviewResponse {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    typeof value.content === 'string' &&
    typeof value.truncated === 'boolean'
  );
}

export function parentPathWithinRoot(currentPath: string, rootPath: string): string {
  const current = normalizePath(currentPath);
  const root = normalizePath(rootPath);
  if (!isPathInsideRoot(current, root) || current === root) return root;

  const slashIndex = current.lastIndexOf('/');
  if (slashIndex <= 0) return root;
  const parent = current.slice(0, slashIndex);
  return isPathInsideRoot(parent, root) ? parent : root;
}

function normalizePath(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed || '/';
}

function isPathInsideRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}
