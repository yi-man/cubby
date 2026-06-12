import { describe, expect, it } from 'vitest';
import {
  formatVerificationDuration,
  isSessionReviewResponse,
  sessionReviewStatusDisplay,
  sessionReviewSummaryLabel,
  shortGitHead,
  verificationRunStatusLabel,
} from './session-review-model.js';

describe('session review model', () => {
  it('accepts session review responses', () => {
    expect(
      isSessionReviewResponse({
        sessionId: 's1',
        workspaceId: '/repo',
        generatedAt: '2026-06-11T10:00:00.000Z',
        baselineGitHead: 'a'.repeat(40),
        currentGitHead: 'b'.repeat(40),
        changedFiles: [{ path: 'README.md', status: 'modified' }],
        summary: {
          total: 1,
          added: 0,
          modified: 1,
          deleted: 0,
          renamed: 0,
          untracked: 0,
        },
        verificationRuns: [
          {
            id: 'run-1',
            sessionId: 's1',
            workspaceId: '/repo',
            command: 'bun test',
            exitCode: 0,
            durationMs: 1200,
            outputSummary: 'pass',
            startedAt: '2026-06-11T10:01:00.000Z',
            completedAt: '2026-06-11T10:01:01.200Z',
          },
        ],
        lastOutput: 'finished',
        exitCode: 0,
      }),
    ).toBe(true);
  });

  it('rejects malformed session review responses', () => {
    expect(isSessionReviewResponse({ sessionId: 's1', changedFiles: 'README.md' })).toBe(false);
    expect(
      isSessionReviewResponse({
        sessionId: 's1',
        workspaceId: '/repo',
        generatedAt: '2026-06-11T10:00:00.000Z',
        baselineGitHead: null,
        currentGitHead: null,
        changedFiles: [],
        summary: {
          total: 0,
          added: 0,
          modified: 0,
          deleted: 0,
          renamed: 0,
          untracked: 0,
        },
        lastOutput: '',
        exitCode: null,
      }),
    ).toBe(false);
  });

  it('formats summary labels', () => {
    expect(sessionReviewSummaryLabel({ total: 0 })).toBe('No file changes');
    expect(sessionReviewSummaryLabel({ total: 1 })).toBe('1 file changed');
    expect(sessionReviewSummaryLabel({ total: 3 })).toBe('3 files changed');
  });

  it('formats status display metadata', () => {
    expect(sessionReviewStatusDisplay('modified')).toEqual({ label: 'Mod', title: 'Modified' });
    expect(sessionReviewStatusDisplay('untracked')).toEqual({
      label: 'New',
      title: 'Untracked',
    });
  });

  it('shortens git heads', () => {
    expect(shortGitHead('abcdef1234567890')).toBe('abcdef1');
    expect(shortGitHead(null)).toBe('none');
  });

  it('formats verification run metadata', () => {
    expect(verificationRunStatusLabel(0)).toBe('Passed');
    expect(verificationRunStatusLabel(7)).toBe('Failed 7');
    expect(verificationRunStatusLabel(null)).toBe('No exit');
    expect(formatVerificationDuration(450)).toBe('450ms');
    expect(formatVerificationDuration(1234)).toBe('1.2s');
  });
});
