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

export interface WorkspaceSearchResult {
  path: string;
  absolutePath: string;
  line: number;
  column: number;
  excerpt: string;
  matchType: 'path' | 'content';
}

export interface WorkspaceSearchResponse {
  root: string;
  query: string;
  truncated: boolean;
  results: WorkspaceSearchResult[];
}

export interface ImportTarget {
  candidates: string[];
  importPath: string;
  targetSymbol: string;
}

export type FilePreviewKind = 'text' | 'markdown' | 'image';

export type MarkdownPreviewBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; language: string; text: string };

export interface WorkspaceFileRef {
  path: string;
  displayPath: string;
  line: number;
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

function isWorkspaceSearchResult(value: unknown): value is WorkspaceSearchResult {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    typeof value.absolutePath === 'string' &&
    typeof value.line === 'number' &&
    typeof value.column === 'number' &&
    typeof value.excerpt === 'string' &&
    (value.matchType === 'path' || value.matchType === 'content')
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

export function isWorkspaceSearchResponse(value: unknown): value is WorkspaceSearchResponse {
  return (
    isRecord(value) &&
    typeof value.root === 'string' &&
    typeof value.query === 'string' &&
    typeof value.truncated === 'boolean' &&
    Array.isArray(value.results) &&
    value.results.every(isWorkspaceSearchResult)
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

export function filePreviewKind(path: string): FilePreviewKind {
  const fileName = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) return 'markdown';
  if (
    fileName.endsWith('.png') ||
    fileName.endsWith('.jpg') ||
    fileName.endsWith('.jpeg') ||
    fileName.endsWith('.gif') ||
    fileName.endsWith('.webp')
  ) {
    return 'image';
  }

  return 'text';
}

export function markdownPreviewBlocks(content: string): MarkdownPreviewBlock[] {
  const blocks: MarkdownPreviewBlock[] = [];
  const lines = content.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const fenceMatch = /^```([A-Za-z0-9_-]*)\s*$/.exec(trimmed);
    if (fenceMatch) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: 'code', language: fenceMatch[1] ?? '', text: codeLines.join('\n') });
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push({
        kind: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2],
      });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const itemMatch = /^[-*]\s+(.+)$/.exec(lines[index].trim());
        if (!itemMatch) break;
        items.push(itemMatch[1]);
        index += 1;
      }
      blocks.push({ kind: 'list', items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const paragraphLine = lines[index].trim();
      if (
        !paragraphLine ||
        /^#{1,3}\s+/.test(paragraphLine) ||
        /^[-*]\s+/.test(paragraphLine) ||
        /^```/.test(paragraphLine)
      ) {
        break;
      }
      paragraphLines.push(paragraphLine);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraphLines.join(' ') });
  }

  return blocks;
}

export function extractedWorkspaceFileRefs(output: string, rootPath: string): WorkspaceFileRef[] {
  const refs: WorkspaceFileRef[] = [];
  const seen = new Set<string>();
  const normalizedRoot = normalizePath(rootPath);
  const pattern = /(^|\s)([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)(?::\d+)?/g;

  for (const match of output.matchAll(pattern)) {
    const displayPath = match[2];
    if (!displayPath || displayPath.startsWith('/') || displayPath.includes('..')) continue;

    const line = Number(match[3]);
    if (!Number.isInteger(line) || line < 1) continue;

    const absolutePath = normalizePath(`${normalizedRoot}/${displayPath}`);
    const key = `${absolutePath}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ path: absolutePath, displayPath, line });
  }

  return refs.slice(0, 8);
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
