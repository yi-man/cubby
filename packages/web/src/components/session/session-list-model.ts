import type { Session } from '@cubby/core';

export interface WorkspaceGroup {
  workspaceId: string;
  sessions: Session[];
}

export const VISIBLE_SESSION_LIMIT = 5;

export function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

export function workspaceName(workspaceId: string): string {
  const parts = workspaceId.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? workspaceId;
}

export function sessionTitle(session: Session): string {
  return session.title ?? session.provider;
}

export function matchesSessionSearch(session: Session, query: string): boolean {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;

  return [
    sessionTitle(session),
    session.provider,
    session.workspaceId,
    workspaceName(session.workspaceId),
    session.status,
    session.id,
  ].some((value) => normalizeSearch(value).includes(normalizedQuery));
}

export function sortSessionsForWorkspace(sessions: Session[], currentId: string | null): Session[] {
  return [...sessions].sort((left, right) => {
    if (left.id === currentId && right.id !== currentId) return -1;
    if (right.id === currentId && left.id !== currentId) return 1;

    const updatedDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (updatedDelta !== 0) return updatedDelta;

    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}

export function groupSessions(sessions: Session[]): WorkspaceGroup[] {
  const groups = new Map<string, Session[]>();
  for (const session of sessions) {
    const group = groups.get(session.workspaceId);
    if (group) {
      group.push(session);
    } else {
      groups.set(session.workspaceId, [session]);
    }
  }
  return Array.from(groups, ([workspaceId, group]) => ({ workspaceId, sessions: group }));
}

export function visibleSessions(groupSessions: Session[], currentId: string | null): Session[] {
  if (groupSessions.length <= VISIBLE_SESSION_LIMIT) return groupSessions;

  const defaultVisible = groupSessions.slice(0, VISIBLE_SESSION_LIMIT);
  const current = currentId ? groupSessions.find((session) => session.id === currentId) : null;
  if (!current || defaultVisible.some((session) => session.id === current.id))
    return defaultVisible;

  return [
    current,
    ...groupSessions
      .filter((session) => session.id !== current.id)
      .slice(0, VISIBLE_SESSION_LIMIT - 1),
  ];
}
