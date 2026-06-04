import {
  SESSION_STATUS,
  type Session,
  type SessionStatus,
  type WSEvent,
  type WSResponse,
} from '@cubby/core';
import { useAtom } from 'jotai';
import { Maximize2, PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { currentSessionIdAtom, sessionsAtom } from './atoms/session.js';
import { SessionList } from './components/session/session-list.js';
import { SessionView } from './components/session/session-view.js';
import { DirPicker } from './components/workspace/dir-picker.js';
import { useWebSocket } from './hooks/use-ws.js';

const SIDEBAR_STATE_STORAGE_KEY = 'cubby.sidebarCollapsed';
const CURRENT_SESSION_ID_STORAGE_KEY = 'cubby.currentSessionId';
const MOBILE_MEDIA_QUERY = '(max-width: 767px)';
const APP_HEADER_HEIGHT = 52;
const SIDEBAR_EXPANDED_WIDTH = 240;
const ICON_BUTTON_STYLE = {
  width: '32px',
  height: '32px',
  border: '1px solid #262626',
  borderRadius: '6px',
  background: '#151515',
  color: '#b8b8b8',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
} as const;
const APP_SURFACE = '#050606';
const APP_PANEL = '#0b0c0c';
const APP_BORDER = '#202020';
const HEADER_ICON_PROPS = { size: 16, strokeWidth: 2.1, 'aria-hidden': true } as const;

function sessionTitle(session: Session | null): string {
  return session?.title ?? session?.provider ?? 'No session selected';
}

function getWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

function initialSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = window.localStorage.getItem(SIDEBAR_STATE_STORAGE_KEY);
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function storedCurrentSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(CURRENT_SESSION_ID_STORAGE_KEY);
}

function persistCurrentSessionId(sessionId: string | null): void {
  if (typeof window === 'undefined') return;
  if (sessionId) {
    window.localStorage.setItem(CURRENT_SESSION_ID_STORAGE_KEY, sessionId);
  } else {
    window.localStorage.removeItem(CURRENT_SESSION_ID_STORAGE_KEY);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSession(value: unknown): value is Session {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.workspaceId === 'string' &&
    typeof value.provider === 'string' &&
    typeof value.status === 'string' &&
    SESSION_STATUS.includes(value.status as SessionStatus)
  );
}

function isSessionStatusData(
  value: unknown,
): value is { sessionId: string; status: SessionStatus } {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.status === 'string' &&
    SESSION_STATUS.includes(value.status as SessionStatus)
  );
}

function preferredSessionId(sessions: Session[]): string | null {
  const liveSession = sessions.find(
    (session) => session.status === 'running' || session.status === 'starting',
  );
  if (liveSession) return liveSession.id;

  const inactiveSession = sessions.find(
    (session) => session.status === 'idle' || session.status === 'draft',
  );
  return inactiveSession?.id ?? sessions[0]?.id ?? null;
}

function isLiveSession(session: Session | null): session is Session {
  return session?.status === 'running' || session?.status === 'starting';
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function isTerminalInputElement(element: Element | null): boolean {
  return element?.getAttribute('aria-label') === 'Terminal input';
}

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (isTerminalInputElement(element)) return false;
  if (element.isContentEditable) return true;
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

export function App() {
  const { send, request, onMessage, connected } = useWebSocket(getWsUrl());
  const [sessions, setSessions] = useAtom(sessionsAtom);
  const [currentId, setCurrentId] = useAtom(currentSessionIdAtom);
  const [pendingSession, setPendingSession] = useState<Session | null>(null);
  const listedCurrentSession = sessions.find((s) => s.id === currentId) ?? null;
  const currentSession =
    listedCurrentSession ?? (pendingSession?.id === currentId ? pendingSession : null);
  const [showPicker, setShowPicker] = useState(false);
  const [autoStartSessionId, setAutoStartSessionId] = useState<string | null>(null);
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [mountedSessionIds, setMountedSessionIds] = useState<Set<string>>(() => new Set());

  const sessionById = useMemo(() => {
    const byId = new Map<string, Session>();
    for (const session of sessions) byId.set(session.id, session);
    if (pendingSession) byId.set(pendingSession.id, pendingSession);
    if (currentSession) byId.set(currentSession.id, currentSession);
    return byId;
  }, [sessions, pendingSession, currentSession]);

  useEffect(() => {
    setMountedSessionIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        const session = sessionById.get(id);
        if (!session) continue;
        if (isLiveSession(session) || id === currentSession?.id) next.add(id);
      }
      if (currentSession) next.add(currentSession.id);
      return sameSet(prev, next) ? prev : next;
    });
  }, [currentSession, sessionById]);

  const mountedSessions = useMemo(
    () =>
      Array.from(mountedSessionIds)
        .map((id) => sessionById.get(id))
        .filter((session): session is Session => Boolean(session)),
    [mountedSessionIds, sessionById],
  );

  const handleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void document.documentElement.requestFullscreen();
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!isLiveSession(currentSession)) return;
      if (showPicker || isEditableElement(document.activeElement)) return;

      event.preventDefault();
      if (isTerminalInputElement(document.activeElement)) return;

      event.stopPropagation();
      setTerminalFocusRequest((request) => request + 1);
      send({
        id: `input-${Date.now()}`,
        cmd: 'terminal.input',
        args: { sessionId: currentSession.id, data: '\x1b' },
      });
    };

    window.addEventListener('keydown', handleEscape, { capture: true });
    return () => window.removeEventListener('keydown', handleEscape, { capture: true });
  }, [currentSession, send, showPicker]);

  // Load sessions on connect
  useEffect(() => {
    if (connected) {
      send({ id: 'init', cmd: 'session.list' });
    }
  }, [connected, send]);

  useEffect(() => {
    if (currentId && pendingSession?.id === currentId) return;

    if (sessions.length === 0) {
      if (currentId !== null) setCurrentId(null);
      return;
    }

    if (currentId && sessions.some((session) => session.id === currentId)) return;

    const storedId = storedCurrentSessionId();
    const restoredId =
      storedId && sessions.some((session) => session.id === storedId) ? storedId : null;
    const nextId = restoredId ?? preferredSessionId(sessions);
    setCurrentId(nextId);
    persistCurrentSessionId(nextId);
  }, [sessions, currentId, pendingSession, setCurrentId]);

  // Handle responses
  useEffect(() => {
    return onMessage((msg: WSResponse | WSEvent) => {
      if (
        'ok' in msg &&
        msg.ok &&
        'id' in msg &&
        msg.id === 'init' &&
        Array.isArray(msg.data) &&
        msg.data.every(isSession)
      ) {
        const nextSessions = msg.data;
        setSessions(nextSessions);
        setPendingSession((pending) => {
          if (!pending) return pending;
          if (nextSessions.some((session) => session.id === pending.id)) return null;
          if (pending.status === 'ended') return null;
          return pending;
        });
        if (
          pendingSession &&
          pendingSession.status === 'ended' &&
          !nextSessions.some((session) => session.id === pendingSession.id) &&
          currentId === pendingSession.id
        ) {
          setCurrentId(null);
          persistCurrentSessionId(null);
        }
      }
      if (
        'ok' in msg &&
        msg.ok &&
        'id' in msg &&
        msg.id.startsWith('create-') &&
        isSession(msg.data)
      ) {
        setPendingSession(msg.data);
        setCurrentId(msg.data.id);
        persistCurrentSessionId(msg.data.id);
      }
      if ('evt' in msg && msg.evt === 'session.status' && isSessionStatusData(msg.data)) {
        setSessions((prev) =>
          prev.map((s) => (s.id === msg.data.sessionId ? { ...s, status: msg.data.status } : s)),
        );
        setPendingSession((pending) =>
          pending?.id === msg.data.sessionId ? { ...pending, status: msg.data.status } : pending,
        );
        if (msg.data.status === 'ended') {
          send({ id: 'init', cmd: 'session.list' });
        }
      }
      if ('evt' in msg && msg.evt === 'session.updated' && isSession(msg.data)) {
        setSessions((prev) => prev.map((s) => (s.id === msg.data.id ? msg.data : s)));
        setPendingSession((pending) => (pending?.id === msg.data.id ? msg.data : pending));
        send({ id: 'init', cmd: 'session.list' });
      }
    });
  }, [onMessage, setSessions, setCurrentId, send, pendingSession, currentId]);

  useEffect(() => {
    if (!connected || !pendingSession) return;
    if (sessions.some((session) => session.id === pendingSession.id)) {
      setPendingSession(null);
      return;
    }
    if (!isLiveSession(pendingSession)) return;

    send({ id: 'init', cmd: 'session.list' });
    const intervalId = window.setInterval(() => {
      send({ id: 'init', cmd: 'session.list' });
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [connected, pendingSession, sessions, send]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STATE_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const handleDirConfirm = useCallback(
    async (workspaceId: string) => {
      setShowPicker(false);
      // Create session
      const createRes = await request({
        id: `create-${Date.now()}`,
        cmd: 'session.create',
        args: { workspaceId, provider: 'claude-code' },
      });
      if (!createRes.ok || !createRes.data) return;
      if (!isSession(createRes.data)) return;

      const session = createRes.data;
      setPendingSession(session);
      setCurrentId(session.id);
      persistCurrentSessionId(session.id);
      setAutoStartSessionId(session.id);
    },
    [request, setCurrentId],
  );

  const handleSelectSession = useCallback(
    (id: string) => {
      setCurrentId(id);
      persistCurrentSessionId(id);
      setTerminalFocusRequest((request) => request + 1);
    },
    [setCurrentId],
  );

  return (
    <div
      data-testid="app-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100dvh',
        overflow: 'hidden',
        background: APP_SURFACE,
        color: '#e7e4dd',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <header
        data-testid="app-header"
        style={{
          height: `${APP_HEADER_HEIGHT}px`,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '0 8px',
          borderBottom: `1px solid ${APP_BORDER}`,
          background: APP_SURFACE,
          position: 'relative',
        }}
      >
        <button
          type="button"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          data-testid="sidebar-toggle"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          style={{
            ...ICON_BUTTON_STYLE,
            color: '#d7d7d2',
          }}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen {...HEADER_ICON_PROPS} />
          ) : (
            <PanelLeftClose {...HEADER_ICON_PROPS} />
          )}
        </button>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              maxWidth: 'min(520px, 42vw)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '13px',
              fontWeight: 650,
              color: currentSession ? '#a9a9a3' : '#777773',
            }}
          >
            {sessionTitle(currentSession)}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          aria-label="Toggle fullscreen"
          title="Toggle fullscreen"
          onClick={handleFullscreen}
          style={ICON_BUTTON_STYLE}
        >
          <Maximize2 {...HEADER_ICON_PROPS} />
        </button>
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          disabled
          style={{
            ...ICON_BUTTON_STYLE,
            cursor: 'not-allowed',
            color: '#6c7086',
            opacity: 0.75,
          }}
        >
          <SlidersHorizontal {...HEADER_ICON_PROPS} />
        </button>
      </header>
      <div
        style={{
          overflow: 'hidden',
          display: 'flex',
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          data-testid="sidebar-shell"
          style={{
            width: sidebarCollapsed ? '0px' : `${SIDEBAR_EXPANDED_WIDTH}px`,
            height: '100%',
            flexShrink: 0,
            overflow: 'hidden',
            borderRight: sidebarCollapsed ? 'none' : `1px solid ${APP_BORDER}`,
            background: APP_PANEL,
            transition: 'width 140ms ease',
          }}
        >
          {!sidebarCollapsed && (
            <div style={{ width: `${SIDEBAR_EXPANDED_WIDTH}px`, height: '100%' }}>
              <SessionList
                sessions={sessions}
                currentId={currentId}
                searchQuery={sessionSearchQuery}
                onSearchQueryChange={setSessionSearchQuery}
                onSelect={handleSelectSession}
                onCreate={() => setShowPicker(true)}
              />
            </div>
          )}
        </div>
        <div
          data-testid="session-detail-pane"
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            overflow: 'hidden',
            display: 'flex',
            background: APP_SURFACE,
            position: 'relative',
          }}
        >
          {currentSession && mountedSessions.length > 0 ? (
            mountedSessions.map((session) => {
              const active = session.id === currentSession?.id;
              return (
                <SessionView
                  key={session.id}
                  session={session}
                  active={active}
                  autoStart={active && session.id === autoStartSessionId}
                  focusRequest={terminalFocusRequest}
                  onAutoStartConsumed={() => setAutoStartSessionId(null)}
                  send={send}
                  request={request}
                  onMessage={onMessage}
                />
              );
            })
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: '#777773',
                background: APP_SURFACE,
              }}
            >
              Select or create a session
            </div>
          )}
        </div>
      </div>
      {showPicker && (
        <DirPicker onConfirm={handleDirConfirm} onCancel={() => setShowPicker(false)} />
      )}
    </div>
  );
}
