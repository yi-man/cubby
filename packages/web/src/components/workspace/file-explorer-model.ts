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

export interface ImportTarget {
  candidates: string[];
  importPath: string;
  targetSymbol: string;
}

export type FileExplorerLayoutMode = 'compact' | 'split';

export const FILE_EXPLORER_COMPACT_BREAKPOINT = 720;
const IMPORT_EXTENSION_CANDIDATES = ['.ts', '.tsx', '.js', '.jsx', '.json', '.css'] as const;
const INDEX_EXTENSION_CANDIDATES = ['.ts', '.tsx', '.js', '.jsx'] as const;

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

export function fileExplorerLayoutMode(viewportWidth: number): FileExplorerLayoutMode {
  return viewportWidth < FILE_EXPLORER_COMPACT_BREAKPOINT ? 'compact' : 'split';
}

export function relativePathFromRoot(pathValue: string, rootPath: string): string {
  const path = normalizePath(pathValue);
  const root = normalizePath(rootPath);
  if (path === root) return '.';
  if (!isPathInsideRoot(path, root)) return pathValue;
  return path.slice(root.length + 1) || '.';
}

export function importTargetForSymbol(
  sourceContent: string,
  sourcePath: string,
  rootPath: string,
  symbolName: string,
): ImportTarget | null {
  const importPattern = /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g;
  for (const match of sourceContent.matchAll(importPattern)) {
    const importBindings = match[1]?.trim();
    const importPath = match[2]?.trim();
    if (!importBindings || !importPath || !isRelativeImportPath(importPath)) continue;

    const targetSymbol = targetSymbolForImportBinding(importBindings, symbolName);
    if (!targetSymbol) continue;

    const targetBasePath = resolveImportBasePath(sourcePath, importPath);
    const candidates = importPathCandidates(targetBasePath).filter((candidate) =>
      isPathInsideRoot(candidate, normalizePath(rootPath)),
    );
    if (candidates.length === 0) return null;

    return { candidates, importPath, targetSymbol };
  }

  return null;
}

export function definitionLineForSymbol(content: string, symbolName: string): number {
  const escapedSymbol = escapeRegExp(symbolName);
  const patterns = [
    new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?function\\s+${escapedSymbol}\\b`),
    new RegExp(`^\\s*(?:export\\s+)?class\\s+${escapedSymbol}\\b`),
    new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${escapedSymbol}\\b`),
    new RegExp(`^\\s*export\\s+default\\s+${escapedSymbol}\\b`),
    /^\s*export\s+default\s+(?:function|class)\b/,
  ];
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => patterns.some((pattern) => pattern.test(line)));
  return index >= 0 ? index + 1 : 1;
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
  const trimmed = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return trimmed || '/';
}

function isPathInsideRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function isRelativeImportPath(importPath: string): boolean {
  return importPath.startsWith('./') || importPath.startsWith('../');
}

function targetSymbolForImportBinding(importBindings: string, symbolName: string): string | null {
  const namedBlock = /\{([\s\S]*?)\}/.exec(importBindings);
  const leadingBinding = namedBlock
    ? importBindings.slice(0, namedBlock.index).replace(/,$/, '').trim()
    : importBindings.trim();

  if (leadingBinding) {
    const namespaceMatch = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(leadingBinding);
    if (namespaceMatch?.[1] === symbolName) return symbolName;

    const defaultBinding = leadingBinding.replace(/^type\s+/, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(defaultBinding) && defaultBinding === symbolName) {
      return symbolName;
    }
  }

  if (!namedBlock) return null;

  for (const binding of namedBlock[1].split(',')) {
    const cleanedBinding = binding.trim().replace(/^type\s+/, '');
    const bindingMatch = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(cleanedBinding);
    if (!bindingMatch) continue;

    const importedName = bindingMatch[1];
    const localName = bindingMatch[2] ?? importedName;
    if (localName === symbolName) return importedName;
  }

  return null;
}

function resolveImportBasePath(sourcePath: string, importPath: string): string {
  const sourceDirectory = directoryPath(sourcePath);
  return resolveWorkspaceRelativePath(sourceDirectory, importPath);
}

function directoryPath(pathValue: string): string {
  const path = normalizePath(pathValue);
  const slashIndex = path.lastIndexOf('/');
  if (slashIndex <= 0) return '/';
  return path.slice(0, slashIndex);
}

function resolveWorkspaceRelativePath(basePath: string, relativePath: string): string {
  const combinedPath = relativePath.startsWith('/')
    ? relativePath
    : `${normalizePath(basePath)}/${relativePath}`;
  const absolute = combinedPath.startsWith('/');
  const parts: string[] = [];

  for (const part of combinedPath.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return `${absolute ? '/' : ''}${parts.join('/')}`;
}

function importPathCandidates(targetBasePath: string): string[] {
  const normalizedPath = normalizePath(targetBasePath);
  if (hasFileExtension(normalizedPath))
    return importPathCandidatesForExplicitExtension(normalizedPath);

  return [
    ...IMPORT_EXTENSION_CANDIDATES.map((extension) => `${normalizedPath}${extension}`),
    ...INDEX_EXTENSION_CANDIDATES.map((extension) => `${normalizedPath}/index${extension}`),
  ];
}

function importPathCandidatesForExplicitExtension(pathValue: string): string[] {
  if (pathValue.endsWith('.js')) {
    const basePath = pathValue.slice(0, -'.js'.length);
    return [pathValue, `${basePath}.ts`, `${basePath}.tsx`, `${basePath}.jsx`];
  }

  if (pathValue.endsWith('.jsx')) {
    const basePath = pathValue.slice(0, -'.jsx'.length);
    return [pathValue, `${basePath}.tsx`, `${basePath}.ts`];
  }

  return [pathValue];
}

function hasFileExtension(pathValue: string): boolean {
  const fileName = pathValue.split('/').pop() ?? '';
  return /\.[^/.]+$/.test(fileName);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
