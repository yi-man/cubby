import { describe, expect, it } from 'vitest';
import { diffModeForEntry, parseGitStatusPorcelain, statusLabelForEntry } from './git-service.js';

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
});
