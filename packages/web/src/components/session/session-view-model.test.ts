import type { Session } from '@cubby/core';
import { describe, expect, it } from 'vitest';
import { resumeActionState, resumeErrorMessage } from './session-view-model.js';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    workspaceId: '/work',
    title: null,
    provider: 'claude-code',
    providerSessionId: null,
    model: null,
    yolo: true,
    status: 'ended',
    pid: null,
    exitCode: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('session view model', () => {
  it('formats resume failure messages from websocket errors', () => {
    expect(
      resumeErrorMessage({
        id: 'resume-1',
        ok: false,
        error: {
          code: 'INTERNAL',
          message: 'Session is not resumable: provider conversation not found',
        },
      }),
    ).toBe('Resume failed: Session is not resumable: provider conversation not found');

    expect(resumeErrorMessage({ id: 'resume-2', ok: false })).toBe('Resume failed');
    expect(resumeErrorMessage({ id: 'resume-3', ok: true })).toBeNull();
  });

  it('does not expose a clickable resume action for non-resumable ended sessions', () => {
    expect(resumeActionState(session({ resumable: false }))).toEqual({
      kind: 'unavailable',
      label: 'Not resumable',
      reason: 'This session cannot be resumed.',
    });
    expect(
      resumeActionState(
        session({
          resumable: false,
          resumeUnavailableReason: 'Provider conversation not found',
        }),
      ),
    ).toEqual({
      kind: 'unavailable',
      label: 'Not resumable',
      reason: 'Provider conversation not found',
    });
    expect(resumeActionState(session({ resumable: true }))).toEqual({ kind: 'enabled' });
    expect(resumeActionState(session({ status: 'running' }))).toEqual({ kind: 'hidden' });
  });
});
