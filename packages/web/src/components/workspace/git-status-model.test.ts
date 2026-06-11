import { describe, expect, it } from 'vitest';
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
    expect(
      isGitDiffResponse({
        path: 'assets/logo.png',
        mode: 'binary',
        content: '',
        language: 'plaintext',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,abc',
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
    expect(gitContextSummaryLabel({ isRepo: false, branch: null, entries: [] })).toBe(
      'No Git repo',
    );
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

  it('formats git status chips for changed files', () => {
    expect(gitChangeStatusDisplay('??')).toEqual({ label: 'New', title: 'Untracked (??)' });
    expect(gitChangeStatusDisplay('M')).toEqual({ label: 'Mod', title: 'Modified (M)' });
    expect(gitChangeStatusDisplay('A')).toEqual({ label: 'Add', title: 'Added (A)' });
    expect(gitChangeStatusDisplay('D')).toEqual({ label: 'Del', title: 'Deleted (D)' });
    expect(gitChangeStatusDisplay('R')).toEqual({ label: 'Ren', title: 'Renamed (R)' });
    expect(gitChangeStatusDisplay('XY')).toEqual({ label: 'XY', title: 'Git status XY' });
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
        type: 'directory',
        name: 'src',
        path: 'src',
        children: [
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
                  status: 'A',
                  worktree: ' ',
                },
              },
            ],
          },
          {
            type: 'file',
            name: 'app.ts',
            path: 'src/app.ts',
            entry: { path: 'src/app.ts', staged: ' ', worktree: 'M', status: 'M' },
          },
        ],
      },
      {
        type: 'file',
        name: 'README.md',
        path: 'README.md',
        entry: { path: 'README.md', staged: '?', worktree: '?', status: '??' },
      },
    ]);
  });
});
