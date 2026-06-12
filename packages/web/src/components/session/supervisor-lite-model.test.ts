import { describe, expect, it } from 'vitest';
import {
  isSupervisorReviewResponse,
  isSupervisorStateResponse,
  supervisorStatusLabel,
  supervisorSuggestionPreview,
} from './supervisor-lite-model.js';

describe('supervisor lite model', () => {
  it('accepts supervisor state responses with saved reviews', () => {
    expect(
      isSupervisorStateResponse({
        sessionId: 's1',
        workspaceId: '/repo',
        objective: 'Finish roadmap item #19',
        status: 'stuck',
        lastOutputAt: '2026-06-11T10:00:00.000Z',
        idleForMs: 420_000,
        stuckReasons: ['Terminal appears to be waiting for input'],
        reviews: [
          {
            id: 'review-1',
            sessionId: 's1',
            workspaceId: '/repo',
            objective: 'Finish roadmap item #19',
            createdAt: '2026-06-11T10:01:00.000Z',
            summary: 'Reviewer summary',
            suggestions: ['Run bun test'],
            terminalTail: 'waiting for input',
          },
        ],
      }),
    ).toBe(true);
  });

  it('accepts supervisor review responses', () => {
    expect(
      isSupervisorReviewResponse({
        id: 'review-1',
        sessionId: 's1',
        workspaceId: '/repo',
        objective: 'Finish roadmap item #19',
        createdAt: '2026-06-11T10:01:00.000Z',
        summary: 'Reviewer summary',
        suggestions: ['Run bun test'],
        terminalTail: 'waiting for input',
      }),
    ).toBe(true);
  });

  it('rejects malformed supervisor responses', () => {
    expect(isSupervisorStateResponse({ sessionId: 's1', reviews: [] })).toBe(false);
    expect(
      isSupervisorReviewResponse({
        id: 'review-1',
        sessionId: 's1',
        suggestions: 'Run bun test',
      }),
    ).toBe(false);
  });

  it('formats status labels and suggestion previews', () => {
    expect(supervisorStatusLabel('unconfigured')).toBe('No objective');
    expect(supervisorStatusLabel('watching')).toBe('Watching');
    expect(supervisorStatusLabel('idle')).toBe('Idle');
    expect(supervisorStatusLabel('stuck')).toBe('Stuck');
    expect(supervisorStatusLabel('ended')).toBe('Ended');
    expect(supervisorSuggestionPreview('x'.repeat(90))).toBe(`${'x'.repeat(77)}...`);
  });
});
