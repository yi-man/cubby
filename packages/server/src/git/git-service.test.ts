import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  diffModeForEntry,
  parseGitHubRemoteUrl,
  parseGitStatusPorcelain,
  readGitHead,
  readGitSessionReview,
  readGitStatus,
  statusLabelForEntry,
} from './git-service.js';

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

describe('git service model', () => {
  it('parses branch and changed files from porcelain status', () => {
    const status = parseGitStatusPorcelain(
      [
        '## feature/git-ui...origin/feature/git-ui [ahead 1]',
        ' M packages/web/src/app.tsx',
        'A  packages/server/src/git/git-service.ts',
        'D  docs/old.md',
        'R  docs/new.md -> docs/current.md',
        '?? scratch/notes.txt',
      ].join('\n'),
    );

    expect(status).toEqual({
      branch: 'feature/git-ui',
      entries: [
        {
          path: 'packages/web/src/app.tsx',
          staged: ' ',
          status: 'M',
          worktree: 'M',
        },
        {
          path: 'packages/server/src/git/git-service.ts',
          staged: 'A',
          status: 'A',
          worktree: ' ',
        },
        {
          path: 'docs/old.md',
          staged: 'D',
          status: 'D',
          worktree: ' ',
        },
        {
          originalPath: 'docs/new.md',
          path: 'docs/current.md',
          staged: 'R',
          status: 'R',
          worktree: ' ',
        },
        {
          path: 'scratch/notes.txt',
          staged: '?',
          status: '??',
          worktree: '?',
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

  it('returns repository context for an ordinary checkout', async () => {
    const root = createCommittedRepo('cubby-git-context-main-');
    const repoRoot = realpathSync(root);

    const status = await readGitStatus(root);

    expect(status.isRepo).toBe(true);
    expect(status.context).toMatchObject({
      repoRoot,
      worktreeRoot: repoRoot,
      worktreeName: null,
      isLinkedWorktree: false,
      headDetached: false,
      pullRequest: null,
    });
    expect(status.context?.gitDir).toBe(join(repoRoot, '.git'));
    expect(status.context?.gitCommonDir).toBe(join(repoRoot, '.git'));
  });

  it('reads session review changes from a baseline commit', async () => {
    const root = createCommittedRepo('cubby-git-session-review-');
    const baseline = await readGitHead(root);
    expect(baseline).toBeTruthy();

    runGit(root, ['mv', 'README.md', 'GUIDE.md']);
    runGit(root, ['commit', '-am', 'rename guide']);
    writeFileSync(join(root, 'notes.txt'), 'untracked notes\n');

    const review = await readGitSessionReview(root, baseline);

    expect(review).toMatchObject({
      isRepo: true,
      baselineGitHead: baseline,
      summary: {
        total: 2,
        added: 0,
        modified: 0,
        deleted: 0,
        renamed: 1,
        untracked: 1,
      },
    });
    expect(review.currentGitHead).not.toBe(baseline);
    expect(review.changedFiles).toEqual([
      {
        originalPath: 'README.md',
        path: 'GUIDE.md',
        status: 'renamed',
      },
      {
        path: 'notes.txt',
        status: 'untracked',
      },
    ]);
  });

  it('includes uncommitted tracked changes in session review changes', async () => {
    const root = createCommittedRepo('cubby-git-session-review-working-tree-');
    const baseline = await readGitHead(root);
    expect(baseline).toBeTruthy();

    writeFileSync(join(root, 'README.md'), '# changed\n');
    writeFileSync(join(root, 'staged.txt'), 'staged file\n');
    runGit(root, ['add', 'staged.txt']);

    const review = await readGitSessionReview(root, baseline);

    expect(review.changedFiles).toEqual([
      {
        path: 'README.md',
        status: 'modified',
      },
      {
        path: 'staged.txt',
        status: 'added',
      },
    ]);
    expect(review.summary).toMatchObject({
      total: 2,
      added: 1,
      modified: 1,
    });
  });

  it('returns linked worktree context for a session workspace inside a worktree', async () => {
    const root = createCommittedRepo('cubby-git-context-root-');
    const worktreeRoot = join(tmpdir(), `cubby-git-context-wt-${Date.now()}`);
    runGit(root, ['worktree', 'add', '-b', 'feature/worktree-context', worktreeRoot]);
    const repoRoot = realpathSync(root);
    const canonicalWorktreeRoot = realpathSync(worktreeRoot);

    const status = await readGitStatus(worktreeRoot);

    expect(status.isRepo).toBe(true);
    expect(status.branch).toBe('feature/worktree-context');
    expect(status.context).toMatchObject({
      repoRoot,
      worktreeRoot: canonicalWorktreeRoot,
      worktreeName: basename(canonicalWorktreeRoot),
      isLinkedWorktree: true,
      headDetached: false,
      pullRequest: null,
    });
    expect(status.context?.gitDir).toContain(join('.git', 'worktrees'));
    expect(status.context?.gitCommonDir).toBe(join(repoRoot, '.git'));
  });

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
});
