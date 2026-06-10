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
                  status: 'A',
                  worktree: ' ',
                },
              },
            ],
          },
        ],
      },
    ]);
  });
});
