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

export function isGitStatusResponse(value: unknown): value is GitStatusResponse {
  return (
    isRecord(value) &&
    typeof value.isRepo === 'boolean' &&
    (typeof value.branch === 'string' || value.branch === null) &&
    Array.isArray(value.entries) &&
    value.entries.every(isGitStatusEntry)
  );
}

export function isGitDiffResponse(value: unknown): value is GitDiffResponse {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    (value.mode === 'diff' || value.mode === 'content') &&
    typeof value.content === 'string' &&
    (value.language === 'diff' || value.language === 'plaintext')
  );
}

export function gitChangeCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'change' : 'changes'}`;
}

export function gitStatusSummaryLabel(status: GitStatusResponse | null): string {
  if (!status) return 'Git';
  if (!status.isRepo) return 'No Git repo';
  return `${status.branch ?? 'Git'} · ${gitChangeCountLabel(status.entries.length)}`;
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
    if (left.type !== right.type) return left.type === 'file' ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) {
    if (node.type === 'directory') sortTree(node.children);
  }
}
