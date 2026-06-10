import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
}

export interface GitDiffResponse {
  path: string;
  mode: 'diff' | 'content';
  content: string;
  language: 'diff' | 'plaintext';
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

  return parseGitStatusPorcelain(result.value.stdout);
}

export async function readGitDiff(
  root: string,
  relativePath: string,
  entry?: GitStatusEntry,
): Promise<GitDiffResponse> {
  const currentEntry = entry ?? (await findStatusEntry(root, relativePath));
  const mode = diffModeForEntry(currentEntry);
  if (mode === 'content') {
    return {
      path: relativePath,
      mode: 'content',
      content: await readFile(join(root, relativePath), 'utf8'),
      language: 'plaintext',
    };
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
