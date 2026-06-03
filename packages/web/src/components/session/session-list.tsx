import type { Session } from '@cubby/core';
import { useEffect, useMemo, useState } from 'react';

interface SessionListProps {
  sessions: Session[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

interface WorkspaceGroup {
  workspaceId: string;
  sessions: Session[];
}

const VISIBLE_SESSION_LIMIT = 5;

function workspaceName(workspaceId: string): string {
  const parts = workspaceId.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? workspaceId;
}

function groupSessions(sessions: Session[]): WorkspaceGroup[] {
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

function visibleSessions(groupSessions: Session[], currentId: string | null): Session[] {
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

export function SessionList({ sessions, currentId, onSelect, onCreate }: SessionListProps) {
  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(() => new Set());
  const [openMoreWorkspace, setOpenMoreWorkspace] = useState<string | null>(null);
  const [activeSessionByWorkspace, setActiveSessionByWorkspace] = useState<Map<string, string>>(
    () => new Map(),
  );

  useEffect(() => {
    const current = sessions.find((session) => session.id === currentId);
    if (!current) return;
    setActiveSessionByWorkspace((prev) => {
      const existing = prev.get(current.workspaceId);
      if (existing === current.id) return prev;
      const next = new Map(prev);
      next.set(current.workspaceId, current.id);
      return next;
    });
  }, [currentId, sessions]);

  return (
    <div
      style={{
        padding: '10px',
        borderRight: '1px solid #262a3b',
        height: '100%',
        overflowY: 'auto',
        background: '#171923',
      }}
    >
      <button
        type="button"
        onClick={onCreate}
        style={{
          width: '100%',
          marginBottom: '12px',
          padding: '8px 10px',
          border: '1px solid #3b4261',
          borderRadius: '6px',
          background: '#24283b',
          color: '#cdd6f4',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        + New Session
      </button>
      {groups.map((group) => {
        const collapsed = collapsedWorkspaces.has(group.workspaceId);
        const workspaceActive = group.sessions.some((session) => session.id === currentId);
        const rememberedId = activeSessionByWorkspace.get(group.workspaceId);
        const workspaceTarget =
          group.sessions.find((session) => session.id === rememberedId) ?? group.sessions[0];
        const visible = visibleSessions(group.sessions, currentId);
        const hidden = group.sessions.filter(
          (session) => !visible.some((visibleSession) => visibleSession.id === session.id),
        );
        const hasLiveSession = group.sessions.some(
          (session) => session.status === 'running' || session.status === 'starting',
        );

        return (
          <section
            key={group.workspaceId}
            data-testid="workspace-group"
            style={{
              marginBottom: '10px',
              borderBottom: '1px solid #24283b',
              paddingBottom: '8px',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '34px minmax(0, 1fr)',
                gap: '8px',
                alignItems: 'center',
                padding: '3px 0',
                borderRadius: '6px',
                outline: workspaceActive ? '1px solid #313a5f' : 'none',
              }}
            >
              <button
                type="button"
                aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${workspaceName(
                  group.workspaceId,
                )}`}
                aria-expanded={!collapsed}
                data-testid="workspace-toggle"
                onClick={() => {
                  setOpenMoreWorkspace(null);
                  setCollapsedWorkspaces((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.workspaceId)) {
                      next.delete(group.workspaceId);
                    } else {
                      next.add(group.workspaceId);
                    }
                    return next;
                  });
                }}
                style={{
                  width: '34px',
                  height: '34px',
                  border: '1px solid #30344f',
                  borderRadius: '6px',
                  background: collapsed ? '#1d2030' : '#24283b',
                  color: '#89b4fa',
                  cursor: 'pointer',
                  fontSize: '20px',
                  lineHeight: 1,
                  fontWeight: 800,
                }}
              >
                {collapsed ? '+' : '-'}
              </button>
              <button
                type="button"
                data-testid="workspace-tab"
                onClick={() => {
                  setOpenMoreWorkspace(null);
                  if (workspaceTarget) onSelect(workspaceTarget.id);
                  setCollapsedWorkspaces((prev) => {
                    if (!prev.has(group.workspaceId)) return prev;
                    const next = new Set(prev);
                    next.delete(group.workspaceId);
                    return next;
                  });
                }}
                style={{
                  minWidth: 0,
                  border: 'none',
                  background: 'transparent',
                  color: '#cdd6f4',
                  cursor: 'pointer',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: '8px',
                  alignItems: 'center',
                  padding: '6px 2px 6px 0',
                  textAlign: 'left',
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {workspaceName(group.workspaceId)}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      color: '#7f849c',
                      fontSize: '11px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {group.workspaceId}
                  </span>
                </span>
                <span
                  style={{
                    color: hasLiveSession ? '#a6e3a1' : '#7f849c',
                    fontSize: '11px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {group.sessions.length}
                </span>
              </button>
            </div>

            {!collapsed && (
              <div style={{ marginTop: '4px', position: 'relative' }}>
                {visible.map((session) => (
                  <button
                    type="button"
                    key={session.id}
                    data-testid="session-item"
                    onClick={() => onSelect(session.id)}
                    style={{
                      padding: '7px 8px 7px 26px',
                      cursor: 'pointer',
                      background: session.id === currentId ? '#31364f' : 'transparent',
                      borderRadius: '6px',
                      marginBottom: '4px',
                      border:
                        session.id === currentId ? '1px solid #89b4fa' : '1px solid transparent',
                      color: 'inherit',
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                    }}
                  >
                    <div
                      style={{
                        display: 'block',
                        fontWeight: 700,
                        fontSize: '13px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {session.title ?? session.provider}
                    </div>
                    <div style={{ fontSize: '11px', color: '#8b93b5' }}>{session.status}</div>
                  </button>
                ))}
                {hidden.length > 0 && (
                  <div style={{ position: 'relative' }}>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenMoreWorkspace((prev) =>
                          prev === group.workspaceId ? null : group.workspaceId,
                        )
                      }
                      style={{
                        width: '100%',
                        padding: '6px 8px 6px 26px',
                        border: '1px solid #30344f',
                        borderRadius: '6px',
                        background: '#1d2030',
                        color: '#bac2de',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: '12px',
                      }}
                    >
                      More {hidden.length}
                    </button>
                    {openMoreWorkspace === group.workspaceId && (
                      <div
                        style={{
                          marginTop: '4px',
                          marginLeft: '24px',
                          maxHeight: '220px',
                          overflowY: 'auto',
                          border: '1px solid #3b4261',
                          borderRadius: '6px',
                          background: '#11131d',
                          boxShadow: '0 12px 30px rgba(0, 0, 0, 0.35)',
                          padding: '4px',
                        }}
                      >
                        {hidden.map((session) => (
                          <button
                            type="button"
                            key={session.id}
                            data-testid="session-more-item"
                            onClick={() => {
                              setOpenMoreWorkspace(null);
                              onSelect(session.id);
                            }}
                            style={{
                              display: 'block',
                              width: '100%',
                              border: 'none',
                              borderRadius: '4px',
                              background: 'transparent',
                              color: '#cdd6f4',
                              cursor: 'pointer',
                              padding: '7px 8px',
                              textAlign: 'left',
                            }}
                          >
                            <div
                              style={{
                                display: 'block',
                                fontSize: '12px',
                                fontWeight: 700,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {session.title ?? session.provider}
                            </div>
                            <div style={{ fontSize: '11px', color: '#8b93b5' }}>
                              {session.status}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
