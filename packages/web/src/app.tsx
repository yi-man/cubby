import {
  SESSION_STATUS,
  type Session,
  type SessionStatus,
  type WSEvent,
  type WSResponse,
} from '@cubby/core';
import { useAtom } from 'jotai';
import { Maximize2, PanelLeft, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { currentSessionIdAtom, sessionsAtom } from './atoms/session.js';
import { SessionList } from './components/session/session-list.js';
import { SessionView } from './components/session/session-view.js';
import { DirPicker } from './components/workspace/dir-picker.js';
import { useWebSocket } from './hooks/use-ws.js';

const SIDEBAR_STATE_STORAGE_KEY = 'cubby.sidebarCollapsed';
const SIDEBAR_WIDTH_STORAGE_KEY = 'cubby.sidebarWidth';
const CURRENT_SESSION_ID_STORAGE_KEY = 'cubby.currentSessionId';
const MOBILE_MEDIA_QUERY = '(max-width: 767px)';
const APP_HEADER_HEIGHT = 52;
const DEFAULT_DESKTOP_SIDEBAR_WIDTH = 240;
const MIN_DESKTOP_SIDEBAR_WIDTH = 200;
const MAX_DESKTOP_SIDEBAR_WIDTH = 420;
const MOBILE_SIDEBAR_WIDTH = 340;
const PROMPT_COMPLETION_QUIET_MS = 2500;
const ICON_BUTTON_STYLE = {
  width: '34px',
  height: '34px',
  borderRadius: '7px',
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

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

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

function clampDesktopSidebarWidth(width: number): number {
  return Math.min(MAX_DESKTOP_SIDEBAR_WIDTH, Math.max(MIN_DESKTOP_SIDEBAR_WIDTH, width));
}

function initialDesktopSidebarWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_DESKTOP_SIDEBAR_WIDTH;
  const storedValue = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (storedValue === null) return DEFAULT_DESKTOP_SIDEBAR_WIDTH;
  const stored = Number(storedValue);
  if (!Number.isFinite(stored)) return DEFAULT_DESKTOP_SIDEBAR_WIDTH;
  return clampDesktopSidebarWidth(stored);
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQueryList.matches);
    handleChange();
    mediaQueryList.addEventListener('change', handleChange);
    return () => mediaQueryList.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
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

function isSessionIdData(value: unknown): value is { sessionId: string } {
  return isRecord(value) && typeof value.sessionId === 'string';
}

function isTerminalOutputEventData(value: unknown): value is { sessionId: string } {
  return isRecord(value) && typeof value.sessionId === 'string';
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

function playSessionFinishedSound(): void {
  try {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    let closed = false;
    const closeContext = () => {
      if (closed) return;
      closed = true;
      void context.close().catch(() => {});
    };

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, now);
    oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
    oscillator.onended = closeContext;
    window.setTimeout(closeContext, 600);
  } catch {
    // Autoplay or audio device failures should never affect session handling.
  }
}

function canUseBrowserNotifications(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
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
  const [desktopSidebarWidth, setDesktopSidebarWidth] = useState(initialDesktopSidebarWidth);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [mountedSessionIds, setMountedSessionIds] = useState<Set<string>>(() => new Set());
  const [executingSessionIds, setExecutingSessionIds] = useState<Set<string>>(() => new Set());
  const [completedPromptSessionIds, setCompletedPromptSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const currentIdRef = useRef(currentId);
  const sessionByIdRef = useRef<Map<string, Session>>(new Map());
  const previousSessionStatusesRef = useRef<Map<string, SessionStatus> | null>(null);
  const notificationPermissionRequestRef = useRef<Promise<NotificationPermission> | null>(null);
  const promptActivityRef = useRef<Map<string, { generation: number; outputSeen: boolean }>>(
    new Map(),
  );
  const promptCompletionTimersRef = useRef<Map<string, number>>(new Map());
  const mobileLayout = useMediaQuery(MOBILE_MEDIA_QUERY);
  const sidebarWidth = sidebarCollapsed
    ? '0px'
    : mobileLayout
      ? `min(${MOBILE_SIDEBAR_WIDTH}px, calc(100vw - 48px))`
      : `${desktopSidebarWidth}px`;

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

  useEffect(() => {
    currentIdRef.current = currentId;
  }, [currentId]);

  useEffect(() => {
    sessionByIdRef.current = sessionById;
  }, [sessionById]);

  const clearPromptCompletionNotice = useCallback((sessionId: string) => {
    setCompletedPromptSessionIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  const requestPromptNotificationPermission =
    useCallback((): Promise<NotificationPermission> | null => {
      if (!canUseBrowserNotifications()) return null;
      if (window.Notification.permission === 'granted') return Promise.resolve('granted');
      if (window.Notification.permission !== 'default') {
        return Promise.resolve(window.Notification.permission);
      }

      const existing = notificationPermissionRequestRef.current;
      if (existing) return existing;

      const request = window.Notification.requestPermission()
        .catch(() => 'denied' as NotificationPermission)
        .finally(() => {
          notificationPermissionRequestRef.current = null;
        });
      notificationPermissionRequestRef.current = request;
      return request;
    }, []);

  const showPromptCompletionNotification = useCallback(
    (sessionId: string): boolean => {
      if (!canUseBrowserNotifications() || window.Notification.permission !== 'granted') {
        return false;
      }

      try {
        const session = sessionByIdRef.current.get(sessionId) ?? null;
        const notification = new window.Notification('Cubby prompt done', {
          body: `${sessionTitle(session)} finished running.`,
          tag: `cubby-prompt-${sessionId}`,
        });
        notification.onclick = () => {
          window.focus();
          currentIdRef.current = sessionId;
          setCurrentId(sessionId);
          persistCurrentSessionId(sessionId);
          clearPromptCompletionNotice(sessionId);
          notification.close();
        };
        return true;
      } catch {
        // Browser notification failures should not affect session handling.
        return false;
      }
    },
    [clearPromptCompletionNotice, setCurrentId],
  );

  const clearPromptActivity = useCallback((sessionId: string) => {
    const timer = promptCompletionTimersRef.current.get(sessionId);
    if (timer !== undefined) window.clearTimeout(timer);
    promptCompletionTimersRef.current.delete(sessionId);
    promptActivityRef.current.delete(sessionId);
    setExecutingSessionIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  const completePromptActivity = useCallback(
    (sessionId: string, generation: number) => {
      const activity = promptActivityRef.current.get(sessionId);
      if (!activity || activity.generation !== generation || !activity.outputSeen) return;
      clearPromptActivity(sessionId);
      if (currentIdRef.current !== sessionId || document.visibilityState !== 'visible') {
        setCompletedPromptSessionIds((prev) => {
          if (prev.has(sessionId)) return prev;
          const next = new Set(prev);
          next.add(sessionId);
          return next;
        });
      }
      playSessionFinishedSound();
      const notificationShown = showPromptCompletionNotification(sessionId);
      const pendingPermissionRequest = notificationPermissionRequestRef.current;
      if (!notificationShown && pendingPermissionRequest) {
        void pendingPermissionRequest.then((permission) => {
          if (permission === 'granted') showPromptCompletionNotification(sessionId);
        });
      }
    },
    [clearPromptActivity, showPromptCompletionNotification],
  );

  const handlePromptSubmitted = useCallback(
    (sessionId: string) => {
      const current = promptActivityRef.current.get(sessionId);
      const generation = (current?.generation ?? 0) + 1;
      clearPromptCompletionNotice(sessionId);
      void requestPromptNotificationPermission();
      promptActivityRef.current.set(sessionId, { generation, outputSeen: false });
      const timer = promptCompletionTimersRef.current.get(sessionId);
      if (timer !== undefined) window.clearTimeout(timer);
      promptCompletionTimersRef.current.delete(sessionId);
      setExecutingSessionIds((prev) => {
        if (prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.add(sessionId);
        return next;
      });
    },
    [clearPromptCompletionNotice, requestPromptNotificationPermission],
  );

  const handlePromptOutput = useCallback(
    (sessionId: string) => {
      const activity = promptActivityRef.current.get(sessionId);
      if (!activity) return;
      activity.outputSeen = true;
      const timer = promptCompletionTimersRef.current.get(sessionId);
      if (timer !== undefined) window.clearTimeout(timer);
      const nextTimer = window.setTimeout(
        () => completePromptActivity(sessionId, activity.generation),
        PROMPT_COMPLETION_QUIET_MS,
      );
      promptCompletionTimersRef.current.set(sessionId, nextTimer);
    },
    [completePromptActivity],
  );

  useEffect(() => {
    return () => {
      for (const timer of promptCompletionTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      promptCompletionTimersRef.current.clear();
      promptActivityRef.current.clear();
    };
  }, []);

  const applySessionDeleted = useCallback(
    (sessionId: string) => {
      setSessions((prev) => {
        const nextSessions = prev.filter((session) => session.id !== sessionId);
        if (currentIdRef.current === sessionId) {
          const nextId = preferredSessionId(nextSessions);
          currentIdRef.current = nextId;
          setCurrentId(nextId);
          persistCurrentSessionId(nextId);
        }
        return nextSessions.length === prev.length ? prev : nextSessions;
      });
      setPendingSession((pending) => (pending?.id === sessionId ? null : pending));
      setMountedSessionIds((prev) => {
        if (!prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
      clearPromptActivity(sessionId);
      clearPromptCompletionNotice(sessionId);
    },
    [clearPromptActivity, clearPromptCompletionNotice, setCurrentId, setSessions],
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

  useEffect(() => {
    const currentStatuses = new Map<string, SessionStatus>();
    for (const session of sessions) currentStatuses.set(session.id, session.status);
    if (pendingSession) currentStatuses.set(pendingSession.id, pendingSession.status);

    const previousStatuses = previousSessionStatusesRef.current;
    if (!previousStatuses) {
      previousSessionStatusesRef.current = currentStatuses;
      return;
    }

    for (const [sessionId, status] of currentStatuses) {
      const previousStatus = previousStatuses.get(sessionId);
      if (status === 'ended' && (previousStatus === 'starting' || previousStatus === 'running')) {
        playSessionFinishedSound();
      }
    }
    previousSessionStatusesRef.current = currentStatuses;
  }, [pendingSession, sessions]);

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
          clearPromptActivity(msg.data.sessionId);
          clearPromptCompletionNotice(msg.data.sessionId);
          send({ id: 'init', cmd: 'session.list' });
        }
      }
      if ('evt' in msg && msg.evt === 'session.updated' && isSession(msg.data)) {
        setSessions((prev) => prev.map((s) => (s.id === msg.data.id ? msg.data : s)));
        setPendingSession((pending) => (pending?.id === msg.data.id ? msg.data : pending));
        send({ id: 'init', cmd: 'session.list' });
      }
      if ('evt' in msg && msg.evt === 'session.deleted' && isSessionIdData(msg.data)) {
        applySessionDeleted(msg.data.sessionId);
      }
      if ('evt' in msg && msg.evt === 'terminal.output' && isTerminalOutputEventData(msg.data)) {
        handlePromptOutput(msg.data.sessionId);
      }
    });
  }, [
    onMessage,
    setSessions,
    setCurrentId,
    send,
    pendingSession,
    currentId,
    applySessionDeleted,
    clearPromptActivity,
    clearPromptCompletionNotice,
    handlePromptOutput,
  ]);

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
    if (!currentId || document.visibilityState !== 'visible') return;
    clearPromptCompletionNotice(currentId);
  }, [clearPromptCompletionNotice, currentId]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!currentIdRef.current || document.visibilityState !== 'visible') return;
      clearPromptCompletionNotice(currentIdRef.current);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [clearPromptCompletionNotice]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STATE_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(desktopSidebarWidth));
  }, [desktopSidebarWidth]);

  useEffect(() => {
    if (!resizingSidebar) return;

    document.body.classList.add('sidebar-resizing');
    const handlePointerMove = (event: PointerEvent) => {
      setDesktopSidebarWidth(clampDesktopSidebarWidth(event.clientX));
    };
    const handlePointerUp = () => {
      setResizingSidebar(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      document.body.classList.remove('sidebar-resizing');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [resizingSidebar]);

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
      if (mobileLayout) setSidebarCollapsed(true);
    },
    [request, setCurrentId, mobileLayout],
  );

  const handleSelectSession = useCallback(
    (id: string) => {
      currentIdRef.current = id;
      setCurrentId(id);
      persistCurrentSessionId(id);
      clearPromptCompletionNotice(id);
      setTerminalFocusRequest((request) => request + 1);
      if (mobileLayout) setSidebarCollapsed(true);
    },
    [clearPromptCompletionNotice, setCurrentId, mobileLayout],
  );

  const handleRenameSession = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      try {
        const response = await request({
          id: `rename-${Date.now()}`,
          cmd: 'session.rename',
          args: { sessionId: id, title },
        });
        if (!response.ok || !isSession(response.data)) return false;
        const session = response.data;
        setSessions((prev) => prev.map((item) => (item.id === session.id ? session : item)));
        setPendingSession((pending) => (pending?.id === session.id ? session : pending));
        return true;
      } catch {
        return false;
      }
    },
    [request, setSessions],
  );

  const handleDeleteSession = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const response = await request({
          id: `delete-${Date.now()}`,
          cmd: 'session.delete',
          args: { sessionId: id },
        });
        if (!response.ok || !isSessionIdData(response.data)) return false;
        applySessionDeleted(response.data.sessionId);
        return true;
      } catch {
        return false;
      }
    },
    [applySessionDeleted, request],
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
        color: '#ffffff',
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
          borderBottom: `1px solid ${APP_BORDER}`,
          background: 'linear-gradient(180deg, #080a09 0%, #050606 100%)',
          position: 'relative',
        }}
      >
        <button
          type="button"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={!sidebarCollapsed}
          className={`header-icon-button sidebar-toggle-button ${
            sidebarCollapsed ? 'is-collapsed' : 'is-expanded'
          }`}
          data-testid="sidebar-toggle"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          style={ICON_BUTTON_STYLE}
        >
          <PanelLeft {...HEADER_ICON_PROPS} />
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
          className="header-icon-button"
          title="Toggle fullscreen"
          onClick={handleFullscreen}
          style={ICON_BUTTON_STYLE}
        >
          <Maximize2 {...HEADER_ICON_PROPS} />
        </button>
        <button
          type="button"
          aria-label="Settings"
          className="header-icon-button"
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
          position: 'relative',
        }}
      >
        {mobileLayout && !sidebarCollapsed && (
          <button
            type="button"
            aria-label="Close sidebar"
            data-testid="mobile-sidebar-scrim"
            onClick={() => setSidebarCollapsed(true)}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: sidebarWidth,
              zIndex: 3,
              border: 0,
              padding: 0,
              background: 'rgba(0, 0, 0, 0.56)',
              cursor: 'pointer',
            }}
          />
        )}
        <div
          data-testid="sidebar-shell"
          style={{
            width: sidebarWidth,
            height: '100%',
            flexShrink: 0,
            overflow: 'hidden',
            borderRight: sidebarCollapsed ? 'none' : `1px solid ${APP_BORDER}`,
            background: APP_PANEL,
            transition: resizingSidebar ? 'none' : 'width 140ms ease',
            position: mobileLayout ? 'absolute' : 'relative',
            top: mobileLayout ? 0 : undefined,
            bottom: mobileLayout ? 0 : undefined,
            left: mobileLayout ? 0 : undefined,
            zIndex: mobileLayout ? 4 : undefined,
            boxShadow:
              mobileLayout && !sidebarCollapsed ? '18px 0 32px rgba(0, 0, 0, 0.38)' : undefined,
          }}
        >
          {!sidebarCollapsed && (
            <div style={{ width: sidebarWidth, height: '100%' }}>
              <SessionList
                sessions={sessions}
                currentId={currentId}
                searchQuery={sessionSearchQuery}
                onSearchQueryChange={setSessionSearchQuery}
                onSelect={handleSelectSession}
                onCreate={() => setShowPicker(true)}
                onRename={handleRenameSession}
                onDelete={handleDeleteSession}
                executingSessionIds={executingSessionIds}
                completedPromptSessionIds={completedPromptSessionIds}
              />
            </div>
          )}
        </div>
        {!sidebarCollapsed && !mobileLayout && (
          <hr
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-valuemin={MIN_DESKTOP_SIDEBAR_WIDTH}
            aria-valuemax={MAX_DESKTOP_SIDEBAR_WIDTH}
            aria-valuenow={desktopSidebarWidth}
            tabIndex={0}
            className={`sidebar-resize-handle ${resizingSidebar ? 'is-dragging' : ''}`}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                setDesktopSidebarWidth((width) => clampDesktopSidebarWidth(width - 16));
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                setDesktopSidebarWidth((width) => clampDesktopSidebarWidth(width + 16));
              } else if (event.key === 'Home') {
                event.preventDefault();
                setDesktopSidebarWidth(MIN_DESKTOP_SIDEBAR_WIDTH);
              } else if (event.key === 'End') {
                event.preventDefault();
                setDesktopSidebarWidth(MAX_DESKTOP_SIDEBAR_WIDTH);
              }
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              setResizingSidebar(true);
            }}
          />
        )}
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
              const executing = executingSessionIds.has(session.id) && isLiveSession(session);
              return (
                <SessionView
                  key={session.id}
                  session={session}
                  active={active}
                  executing={executing}
                  autoStart={active && session.id === autoStartSessionId}
                  focusRequest={terminalFocusRequest}
                  onAutoStartConsumed={() => setAutoStartSessionId(null)}
                  onPromptSubmitted={handlePromptSubmitted}
                  send={send}
                  request={request}
                  onMessage={onMessage}
                />
              );
            })
          ) : (
            <div
              style={{
                flex: 1,
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                padding: mobileLayout ? '24px' : 'clamp(32px, 5vw, 64px)',
                color: '#777773',
                background:
                  'radial-gradient(circle at 50% 42%, rgba(34, 200, 242, 0.06), transparent 34%), #050606',
              }}
            >
              <div
                style={{
                  width: '100%',
                  minHeight: mobileLayout ? '180px' : '260px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px dashed #242826',
                  borderRadius: '8px',
                  background: 'rgba(11, 12, 12, 0.52)',
                  color: '#8f928b',
                  fontSize: '13px',
                  fontWeight: 600,
                  textAlign: 'center',
                }}
              >
                Select or create a session
              </div>
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
