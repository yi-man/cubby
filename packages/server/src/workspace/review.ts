import { open, readdir, realpath, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

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

const SEARCH_SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
]);
const SEARCH_MAX_FILE_BYTES = 256 * 1024;
const SEARCH_MAX_RESULTS = 80;
const SEARCH_MAX_FILES = 3000;

export async function searchWorkspace(
  root: string,
  query: string,
): Promise<WorkspaceSearchResponse> {
  const normalizedQuery = query.trim();
  const realRoot = await realpath(root);
  if (!normalizedQuery) {
    return { root: realRoot, query: normalizedQuery, truncated: false, results: [] };
  }

  const loweredQuery = normalizedQuery.toLowerCase();
  const results: WorkspaceSearchResult[] = [];
  let scannedFiles = 0;
  let truncated = false;

  async function visitDirectory(directory: string): Promise<void> {
    if (truncated) return;

    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (truncated) return;
      if (entry.name.startsWith('.')) continue;

      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SEARCH_SKIP_DIRECTORIES.has(entry.name)) continue;
        await visitDirectory(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      scannedFiles += 1;
      if (scannedFiles > SEARCH_MAX_FILES) {
        truncated = true;
        return;
      }

      const relativePath = relative(realRoot, absolutePath);
      if (relativePath.toLowerCase().includes(loweredQuery)) {
        results.push({
          path: relativePath,
          absolutePath: await realpath(absolutePath),
          line: 1,
          column: 1,
          excerpt: relativePath,
          matchType: 'path',
        });
      }

      const fileStat = await stat(absolutePath);
      if (fileStat.size > SEARCH_MAX_FILE_BYTES) continue;

      const content = await readSearchableText(absolutePath, fileStat.size);
      if (content === null) continue;

      const contentResult = searchTextContent(
        content,
        normalizedQuery,
        loweredQuery,
        relativePath,
        await realpath(absolutePath),
      );
      if (contentResult) results.push(contentResult);

      if (results.length >= SEARCH_MAX_RESULTS) {
        truncated = true;
        return;
      }
    }
  }

  await visitDirectory(realRoot);

  results.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);
  return {
    root: realRoot,
    query: normalizedQuery,
    truncated,
    results: results.slice(0, SEARCH_MAX_RESULTS),
  };
}

export function imageMimeTypeForPath(path: string): string | null {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith('.png')) return 'image/png';
  if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerPath.endsWith('.gif')) return 'image/gif';
  if (lowerPath.endsWith('.webp')) return 'image/webp';
  return null;
}

async function readSearchableText(path: string, size: number): Promise<string | null> {
  const buffer = Buffer.alloc(size);
  const file = await open(path, 'r');
  try {
    const { bytesRead } = await file.read(buffer, 0, size, 0);
    const contentBuffer = buffer.subarray(0, bytesRead);
    if (contentBuffer.includes(0)) return null;

    const content = contentBuffer.toString('utf8');
    return content.includes('\uFFFD') ? null : content;
  } finally {
    await file.close();
  }
}

function searchTextContent(
  content: string,
  query: string,
  loweredQuery: string,
  relativePath: string,
  absolutePath: string,
): WorkspaceSearchResult | null {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const column = line.toLowerCase().indexOf(loweredQuery);
    if (column < 0) continue;

    return {
      path: relativePath,
      absolutePath,
      line: index + 1,
      column: column + 1,
      excerpt: line.trim() || query,
      matchType: 'content',
    };
  }

  return null;
}
