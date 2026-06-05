import type { Session } from '@cubby/core';
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

interface SessionListProps {
  sessions: Session[];
  currentId: string | null;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

interface WorkspaceGroup {
  workspaceId: string;
  sessions: Session[];
}

const VISIBLE_SESSION_LIMIT = 5;
const SIDEBAR_ICON_PROPS = { size: 16, strokeWidth: 2.2, 'aria-hidden': true } as const;
const SIDEBAR_SURFACE = '#0b0c0c';
const SIDEBAR_BORDER = '#202020';

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

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

function sessionTitle(session: Session): string {
  return session.title ?? session.provider;
}

function matchesSessionSearch(session: Session, query: string): boolean {
  if (!query) return true;
  return [sessionTitle(session), session.workspaceId, session.provider, session.status].some(
    (value) => value.toLowerCase().includes(query),
  );
}

function isLiveStatus(status: Session['status']): boolean {
  return status === 'running' || status === 'starting';
}

function statusLabel(status: Session['status']): string {
  if (status === 'running') return 'Live';
  if (status === 'starting') return 'Starting';
  if (status === 'ended') return 'Closed';
  if (status === 'draft') return 'Draft';
  return 'Ready';
}

function sessionTone(status: Session['status']) {
  if (isLiveStatus(status)) {
    return {
      background: '#182915',
      border: '#31442d',
      activeBorder: '#5d8d48',
      indicator: '#8fbf73',
      rail: '#6fa35a',
      text: '#dcebd4',
      meta: '#96aa8a',
    };
  }
  if (status === 'ended') {
    return {
      background: '#242424',
      border: '#3b3b3b',
      activeBorder: '#5b5b57',
      indicator: '#989890',
      rail: '#555550',
      text: '#dedbd2',
      meta: '#8e8d86',
    };
  }
  return {
    background: '#2c1715',
    border: '#4b2825',
    activeBorder: '#745047',
    indicator: '#c78a7c',
    rail: '#8f5c54',
    text: '#ead9d4',
    meta: '#ad8981',
  };
}

function slashCommandName(title: string): string | null {
  if (!title.startsWith('/')) return null;
  const command = title.slice(1).trim();
  return command || null;
}

function SessionTitle({ session, fontSize }: { session: Session; fontSize: string }) {
  const title = sessionTitle(session);
  const commandName = slashCommandName(title);
  if (!commandName) {
    return <>{title}</>;
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      <span
        data-testid="session-command-prefix"
        style={{
          flexShrink: 0,
          width: '16px',
          height: '16px',
          border: '1px solid #454b6f',
          borderRadius: '4px',
          background: '#1d2030',
          color: '#89b4fa',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'monospace',
          fontSize: '11px',
          fontWeight: 800,
        }}
      >
        /
      </span>
      <span
        data-testid="session-command-title"
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: 'monospace',
          fontSize,
        }}
      >
        {commandName}
      </span>
    </span>
  );
}

export function SessionList({
  sessions,
  currentId,
  searchQuery,
  onSearchQueryChange,
  onSelect,
  onCreate,
}: SessionListProps) {
  const normalizedSearch = normalizeSearch(searchQuery);
  const filteredSessions = useMemo(
    () => sessions.filter((session) => matchesSessionSearch(session, normalizedSearch)),
    [sessions, normalizedSearch],
  );
  const groups = useMemo(() => groupSessions(filteredSessions), [filteredSessions]);
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
        padding: 0,
        height: '100%',
        background: SIDEBAR_SURFACE,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          height: '52px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '0 8px',
          borderBottom: `1px solid ${SIDEBAR_BORDER}`,
        }}
      >
        <label
          style={{
            flex: 1,
            minWidth: 0,
            height: '32px',
            border: '1px solid #171717',
            borderRadius: '6px',
            background: '#111111',
            color: '#8d8d87',
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            padding: '0 8px',
          }}
        >
          <Search size={15} strokeWidth={2.1} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search sessions"
            placeholder="Search sessions"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            style={{
              minWidth: 0,
              width: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: '#d8d8d4',
              font: 'inherit',
              fontSize: '12px',
            }}
          />
        </label>
        <button
          type="button"
          aria-label="New Session"
          title="New Session"
          onClick={onCreate}
          style={{
            width: '30px',
            height: '30px',
            border: 'none',
            background: 'transparent',
            color: '#a8a8a1',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          <Plus {...SIDEBAR_ICON_PROPS} />
        </button>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '10px 8px 12px',
        }}
      >
        {groups.length === 0 && normalizedSearch && (
          <div
            style={{
              padding: '18px 8px',
              color: '#777773',
              fontSize: '12px',
              lineHeight: 1.4,
            }}
          >
            No matching sessions
          </div>
        )}
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
                marginBottom: '12px',
                borderBottom: `1px solid ${SIDEBAR_BORDER}`,
                paddingBottom: '10px',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '28px minmax(0, 1fr)',
                  gap: '7px',
                  alignItems: 'center',
                  padding: '2px 2px 7px',
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
                    width: '28px',
                    height: '28px',
                    border: '1px solid #252525',
                    borderRadius: '6px',
                    background: workspaceActive ? '#151515' : 'transparent',
                    color: workspaceActive ? '#22c8f2' : '#7f7f78',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {collapsed ? (
                    <ChevronRight {...SIDEBAR_ICON_PROPS} />
                  ) : (
                    <ChevronDown {...SIDEBAR_ICON_PROPS} />
                  )}
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
                    padding: '4px 2px 4px 0',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 650,
                        color: workspaceActive ? '#d7d7d2' : '#a8a8a1',
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
                        color: '#6f6f6a',
                        fontSize: '10px',
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
                      color: hasLiveSession ? '#8aa777' : '#6f6f6a',
                      fontSize: '10px',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {group.sessions.length}
                  </span>
                </button>
              </div>

              {!collapsed && (
                <div style={{ marginTop: '2px', position: 'relative' }}>
                  {visible.map((session) => {
                    const active = session.id === currentId;
                    const tone = sessionTone(session.status);
                    const liveSession = isLiveStatus(session.status);

                    return (
                      <button
                        type="button"
                        key={session.id}
                        aria-label={`Session ${sessionTitle(session)}`}
                        data-testid="session-item"
                        onClick={() => onSelect(session.id)}
                        style={{
                          position: 'relative',
                          overflow: 'hidden',
                          padding: '10px 10px 10px 13px',
                          cursor: 'pointer',
                          background: active ? tone.background : '#141414',
                          borderRadius: '6px',
                          marginBottom: '7px',
                          border: `1px solid ${active ? tone.activeBorder : tone.border}`,
                          color: tone.text,
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          boxShadow: active ? 'inset 0 0 0 1px rgba(255,255,255,0.04)' : 'none',
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            top: '9px',
                            bottom: '9px',
                            left: 0,
                            width: '3px',
                            borderRadius: '0 3px 3px 0',
                            background: active ? tone.rail : '#2d2d2a',
                            opacity: active ? 1 : 0.85,
                          }}
                        />
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(0, 1fr) auto',
                            gap: '8px',
                            alignItems: 'center',
                            fontWeight: 650,
                            fontSize: '13px',
                            overflow: 'hidden',
                          }}
                        >
                          <span
                            style={{
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <SessionTitle session={session} fontSize="13px" />
                          </span>
                          <span
                            className="session-status-dot"
                            data-live={liveSession ? 'true' : 'false'}
                            aria-hidden="true"
                            title={statusLabel(session.status)}
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '999px',
                              background: tone.indicator,
                              boxShadow: liveSession
                                ? `0 0 0 3px rgba(143, 191, 115, 0.13)`
                                : 'none',
                            }}
                          />
                        </div>
                      </button>
                    );
                  })}
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
                          border: '1px solid #2a2a2a',
                          borderRadius: '6px',
                          background: '#141414',
                          color: '#b8b8b0',
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
                            border: '1px solid #2c2c2c',
                            borderRadius: '6px',
                            background: '#090a0a',
                            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.45)',
                            padding: '4px',
                          }}
                        >
                          {hidden.map((session) => (
                            <button
                              type="button"
                              key={session.id}
                              aria-label={`Session ${sessionTitle(session)}`}
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
                                color: '#dedbd2',
                                cursor: 'pointer',
                                padding: '7px 8px',
                                textAlign: 'left',
                              }}
                            >
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                                  gap: '8px',
                                  alignItems: 'center',
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  overflow: 'hidden',
                                }}
                              >
                                <span
                                  style={{
                                    minWidth: 0,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  <SessionTitle session={session} fontSize="12px" />
                                </span>
                                <span
                                  className="session-status-dot"
                                  data-live={isLiveStatus(session.status) ? 'true' : 'false'}
                                  aria-hidden="true"
                                  title={statusLabel(session.status)}
                                  style={{
                                    width: '7px',
                                    height: '7px',
                                    borderRadius: '999px',
                                    background: sessionTone(session.status).indicator,
                                  }}
                                />
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
    </div>
  );
}
