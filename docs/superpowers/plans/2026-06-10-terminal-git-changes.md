# Terminal Git Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Git branch and change-count information to the terminal bottom toolbar, with a read-only dialog for browsing changed files by directory and viewing diffs.

**Architecture:** The server exposes read-only Git HTTP endpoints next to the existing file browse routes. The web app adds a focused Git status model and modal component under `packages/web/src/components/workspace`, then `SessionView` fetches status for the active session workspace and opens the dialog from the terminal toolbar.

**Tech Stack:** Bun, Fastify, React, Monaco Editor, lucide-react, Vitest, Playwright.

---

## File Structure

- Create `packages/server/src/git/git-service.ts`
  - Runs Git commands without a shell.
  - Parses `git status --porcelain=v1 -b`.
  - Produces status and diff/content responses.
- Create `packages/server/src/git/git-service.test.ts`
  - Unit tests for porcelain parsing and diff mode decisions.
- Modify `packages/server/src/http/routes.ts`
  - Add `/api/git/status` and `/api/git/diff`.
  - Export shared path helpers only if tests require it.
- Modify `packages/server/src/server.test.ts`
  - Add route integration coverage for status, diff, untracked content, non-repo, and path safety.
- Create `packages/web/src/components/workspace/git-status-model.ts`
  - Validates API responses.
  - Formats branch/count labels.
  - Builds a directory tree from flat changed-file entries.
- Create `packages/web/src/components/workspace/git-status-model.test.ts`
  - Unit tests for response guards and directory tree construction.
- Create `packages/web/src/components/workspace/git-changes.tsx`
  - Read-only modal for changed files and diff preview.
- Modify `packages/web/src/components/session/session-view.tsx`
  - Fetch Git status for `session.workspaceId`.
  - Render branch/change count in the bottom toolbar.
  - Open `GitChanges`.
- Modify `e2e/app.spec.ts`
  - Add a browser test that initializes a temporary Git repo, creates a modified file, opens the dialog, and verifies diff display.

---

### Task 1: Server Git Service

**Files:**
- Create: `packages/server/src/git/git-service.ts`
- Test: `packages/server/src/git/git-service.test.ts`

- [ ] **Step 1: Write the failing service tests**

Add `packages/server/src/git/git-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  diffModeForEntry,
  parseGitStatusPorcelain,
  statusLabelForEntry,
} from './git-service.js';

describe('git service model', () => {
  it('parses branch and changed files from porcelain status', () => {
    const status = parseGitStatusPorcelain([
      '## feature/git-ui...origin/feature/git-ui [ahead 1]',
      ' M packages/web/src/app.tsx',
      'A  packages/server/src/git/git-service.ts',
      'D  docs/old.md',
      'R  docs/new.md -> docs/current.md',
      '?? scratch/notes.txt',
    ].join('\n'));

    expect(status).toEqual({
      branch: 'feature/git-ui',
      entries: [
        {
          path: 'packages/web/src/app.tsx',
          staged: ' ',
          worktree: 'M',
          status: 'M',
        },
        {
          path: 'packages/server/src/git/git-service.ts',
          staged: 'A',
          worktree: ' ',
          status: 'A',
        },
        {
          path: 'docs/old.md',
          staged: 'D',
          worktree: ' ',
          status: 'D',
        },
        {
          originalPath: 'docs/new.md',
          path: 'docs/current.md',
          staged: 'R',
          worktree: ' ',
          status: 'R',
        },
        {
          path: 'scratch/notes.txt',
          staged: '?',
          worktree: '?',
          status: '??',
        },
      ],
      isRepo: true,
    });
  });

  it('labels detached heads from porcelain branch lines', () => {
    expect(parseGitStatusPorcelain('## HEAD (no branch)\n M file.txt\n')).toMatchObject({
      branch: 'HEAD (detached)',
      isRepo: true,
    });
  });

  it('selects diff modes from staged and worktree states', () => {
    expect(diffModeForEntry({ path: 'a.txt', staged: ' ', worktree: 'M', status: 'M' })).toBe(
      'worktree',
    );
    expect(diffModeForEntry({ path: 'a.txt', staged: 'M', worktree: ' ', status: 'M' })).toBe(
      'cached',
    );
    expect(diffModeForEntry({ path: 'a.txt', staged: 'M', worktree: 'M', status: 'M' })).toBe(
      'both',
    );
    expect(diffModeForEntry({ path: 'a.txt', staged: '?', worktree: '?', status: '??' })).toBe(
      'content',
    );
  });

  it('returns concise display labels', () => {
    expect(statusLabelForEntry({ path: 'a.txt', staged: ' ', worktree: 'M', status: 'M' })).toBe(
      'M',
    );
    expect(statusLabelForEntry({ path: 'a.txt', staged: '?', worktree: '?', status: '??' })).toBe(
      '??',
    );
  });
});
```

- [ ] **Step 2: Run the service tests and verify RED**

Run:

```bash
bun run test -- packages/server/src/git/git-service.test.ts
```

Expected: fail because `packages/server/src/git/git-service.ts` does not exist.

- [ ] **Step 3: Add the minimal Git service implementation**

Create `packages/server/src/git/git-service.ts`:

```ts
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
  const result = await runGit(root, ['status', '--porcelain=v1', '-b']);
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
  if (diffModeForEntry(currentEntry) === 'content') {
    return {
      path: relativePath,
      mode: 'content',
      content: await readFile(`${root}/${relativePath}`, 'utf8'),
      language: 'plaintext',
    };
  }

  const mode = diffModeForEntry(currentEntry);
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
  if (!entry) {
    return { path: relativePath, staged: ' ', worktree: 'M', status: 'M' };
  }
  return entry;
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
    worktree,
    status,
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
  | { ok: true; value: RunGitResult }
  | { ok: false; reason: 'not-repo' | 'failed'; error: Error }
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
```

- [ ] **Step 4: Run the service tests and verify GREEN**

Run:

```bash
bun run test -- packages/server/src/git/git-service.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/git/git-service.ts packages/server/src/git/git-service.test.ts
git commit -m "feat(server): add git status service"
```

---

### Task 2: Server Git HTTP Routes

**Files:**
- Modify: `packages/server/src/http/routes.ts`
- Modify: `packages/server/src/server.test.ts`
- Modify if needed: `packages/server/src/git/git-service.ts`

- [ ] **Step 1: Write failing route integration tests**

Append tests near the existing `/api/browse` and `/api/file` tests in `packages/server/src/server.test.ts`:

```ts
  it('returns git status for a workspace repository', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-git-workspace-'));
    dataDirs.push(workspaceDir);
    mkdirSync(join(workspaceDir, 'src'));
    writeFileSync(join(workspaceDir, 'src/app.ts'), 'export const value = 1;\n');
    await runGit(workspaceDir, ['init']);
    await runGit(workspaceDir, ['config', 'user.email', 'cubby@example.test']);
    await runGit(workspaceDir, ['config', 'user.name', 'Cubby Test']);
    await runGit(workspaceDir, ['add', '.']);
    await runGit(workspaceDir, ['commit', '-m', 'initial']);
    writeFileSync(join(workspaceDir, 'src/app.ts'), 'export const value = 2;\n');
    writeFileSync(join(workspaceDir, 'src/new.ts'), 'export const fresh = true;\n');
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/git/status?root=${encodeURIComponent(workspaceDir)}`,
    });
    const body = response.json();
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(body.isRepo).toBe(true);
    expect(body.branch).toBeTruthy();
    expect(body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/app.ts', status: 'M' }),
        expect.objectContaining({ path: 'src/new.ts', status: '??' }),
      ]),
    );
  });

  it('returns a git diff for tracked workspace changes', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-git-diff-'));
    dataDirs.push(workspaceDir);
    writeFileSync(join(workspaceDir, 'app.ts'), 'export const value = 1;\n');
    await runGit(workspaceDir, ['init']);
    await runGit(workspaceDir, ['config', 'user.email', 'cubby@example.test']);
    await runGit(workspaceDir, ['config', 'user.name', 'Cubby Test']);
    await runGit(workspaceDir, ['add', '.']);
    await runGit(workspaceDir, ['commit', '-m', 'initial']);
    writeFileSync(join(workspaceDir, 'app.ts'), 'export const value = 2;\n');
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/git/diff?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent(
        'app.ts',
      )}`,
    });
    const body = response.json();
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ path: 'app.ts', mode: 'diff', language: 'diff' });
    expect(body.content).toContain('-export const value = 1;');
    expect(body.content).toContain('+export const value = 2;');
  });

  it('returns content for untracked git files', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-git-untracked-'));
    dataDirs.push(workspaceDir);
    await runGit(workspaceDir, ['init']);
    writeFileSync(join(workspaceDir, 'notes.txt'), 'untracked notes\n');
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/git/diff?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent(
        'notes.txt',
      )}`,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      path: 'notes.txt',
      mode: 'content',
      content: 'untracked notes\n',
      language: 'plaintext',
    });
  });

  it('returns a non-repo git status for ordinary directories', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-non-git-'));
    dataDirs.push(workspaceDir);
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/git/status?root=${encodeURIComponent(workspaceDir)}`,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ isRepo: false, branch: null, entries: [] });
  });

  it('rejects git diff paths outside the workspace root', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-git-safe-'));
    dataDirs.push(workspaceDir);
    const outsideDir = mkdtempSync(join(tmpdir(), 'cubby-git-outside-'));
    dataDirs.push(outsideDir);
    writeFileSync(join(outsideDir, 'outside.txt'), 'outside\n');
    await runGit(workspaceDir, ['init']);
    const { app } = await createServer(0);

    const response = await app.inject({
      method: 'GET',
      url: `/api/git/diff?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent(
        join(outsideDir, 'outside.txt'),
      )}`,
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Path is outside workspace root' });
  });
```

Add this helper near the other test helpers:

```ts
async function runGit(cwd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`git ${args.join(' ')} failed: ${stderr}`));
    });
  });
}
```

- [ ] **Step 2: Run route tests and verify RED**

Run:

```bash
bun run test -- packages/server/src/server.test.ts -t "git"
```

Expected: fail because `/api/git/status` and `/api/git/diff` are not registered.

- [ ] **Step 3: Implement the routes**

Modify `packages/server/src/http/routes.ts`:

```ts
import { relative, resolve } from 'node:path';
import { readGitDiff, readGitStatus } from '../git/git-service.js';
```

Add routes after `/api/file`:

```ts
  app.get('/api/git/status', async (request, reply) => {
    const { root } = request.query as { root?: string };
    if (!root) {
      return reply.code(400).send({ error: 'Workspace root is required' });
    }

    try {
      const target = await resolveWorkspacePath(root, root);
      return await readGitStatus(target.root ?? target.path);
    } catch (err) {
      return sendFileSystemError(reply, err);
    }
  });

  app.get('/api/git/diff', async (request, reply) => {
    const { path, root } = request.query as { path?: string; root?: string };
    if (!root) {
      return reply.code(400).send({ error: 'Workspace root is required' });
    }
    if (!path) {
      return reply.code(400).send({ error: 'File path is required' });
    }

    try {
      const target = await resolveWorkspacePath(path, root);
      const relativePath = relative(target.root ?? root, target.path);
      return await readGitDiff(target.root ?? root, relativePath);
    } catch (err) {
      return sendFileSystemError(reply, err);
    }
  });
```

If TypeScript reports a duplicate `relative` import, merge it with the existing path import.

- [ ] **Step 4: Run route tests and verify GREEN**

Run:

```bash
bun run test -- packages/server/src/server.test.ts -t "git"
```

Expected: all Git route tests pass.

- [ ] **Step 5: Run focused server tests**

Run:

```bash
bun run test -- packages/server/src/git/git-service.test.ts packages/server/src/server.test.ts
```

Expected: both suites pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/git/git-service.ts packages/server/src/git/git-service.test.ts packages/server/src/http/routes.ts packages/server/src/server.test.ts
git commit -m "feat(server): expose git status routes"
```

---

### Task 3: Frontend Git Status Model

**Files:**
- Create: `packages/web/src/components/workspace/git-status-model.ts`
- Test: `packages/web/src/components/workspace/git-status-model.test.ts`

- [ ] **Step 1: Write failing frontend model tests**

Add `packages/web/src/components/workspace/git-status-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildGitChangeTree,
  gitChangeCountLabel,
  gitStatusSummaryLabel,
  isGitDiffResponse,
  isGitStatusResponse,
} from './git-status-model.js';

describe('git status model', () => {
  it('validates git status responses', () => {
    expect(
      isGitStatusResponse({
        isRepo: true,
        branch: 'main',
        entries: [{ path: 'src/app.ts', staged: ' ', worktree: 'M', status: 'M' }],
      }),
    ).toBe(true);

    expect(isGitStatusResponse({ isRepo: true, branch: 'main', entries: [{ path: 1 }] })).toBe(
      false,
    );
  });

  it('validates git diff responses', () => {
    expect(
      isGitDiffResponse({
        path: 'src/app.ts',
        mode: 'diff',
        content: 'diff --git a/src/app.ts b/src/app.ts\n',
        language: 'diff',
      }),
    ).toBe(true);

    expect(isGitDiffResponse({ path: 'src/app.ts', mode: 'diff', content: 1 })).toBe(false);
  });

  it('formats status labels for toolbar display', () => {
    expect(gitChangeCountLabel(0)).toBe('0 changes');
    expect(gitChangeCountLabel(1)).toBe('1 change');
    expect(gitChangeCountLabel(2)).toBe('2 changes');
    expect(gitStatusSummaryLabel({ isRepo: false, branch: null, entries: [] })).toBe('No Git repo');
    expect(
      gitStatusSummaryLabel({
        isRepo: true,
        branch: 'feature/git-ui',
        entries: [{ path: 'src/app.ts', staged: ' ', worktree: 'M', status: 'M' }],
      }),
    ).toBe('feature/git-ui · 1 change');
  });

  it('builds a directory tree for changed files', () => {
    expect(
      buildGitChangeTree([
        { path: 'src/app.ts', staged: ' ', worktree: 'M', status: 'M' },
        { path: 'src/components/button.tsx', staged: 'A', worktree: ' ', status: 'A' },
        { path: 'README.md', staged: '?', worktree: '?', status: '??' },
      ]),
    ).toEqual([
      {
        type: 'file',
        name: 'README.md',
        path: 'README.md',
        entry: { path: 'README.md', staged: '?', worktree: '?', status: '??' },
      },
      {
        type: 'directory',
        name: 'src',
        path: 'src',
        children: [
          {
            type: 'file',
            name: 'app.ts',
            path: 'src/app.ts',
            entry: { path: 'src/app.ts', staged: ' ', worktree: 'M', status: 'M' },
          },
          {
            type: 'directory',
            name: 'components',
            path: 'src/components',
            children: [
              {
                type: 'file',
                name: 'button.tsx',
                path: 'src/components/button.tsx',
                entry: {
                  path: 'src/components/button.tsx',
                  staged: 'A',
                  worktree: ' ',
                  status: 'A',
                },
              },
            ],
          },
        ],
      },
    ]);
  });
});
```

- [ ] **Step 2: Run model tests and verify RED**

Run:

```bash
bun run test -- packages/web/src/components/workspace/git-status-model.test.ts
```

Expected: fail because `git-status-model.ts` does not exist.

- [ ] **Step 3: Add the frontend model**

Create `packages/web/src/components/workspace/git-status-model.ts`:

```ts
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
    typeof value.worktree === 'string' &&
    typeof value.status === 'string'
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
```

- [ ] **Step 4: Run model tests and verify GREEN**

Run:

```bash
bun run test -- packages/web/src/components/workspace/git-status-model.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/workspace/git-status-model.ts packages/web/src/components/workspace/git-status-model.test.ts
git commit -m "feat(web): add git status model"
```

---

### Task 4: Git Changes Modal

**Files:**
- Create: `packages/web/src/components/workspace/git-changes.tsx`
- Modify: `packages/web/src/components/workspace/git-status-model.ts`

- [ ] **Step 1: Run existing frontend model tests before UI work**

Run:

```bash
bun run test -- packages/web/src/components/workspace/git-status-model.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Add the modal component**

Create `packages/web/src/components/workspace/git-changes.tsx`:

```tsx
import Editor from '@monaco-editor/react';
import { ArrowLeft, ChevronDown, ChevronRight, FileCode2, Folder, GitBranch, Loader2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildGitChangeTree,
  type GitChangeTreeNode,
  type GitDiffResponse,
  type GitStatusEntry,
  type GitStatusResponse,
  gitChangeCountLabel,
  isGitDiffResponse,
} from './git-status-model.js';
import { fileExplorerLayoutMode } from './file-explorer-model.js';

interface GitChangesProps {
  rootPath: string;
  status: GitStatusResponse;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

type CompactPanel = 'files' | 'preview';

const ICON_PROPS = { size: 15, strokeWidth: 2.1, 'aria-hidden': true } as const;
const GIT_CHANGES_Z_INDEX = 1000;

export function GitChanges({ rootPath, status, onClose, onRefresh }: GitChangesProps) {
  const viewportWidth = useViewportWidth();
  const compact = fileExplorerLayoutMode(viewportWidth) === 'compact';
  const tree = useMemo(() => buildGitChangeTree(status.entries), [status.entries]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(['']));
  const [selectedEntry, setSelectedEntry] = useState<GitStatusEntry | null>(null);
  const [preview, setPreview] = useState<GitDiffResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [compactPanel, setCompactPanel] = useState<CompactPanel>('files');
  const showFilesPanel = !compact || compactPanel === 'files';
  const showPreviewPanel = !compact || compactPanel === 'preview';

  const toggleDirectory = useCallback((path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const openEntry = useCallback(
    async (entry: GitStatusEntry) => {
      setSelectedEntry(entry);
      setPreview(null);
      setPreviewError('');
      setPreviewLoading(true);
      setCompactPanel('preview');
      try {
        const query = new URLSearchParams({ root: rootPath, path: entry.path });
        const response = await fetch(`/api/git/diff?${query.toString()}`);
        if (!response.ok) {
          setPreviewError('Failed to load diff');
          return;
        }
        const data = await response.json();
        if (!isGitDiffResponse(data)) {
          setPreviewError('Failed to read diff');
          return;
        }
        setPreview(data);
      } catch {
        setPreviewError('Failed to load diff');
      } finally {
        setPreviewLoading(false);
      }
    },
    [rootPath],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (!selectedEntry && status.entries[0]) {
      void openEntry(status.entries[0]);
    }
  }, [openEntry, selectedEntry, status.entries]);

  return (
    <div
      data-testid="git-changes-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: GIT_CHANGES_Z_INDEX,
        background: 'rgba(0, 0, 0, 0.66)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '18px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="git-changes-title"
        style={{
          width: 'min(1040px, 100%)',
          height: 'min(720px, calc(100dvh - 36px))',
          minHeight: 0,
          border: '1px solid #2a2d2a',
          borderRadius: '8px',
          background: '#0c0e0d',
          color: '#f4f3ea',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.56)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            minHeight: '46px',
            borderBottom: '1px solid #242624',
            padding: '0 12px 0 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'linear-gradient(180deg, #111412 0%, #0c0e0d 100%)',
          }}
        >
          <GitBranch {...ICON_PROPS} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 id="git-changes-title" style={{ margin: 0, color: '#ffffff', fontSize: '14px', fontWeight: 700 }}>
              Git Changes
            </h2>
            <div
              style={{
                marginTop: '2px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: '#8d928b',
                fontFamily: 'monospace',
                fontSize: '11px',
              }}
            >
              {status.branch ?? 'Git'} · {gitChangeCountLabel(status.entries.length)}
            </div>
          </div>
          <button type="button" aria-label="Refresh git changes" title="Refresh" onClick={refresh} disabled={refreshing} style={iconButtonStyle(!refreshing)}>
            {refreshing ? <Loader2 {...ICON_PROPS} /> : <RefreshCw {...ICON_PROPS} />}
          </button>
          <button type="button" aria-label="Close git changes" title="Close" onClick={onClose} style={iconButtonStyle(true)}>
            <X {...ICON_PROPS} />
          </button>
        </div>

        <div style={{ minHeight: 0, flex: 1, display: 'flex', overflow: 'hidden' }}>
          <section
            aria-label="Changed files"
            style={{
              minWidth: compact ? 0 : '300px',
              width: compact ? '100%' : undefined,
              height: compact ? '100%' : undefined,
              flex: compact ? '0 0 100%' : '1 1 340px',
              minHeight: 0,
              borderRight: compact ? 'none' : '1px solid #242624',
              display: showFilesPanel ? 'flex' : 'none',
              flexDirection: 'column',
              background: '#090b0a',
            }}
          >
            <div style={{ minHeight: 0, flex: 1, overflowY: 'auto', padding: '8px' }}>
              {tree.length === 0 ? (
                <EmptyState label="No Git changes" />
              ) : (
                tree.map((node) => (
                  <GitTreeNodeView
                    key={node.path}
                    node={node}
                    depth={0}
                    expandedPaths={expandedPaths}
                    selectedPath={selectedEntry?.path ?? null}
                    onToggleDirectory={toggleDirectory}
                    onOpenEntry={openEntry}
                  />
                ))
              )}
            </div>
          </section>

          <section
            aria-label="Git diff preview"
            style={{
              minWidth: compact ? 0 : '300px',
              width: compact ? '100%' : undefined,
              height: compact ? '100%' : undefined,
              flex: compact ? '0 0 100%' : '2 1 560px',
              minHeight: 0,
              display: showPreviewPanel ? 'flex' : 'none',
              flexDirection: 'column',
              background: '#050606',
            }}
          >
            <div style={{ minHeight: '42px', borderBottom: '1px solid #202320', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              {compact && (
                <button type="button" aria-label="Back to changed files" title="Back to changed files" onClick={() => setCompactPanel('files')} style={textButtonStyle()}>
                  <ArrowLeft {...ICON_PROPS} />
                  Files
                </button>
              )}
              <div
                title={selectedEntry?.path ?? ''}
                style={{
                  minWidth: 0,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: selectedEntry ? '#f5f4ec' : '#777c76',
                  fontFamily: selectedEntry ? 'monospace' : undefined,
                  fontSize: '12px',
                  fontWeight: selectedEntry ? 500 : 650,
                }}
              >
                {selectedEntry?.path ?? 'Select a changed file'}
              </div>
              {selectedEntry && <StatusChip status={selectedEntry.status} />}
            </div>
            {previewLoading ? (
              <EmptyState label="Loading diff" />
            ) : previewError ? (
              <EmptyState label={previewError} />
            ) : preview ? (
              <div data-testid="git-diff-preview" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <Editor
                  height="100%"
                  path={`git:${preview.path}`}
                  language={preview.language}
                  value={preview.content}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    domReadOnly: true,
                    automaticLayout: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineHeight: 20,
                    lineNumbers: 'on',
                    renderLineHighlight: 'line',
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                    wordWrap: 'off',
                    tabSize: 2,
                    readOnlyMessage: { value: 'Git preview is read-only' },
                    overviewRulerBorder: false,
                    padding: { top: 12, bottom: 12 },
                  }}
                />
              </div>
            ) : (
              <EmptyState label="No file selected" />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function GitTreeNodeView({
  node,
  depth,
  expandedPaths,
  selectedPath,
  onToggleDirectory,
  onOpenEntry,
}: {
  node: GitChangeTreeNode;
  depth: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  onToggleDirectory: (path: string) => void;
  onOpenEntry: (entry: GitStatusEntry) => void;
}) {
  if (node.type === 'directory') {
    const expanded = expandedPaths.has(node.path);
    return (
      <div>
        <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} folder ${node.name}`} onClick={() => onToggleDirectory(node.path)} style={treeButtonStyle(depth, false)}>
          {expanded ? <ChevronDown {...ICON_PROPS} /> : <ChevronRight {...ICON_PROPS} />}
          <Folder {...ICON_PROPS} />
          <span style={treeLabelStyle}>{node.name}</span>
        </button>
        {expanded &&
          node.children.map((child) => (
            <GitTreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              onToggleDirectory={onToggleDirectory}
              onOpenEntry={onOpenEntry}
            />
          ))}
      </div>
    );
  }

  const selected = selectedPath === node.entry.path;
  return (
    <button type="button" aria-label={`Open git change ${node.entry.path}`} onClick={() => onOpenEntry(node.entry)} style={treeButtonStyle(depth, selected)}>
      <span style={{ width: '15px' }} />
      <FileCode2 {...ICON_PROPS} />
      <span style={treeLabelStyle}>{node.name}</span>
      <StatusChip status={node.entry.status} />
    </button>
  );
}

function StatusChip({ status }: { status: string }) {
  return (
    <span style={{ flexShrink: 0, border: '1px solid #253b40', borderRadius: '999px', background: '#071a1f', color: '#9ce8f8', padding: '2px 7px', fontSize: '11px', fontWeight: 800 }}>
      {status}
    </span>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div style={{ minHeight: 0, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', color: '#777c76', fontSize: '13px', textAlign: 'center' }}>{label}</div>;
}

const treeLabelStyle = {
  minWidth: 0,
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '13px',
  fontWeight: 650,
} as const;

function treeButtonStyle(depth: number, selected: boolean) {
  return {
    width: '100%',
    minHeight: '34px',
    border: `1px solid ${selected ? '#315f6b' : 'transparent'}`,
    borderRadius: '6px',
    background: selected ? '#071a1f' : 'transparent',
    color: '#f3f1e7',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    padding: `6px 8px 6px ${8 + depth * 14}px`,
    textAlign: 'left',
  } as const;
}

function iconButtonStyle(enabled: boolean) {
  return {
    width: '30px',
    height: '30px',
    border: `1px solid ${enabled ? '#303331' : '#202220'}`,
    borderRadius: '6px',
    background: enabled ? '#141715' : '#0d0f0e',
    color: enabled ? '#d7d5ca' : '#5f645e',
    cursor: enabled ? 'pointer' : 'default',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    flexShrink: 0,
  } as const;
}

function textButtonStyle() {
  return {
    flexShrink: 0,
    height: '30px',
    border: '1px solid #303331',
    borderRadius: '6px',
    background: '#141715',
    color: '#d7d5ca',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '0 9px',
    fontSize: '11px',
    fontWeight: 700,
  } as const;
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth,
  );

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return width;
}
```

- [ ] **Step 3: Run TypeScript/build to catch UI integration errors**

Run:

```bash
bun run --filter @cubby/web build
```

Expected: build passes once imports and style objects are valid.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/workspace/git-changes.tsx
git commit -m "feat(web): add git changes dialog"
```

---

### Task 5: SessionView Toolbar Integration

**Files:**
- Modify: `packages/web/src/components/session/session-view.tsx`
- Modify if needed: `packages/web/src/components/workspace/git-changes.tsx`
- Modify if needed: `packages/web/src/components/workspace/git-status-model.ts`

- [ ] **Step 1: Run existing focused tests before integration**

Run:

```bash
bun run test -- packages/web/src/components/workspace/git-status-model.test.ts packages/web/src/components/workspace/file-explorer-model.test.ts
```

Expected: both suites pass.

- [ ] **Step 2: Integrate Git status into `SessionView`**

Modify imports in `packages/web/src/components/session/session-view.tsx`:

```tsx
import { Folder, GitBranch, MonitorUp } from 'lucide-react';
import { GitChanges } from '../workspace/git-changes.js';
import {
  type GitStatusResponse,
  gitStatusSummaryLabel,
  isGitStatusResponse,
} from '../workspace/git-status-model.js';
```

Add state near `showFileExplorer`:

```tsx
  const [showGitChanges, setShowGitChanges] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatusResponse | null>(null);
  const [gitStatusError, setGitStatusError] = useState(false);
```

Add a loader callback after the action handlers:

```tsx
  const loadGitStatus = useCallback(async () => {
    setGitStatusError(false);
    try {
      const query = new URLSearchParams({ root: session.workspaceId });
      const response = await fetch(`/api/git/status?${query.toString()}`);
      if (!response.ok) {
        setGitStatusError(true);
        return;
      }
      const data = await response.json();
      if (!isGitStatusResponse(data)) {
        setGitStatusError(true);
        return;
      }
      setGitStatus(data);
    } catch {
      setGitStatusError(true);
    }
  }, [session.workspaceId]);

  useEffect(() => {
    if (!active) return;
    void loadGitStatus();
  }, [active, loadGitStatus]);
```

Add derived labels before `return`:

```tsx
  const gitSummaryLabel = gitStatusError ? 'Git unavailable' : gitStatusSummaryLabel(gitStatus);
  const gitButtonEnabled = Boolean(gitStatus?.isRepo);
```

Add the Git button next to the existing File Explorer button in the bottom toolbar:

```tsx
        <button
          type="button"
          aria-label="Open git changes"
          title={gitSummaryLabel}
          onClick={() => {
            if (!gitButtonEnabled) return;
            setShowGitChanges(true);
            void loadGitStatus();
          }}
          disabled={!gitButtonEnabled}
          style={{
            minHeight: '32px',
            border: `1px solid ${gitButtonEnabled ? '#303331' : '#202220'}`,
            borderRadius: '6px',
            background: gitButtonEnabled ? '#141715' : '#0d0f0e',
            color: gitButtonEnabled ? '#d7d5ca' : '#5f645e',
            cursor: gitButtonEnabled ? 'pointer' : 'default',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '0 10px',
            fontSize: '12px',
            fontWeight: 700,
          }}
        >
          <GitBranch {...ACTION_ICON_PROPS} />
          <span>{gitSummaryLabel}</span>
        </button>
```

Render the modal near the existing `FileExplorer` render:

```tsx
      {showGitChanges && gitStatus?.isRepo && (
        <GitChanges
          rootPath={session.workspaceId}
          status={gitStatus}
          onClose={() => setShowGitChanges(false)}
          onRefresh={loadGitStatus}
        />
      )}
```

- [ ] **Step 3: Run build and focused tests**

Run:

```bash
bun run test -- packages/web/src/components/workspace/git-status-model.test.ts
bun run --filter @cubby/web build
```

Expected: test and build pass.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/session/session-view.tsx packages/web/src/components/workspace/git-changes.tsx packages/web/src/components/workspace/git-status-model.ts
git commit -m "feat(web): show git changes from terminal toolbar"
```

---

### Task 6: Browser Coverage And Verification

**Files:**
- Modify: `e2e/app.spec.ts`

- [ ] **Step 1: Add failing E2E coverage**

Add this test near the terminal/file explorer area in `e2e/app.spec.ts`:

```ts
  test('terminal toolbar opens git changes grouped by directory with diff preview', async ({
    page,
  }) => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-git-toolbar-'));
    mkdirSync(join(workspaceDir, 'src'));
    try {
      writeFileSync(join(workspaceDir, 'src/app.ts'), 'export const value = 1;\n');
      await runGit(workspaceDir, ['init']);
      await runGit(workspaceDir, ['config', 'user.email', 'cubby@example.test']);
      await runGit(workspaceDir, ['config', 'user.name', 'Cubby Test']);
      await runGit(workspaceDir, ['add', '.']);
      await runGit(workspaceDir, ['commit', '-m', 'initial']);
      writeFileSync(join(workspaceDir, 'src/app.ts'), 'export const value = 2;\n');

      const session = await createSession(page, {
        workspaceId: workspaceDir,
        title: `Git Toolbar ${Date.now()}`,
      });

      await page.goto('/');
      const group = page.getByTestId('workspace-group').filter({ hasText: workspaceDir });
      await selectSessionTab(group, session.title);

      await expect(page.getByRole('button', { name: 'Open git changes' })).toContainText(
        '1 change',
      );
      await page.getByRole('button', { name: 'Open git changes' }).click();
      const dialog = page.getByTestId('git-changes-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Expand folder src' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Expand folder src' }).click();
      await dialog.getByRole('button', { name: 'Open git change src/app.ts' }).click();
      await expect(dialog.getByTestId('git-diff-preview')).toContainText(
        '-export const value = 1;',
      );
      await expect(dialog.getByTestId('git-diff-preview')).toContainText(
        '+export const value = 2;',
      );
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
```

Add this helper near other E2E helpers if it is not already present:

```ts
async function runGit(cwd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`git ${args.join(' ')} failed: ${stderr}`));
    });
  });
}
```

Update the first import in `e2e/app.spec.ts` if needed:

```ts
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
```

- [ ] **Step 2: Run E2E test and verify RED or integration failure**

Run:

```bash
CUBBY_MOCK_CLAUDE_PROVIDER=1 bunx playwright test e2e/app.spec.ts -g "terminal toolbar opens git changes"
```

Expected before final integration: fail if the toolbar or dialog is not wired correctly. If it already passes after prior tasks, record it as passing verification.

- [ ] **Step 3: Fix E2E integration issues**

Adjust only the smallest mismatches found by the failing E2E:

- If the Git button text has not loaded yet, wait for `1 change` with `expect(...).toContainText`.
- If Monaco text is not directly visible to Playwright, inspect `.view-line` text under `git-diff-preview`.
- If the directory starts expanded by default, assert the file button directly instead of clicking the folder.

- [ ] **Step 4: Run final verification**

Run:

```bash
bun run test -- packages/server/src/git/git-service.test.ts packages/server/src/server.test.ts packages/web/src/components/workspace/git-status-model.test.ts packages/web/src/components/workspace/file-explorer-model.test.ts
bun run --filter @cubby/web build
CUBBY_MOCK_CLAUDE_PROVIDER=1 bunx playwright test e2e/app.spec.ts -g "terminal toolbar opens git changes"
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add e2e/app.spec.ts
git commit -m "test(e2e): cover terminal git changes dialog"
```

---

## Final Check

- [ ] Run `git status --short` and confirm only intentional files are changed.
- [ ] Run `bun run lint`.
- [ ] If lint changes are needed, apply them and rerun focused tests.
- [ ] Summarize changed files, verification commands, and any skipped checks.
