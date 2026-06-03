import type { Session, WSEvent, WSResponse } from '@cubby/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type TerminalHandle, TerminalView } from '../terminal/terminal.js';

interface SessionViewProps {
  session: Session;
  autoStart?: boolean;
  onAutoStartConsumed?: () => void;
  send: (req: { id: string; cmd: string; args?: Record<string, unknown> }) => void;
  request: (req: {
    id: string;
    cmd: string;
    args?: Record<string, unknown>;
  }) => Promise<{ ok: boolean; data?: unknown }>;
  onMessage: (handler: (msg: WSResponse | WSEvent) => void) => () => void;
}

function isTerminalOutputData(
  value: unknown,
  sessionId: string,
): value is { sessionId: string; data: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sessionId' in value &&
    'data' in value &&
    value.sessionId === sessionId &&
    typeof value.data === 'string'
  );
}

function isTerminalReplayData(
  value: unknown,
  sessionId: string,
): value is { sessionId: string; chunks: string[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sessionId' in value &&
    'chunks' in value &&
    value.sessionId === sessionId &&
    Array.isArray(value.chunks) &&
    value.chunks.every((chunk) => typeof chunk === 'string')
  );
}

function isLiveStatus(status: Session['status']): boolean {
  return status === 'starting' || status === 'running';
}

export function SessionView({
  session,
  autoStart = false,
  onAutoStartConsumed,
  send,
  request,
  onMessage,
}: SessionViewProps) {
  const termRef = useRef<TerminalHandle>(null);
  const terminalSizeRef = useRef({ cols: 80, rows: 24 });
  const [terminalReady, setTerminalReady] = useState(false);
  const [replayState, setReplayState] = useState({ loaded: false, hasHistory: false });

  // Subscribe to terminal output events
  useEffect(() => {
    const unsub = onMessage((msg) => {
      if (
        'evt' in msg &&
        msg.evt === 'terminal.output' &&
        isTerminalOutputData(msg.data, session.id)
      ) {
        termRef.current?.write(msg.data.data);
        setReplayState((prev) => (prev.hasHistory ? prev : { loaded: true, hasHistory: true }));
      }
    });
    return unsub;
  }, [session.id, onMessage]);

  useEffect(() => {
    if (!terminalReady) return;
    let cancelled = false;
    setReplayState({ loaded: false, hasHistory: false });

    request({
      id: `replay-${session.id}-${Date.now()}`,
      cmd: 'terminal.replay',
      args: { sessionId: session.id },
    })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !isTerminalReplayData(res.data, session.id)) {
          setReplayState({ loaded: true, hasHistory: false });
          return;
        }
        for (const chunk of res.data.chunks) {
          termRef.current?.write(chunk);
        }
        setReplayState({ loaded: true, hasHistory: res.data.chunks.length > 0 });
      })
      .catch(() => {
        if (!cancelled) setReplayState({ loaded: true, hasHistory: false });
      });

    return () => {
      cancelled = true;
    };
  }, [request, session.id, terminalReady]);

  useEffect(() => {
    if (!isLiveStatus(session.status)) return;

    send({
      id: `sub-${session.id}-${Date.now()}`,
      cmd: 'terminal.subscribe',
      args: { sessionId: session.id },
    });

    return () => {
      send({
        id: `unsub-${session.id}-${Date.now()}`,
        cmd: 'terminal.unsubscribe',
        args: { sessionId: session.id },
      });
    };
  }, [send, session.id, session.status]);

  const startSession = useCallback(async () => {
    const { cols, rows } = terminalSizeRef.current;
    const res = await request({
      id: `start-${Date.now()}`,
      cmd: 'session.start',
      args: { sessionId: session.id, cwd: session.workspaceId, cols, rows },
    });
    if (!res.ok) return;
  }, [session.id, session.workspaceId, request]);

  useEffect(() => {
    if (!autoStart || !terminalReady || session.status !== 'draft') return;
    onAutoStartConsumed?.();
    void startSession();
  }, [autoStart, terminalReady, session.status, startSession, onAutoStartConsumed]);

  const handleStop = useCallback(() => {
    send({ id: `kill-${Date.now()}`, cmd: 'session.kill', args: { sessionId: session.id } });
  }, [session.id, send]);

  const handleResume = useCallback(async () => {
    const { cols, rows } = terminalSizeRef.current;
    const res = await request({
      id: `resume-${Date.now()}`,
      cmd: 'session.resume',
      args: { sessionId: session.id, cwd: session.workspaceId, cols, rows },
    });
    if (!res.ok) return;
  }, [session.id, session.workspaceId, request]);

  const handleData = useCallback(
    (data: string) => {
      send({
        id: `input-${Date.now()}`,
        cmd: 'terminal.input',
        args: { sessionId: session.id, data },
      });
    },
    [session.id, send],
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      terminalSizeRef.current = { cols, rows };
      if (!isLiveStatus(session.status)) return;
      send({
        id: `resize-${Date.now()}`,
        cmd: 'terminal.resize',
        args: { sessionId: session.id, cols, rows },
      });
    },
    [session.id, session.status, send],
  );

  const showEmptyEndedHistory =
    session.status === 'ended' && replayState.loaded && !replayState.hasHistory;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '8px',
          borderBottom: '1px solid #333',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
        }}
      >
        <span data-testid="session-title" style={{ fontWeight: 'bold' }}>
          {session.title ?? session.provider}
        </span>
        <span data-testid="session-status" style={{ color: '#888', fontSize: '12px' }}>
          {session.status}
        </span>
        <span style={{ color: '#666', fontSize: '11px' }}>{session.workspaceId}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
          {session.status === 'draft' && (
            <button type="button" onClick={startSession} style={{ padding: '4px 12px' }}>
              Start
            </button>
          )}
          {(session.status === 'running' || session.status === 'starting') && (
            <button
              type="button"
              onClick={handleStop}
              style={{ padding: '4px 12px', color: 'red' }}
            >
              Stop
            </button>
          )}
          {session.status === 'ended' && (
            <button type="button" onClick={handleResume} style={{ padding: '4px 12px' }}>
              Resume
            </button>
          )}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        <TerminalView
          ref={termRef}
          onData={handleData}
          onResize={handleResize}
          onReady={() => setTerminalReady(true)}
        />
        {showEmptyEndedHistory && (
          <div
            data-testid="empty-terminal-history"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              background: '#1e1e2e',
              color: '#8b93b5',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            <div>
              <div style={{ color: '#cdd6f4', fontSize: '14px', fontWeight: 700 }}>
                No terminal history captured
              </div>
              <div style={{ marginTop: '6px', fontSize: '12px' }}>
                Resume to continue this session.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
