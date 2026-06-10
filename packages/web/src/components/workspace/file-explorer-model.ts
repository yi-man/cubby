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

export function fileLanguageFromPath(path: string): string {
  const fileName = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (!fileName) return 'plaintext';

  if (fileName === 'package.json' || fileName.endsWith('.json')) return 'json';
  if (fileName === 'tsconfig.json' || fileName.endsWith('.ts')) return 'typescript';
  if (fileName.endsWith('.tsx')) return 'typescript';
  if (fileName.endsWith('.js') || fileName.endsWith('.mjs') || fileName.endsWith('.cjs')) {
    return 'javascript';
  }
  if (fileName.endsWith('.jsx')) return 'javascript';
  if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) return 'markdown';
  if (fileName.endsWith('.css')) return 'css';
  if (fileName.endsWith('.scss') || fileName.endsWith('.sass')) return 'scss';
  if (fileName.endsWith('.html') || fileName.endsWith('.htm')) return 'html';
  if (fileName.endsWith('.yml') || fileName.endsWith('.yaml')) return 'yaml';
  if (fileName.endsWith('.toml')) return 'toml';
  if (fileName.endsWith('.xml')) return 'xml';
  if (fileName.endsWith('.sql')) return 'sql';
  if (fileName.endsWith('.sh') || fileName.endsWith('.bash') || fileName.endsWith('.zsh')) {
    return 'shell';
  }
  if (fileName.endsWith('.py')) return 'python';
  if (fileName.endsWith('.rs')) return 'rust';
  if (fileName.endsWith('.go')) return 'go';
  if (fileName.endsWith('.java')) return 'java';
  if (fileName.endsWith('.kt') || fileName.endsWith('.kts')) return 'kotlin';
  if (fileName.endsWith('.rb')) return 'ruby';
  if (fileName.endsWith('.php')) return 'php';
  if (fileName.endsWith('.c') || fileName.endsWith('.h')) return 'c';
  if (fileName.endsWith('.cpp') || fileName.endsWith('.cc') || fileName.endsWith('.hpp')) {
    return 'cpp';
  }

  return 'plaintext';
}

function normalizePath(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed || '/';
}

function isPathInsideRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}
