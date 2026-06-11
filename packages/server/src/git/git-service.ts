import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_BINARY_PREVIEW_BYTES = 2 * 1024 * 1024;

export type GitDiffMode = 'worktree' | 'cached' | 'both' | 'content';

export interface GitStatusEntry {
  path: string;
  originalPath?: string;
  staged: string;
  worktree: string;
  status: string;
}

export interface GitStatusResponse {
  isRepo: boolean;
  branch: string | null;
  entries: GitStatusEntry[];
  context?: GitRepositoryContext;
}

export interface GitRepositoryContext {
  repoRoot: string;
  worktreeRoot: string;
  worktreeName: string | null;
  gitDir: string;
  gitCommonDir: string;
  isLinkedWorktree: boolean;
  headDetached: boolean;
  commit: string | null;
  remoteUrl: string | null;
  pullRequest: GitPullRequest | null;
}

export interface GitPullRequest {
  provider: 'github';
  number: number;
  title: string;
  url: string;
}

export interface GitDiffResponse {
  path: string;
  mode: 'diff' | 'content' | 'binary';
  content: string;
  language: 'diff' | 'plaintext';
  mimeType?: string;
  dataUrl?: string;
}

interface RunGitResult {
  stdout: string;
  stderr: string;
}

export async function readGitStatus(root: string): Promise<GitStatusResponse> {
  const result = await runGit(root, ['status', '--porcelain=v1', '-b', '-uall']);
  if (!result.ok) {
    if (result.reason === 'not-repo') return { isRepo: false, branch: null, entries: [] };
    throw result.error;
  }

  const status = parseGitStatusPorcelain(result.value.stdout);
  return {
    ...status,
    context: await readGitRepositoryContext(root, status.branch),
  };
}

export async function readGitDiff(
  root: string,
  relativePath: string,
  entry?: GitStatusEntry,
): Promise<GitDiffResponse> {
  const currentEntry = entry ?? (await findStatusEntry(root, relativePath));
  const mode = diffModeForEntry(currentEntry);
  if (mode === 'content') {
    return await readContentPreview(root, relativePath);
  }

  const binaryPreview = await readBinaryPreview(root, relativePath);
  if (binaryPreview) {
    return binaryPreview;
  }

  const chunks: string[] = [];
  if (mode === 'worktree' || mode === 'both') {
    const diff = await runGitOrThrow(root, ['diff', '--', relativePath]);
    if (mode === 'both') chunks.push('## Worktree changes\n');
    chunks.push(diff.stdout);
  }
  if (mode === 'cached' || mode === 'both') {
    const diff = await runGitOrThrow(root, ['diff', '--cached', '--', relativePath]);
    if (mode === 'both') chunks.push('\n## Staged changes\n');
    chunks.push(diff.stdout);
  }

  return {
    path: relativePath,
    mode: 'diff',
    content: chunks.join(''),
    language: 'diff',
  };
}

export function parseGitStatusPorcelain(output: string): GitStatusResponse {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith('## '));

  return {
    isRepo: true,
    branch: branchLine ? parseBranchLine(branchLine) : null,
    entries: lines.filter((line) => !line.startsWith('## ')).map(parseStatusLine),
  };
}

export function diffModeForEntry(entry: GitStatusEntry): GitDiffMode {
  if (entry.staged === '?' && entry.worktree === '?') return 'content';

  const hasStaged = entry.staged !== ' ' && entry.staged !== '?';
  const hasWorktree = entry.worktree !== ' ' && entry.worktree !== '?';
  if (hasStaged && hasWorktree) return 'both';
  if (hasStaged) return 'cached';
  return 'worktree';
}

export function statusLabelForEntry(entry: GitStatusEntry): string {
  return entry.status;
}

async function findStatusEntry(root: string, relativePath: string): Promise<GitStatusEntry> {
  const status = await readGitStatus(root);
  const entry = status.entries.find((candidate) => candidate.path === relativePath);
  return entry ?? { path: relativePath, staged: ' ', worktree: 'M', status: 'M' };
}

function parseBranchLine(line: string): string {
  const value = line.slice(3).trim();
  if (value === 'HEAD (no branch)') return 'HEAD (detached)';
  return value.split('...')[0]?.trim() || value;
}

function parseStatusLine(line: string): GitStatusEntry {
  const staged = line[0] ?? ' ';
  const worktree = line[1] ?? ' ';
  const rawPath = line.slice(3);
  const renameParts = rawPath.split(' -> ');
  const path = renameParts[renameParts.length - 1] ?? rawPath;
  const originalPath = renameParts.length > 1 ? renameParts[0] : undefined;
  const status = staged === '?' && worktree === '?' ? '??' : staged !== ' ' ? staged : worktree;

  return {
    ...(originalPath ? { originalPath } : {}),
    path,
    staged,
    status,
    worktree,
  };
}

async function runGitOrThrow(root: string, args: string[]): Promise<RunGitResult> {
  const result = await runGit(root, args);
  if (!result.ok) throw result.error;
  return result.value;
}

async function readGitRepositoryContext(
  root: string,
  branch: string | null,
): Promise<GitRepositoryContext | undefined> {
  try {
    const [worktreeRoot, gitDir, gitCommonDir, commit, remoteUrl] = await Promise.all([
      readGitSingleLine(root, ['rev-parse', '--show-toplevel']),
      readGitSingleLine(root, ['rev-parse', '--absolute-git-dir']),
      readGitSingleLine(root, ['rev-parse', '--git-common-dir']),
      readOptionalGitSingleLine(root, ['rev-parse', '--short', 'HEAD']),
      readOptionalGitSingleLine(root, ['remote', 'get-url', 'origin']),
    ]);
    const absoluteGitDir = resolve(worktreeRoot, gitDir);
    const absoluteGitCommonDir = resolve(worktreeRoot, gitCommonDir);
    const isLinkedWorktree = absoluteGitDir !== absoluteGitCommonDir;
    const repoRoot = isLinkedWorktree ? dirname(absoluteGitCommonDir) : worktreeRoot;

    return {
      repoRoot,
      worktreeRoot,
      worktreeName: isLinkedWorktree ? basename(worktreeRoot) : null,
      gitDir: absoluteGitDir,
      gitCommonDir: absoluteGitCommonDir,
      isLinkedWorktree,
      headDetached: branch === null || branch === 'HEAD (detached)',
      commit,
      remoteUrl,
      pullRequest: null,
    };
  } catch {
    return undefined;
  }
}

async function readGitSingleLine(root: string, args: string[]): Promise<string> {
  const result = await runGitOrThrow(root, args);
  return result.stdout.trim();
}

async function readOptionalGitSingleLine(root: string, args: string[]): Promise<string | null> {
  const result = await runGit(root, args);
  if (!result.ok) return null;
  const value = result.value.stdout.trim();
  return value.length > 0 ? value : null;
}

async function readContentPreview(root: string, relativePath: string): Promise<GitDiffResponse> {
  const buffer = await readFile(join(root, relativePath));
  if (isBinaryBuffer(buffer)) {
    return binaryResponse(relativePath, buffer);
  }

  const content = buffer.toString('utf8');
  if (content.includes('\uFFFD')) {
    return binaryResponse(relativePath, buffer);
  }

  return {
    path: relativePath,
    mode: 'content',
    content,
    language: 'plaintext',
  };
}

async function readBinaryPreview(
  root: string,
  relativePath: string,
): Promise<GitDiffResponse | null> {
  try {
    const buffer = await readFile(join(root, relativePath));
    if (!isBinaryBuffer(buffer) && !buffer.toString('utf8').includes('\uFFFD')) {
      return null;
    }
    return binaryResponse(relativePath, buffer);
  } catch {
    return null;
  }
}

function binaryResponse(relativePath: string, buffer: Buffer): GitDiffResponse {
  const mimeType = mimeTypeForPath(relativePath);
  return {
    path: relativePath,
    mode: 'binary',
    content: '',
    language: 'plaintext',
    ...(mimeType ? { mimeType } : {}),
    ...(mimeType?.startsWith('image/') && buffer.byteLength <= MAX_BINARY_PREVIEW_BYTES
      ? { dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}` }
      : {}),
  };
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function mimeTypeForPath(path: string): string | undefined {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.ico':
      return 'image/x-icon';
    default:
      return undefined;
  }
}

async function runGit(
  root: string,
  args: string[],
): Promise<
  { ok: true; value: RunGitResult } | { ok: false; reason: 'not-repo' | 'failed'; error: Error }
> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-C', root, ...args], {
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, value: { stdout, stderr } };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const stderr = 'stderr' in error ? String((error as Error & { stderr?: unknown }).stderr) : '';
    if (stderr.includes('not a git repository')) {
      return { ok: false, reason: 'not-repo', error };
    }
    return { ok: false, reason: 'failed', error };
  }
}
