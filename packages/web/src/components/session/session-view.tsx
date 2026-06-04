import type { Session, TerminalOutputChunk, WSEvent, WSResponse } from '@cubby/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type TerminalHandle, TerminalView } from '../terminal/terminal.js';
import {
  filterRenderableLiveChunks,
  isRecoveryReconcileData,
  isTerminalOutputData,
  isTerminalReplayData,
} from './terminal-recovery.js';
import { sanitizeEndedReplayChunks } from './terminal-replay.js';

interface SessionViewProps {
  session: Session;
  autoStart?: boolean;
  focusRequest?: number;
  onAutoStartConsumed?: () => void;
  send: (req: { id: string; cmd: string; args?: Record<string, unknown> }) => void;
  request: (req: {
    id: string;
    cmd: string;
    args?: Record<string, unknown>;
  }) => Promise<{ ok: boolean; data?: unknown }>;
  onMessage: (handler: (msg: WSResponse | WSEvent) => void) => () => void;
}

function isLiveStatus(status: Session['status']): boolean {
  return status === 'starting' || status === 'running';
}

function statusColor(status: Session['status']): string {
  if (status === 'running' || status === 'starting') return '#8fbf73';
  if (status === 'ended') return '#8d8d87';
  return '#c78a7c';
}

interface ReplayState {
  loaded: boolean;
  hasHistory: boolean;
}

function emptyReplayState(): ReplayState {
  return { loaded: false, hasHistory: false };
}

function EmptyEndedHistory() {
  return (
    <div
      data-testid="empty-terminal-history"
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: 'linear-gradient(180deg, rgba(13, 15, 14, 0.98) 0%, rgba(5, 6, 6, 1) 100%)',
        color: '#8d8d87',
        textAlign: 'center',
      }}
    >
      <div>
        <div style={{ color: '#dedbd2', fontSize: '14px', fontWeight: 700 }}>
          No terminal history captured
        </div>
        <div style={{ marginTop: '6px', fontSize: '12px' }}>Session ended</div>
      </div>
    </div>
  );
}

export function SessionView({
  session,
  autoStart = false,
  focusRequest = 0,
  onAutoStartConsumed,
  send,
  request,
  onMessage,
}: SessionViewProps) {
  const termRef = useRef<TerminalHandle>(null);
  const terminalSizeRef = useRef({ cols: 80, rows: 24 });
  const replayGenerationRef = useRef(0);
  const renderedSeqRef = useRef(0);
  const pendingLiveChunksRef = useRef<TerminalOutputChunk[]>([]);
  const recoveringRef = useRef(false);
  const initialRecoveryDoneRef = useRef(false);
  const recoveryBlockedRef = useRef(false);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const lastFocusRequestRef = useRef(focusRequest);
  const [terminalReady, setTerminalReady] = useState(false);
  const [replayState, setReplayState] = useState<ReplayState>(() => emptyReplayState());
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryRequest, setRecoveryRequest] = useState(0);
  const live = isLiveStatus(session.status);
  const canReplayHistory = terminalReady && (live || session.status === 'ended');

  const writeChunkForGeneration = useCallback(
    async (chunk: TerminalOutputChunk, generation: number) => {
      if (replayGenerationRef.current !== generation || recoveryBlockedRef.current) return false;
      await termRef.current?.writeAsync(chunk.data);
      if (replayGenerationRef.current !== generation || recoveryBlockedRef.current) return false;
      renderedSeqRef.current = Math.max(renderedSeqRef.current, chunk.seq);
      return true;
    },
    [],
  );

  const writeStringForGeneration = useCallback(async (data: string, generation: number) => {
    if (replayGenerationRef.current !== generation) return false;
    await termRef.current?.writeAsync(data);
    return replayGenerationRef.current === generation;
  }, []);

  const flushPendingLiveChunks = useCallback(
    async (generation: number) => {
      const chunks = filterRenderableLiveChunks(
        pendingLiveChunksRef.current,
        renderedSeqRef.current,
      ).sort((left, right) => left.seqStart - right.seqStart);
      pendingLiveChunksRef.current = [];

      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        if (chunk.seqStart > renderedSeqRef.current) {
          pendingLiveChunksRef.current = chunks.slice(index);
          return false;
        }
        const written = await writeChunkForGeneration(chunk, generation);
        if (!written) {
          pendingLiveChunksRef.current = chunks.slice(index);
          return false;
        }
      }

      return true;
    },
    [writeChunkForGeneration],
  );

  const blockRecovery = useCallback((message: string) => {
    const blockGeneration = replayGenerationRef.current + 1;
    replayGenerationRef.current = blockGeneration;
    recoveryBlockedRef.current = true;
    recoveringRef.current = false;
    initialRecoveryDoneRef.current = false;
    pendingLiveChunksRef.current = [];
    setRecoveryError(message);
    setReplayState({ loaded: true, hasHistory: false });
    const resetAfterWrites = writeChainRef.current
      .catch(() => {})
      .then(() => {
        if (!recoveryBlockedRef.current || replayGenerationRef.current !== blockGeneration) return;
        termRef.current?.reset();
      });
    writeChainRef.current = resetAfterWrites;
  }, []);

  const queueLiveChunk = useCallback(
    (chunk: TerminalOutputChunk) => {
      const generation = replayGenerationRef.current;
      writeChainRef.current = writeChainRef.current.then(async () => {
        if (replayGenerationRef.current !== generation) return;
        if (recoveryBlockedRef.current) return;
        if (!initialRecoveryDoneRef.current || recoveringRef.current) {
          pendingLiveChunksRef.current.push(chunk);
          return;
        }
        if (chunk.seqStart > renderedSeqRef.current) {
          pendingLiveChunksRef.current.push(chunk);
          setRecoveryRequest((request) => request + 1);
          return;
        }
        if (chunk.seq > renderedSeqRef.current) {
          const written = await writeChunkForGeneration(chunk, generation);
          if (!written) return;
          setReplayState((prev) => (prev.hasHistory ? prev : { loaded: true, hasHistory: true }));
        }
      });
    },
    [writeChunkForGeneration],
  );

  // Subscribe to terminal output events
  useEffect(() => {
    const unsub = onMessage((msg) => {
      if (!live) return;
      if (
        'evt' in msg &&
        msg.evt === 'terminal.output' &&
        isTerminalOutputData(msg.data, session.id)
      ) {
        const chunk = msg.data;
        if (recoveryBlockedRef.current) return;
        if (!initialRecoveryDoneRef.current || recoveringRef.current) {
          pendingLiveChunksRef.current.push(chunk);
          return;
        }
        queueLiveChunk(chunk);
      }
    });
    return unsub;
  }, [session.id, live, onMessage, queueLiveChunk]);

  useEffect(() => {
    if (!canReplayHistory) return;
    let cancelled = false;
    if (live && recoveryBlockedRef.current) return;
    replayGenerationRef.current += 1;
    const replayGeneration = replayGenerationRef.current;

    if (live) {
      recoveringRef.current = true;
      initialRecoveryDoneRef.current = false;
      setRecoveryError(null);

      request({
        id: `reconcile-${session.id}-${recoveryRequest}-${Date.now()}`,
        cmd: 'recovery.reconcile',
        args: { sessionId: session.id, renderedSeq: renderedSeqRef.current },
      })
        .then(async (res) => {
          if (cancelled || replayGenerationRef.current !== replayGeneration) return;
          if (!res.ok || !isRecoveryReconcileData(res.data, session.id)) {
            blockRecovery('Terminal recovery check failed');
            return;
          }

          if (res.data.action === 'unrecoverable') {
            blockRecovery('Terminal history is no longer available');
            return;
          }

          if (res.data.action === 'noop' || res.data.action === 'closed') {
            const flushed = await flushPendingLiveChunks(replayGeneration);
            if (cancelled || replayGenerationRef.current !== replayGeneration) return;
            if (!flushed) setRecoveryRequest((request) => request + 1);
            setReplayState((prev) => ({
              loaded: true,
              hasHistory: prev.hasHistory,
            }));
            return;
          }

          const replayRes = await request({
            id: `replay-${session.id}-${session.status}-${Date.now()}`,
            cmd: 'terminal.replay',
            args: { sessionId: session.id, lastSeq: res.data.fromSeq },
          });
          if (cancelled || replayGenerationRef.current !== replayGeneration) return;
          if (!replayRes.ok || !isTerminalReplayData(replayRes.data, session.id)) {
            blockRecovery('Terminal replay failed');
            return;
          }

          if (replayRes.data.status === 'too_old' || replayRes.data.status === 'unknown') {
            blockRecovery('Terminal history is no longer available');
            return;
          }

          const replayChunks = replayRes.data.chunks.filter(
            (chunk) => chunk.seq > renderedSeqRef.current,
          );
          for (const chunk of replayChunks) {
            if (cancelled || replayGenerationRef.current !== replayGeneration) return;
            const written = await writeChunkForGeneration(chunk, replayGeneration);
            if (!written) return;
          }
          const flushed = await flushPendingLiveChunks(replayGeneration);
          if (cancelled || replayGenerationRef.current !== replayGeneration) return;
          if (!flushed) setRecoveryRequest((request) => request + 1);
          setReplayState((prev) => ({
            loaded: true,
            hasHistory: prev.hasHistory || replayChunks.some((chunk) => chunk.data.length > 0),
          }));
        })
        .catch(() => {
          if (!cancelled && replayGenerationRef.current === replayGeneration) {
            blockRecovery('Terminal recovery check failed');
          }
        })
        .finally(() => {
          if (cancelled || replayGenerationRef.current !== replayGeneration) return;
          recoveringRef.current = false;
          initialRecoveryDoneRef.current = true;
        });

      return () => {
        cancelled = true;
      };
    }

    setRecoveryError(null);
    termRef.current?.reset();
    setReplayState(emptyReplayState());

    request({
      id: `replay-${session.id}-${session.status}-${Date.now()}`,
      cmd: 'terminal.replay',
      args: { sessionId: session.id },
    })
      .then(async (res) => {
        if (cancelled || replayGenerationRef.current !== replayGeneration) return;
        if (!res.ok || !isTerminalReplayData(res.data, session.id) || res.data.status !== 'ok') {
          setReplayState({ loaded: true, hasHistory: false });
          return;
        }
        const replayChunks = sanitizeEndedReplayChunks(res.data.chunks.map((chunk) => chunk.data));
        for (const chunk of replayChunks) {
          if (cancelled || replayGenerationRef.current !== replayGeneration) return;
          const written = await writeStringForGeneration(chunk, replayGeneration);
          if (!written) return;
        }
        if (cancelled || replayGenerationRef.current !== replayGeneration) return;
        termRef.current?.scrollToBottom();
        setReplayState({
          loaded: true,
          hasHistory: replayChunks.some((chunk) => chunk.length > 0),
        });
      })
      .catch(() => {
        if (!cancelled) setReplayState({ loaded: true, hasHistory: false });
      });

    return () => {
      cancelled = true;
    };
  }, [
    request,
    session.id,
    session.status,
    canReplayHistory,
    live,
    recoveryRequest,
    flushPendingLiveChunks,
    writeChunkForGeneration,
    writeStringForGeneration,
    blockRecovery,
  ]);

  useEffect(() => {
    if (!live) return;

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
  }, [send, session.id, live]);

  useEffect(() => {
    const focusRequested = focusRequest !== lastFocusRequestRef.current;
    lastFocusRequestRef.current = focusRequest;
    if (!focusRequested) return;
    if (!terminalReady || !live) return;
    termRef.current?.focus();
  }, [focusRequest, live, terminalReady]);

  const startSession = useCallback(async () => {
    replayGenerationRef.current += 1;
    renderedSeqRef.current = 0;
    pendingLiveChunksRef.current = [];
    recoveringRef.current = false;
    initialRecoveryDoneRef.current = false;
    recoveryBlockedRef.current = false;
    writeChainRef.current = Promise.resolve();
    setRecoveryError(null);
    const { cols, rows } = terminalSizeRef.current;
    const res = await request({
      id: `start-${Date.now()}`,
      cmd: 'session.start',
      args: { sessionId: session.id, cwd: session.workspaceId, cols, rows },
    });
    if (!res.ok) return;
    termRef.current?.focus();
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
    replayGenerationRef.current += 1;
    renderedSeqRef.current = 0;
    pendingLiveChunksRef.current = [];
    recoveringRef.current = false;
    initialRecoveryDoneRef.current = false;
    recoveryBlockedRef.current = false;
    writeChainRef.current = Promise.resolve();
    setRecoveryError(null);
    const { cols, rows } = terminalSizeRef.current;
    termRef.current?.reset();
    setReplayState({ loaded: true, hasHistory: true });
    const res = await request({
      id: `resume-${Date.now()}`,
      cmd: 'session.resume',
      args: { sessionId: session.id, cwd: session.workspaceId, cols, rows },
    });
    if (!res.ok) return;
    termRef.current?.focus();
  }, [session.id, session.workspaceId, request]);

  const handleData = useCallback(
    (data: string) => {
      if (!live) return;
      send({
        id: `input-${Date.now()}`,
        cmd: 'terminal.input',
        args: { sessionId: session.id, data },
      });
    },
    [session.id, live, send],
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      terminalSizeRef.current = { cols, rows };
      if (!live) return;
      send({
        id: `resize-${Date.now()}`,
        cmd: 'terminal.resize',
        args: { sessionId: session.id, cols, rows },
      });
    },
    [session.id, live, send],
  );

  const showEmptyEndedHistory =
    session.status === 'ended' && replayState.loaded && !replayState.hasHistory;
  const showRecoveryError = live && recoveryError !== null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        background: '#050606',
      }}
    >
      <div
        style={{
          minHeight: '38px',
          padding: '0 14px 0 24px',
          borderBottom: '1px solid #1d1d1d',
          background: '#050606',
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
        }}
      >
        <span
          data-testid="session-title"
          style={{
            minWidth: 0,
            maxWidth: '38vw',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: '#d8d6cf',
            fontSize: '13px',
            fontWeight: 650,
          }}
        >
          {session.title ?? session.provider}
        </span>
        <span
          data-testid="session-status"
          style={{
            color: statusColor(session.status),
            fontSize: '11px',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {session.status}
        </span>
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: '#6f6f6a',
            fontSize: '11px',
          }}
        >
          {session.workspaceId}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
          {session.status === 'draft' && (
            <button
              type="button"
              onClick={startSession}
              style={{
                padding: '5px 12px',
                border: '1px solid #2d3b29',
                borderRadius: '6px',
                background: '#172114',
                color: '#cfe5c4',
                cursor: 'pointer',
                fontWeight: 650,
              }}
            >
              Start
            </button>
          )}
          {(session.status === 'running' || session.status === 'starting') && (
            <button
              type="button"
              onClick={handleStop}
              style={{
                padding: '5px 12px',
                border: '1px solid #4a2b29',
                borderRadius: '6px',
                background: '#2a1514',
                color: '#f0c1b8',
                cursor: 'pointer',
                fontWeight: 650,
              }}
            >
              Stop
            </button>
          )}
          {session.status === 'ended' && (
            <button
              type="button"
              onClick={handleResume}
              style={{
                padding: '5px 12px',
                border: '1px solid #303030',
                borderRadius: '6px',
                background: '#171717',
                color: '#dedbd2',
                cursor: 'pointer',
                fontWeight: 650,
              }}
            >
              Resume
            </button>
          )}
        </div>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
          background: '#050606',
        }}
      >
        <TerminalView
          ref={termRef}
          interactive={live}
          onData={handleData}
          onResize={handleResize}
          onReady={() => setTerminalReady(true)}
        />
        {showEmptyEndedHistory && <EmptyEndedHistory />}
        {showRecoveryError && (
          <div
            data-testid="terminal-recovery-error"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              background: 'rgba(5, 6, 6, 0.92)',
              color: '#dedbd2',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700 }}>{recoveryError}</div>
              <div style={{ marginTop: '6px', fontSize: '12px', color: '#8d8d87' }}>
                Terminal output cannot be safely replayed.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
