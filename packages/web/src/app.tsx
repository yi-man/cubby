import {
  SESSION_STATUS,
  type Session,
  type SessionStatus,
  type WSEvent,
  type WSResponse,
} from '@cubby/core';
import { useAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { currentSessionIdAtom, sessionsAtom } from './atoms/session.js';
import { SessionList } from './components/session/session-list.js';
import { SessionView } from './components/session/session-view.js';
import { DirPicker } from './components/workspace/dir-picker.js';
import { useWebSocket } from './hooks/use-ws.js';

const SIDEBAR_STATE_STORAGE_KEY = 'cubby.sidebarCollapsed';
const MOBILE_MEDIA_QUERY = '(max-width: 767px)';
const SIDEBAR_EXPANDED_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 44;

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

export function App() {
  const { send, request, onMessage, connected } = useWebSocket(getWsUrl());
  const [sessions, setSessions] = useAtom(sessionsAtom);
  const [currentId, setCurrentId] = useAtom(currentSessionIdAtom);
  const currentSession = sessions.find((s) => s.id === currentId) ?? null;
  const [showPicker, setShowPicker] = useState(false);
  const [autoStartSessionId, setAutoStartSessionId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);

  // Load sessions on connect
  useEffect(() => {
    if (connected) {
      send({ id: 'init', cmd: 'session.list' });
    }
  }, [connected, send]);

  useEffect(() => {
    if (sessions.length === 0) {
      if (currentId !== null) setCurrentId(null);
      return;
    }

    if (currentId && sessions.some((session) => session.id === currentId)) return;
    setCurrentId(sessions[0].id);
  }, [sessions, currentId, setCurrentId]);

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
        setSessions(msg.data);
      }
      if (
        'ok' in msg &&
        msg.ok &&
        'id' in msg &&
        msg.id.startsWith('create-') &&
        isSession(msg.data)
      ) {
        setSessions((prev) => [msg.data, ...prev]);
        setCurrentId(msg.data.id);
      }
      if ('evt' in msg && msg.evt === 'session.status' && isSessionStatusData(msg.data)) {
        setSessions((prev) =>
          prev.map((s) => (s.id === msg.data.sessionId ? { ...s, status: msg.data.status } : s)),
        );
      }
      if ('evt' in msg && msg.evt === 'session.updated' && isSession(msg.data)) {
        setSessions((prev) => prev.map((s) => (s.id === msg.data.id ? msg.data : s)));
      }
    });
  }, [onMessage, setSessions, setCurrentId]);

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
      setSessions((prev) => [session, ...prev]);
      setCurrentId(session.id);
      setAutoStartSessionId(session.id);
    },
    [request, setSessions, setCurrentId],
  );

  return (
    <div
      data-testid="app-shell"
      style={{
        display: 'flex',
        width: '100vw',
        height: '100dvh',
        overflow: 'hidden',
        background: '#1e1e2e',
        color: '#cdd6f4',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        data-testid="sidebar-shell"
        style={{
          width: sidebarCollapsed ? `${SIDEBAR_COLLAPSED_WIDTH}px` : `${SIDEBAR_EXPANDED_WIDTH}px`,
          height: '100%',
          flexShrink: 0,
          overflow: 'hidden',
          borderRight: '1px solid #262a3b',
          background: '#171923',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 140ms ease',
        }}
      >
        {sidebarCollapsed ? (
          <div
            data-testid="sidebar-rail"
            style={{
              height: '100%',
              display: 'flex',
              justifyContent: 'center',
              paddingTop: '10px',
            }}
          >
            <button
              type="button"
              aria-label="Expand sidebar"
              data-testid="sidebar-toggle"
              onClick={() => setSidebarCollapsed(false)}
              style={{
                width: '32px',
                height: '32px',
                border: '1px solid #3b4261',
                borderRadius: '6px',
                background: '#24283b',
                color: '#89b4fa',
                cursor: 'pointer',
                fontSize: '20px',
                lineHeight: 1,
                fontWeight: 800,
              }}
            >
              ›
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                padding: '10px 10px 0',
              }}
            >
              <button
                type="button"
                aria-label="Collapse sidebar"
                data-testid="sidebar-toggle"
                onClick={() => setSidebarCollapsed(true)}
                style={{
                  width: '32px',
                  height: '32px',
                  border: '1px solid #3b4261',
                  borderRadius: '6px',
                  background: '#24283b',
                  color: '#89b4fa',
                  cursor: 'pointer',
                  fontSize: '20px',
                  lineHeight: 1,
                  fontWeight: 800,
                }}
              >
                ‹
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <SessionList
                sessions={sessions}
                currentId={currentId}
                onSelect={setCurrentId}
                onCreate={() => setShowPicker(true)}
              />
            </div>
          </>
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
        }}
      >
        {currentSession ? (
          <SessionView
            key={currentSession.id}
            session={currentSession}
            autoStart={currentSession.id === autoStartSessionId}
            onAutoStartConsumed={() => setAutoStartSessionId(null)}
            send={send}
            request={request}
            onMessage={onMessage}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#666',
            }}
          >
            Select or create a session
          </div>
        )}
      </div>
      {showPicker && (
        <DirPicker onConfirm={handleDirConfirm} onCancel={() => setShowPicker(false)} />
      )}
    </div>
  );
}
