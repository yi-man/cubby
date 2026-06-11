# Session Git Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show whether the active session workspace is a linked Git worktree, keep normal branch display unchanged, and render a clickable GitHub PR link when one is detected.

**Architecture:** Extend the existing `/api/git/status` response because the terminal toolbar already fetches it from `session.workspaceId`. Keep Git status, worktree context, and optional PR metadata in one validated response; front-end helpers format the existing branch/count label plus optional worktree and PR link. PR lookup is best-effort and never blocks Git status.

**Tech Stack:** Bun, TypeScript, Fastify, Git CLI via `execFile`, React, Vite, Vitest, Playwright.

---

## File Structure

- Modify `packages/server/src/git/git-service.ts`
  - Add `GitRepositoryContext`, `GitPullRequest`, and `GitStatusResponse.context`.
  - Add Git context readers using existing `runGit` helper.
  - Add GitHub remote parsing and best-effort PR lookup.
- Modify `packages/server/src/git/git-service.test.ts`
  - Add model/unit tests for GitHub remote parsing.
  - Add integration-style tests for ordinary repo context and linked worktree context.
  - Add tests for PR lookup success and failure using injected fetch.
- Modify `packages/web/src/components/workspace/git-status-model.ts`
  - Extend response validation.
  - Add `gitContextSummaryLabel()` and `gitPullRequestLabel()`.
- Modify `packages/web/src/components/workspace/git-status-model.test.ts`
  - Add validation/helper tests for context and PR metadata.
- Modify `packages/web/src/components/session/session-view.tsx`
  - Use the new summary helper for toolbar text.
  - Render `PR #n` as a separate link beside the Git button when present.
- Modify `packages/web/src/components/workspace/git-changes.tsx`
  - Use the new summary helper in the dialog header.
  - Render the same PR link in the dialog header.
- Modify `e2e/app.spec.ts`
  - Extend the existing Git toolbar e2e with a linked worktree fixture.
  - Add a focused PR-link test by intercepting `/api/git/status`.

---

### Task 1: Backend Git Context

**Files:**
- Modify: `packages/server/src/git/git-service.ts`
- Modify: `packages/server/src/git/git-service.test.ts`

- [ ] **Step 1: Write failing tests for ordinary repo and linked worktree context**

Add imports at the top of `packages/server/src/git/git-service.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
```

Replace the current import from `./git-service.js` with:

```ts
import {
  diffModeForEntry,
  parseGitStatusPorcelain,
  readGitStatus,
  statusLabelForEntry,
} from './git-service.js';
```

Add local helper functions near the top of the test file:

```ts
function runGit(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function createCommittedRepo(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(root, 'README.md'), '# test\n');
  runGit(root, ['init']);
  runGit(root, ['config', 'user.email', 'cubby@example.test']);
  runGit(root, ['config', 'user.name', 'Cubby Test']);
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', 'initial']);
  return root;
}
```

Add these tests inside `describe('git service model', () => { ... })`:

```ts
it('returns repository context for an ordinary checkout', async () => {
  const root = createCommittedRepo('cubby-git-context-main-');

  const status = await readGitStatus(root);

  expect(status.isRepo).toBe(true);
  expect(status.context).toMatchObject({
    repoRoot: root,
    worktreeRoot: root,
    worktreeName: null,
    isLinkedWorktree: false,
    headDetached: false,
    pullRequest: null,
  });
  expect(status.context?.gitDir).toBe(join(root, '.git'));
  expect(status.context?.gitCommonDir).toBe(join(root, '.git'));
});

it('returns linked worktree context for a session workspace inside a worktree', async () => {
  const root = createCommittedRepo('cubby-git-context-root-');
  const worktreeRoot = join(tmpdir(), `cubby-git-context-wt-${Date.now()}`);
  runGit(root, ['worktree', 'add', '-b', 'feature/worktree-context', worktreeRoot]);

  const status = await readGitStatus(worktreeRoot);

  expect(status.isRepo).toBe(true);
  expect(status.branch).toBe('feature/worktree-context');
  expect(status.context).toMatchObject({
    repoRoot: root,
    worktreeRoot,
    worktreeName: basename(worktreeRoot),
    isLinkedWorktree: true,
    headDetached: false,
    pullRequest: null,
  });
  expect(status.context?.gitDir).toContain(join('.git', 'worktrees'));
  expect(status.context?.gitCommonDir).toBe(join(root, '.git'));
});
```

- [ ] **Step 2: Run tests and verify they fail because context is missing**

Run:

```bash
bun test packages/server/src/git/git-service.test.ts
```

Expected: FAIL with assertions that `status.context` is undefined.

- [ ] **Step 3: Add backend context types and command readers**

In `packages/server/src/git/git-service.ts`, change the path import:

```ts
import { basename, dirname, extname, join, resolve } from 'node:path';
```

Add these interfaces after `GitStatusResponse`:

```ts
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
```

Update `GitStatusResponse`:

```ts
export interface GitStatusResponse {
  isRepo: boolean;
  branch: string | null;
  entries: GitStatusEntry[];
  context?: GitRepositoryContext;
}
```

Change `readGitStatus` to attach context after porcelain parsing:

```ts
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
```

Add these helpers before `runGitOrThrow`:

```ts
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
    const absoluteGitCommonDir = resolve(worktreeRoot, gitCommonDir);
    const absoluteGitDir = resolve(worktreeRoot, gitDir);
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
```

- [ ] **Step 4: Run tests and verify Task 1 passes**

Run:

```bash
bun test packages/server/src/git/git-service.test.ts
```

Expected: PASS for all tests in `git-service.test.ts`.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/server/src/git/git-service.ts packages/server/src/git/git-service.test.ts
git commit -m "feat(server): include git worktree context"
```

---

### Task 2: Backend GitHub PR Detection

**Files:**
- Modify: `packages/server/src/git/git-service.ts`
- Modify: `packages/server/src/git/git-service.test.ts`

- [ ] **Step 1: Write failing tests for remote parsing and PR lookup**

Extend the import in `packages/server/src/git/git-service.test.ts`:

```ts
import {
  diffModeForEntry,
  parseGitHubRemoteUrl,
  parseGitStatusPorcelain,
  readGitStatus,
  statusLabelForEntry,
} from './git-service.js';
```

Add tests:

```ts
it('parses GitHub remote URLs', () => {
  expect(parseGitHubRemoteUrl('git@github.com:yi-man/cubby.git')).toEqual({
    owner: 'yi-man',
    repo: 'cubby',
  });
  expect(parseGitHubRemoteUrl('https://github.com/yi-man/cubby.git')).toEqual({
    owner: 'yi-man',
    repo: 'cubby',
  });
  expect(parseGitHubRemoteUrl('https://github.com/yi-man/cubby')).toEqual({
    owner: 'yi-man',
    repo: 'cubby',
  });
  expect(parseGitHubRemoteUrl('git@gitlab.com:yi-man/cubby.git')).toBeNull();
});

it('returns open GitHub pull request metadata when available', async () => {
  const root = createCommittedRepo('cubby-git-context-pr-');
  runGit(root, ['checkout', '-b', 'feature/pr-link']);
  runGit(root, ['remote', 'add', 'origin', 'git@github.com:yi-man/cubby.git']);
  const fetchPullRequests = async (owner: string, repo: string, branch: string) => {
    expect({ owner, repo, branch }).toEqual({
      owner: 'yi-man',
      repo: 'cubby',
      branch: 'feature/pr-link',
    });
    return [
      {
        number: 8,
        title: 'Add terminal Git changes dialog',
        html_url: 'https://github.com/yi-man/cubby/pull/8',
      },
    ];
  };

  const status = await readGitStatus(root, { fetchPullRequests });

  expect(status.context?.pullRequest).toEqual({
    provider: 'github',
    number: 8,
    title: 'Add terminal Git changes dialog',
    url: 'https://github.com/yi-man/cubby/pull/8',
  });
});

it('keeps pullRequest null when GitHub PR lookup fails', async () => {
  const root = createCommittedRepo('cubby-git-context-pr-failure-');
  runGit(root, ['checkout', '-b', 'feature/pr-link']);
  runGit(root, ['remote', 'add', 'origin', 'https://github.com/yi-man/cubby.git']);

  const status = await readGitStatus(root, {
    fetchPullRequests: async () => {
      throw new Error('network unavailable');
    },
  });

  expect(status.context?.pullRequest).toBeNull();
});
```

- [ ] **Step 2: Run tests and verify they fail because parser/options are missing**

Run:

```bash
bun test packages/server/src/git/git-service.test.ts
```

Expected: FAIL with missing `parseGitHubRemoteUrl` export and unsupported `readGitStatus` options.

- [ ] **Step 3: Add PR lookup options and parser implementation**

In `packages/server/src/git/git-service.ts`, add:

```ts
interface GitHubRemote {
  owner: string;
  repo: string;
}

interface GitHubPullRequestResponse {
  number?: unknown;
  title?: unknown;
  html_url?: unknown;
}

export interface ReadGitStatusOptions {
  fetchPullRequests?: (
    owner: string,
    repo: string,
    branch: string,
  ) => Promise<GitHubPullRequestResponse[]>;
}
```

Change `readGitStatus` signature:

```ts
export async function readGitStatus(
  root: string,
  options: ReadGitStatusOptions = {},
): Promise<GitStatusResponse> {
```

Pass options into context:

```ts
context: await readGitRepositoryContext(root, status.branch, options),
```

Change `readGitRepositoryContext` signature:

```ts
async function readGitRepositoryContext(
  root: string,
  branch: string | null,
  options: ReadGitStatusOptions,
): Promise<GitRepositoryContext | undefined> {
```

Before returning the context object, compute:

```ts
const headDetached = branch === null || branch === 'HEAD (detached)';
const pullRequest = await readPullRequest(remoteUrl, branch, headDetached, options);
```

Use those fields in the return object:

```ts
headDetached,
pullRequest,
```

Add parser and PR helpers before `runGitOrThrow`:

```ts
export function parseGitHubRemoteUrl(remoteUrl: string | null): GitHubRemote | null {
  if (!remoteUrl) return null;

  const sshMatch = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  return null;
}

async function readPullRequest(
  remoteUrl: string | null,
  branch: string | null,
  headDetached: boolean,
  options: ReadGitStatusOptions,
): Promise<GitPullRequest | null> {
  if (!branch || headDetached) return null;
  const remote = parseGitHubRemoteUrl(remoteUrl);
  if (!remote) return null;

  try {
    const values = await fetchPullRequests(remote.owner, remote.repo, branch, options);
    const first = values[0];
    if (
      typeof first?.number !== 'number' ||
      typeof first.title !== 'string' ||
      typeof first.html_url !== 'string'
    ) {
      return null;
    }

    return {
      provider: 'github',
      number: first.number,
      title: first.title,
      url: first.html_url,
    };
  } catch {
    return null;
  }
}

async function fetchPullRequests(
  owner: string,
  repo: string,
  branch: string,
  options: ReadGitStatusOptions,
): Promise<GitHubPullRequestResponse[]> {
  if (options.fetchPullRequests) {
    return await options.fetchPullRequests(owner, repo, branch);
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body) ? (body as GitHubPullRequestResponse[]) : [];
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Run server tests and verify Task 2 passes**

Run:

```bash
bun test packages/server/src/git/git-service.test.ts packages/server/src/server.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/server/src/git/git-service.ts packages/server/src/git/git-service.test.ts
git commit -m "feat(server): detect git pull request links"
```

---

### Task 3: Frontend Git Status Model

**Files:**
- Modify: `packages/web/src/components/workspace/git-status-model.ts`
- Modify: `packages/web/src/components/workspace/git-status-model.test.ts`

- [ ] **Step 1: Write failing frontend model tests**

In `packages/web/src/components/workspace/git-status-model.test.ts`, extend imports:

```ts
import {
  buildGitChangeTree,
  gitChangeCountLabel,
  gitChangeStatusDisplay,
  gitContextSummaryLabel,
  gitPullRequestLabel,
  gitStatusSummaryLabel,
  isGitDiffResponse,
  isGitStatusResponse,
} from './git-status-model.js';
```

Add tests after the existing toolbar label test:

```ts
it('validates git status responses with context and pull request metadata', () => {
  expect(
    isGitStatusResponse({
      isRepo: true,
      branch: 'feature/git-ui',
      entries: [],
      context: {
        repoRoot: '/repo',
        worktreeRoot: '/repo/.worktrees/git-ui',
        worktreeName: 'git-ui',
        gitDir: '/repo/.git/worktrees/git-ui',
        gitCommonDir: '/repo/.git',
        isLinkedWorktree: true,
        headDetached: false,
        commit: 'abc1234',
        remoteUrl: 'git@github.com:yi-man/cubby.git',
        pullRequest: {
          provider: 'github',
          number: 8,
          title: 'Add terminal Git changes dialog',
          url: 'https://github.com/yi-man/cubby/pull/8',
        },
      },
    }),
  ).toBe(true);

  expect(
    isGitStatusResponse({
      isRepo: true,
      branch: 'feature/git-ui',
      entries: [],
      context: { isLinkedWorktree: true },
    }),
  ).toBe(false);
});

it('formats git context summary labels', () => {
  expect(gitContextSummaryLabel(null)).toBe('Git');
  expect(gitContextSummaryLabel({ isRepo: false, branch: null, entries: [] })).toBe('No Git repo');
  expect(
    gitContextSummaryLabel({
      isRepo: true,
      branch: 'feature/git-ui',
      entries: [{ path: 'src/app.ts', staged: ' ', worktree: 'M', status: 'M' }],
    }),
  ).toBe('feature/git-ui · 1 change');
  expect(
    gitContextSummaryLabel({
      isRepo: true,
      branch: 'feature/git-ui',
      entries: [],
      context: {
        repoRoot: '/repo',
        worktreeRoot: '/repo/.worktrees/git-ui',
        worktreeName: 'git-ui',
        gitDir: '/repo/.git/worktrees/git-ui',
        gitCommonDir: '/repo/.git',
        isLinkedWorktree: true,
        headDetached: false,
        commit: 'abc1234',
        remoteUrl: null,
        pullRequest: null,
      },
    }),
  ).toBe('feature/git-ui · worktree git-ui · 0 changes');
});

it('formats pull request labels', () => {
  expect(gitPullRequestLabel(null)).toBeNull();
  expect(
    gitPullRequestLabel({
      provider: 'github',
      number: 8,
      title: 'Add terminal Git changes dialog',
      url: 'https://github.com/yi-man/cubby/pull/8',
    }),
  ).toBe('PR #8');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bun test packages/web/src/components/workspace/git-status-model.test.ts
```

Expected: FAIL with missing helpers and validator rejecting the new fields.

- [ ] **Step 3: Implement frontend types, validation, and display helpers**

In `packages/web/src/components/workspace/git-status-model.ts`, add:

```ts
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
```

Update `GitStatusResponse`:

```ts
export interface GitStatusResponse {
  isRepo: boolean;
  branch: string | null;
  entries: GitStatusEntry[];
  context?: GitRepositoryContext;
}
```

Add validators before `isGitStatusResponse`:

```ts
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
```

Update `isGitStatusResponse`:

```ts
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
```

Add helpers after `gitStatusSummaryLabel`:

```ts
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
```

- [ ] **Step 4: Keep old helper as a compatibility wrapper**

Change `gitStatusSummaryLabel` implementation to delegate:

```ts
export function gitStatusSummaryLabel(status: GitStatusResponse | null): string {
  return gitContextSummaryLabel(status);
}
```

- [ ] **Step 5: Run frontend model tests**

Run:

```bash
bun test packages/web/src/components/workspace/git-status-model.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add packages/web/src/components/workspace/git-status-model.ts packages/web/src/components/workspace/git-status-model.test.ts
git commit -m "feat(web): format git context summaries"
```

---

### Task 4: Frontend Toolbar and Dialog UI

**Files:**
- Modify: `packages/web/src/components/session/session-view.tsx`
- Modify: `packages/web/src/components/workspace/git-changes.tsx`

- [ ] **Step 1: Write failing e2e assertions for worktree label in the existing Git toolbar test**

This step modifies `e2e/app.spec.ts` as a test-first change. In the existing `terminal toolbar opens git changes grouped by directory with diff preview` test, after committing the initial repository and before modifying files, create a linked worktree:

```ts
const worktreeDir = join(tmpdir(), `cubby-git-toolbar-worktree-${Date.now()}`);
await runGit(workspaceDir, ['worktree', 'add', '-b', 'feature/git-toolbar-worktree', worktreeDir]);
```

Move the file writes after that line to use `worktreeDir`:

```ts
writeFileSync(join(worktreeDir, 'docs/guide.md'), 'updated docs\n');
writeFileSync(join(worktreeDir, 'src/app.ts'), 'export const value = 2;\n');
mkdirSync(join(worktreeDir, 'notes'));
writeFileSync(join(worktreeDir, 'notes/todo.txt'), 'write release notes\n');
writeFileSync(join(worktreeDir, 'assets/logo.png'), Buffer.from(...));
```

Create the session with the worktree workspace:

```ts
const session = await createSession(page, {
  workspaceId: worktreeDir,
  title: `Git Toolbar ${Date.now()}`,
});
```

Update the workspace group filter:

```ts
const group = page.getByTestId('workspace-group').filter({ hasText: worktreeDir });
```

Add assertion after locating `gitButton`:

```ts
await expect(gitButton).toContainText('worktree');
await expect(gitButton).toContainText(basename(worktreeDir));
```

Add `basename` to the `node:path` import at the top of `e2e/app.spec.ts`.

- [ ] **Step 2: Run e2e and verify it fails before UI changes**

Run:

```bash
CUBBY_MOCK_CLAUDE_PROVIDER=1 bunx playwright test e2e/app.spec.ts -g "terminal toolbar opens git changes"
```

Expected: FAIL because the toolbar still uses the old branch/count helper and does not show `worktree`.

- [ ] **Step 3: Update SessionView toolbar helper and PR link**

In `packages/web/src/components/session/session-view.tsx`, change the workspace model import from:

```ts
gitStatusSummaryLabel,
isGitStatusResponse,
```

to:

```ts
gitContextSummaryLabel,
gitPullRequestLabel,
isGitStatusResponse,
```

Change:

```ts
const gitSummaryLabel = gitStatusError ? 'Git unavailable' : gitStatusSummaryLabel(gitStatus);
```

to:

```ts
const gitSummaryLabel = gitStatusError ? 'Git unavailable' : gitContextSummaryLabel(gitStatus);
const gitPullRequest = gitStatus?.context?.pullRequest ?? null;
const gitPullRequestLabelText = gitPullRequestLabel(gitPullRequest);
```

After the Git button, render:

```tsx
{gitPullRequest && gitPullRequestLabelText && (
  <a
    href={gitPullRequest.url}
    target="_blank"
    rel="noreferrer noopener"
    title={gitPullRequest.title}
    style={gitPullRequestLinkStyle()}
  >
    {gitPullRequestLabelText}
  </a>
)}
```

Add helper near other style helpers in `session-view.tsx`:

```ts
function gitPullRequestLinkStyle() {
  return {
    height: '30px',
    border: '1px solid #253b40',
    borderRadius: '6px',
    background: '#071a1f',
    color: '#9ce8f8',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 10px',
    fontSize: '12px',
    fontWeight: 800,
    textDecoration: 'none',
    flexShrink: 0,
  } as const;
}
```

- [ ] **Step 4: Update GitChanges dialog header**

In `packages/web/src/components/workspace/git-changes.tsx`, import:

```ts
gitContextSummaryLabel,
gitPullRequestLabel,
```

Add at the top of `GitChanges` after `compact`:

```ts
const contextSummary = gitContextSummaryLabel(status);
const pullRequest = status.context?.pullRequest ?? null;
const pullRequestLabel = gitPullRequestLabel(pullRequest);
```

Replace header secondary text:

```tsx
{status.branch ?? 'Git'} · {gitChangeCountLabel(status.entries.length)}
```

with:

```tsx
{contextSummary}
```

Add `title={status.context?.worktreeRoot ?? contextSummary}` to that secondary text div.

Render the PR link before the refresh button:

```tsx
{pullRequest && pullRequestLabel && (
  <a
    href={pullRequest.url}
    target="_blank"
    rel="noreferrer noopener"
    title={pullRequest.title}
    style={dialogPullRequestLinkStyle()}
  >
    {pullRequestLabel}
  </a>
)}
```

Add helper:

```ts
function dialogPullRequestLinkStyle() {
  return {
    height: '30px',
    border: '1px solid #253b40',
    borderRadius: '6px',
    background: '#071a1f',
    color: '#9ce8f8',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 10px',
    fontSize: '12px',
    fontWeight: 800,
    textDecoration: 'none',
    flexShrink: 0,
  } as const;
}
```

- [ ] **Step 5: Run e2e and verify worktree display passes**

Run:

```bash
bun run --filter @cubby/web build
CUBBY_MOCK_CLAUDE_PROVIDER=1 bunx playwright test e2e/app.spec.ts -g "terminal toolbar opens git changes"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add e2e/app.spec.ts packages/web/src/components/session/session-view.tsx packages/web/src/components/workspace/git-changes.tsx
git commit -m "feat(web): show session worktree context"
```

---

### Task 5: PR Link Browser Coverage and Final Verification

**Files:**
- Modify: `e2e/app.spec.ts`

- [ ] **Step 1: Write focused e2e for PR link**

Add this test near the Git toolbar test:

```ts
test('terminal toolbar renders git pull request link from status metadata', async ({ page }) => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'cubby-git-pr-link-'));
  try {
    const session = await createSession(page, {
      workspaceId: workspaceDir,
      title: `Git PR Link ${Date.now()}`,
    });
    await page.route('**/api/git/status?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          isRepo: true,
          branch: 'feature/pr-link',
          entries: [],
          context: {
            repoRoot: workspaceDir,
            worktreeRoot: workspaceDir,
            worktreeName: null,
            gitDir: `${workspaceDir}/.git`,
            gitCommonDir: `${workspaceDir}/.git`,
            isLinkedWorktree: false,
            headDetached: false,
            commit: 'abc1234',
            remoteUrl: 'git@github.com:yi-man/cubby.git',
            pullRequest: {
              provider: 'github',
              number: 8,
              title: 'Add terminal Git changes dialog',
              url: 'https://github.com/yi-man/cubby/pull/8',
            },
          },
        }),
      });
    });

    await page.goto('/');
    const group = page.getByTestId('workspace-group').filter({ hasText: workspaceDir });
    await selectSessionTab(group, session.title);

    const link = page.getByRole('link', { name: 'PR #8' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://github.com/yi-man/cubby/pull/8');
    await expect(link).toHaveAttribute('target', '_blank');
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run focused e2e**

Run:

```bash
bun run --filter @cubby/web build
CUBBY_MOCK_CLAUDE_PROVIDER=1 bunx playwright test e2e/app.spec.ts -g "git pull request link|terminal toolbar opens git changes"
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
bun run test
bunx biome check scripts packages e2e playwright.config.ts vitest.config.ts
bun run --filter @cubby/web build
```

Expected:

- `bun run test`: 202+ tests pass.
- `bunx biome check ...`: no fixes applied.
- `bun run --filter @cubby/web build`: exits 0, existing Vite chunk warning is acceptable.

- [ ] **Step 4: Commit Task 5**

```bash
git add e2e/app.spec.ts
git commit -m "test(e2e): cover git pull request links"
```

- [ ] **Step 5: Final status check**

Run:

```bash
git status --short --branch
git log --oneline -5
```

Expected:

- Branch is `feat/session-git-context`.
- Worktree is clean.
- Recent commits include:
  - `test(e2e): cover git pull request links`
  - `feat(web): show session worktree context`
  - `feat(web): format git context summaries`
  - `feat(server): detect git pull request links`
  - `feat(server): include git worktree context`
