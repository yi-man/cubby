import type { Session } from '@cubby/core';
import { describe, expect, it } from 'vitest';

import {
  groupSessions,
  matchesSessionSearch,
  sortSessionsForWorkspace,
  visibleSessions,
  workspaceName,
} from './session-list-model.js';

function session(overrides: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    id: overrides.id,
    workspaceId: overrides.workspaceId ?? '/work/alpha',
    title: overrides.title ?? null,
    provider: overrides.provider ?? 'claude-code',
    providerSessionId: overrides.providerSessionId ?? null,
    model: overrides.model ?? null,
    status: overrides.status ?? 'idle',
    pid: overrides.pid ?? null,
    exitCode: overrides.exitCode ?? null,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    endedAt: overrides.endedAt ?? null,
  };
}

describe('session list model', () => {
  it('derives workspace names from POSIX and Windows paths', () => {
    expect(workspaceName('/Users/dev/project-alpha')).toBe('project-alpha');
    expect(workspaceName('C:\\Users\\dev\\project-beta')).toBe('project-beta');
  });

  it('matches provider, custom title, and rejects absent search terms', () => {
    const customTitleSession = session({
      id: 'session-custom',
      title: 'Implement sidebar polish',
      provider: 'claude-code',
    });

    expect(matchesSessionSearch(customTitleSession, 'claude-code')).toBe(true);
    expect(matchesSessionSearch(customTitleSession, 'sidebar polish')).toBe(true);
    expect(matchesSessionSearch(customTitleSession, 'missing term')).toBe(false);
  });

  it('sorts sessions by updated and created timestamps descending without selection state', () => {
    const sessions = [
      session({
        id: 'old-created',
        updatedAt: '2026-01-02T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      session({
        id: 'active',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      session({
        id: 'new-created',
        updatedAt: '2026-01-02T00:00:00.000Z',
        createdAt: '2026-01-03T00:00:00.000Z',
      }),
      session({
        id: 'new-updated',
        updatedAt: '2026-01-04T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];

    expect(sortSessionsForWorkspace(sessions).map(({ id }) => id)).toEqual([
      'new-updated',
      'new-created',
      'old-created',
      'active',
    ]);
    expect(sessions.map(({ id }) => id)).toEqual([
      'old-created',
      'active',
      'new-created',
      'new-updated',
    ]);
  });

  it('groups sessions by first-seen workspace order and preserves session order', () => {
    const sessions = [
      session({ id: 'alpha-1', workspaceId: '/work/alpha' }),
      session({ id: 'beta-1', workspaceId: '/work/beta' }),
      session({ id: 'alpha-2', workspaceId: '/work/alpha' }),
    ];

    expect(groupSessions(sessions)).toEqual([
      { workspaceId: '/work/alpha', sessions: [sessions[0], sessions[2]] },
      { workspaceId: '/work/beta', sessions: [sessions[1]] },
    ]);
  });

  it('keeps the active session visible when a workspace exceeds the visible limit', () => {
    const sessions = Array.from({ length: 6 }, (_, index) => session({ id: `s${index + 1}` }));

    expect(visibleSessions(sessions, 's6').map(({ id }) => id)).toEqual([
      's6',
      's1',
      's2',
      's3',
      's4',
    ]);
  });
});
