import type { Session } from '@cubby/core';
import {
  Check,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  groupSessions,
  matchesSessionSearch,
  normalizeSearch,
  sessionTitle,
  sortSessionsForWorkspace,
  visibleSessions,
  workspaceName,
} from './session-list-model.js';

interface SessionListProps {
  sessions: Session[];
  currentId: string | null;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename?: (id: string, title: string) => Promise<boolean>;
  onDelete?: (id: string) => Promise<boolean>;
  executingSessionIds?: Set<string>;
  completedPromptSessionIds?: Set<string>;
}

const SIDEBAR_ICON_PROPS = { size: 16, strokeWidth: 2.2, 'aria-hidden': true } as const;
const SIDEBAR_SURFACE = '#0b0c0c';
const SIDEBAR_BORDER = '#202020';

function isLiveStatus(status: Session['status']): boolean {
  return status === 'running' || status === 'starting';
}

function statusLabel(status: Session['status'], executing = false, completed = false): string {
  if (executing) return 'Executing';
  if (completed) return 'Done';
  if (status === 'running') return 'Live';
  if (status === 'starting') return 'Starting';
  if (status === 'ended') return 'Closed';
  if (status === 'draft') return 'Draft';
  return 'Ready';
}

function sessionTone(status: Session['status'], executing = false, completed = false) {
  if (executing) {
    return {
      background: '#10242b',
      border: '#245564',
      activeBorder: '#287f95',
      indicator: '#22c8f2',
      text: '#e7fbff',
      meta: '#88b9c5',
    };
  }
  if (completed) {
    return {
      background: '#151f12',
      border: '#34502d',
      activeBorder: '#5d8d48',
      indicator: '#98d36e',
      text: '#ecf8e8',
      meta: '#9fbe93',
    };
  }
  if (isLiveStatus(status)) {
    return {
      background: '#182915',
      border: '#31442d',
      activeBorder: '#5d8d48',
      indicator: '#8fbf73',
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
      text: '#ffffff',
      meta: '#8e8d86',
    };
  }
  return {
    background: '#2c1715',
    border: '#4b2825',
    activeBorder: '#745047',
    indicator: '#c78a7c',
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
  onRename,
  onDelete,
  executingSessionIds = new Set(),
  completedPromptSessionIds = new Set(),
}: SessionListProps) {
  const normalizedSearch = normalizeSearch(searchQuery);
  const filteredSessions = useMemo(
    () => sessions.filter((session) => matchesSessionSearch(session, normalizedSearch)),
    [sessions, normalizedSearch],
  );
  const groups = useMemo(
    () =>
      groupSessions(filteredSessions).map((group) => ({
        ...group,
        sessions: sortSessionsForWorkspace(group.sessions, currentId),
      })),
    [currentId, filteredSessions],
  );
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(() => new Set());
  const [openMoreWorkspace, setOpenMoreWorkspace] = useState<string | null>(null);
  const [activeSessionByWorkspace, setActiveSessionByWorkspace] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [openActionsSessionId, setOpenActionsSessionId] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const beginRename = (session: Session) => {
    setOpenActionsSessionId(null);
    setEditingSessionId(session.id);
    setEditingTitle(sessionTitle(session));
  };

  const submitRename = async (sessionId: string) => {
    if (!onRename) return;
    const nextTitle = editingTitle.trim();
    if (!nextTitle) return;

    setBusySessionId(sessionId);
    try {
      const renamed = await onRename(sessionId, nextTitle);
      if (renamed) {
        setEditingSessionId(null);
        setEditingTitle('');
      }
    } finally {
      setBusySessionId(null);
    }
  };

  const confirmDelete = async (session: Session) => {
    if (!onDelete) return;
    setOpenActionsSessionId(null);
    const title = sessionTitle(session);
    const runningWarning = isLiveStatus(session.status)
      ? '\n\nThis will stop the running session.'
      : '';
    const confirmed = window.confirm(`Delete session "${title}"?${runningWarning}`);
    if (!confirmed) return;

    setBusySessionId(session.id);
    try {
      const deleted = await onDelete(session.id);
      if (deleted && editingSessionId === session.id) {
        setEditingSessionId(null);
        setEditingTitle('');
      }
    } finally {
      setBusySessionId(null);
    }
  };

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

  useEffect(() => {
    if (!editingSessionId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [editingSessionId]);

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
              color: '#ffffff',
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
                    gridTemplateColumns: 'minmax(0, 1fr)',
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
                        color: workspaceActive ? '#ffffff' : '#a8a8a1',
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
                </button>
              </div>

              {!collapsed && (
                <div style={{ marginTop: '2px', position: 'relative' }}>
                  {visible.map((session) => {
                    const active = session.id === currentId;
                    const liveSession = isLiveStatus(session.status);
                    const executing = liveSession && executingSessionIds.has(session.id);
                    const completed = completedPromptSessionIds.has(session.id);
                    const tone = sessionTone(session.status, executing, completed);
                    const title = sessionTitle(session);
                    const editing = editingSessionId === session.id;
                    const actionsOpen = openActionsSessionId === session.id;
                    const busy = busySessionId === session.id;

                    return (
                      <div
                        key={session.id}
                        data-testid="session-item"
                        style={{
                          position: 'relative',
                          overflow: 'visible',
                          padding: '10px 10px 10px 13px',
                          cursor: 'pointer',
                          background: active || completed ? tone.background : '#141414',
                          borderRadius: '6px',
                          marginBottom: '7px',
                          border: `1px solid ${active ? tone.activeBorder : tone.border}`,
                          color: tone.text,
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          boxShadow:
                            active || completed
                              ? `inset 3px 0 0 ${tone.indicator}, inset 0 0 0 1px rgba(255,255,255,0.04)`
                              : 'inset 3px 0 0 #2d2d2a',
                        }}
                      >
                        <button
                          type="button"
                          aria-label={`Session ${title}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelect(session.id);
                          }}
                          style={{
                            position: 'absolute',
                            inset: 0,
                            zIndex: 1,
                            border: 'none',
                            background: 'transparent',
                            padding: 0,
                            cursor: 'pointer',
                          }}
                        />
                        <div
                          style={{
                            position: 'relative',
                            zIndex: 2,
                            display: 'grid',
                            gridTemplateColumns:
                              executing || completed
                                ? 'minmax(0, 1fr) auto auto auto'
                                : 'minmax(0, 1fr) auto auto',
                            gap: '8px',
                            alignItems: 'center',
                            fontWeight: 650,
                            fontSize: '13px',
                            overflow: 'hidden',
                            pointerEvents: 'none',
                          }}
                        >
                          {editing ? (
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void submitRename(session.id);
                              }}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'minmax(0, 1fr) 28px 28px',
                                gap: '5px',
                                alignItems: 'center',
                                minWidth: 0,
                                pointerEvents: 'auto',
                              }}
                            >
                              <input
                                ref={renameInputRef}
                                aria-label={`Rename ${title}`}
                                value={editingTitle}
                                disabled={busy}
                                onChange={(event) => setEditingTitle(event.target.value)}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape') {
                                    event.stopPropagation();
                                    setEditingSessionId(null);
                                    setEditingTitle('');
                                  }
                                }}
                                style={{
                                  minWidth: 0,
                                  height: '28px',
                                  border: '1px solid #3a3f3c',
                                  borderRadius: '5px',
                                  background: '#090a0a',
                                  color: '#ffffff',
                                  padding: '0 8px',
                                  font: 'inherit',
                                  fontSize: '12px',
                                  outline: 'none',
                                }}
                              />
                              <button
                                type="submit"
                                className="session-icon-action"
                                aria-label="Save session name"
                                disabled={busy || editingTitle.trim().length === 0}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <Check size={15} strokeWidth={2.2} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="session-icon-action"
                                aria-label="Cancel rename"
                                disabled={busy}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setEditingSessionId(null);
                                  setEditingTitle('');
                                }}
                              >
                                <X size={15} strokeWidth={2.2} aria-hidden="true" />
                              </button>
                            </form>
                          ) : (
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
                          )}
                          <span
                            className="session-status-dot"
                            data-live={liveSession ? 'true' : 'false'}
                            aria-hidden="true"
                            title={statusLabel(session.status, executing, completed)}
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '999px',
                              background: tone.indicator,
                              boxShadow: executing
                                ? '0 0 0 3px rgba(34, 200, 242, 0.13)'
                                : completed
                                  ? '0 0 0 3px rgba(152, 211, 110, 0.13)'
                                  : liveSession
                                    ? '0 0 0 3px rgba(143, 191, 115, 0.13)'
                                    : 'none',
                            }}
                          />
                          {executing && (
                            <span
                              data-testid="session-execution-status"
                              style={{
                                border: '1px solid rgba(34, 200, 242, 0.35)',
                                borderRadius: '999px',
                                color: '#a8edff',
                                fontSize: '10px',
                                fontWeight: 800,
                                lineHeight: 1,
                                padding: '4px 6px',
                                textTransform: 'uppercase',
                              }}
                            >
                              Executing
                            </span>
                          )}
                          {!executing && completed && (
                            <span
                              data-testid="session-completion-status"
                              style={{
                                border: '1px solid rgba(152, 211, 110, 0.38)',
                                borderRadius: '999px',
                                color: '#c8f6ad',
                                fontSize: '10px',
                                fontWeight: 800,
                                lineHeight: 1,
                                padding: '4px 6px',
                                textTransform: 'uppercase',
                              }}
                            >
                              Done
                            </span>
                          )}
                          {!editing && (
                            <button
                              type="button"
                              className="session-icon-action"
                              aria-label={`Session actions for ${title}`}
                              aria-expanded={actionsOpen}
                              disabled={busy}
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenActionsSessionId((prev) =>
                                  prev === session.id ? null : session.id,
                                );
                              }}
                              style={{ pointerEvents: 'auto' }}
                            >
                              <MoreHorizontal size={15} strokeWidth={2.2} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                        {actionsOpen && (
                          <div className="session-actions-menu" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={(event) => {
                                event.stopPropagation();
                                beginRename(session);
                              }}
                            >
                              <Pencil size={14} strokeWidth={2.2} aria-hidden="true" />
                              Rename
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={(event) => {
                                event.stopPropagation();
                                void confirmDelete(session);
                              }}
                            >
                              <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
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
                          {hidden.map((session) => {
                            const liveSession = isLiveStatus(session.status);
                            const executing = liveSession && executingSessionIds.has(session.id);
                            const completed = completedPromptSessionIds.has(session.id);
                            const tone = sessionTone(session.status, executing, completed);

                            return (
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
                                  background: completed ? '#151f12' : 'transparent',
                                  color: '#ffffff',
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
                                    data-live={liveSession ? 'true' : 'false'}
                                    aria-hidden="true"
                                    title={statusLabel(session.status, executing, completed)}
                                    style={{
                                      width: '7px',
                                      height: '7px',
                                      borderRadius: '999px',
                                      background: tone.indicator,
                                    }}
                                  />
                                </div>
                              </button>
                            );
                          })}
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
