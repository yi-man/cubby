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
const APP_HEADER_HEIGHT = 44;
const SIDEBAR_EXPANDED_WIDTH = 240;
const ICON_BUTTON_STYLE = {
  width: '32px',
  height: '32px',
  border: '1px solid #30344f',
  borderRadius: '6px',
  background: '#1d2030',
  color: '#cdd6f4',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
} as const;

type AppIconName = 'sidebar-expand' | 'sidebar-collapse' | 'fullscreen' | 'settings';

function AppIcon({ name }: { name: AppIconName }) {
  const iconTitle = {
    'sidebar-expand': 'Expand sidebar',
    'sidebar-collapse': 'Collapse sidebar',
    fullscreen: 'Toggle fullscreen',
    settings: 'Settings',
  }[name];
  const iconProps = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    role: 'img' as const,
    'aria-label': iconTitle,
    focusable: 'false',
  };

  if (name === 'sidebar-expand' || name === 'sidebar-collapse') {
    return (
      <svg {...iconProps}>
        <title>{iconTitle}</title>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
        <path d={name === 'sidebar-expand' ? 'M15 9l3 3-3 3' : 'M18 9l-3 3 3 3'} />
      </svg>
    );
  }

  if (name === 'fullscreen') {
    return (
      <svg {...iconProps}>
        <title>{iconTitle}</title>
        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
        <path d="M16 3h3a2 2 0 0 1 2 2v3" />
        <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
        <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      </svg>
    );
  }

  return (
    <svg {...iconProps}>
      <title>{iconTitle}</title>
      <path d="M4 7h16" />
      <path d="M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="17" r="2" />
    </svg>
  );
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

  const handleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void document.documentElement.requestFullscreen();
  }, []);

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
        flexDirection: 'column',
        width: '100vw',
        height: '100dvh',
        overflow: 'hidden',
        background: '#1e1e2e',
        color: '#cdd6f4',
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
          gap: '10px',
          padding: '0 10px',
          borderBottom: '1px solid #262a3b',
          background: '#11131d',
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
            color: '#89b4fa',
          }}
        >
          <AppIcon name={sidebarCollapsed ? 'sidebar-expand' : 'sidebar-collapse'} />
        </button>
        <div
          style={{
            minWidth: 0,
            display: 'flex',
            alignItems: 'baseline',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '13px', fontWeight: 800, color: '#cdd6f4' }}>Cubby</span>
          <span
            style={{
              color: '#7f849c',
              fontSize: '11px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            Claude sessions
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
          <AppIcon name="fullscreen" />
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
          <AppIcon name="settings" />
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
            borderRight: sidebarCollapsed ? 'none' : '1px solid #262a3b',
            background: '#171923',
            transition: 'width 140ms ease',
          }}
        >
          {!sidebarCollapsed && (
            <div style={{ width: `${SIDEBAR_EXPANDED_WIDTH}px`, height: '100%' }}>
              <SessionList
                sessions={sessions}
                currentId={currentId}
                onSelect={setCurrentId}
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
      </div>
      {showPicker && (
        <DirPicker onConfirm={handleDirConfirm} onCancel={() => setShowPicker(false)} />
      )}
    </div>
  );
}
