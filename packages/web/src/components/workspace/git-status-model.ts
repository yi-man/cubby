export interface GitStatusEntry {
  path: string;
  originalPath?: string;
  staged: string;
  worktree: string;
  status: string;
}

export interface GitPullRequest {
  provider: 'github';
  number: number;
  title: string;
  url: string;
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

export interface GitStatusResponse {
  isRepo: boolean;
  branch: string | null;
  entries: GitStatusEntry[];
  context?: GitRepositoryContext;
}

export interface GitDiffResponse {
  path: string;
  mode: 'diff' | 'content' | 'binary';
  content: string;
  language: 'diff' | 'plaintext';
  mimeType?: string;
  dataUrl?: string;
}

export type GitChangeTreeNode = GitChangeDirectoryNode | GitChangeFileNode;

export interface GitChangeDirectoryNode {
  type: 'directory';
  name: string;
  path: string;
  children: GitChangeTreeNode[];
}

export interface GitChangeFileNode {
  type: 'file';
  name: string;
  path: string;
  entry: GitStatusEntry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isGitStatusEntry(value: unknown): value is GitStatusEntry {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    (typeof value.originalPath === 'string' || value.originalPath === undefined) &&
    typeof value.staged === 'string' &&
    typeof value.status === 'string' &&
    typeof value.worktree === 'string'
  );
}

function isGitPullRequest(value: unknown): value is GitPullRequest {
  return (
    isRecord(value) &&
    value.provider === 'github' &&
    typeof value.number === 'number' &&
    typeof value.title === 'string' &&
    typeof value.url === 'string'
  );
}

function isGitRepositoryContext(value: unknown): value is GitRepositoryContext {
  return (
    isRecord(value) &&
    typeof value.repoRoot === 'string' &&
    typeof value.worktreeRoot === 'string' &&
    (typeof value.worktreeName === 'string' || value.worktreeName === null) &&
    typeof value.gitDir === 'string' &&
    typeof value.gitCommonDir === 'string' &&
    typeof value.isLinkedWorktree === 'boolean' &&
    typeof value.headDetached === 'boolean' &&
    (typeof value.commit === 'string' || value.commit === null) &&
    (typeof value.remoteUrl === 'string' || value.remoteUrl === null) &&
    (isGitPullRequest(value.pullRequest) || value.pullRequest === null)
  );
}

export function isGitStatusResponse(value: unknown): value is GitStatusResponse {
  return (
    isRecord(value) &&
    typeof value.isRepo === 'boolean' &&
    (typeof value.branch === 'string' || value.branch === null) &&
    Array.isArray(value.entries) &&
    value.entries.every(isGitStatusEntry) &&
    (isGitRepositoryContext(value.context) || value.context === undefined)
  );
}

export function isGitDiffResponse(value: unknown): value is GitDiffResponse {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    (value.mode === 'diff' || value.mode === 'content' || value.mode === 'binary') &&
    typeof value.content === 'string' &&
    (value.language === 'diff' || value.language === 'plaintext') &&
    (typeof value.mimeType === 'string' || value.mimeType === undefined) &&
    (typeof value.dataUrl === 'string' || value.dataUrl === undefined)
  );
}

export function gitChangeCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'change' : 'changes'}`;
}

export function gitStatusSummaryLabel(status: GitStatusResponse | null): string {
  return gitContextSummaryLabel(status);
}

export function gitContextSummaryLabel(status: GitStatusResponse | null): string {
  if (!status) return 'Git';
  if (!status.isRepo) return 'No Git repo';

  const branch = status.context?.headDetached ? 'HEAD detached' : (status.branch ?? 'Git');
  const worktree =
    status.context?.isLinkedWorktree && status.context.worktreeName
      ? ` · worktree ${status.context.worktreeName}`
      : '';
  return `${branch}${worktree} · ${gitChangeCountLabel(status.entries.length)}`;
}

export function gitPullRequestLabel(pullRequest: GitPullRequest | null | undefined): string | null {
  if (!pullRequest) return null;
  return `PR #${pullRequest.number}`;
}

export function gitChangeStatusDisplay(status: string): { label: string; title: string } {
  switch (status) {
    case '??':
      return { label: 'New', title: 'Untracked (??)' };
    case 'M':
      return { label: 'Mod', title: 'Modified (M)' };
    case 'A':
      return { label: 'Add', title: 'Added (A)' };
    case 'D':
      return { label: 'Del', title: 'Deleted (D)' };
    case 'R':
      return { label: 'Ren', title: 'Renamed (R)' };
    case 'C':
      return { label: 'Copy', title: 'Copied (C)' };
    case 'U':
      return { label: 'Conflict', title: 'Unmerged conflict (U)' };
    case '!':
      return { label: 'Ignored', title: 'Ignored (!)' };
    default:
      return { label: status, title: `Git status ${status}` };
  }
}

export function buildGitChangeTree(entries: GitStatusEntry[]): GitChangeTreeNode[] {
  const root: GitChangeDirectoryNode = { type: 'directory', name: '', path: '', children: [] };

  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    let directory = root;
    for (let index = 0; index < parts.length - 1; index++) {
      const name = parts[index];
      const path = parts.slice(0, index + 1).join('/');
      let child = directory.children.find(
        (node): node is GitChangeDirectoryNode => node.type === 'directory' && node.path === path,
      );
      if (!child) {
        child = { type: 'directory', name, path, children: [] };
        directory.children.push(child);
      }
      directory = child;
    }

    const name = parts[parts.length - 1] ?? entry.path;
    directory.children.push({ type: 'file', name, path: entry.path, entry });
  }

  sortTree(root.children);
  return root.children;
}

function sortTree(nodes: GitChangeTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) {
    if (node.type === 'directory') sortTree(node.children);
  }
}
