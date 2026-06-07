import type { Session, TerminalOutputChunk, WSEvent, WSResponse } from '@cubby/core';
import { MonitorUp } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type TerminalHandle, TerminalView } from '../terminal/terminal.js';
import {
  filterRenderableLiveChunks,
  isRecoveryReconcileData,
  isTerminalOutputData,
  isTerminalReplayData,
  isTerminalSnapshotData,
} from './terminal-recovery.js';
import { sanitizeEndedReplayChunks } from './terminal-replay.js';

interface SessionViewProps {
  session: Session;
  active?: boolean;
  executing?: boolean;
  autoStart?: boolean;
  focusRequest?: number;
  layoutSignal?: string;
  onAutoStartConsumed?: () => void;
  onPromptSubmitted?: (sessionId: string) => void;
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

function supportsResume(session: Session): boolean {
  if (session.provider === 'codex' || session.provider === 'opencode') {
    return Boolean(session.providerSessionId);
  }
  return true;
}

const VISUALLY_HIDDEN_STYLE = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

function statusTone(status: Session['status']) {
  if (status === 'running' || status === 'starting') {
    return {
      label: status === 'starting' ? 'Starting' : 'Live',
      color: '#8fbf73',
      border: '#31442d',
      background: '#111b0f',
    };
  }
  if (status === 'ended') {
    return {
      label: 'Closed',
      color: '#989890',
      border: '#363633',
      background: '#161616',
    };
  }
  return {
    label: status === 'draft' ? 'Draft' : 'Ready',
    color: '#c78a7c',
    border: '#4b2825',
    background: '#21110f',
  };
}

function collectSubmittedTerminalInput(
  buffer: string,
  data: string,
): { buffer: string; submitted: boolean } {
  let nextBuffer = buffer;
  let submitted = false;

  for (let index = 0; index < data.length; index++) {
    const char = data[index];
    if (char === '\x1b') {
      index = skipTerminalEscapeSequence(data, index) - 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (nextBuffer.trim()) submitted = true;
      nextBuffer = '';
      continue;
    }
    if (char === '\b' || char === '\x7f') {
      nextBuffer = nextBuffer.slice(0, -1);
      continue;
    }
    if (char >= ' ') nextBuffer += char;
  }

  return { buffer: nextBuffer, submitted };
}

function skipTerminalEscapeSequence(data: string, start: number): number {
  let index = start + 1;
  if (data[index] === '[') {
    index += 1;
    while (index < data.length) {
      const code = data.charCodeAt(index);
      index += 1;
      if (code >= 0x40 && code <= 0x7e) break;
    }
    return index;
  }
  return index;
}

interface ReplayState {
  loaded: boolean;
  hasHistory: boolean;
}

const ENDED_REPLAY_RESIZE_DEBOUNCE_MS = 120;
const ACTION_ICON_PROPS = { size: 14, strokeWidth: 2.1, 'aria-hidden': true } as const;

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
        <div style={{ color: '#ffffff', fontSize: '14px', fontWeight: 700 }}>
          No terminal history captured
        </div>
        <div style={{ marginTop: '6px', fontSize: '12px' }}>Session ended</div>
      </div>
    </div>
  );
}

export function SessionView({
  session,
  active = true,
  executing = false,
  autoStart = false,
  focusRequest = 0,
  layoutSignal = '',
  onAutoStartConsumed,
  onPromptSubmitted,
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
  // Recovered viewers may fit locally, but must not mutate shared PTY geometry.
  const resizeAuthorityRef = useRef(false);
  const endedReplayFitToContainerRef = useRef(false);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const lastSessionIdRef = useRef(session.id);
  const lastFocusRequestRef = useRef(focusRequest);
  const lastEndedReplayLayoutSignalRef = useRef(layoutSignal);
  const pendingInputRef = useRef('');
  const [terminalReady, setTerminalReady] = useState(false);
  const [replayState, setReplayState] = useState<ReplayState>(() => emptyReplayState());
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryRequest, setRecoveryRequest] = useState(0);
  const [endedReplayLayoutRevision, setEndedReplayLayoutRevision] = useState(0);
  const [endedReplayFitToContainer, setEndedReplayFitToContainer] = useState(false);
  const [resizeAuthority, setResizeAuthority] = useState(false);
  const live = isLiveStatus(session.status);
  const canReplayHistory = terminalReady && (live || session.status === 'ended');
  const fitTerminalToContainer =
    session.status === 'ended' ? endedReplayFitToContainer : !live || resizeAuthority;

  const setResizeAuthorityState = useCallback((nextAuthority: boolean) => {
    resizeAuthorityRef.current = nextAuthority;
    setResizeAuthority(nextAuthority);
  }, []);

  const setEndedReplayFitToContainerState = useCallback((nextFit: boolean) => {
    endedReplayFitToContainerRef.current = nextFit;
    setEndedReplayFitToContainer(nextFit);
  }, []);

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

  const enqueueWriteChunkForGeneration = useCallback(
    (chunk: TerminalOutputChunk, generation: number) => {
      const queuedWrite = writeChainRef.current
        .catch(() => {})
        .then(() => writeChunkForGeneration(chunk, generation));
      writeChainRef.current = queuedWrite.then(
        () => {},
        () => {},
      );
      return queuedWrite;
    },
    [writeChunkForGeneration],
  );

  const enqueueWriteStringForGeneration = useCallback(
    (data: string, generation: number) => {
      const queuedWrite = writeChainRef.current
        .catch(() => {})
        .then(() => writeStringForGeneration(data, generation));
      writeChainRef.current = queuedWrite.then(
        () => {},
        () => {},
      );
      return queuedWrite;
    },
    [writeStringForGeneration],
  );

  const enqueueResetForGeneration = useCallback((generation: number) => {
    const queuedReset = writeChainRef.current
      .catch(() => {})
      .then(() => {
        if (replayGenerationRef.current !== generation) return false;
        termRef.current?.reset();
        return true;
      });
    writeChainRef.current = queuedReset.then(
      () => {},
      () => {},
    );
    return queuedReset;
  }, []);

  const scrollTerminalToBottomAfterLayout = useCallback(() => {
    termRef.current?.scrollToBottom();
    window.requestAnimationFrame(() => {
      termRef.current?.scrollToBottom();
      window.requestAnimationFrame(() => {
        termRef.current?.scrollToBottom();
      });
    });
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
        const written = await enqueueWriteChunkForGeneration(chunk, generation);
        if (!written) {
          pendingLiveChunksRef.current = chunks.slice(index);
          return false;
        }
      }

      return true;
    },
    [enqueueWriteChunkForGeneration],
  );

  const blockRecovery = useCallback(
    (message: string) => {
      const blockGeneration = replayGenerationRef.current + 1;
      replayGenerationRef.current = blockGeneration;
      recoveryBlockedRef.current = true;
      recoveringRef.current = false;
      initialRecoveryDoneRef.current = false;
      pendingLiveChunksRef.current = [];
      setRecoveryError(message);
      setReplayState({ loaded: true, hasHistory: false });
      void enqueueResetForGeneration(blockGeneration);
    },
    [enqueueResetForGeneration],
  );

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

          let replayFromSeq: number;
          let restoredSnapshotHistory = false;

          if (res.data.action === 'snapshot') {
            const snapshotRes = await request({
              id: `snapshot-${session.id}-${session.status}-${Date.now()}`,
              cmd: 'terminal.snapshot',
              args: { sessionId: session.id },
            });
            if (cancelled || replayGenerationRef.current !== replayGeneration) return;
            if (!snapshotRes.ok || !isTerminalSnapshotData(snapshotRes.data, session.id)) {
              blockRecovery('Terminal snapshot failed');
              return;
            }
            if (snapshotRes.data.status !== 'ok') {
              blockRecovery('Terminal history is no longer available');
              return;
            }

            const resetDone = await enqueueResetForGeneration(replayGeneration);
            if (cancelled || replayGenerationRef.current !== replayGeneration) return;
            if (!resetDone) return;
            if (!resizeAuthorityRef.current) {
              termRef.current?.resize(snapshotRes.data.cols, snapshotRes.data.rows);
            }
            const snapshotWritten = await enqueueWriteStringForGeneration(
              snapshotRes.data.data,
              replayGeneration,
            );
            if (cancelled || replayGenerationRef.current !== replayGeneration) return;
            if (!snapshotWritten) return;
            renderedSeqRef.current = Math.max(renderedSeqRef.current, snapshotRes.data.seq);
            replayFromSeq = snapshotRes.data.seq;
            restoredSnapshotHistory = snapshotRes.data.data.length > 0;
          } else {
            replayFromSeq = res.data.fromSeq;
          }

          const replayRes = await request({
            id: `replay-${session.id}-${session.status}-${Date.now()}`,
            cmd: 'terminal.replay',
            args: { sessionId: session.id, lastSeq: replayFromSeq },
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
            const written = await enqueueWriteChunkForGeneration(chunk, replayGeneration);
            if (!written) return;
          }
          const flushed = await flushPendingLiveChunks(replayGeneration);
          if (cancelled || replayGenerationRef.current !== replayGeneration) return;
          if (!flushed) setRecoveryRequest((request) => request + 1);
          setReplayState((prev) => ({
            loaded: true,
            hasHistory:
              prev.hasHistory ||
              restoredSnapshotHistory ||
              replayChunks.some((chunk) => chunk.data.length > 0),
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
    const resetDone = enqueueResetForGeneration(replayGeneration);
    setReplayState(emptyReplayState());

    request({
      id: `replay-${session.id}-${session.status}-${endedReplayLayoutRevision}-${Date.now()}`,
      cmd: 'terminal.replay',
      args: { sessionId: session.id },
    })
      .then(async (res) => {
        if (cancelled || replayGenerationRef.current !== replayGeneration) return;
        if (!res.ok || !isTerminalReplayData(res.data, session.id) || res.data.status !== 'ok') {
          setReplayState({ loaded: true, hasHistory: false });
          return;
        }
        if (!(await resetDone)) return;
        const snapshotRes = await request({
          id: `ended-snapshot-${session.id}-${endedReplayLayoutRevision}-${Date.now()}`,
          cmd: 'terminal.snapshot',
          args: { sessionId: session.id },
        });
        if (cancelled || replayGenerationRef.current !== replayGeneration) return;
        let snapshotSize: { cols: number; rows: number } | null = null;
        if (snapshotRes.ok && isTerminalSnapshotData(snapshotRes.data, session.id)) {
          if (snapshotRes.data.status === 'ok') {
            snapshotSize = { cols: snapshotRes.data.cols, rows: snapshotRes.data.rows };
          }
        }
        if (endedReplayFitToContainerRef.current) {
          termRef.current?.fit();
          const term = termRef.current?.getTerminal();
          if (term) terminalSizeRef.current = { cols: term.cols, rows: term.rows };
        } else if (snapshotSize) {
          termRef.current?.resize(snapshotSize.cols, snapshotSize.rows);
          terminalSizeRef.current = snapshotSize;
        }
        const replayChunks = sanitizeEndedReplayChunks(res.data.chunks.map((chunk) => chunk.data));
        for (const chunk of replayChunks) {
          if (cancelled || replayGenerationRef.current !== replayGeneration) return;
          const written = await enqueueWriteStringForGeneration(chunk, replayGeneration);
          if (!written) return;
        }
        if (cancelled || replayGenerationRef.current !== replayGeneration) return;
        scrollTerminalToBottomAfterLayout();
        setReplayState({
          loaded: true,
          hasHistory: replayChunks.some((chunk) => chunk.length > 0),
        });
      })
      .catch(() => {
        if (!cancelled && replayGenerationRef.current === replayGeneration) {
          setReplayState({ loaded: true, hasHistory: false });
        }
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
    endedReplayLayoutRevision,
    flushPendingLiveChunks,
    enqueueWriteChunkForGeneration,
    enqueueWriteStringForGeneration,
    enqueueResetForGeneration,
    blockRecovery,
    scrollTerminalToBottomAfterLayout,
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
    if (!live) setResizeAuthorityState(false);
  }, [live, setResizeAuthorityState]);

  useEffect(() => {
    if (lastSessionIdRef.current === session.id) return;
    lastSessionIdRef.current = session.id;
    setEndedReplayFitToContainerState(false);
  }, [session.id, setEndedReplayFitToContainerState]);

  useEffect(() => {
    if (session.status !== 'ended') setEndedReplayFitToContainerState(false);
  }, [session.status, setEndedReplayFitToContainerState]);

  useEffect(() => {
    const focusRequested = focusRequest !== lastFocusRequestRef.current;
    lastFocusRequestRef.current = focusRequest;
    if (!focusRequested) return;
    if (!active || !terminalReady || !live) return;
    termRef.current?.focus();
  }, [focusRequest, active, live, terminalReady]);

  useEffect(() => {
    if (!active || !terminalReady) return;
    if (fitTerminalToContainer) termRef.current?.fit();
    if (live) termRef.current?.focus();
  }, [active, live, terminalReady, fitTerminalToContainer]);

  useLayoutEffect(() => {
    const currentLayoutSignal = layoutSignal;
    if (!active || !terminalReady || currentLayoutSignal === undefined) return;
    if (fitTerminalToContainer) termRef.current?.fit();
    if (session.status === 'ended') scrollTerminalToBottomAfterLayout();
  }, [
    active,
    terminalReady,
    layoutSignal,
    session.status,
    fitTerminalToContainer,
    scrollTerminalToBottomAfterLayout,
  ]);

  useEffect(() => {
    if (session.status !== 'ended') {
      lastEndedReplayLayoutSignalRef.current = layoutSignal;
      return;
    }
    if (!active || !terminalReady) {
      lastEndedReplayLayoutSignalRef.current = layoutSignal;
      return;
    }
    if (lastEndedReplayLayoutSignalRef.current === layoutSignal) return;

    lastEndedReplayLayoutSignalRef.current = layoutSignal;
    const timeout = window.setTimeout(() => {
      setEndedReplayLayoutRevision((revision) => revision + 1);
    }, ENDED_REPLAY_RESIZE_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [active, terminalReady, session.status, layoutSignal]);

  const startSession = useCallback(async () => {
    if (!active) return;
    replayGenerationRef.current += 1;
    renderedSeqRef.current = 0;
    pendingLiveChunksRef.current = [];
    recoveringRef.current = false;
    initialRecoveryDoneRef.current = false;
    recoveryBlockedRef.current = false;
    setRecoveryError(null);
    termRef.current?.fit();
    const term = termRef.current?.getTerminal();
    const cols = term?.cols ?? terminalSizeRef.current.cols;
    const rows = term?.rows ?? terminalSizeRef.current.rows;
    terminalSizeRef.current = { cols, rows };
    setResizeAuthorityState(true);
    const res = await request({
      id: `start-${Date.now()}`,
      cmd: 'session.start',
      args: { sessionId: session.id, cwd: session.workspaceId, cols, rows },
    });
    if (!res.ok) {
      setResizeAuthorityState(false);
      return;
    }
    termRef.current?.focus();
  }, [session.id, session.workspaceId, active, request, setResizeAuthorityState]);

  useEffect(() => {
    if (!active || !autoStart || !terminalReady || session.status !== 'draft') return;
    onAutoStartConsumed?.();
    void startSession();
  }, [active, autoStart, terminalReady, session.status, startSession, onAutoStartConsumed]);

  const handleStop = useCallback(() => {
    send({ id: `kill-${Date.now()}`, cmd: 'session.kill', args: { sessionId: session.id } });
  }, [session.id, send]);

  const handleResume = useCallback(async () => {
    if (!active) return;
    replayGenerationRef.current += 1;
    renderedSeqRef.current = 0;
    pendingLiveChunksRef.current = [];
    recoveringRef.current = false;
    initialRecoveryDoneRef.current = false;
    recoveryBlockedRef.current = false;
    setRecoveryError(null);
    termRef.current?.fit();
    const term = termRef.current?.getTerminal();
    const cols = term?.cols ?? terminalSizeRef.current.cols;
    const rows = term?.rows ?? terminalSizeRef.current.rows;
    terminalSizeRef.current = { cols, rows };
    const resetDone = enqueueResetForGeneration(replayGenerationRef.current);
    setReplayState({ loaded: true, hasHistory: false });
    const resetOk = await resetDone;
    if (!resetOk) return;
    setResizeAuthorityState(true);
    const res = await request({
      id: `resume-${Date.now()}`,
      cmd: 'session.resume',
      args: { sessionId: session.id, cwd: session.workspaceId, cols, rows },
    });
    if (!res.ok) {
      setResizeAuthorityState(false);
      return;
    }
    termRef.current?.focus();
  }, [
    session.id,
    session.workspaceId,
    active,
    request,
    enqueueResetForGeneration,
    setResizeAuthorityState,
  ]);

  const handleControlTerminalSize = useCallback(() => {
    if (!active || !terminalReady) return;
    if (session.status === 'ended') {
      setEndedReplayFitToContainerState(true);
      termRef.current?.fit();
      const term = termRef.current?.getTerminal();
      if (term) terminalSizeRef.current = { cols: term.cols, rows: term.rows };
      scrollTerminalToBottomAfterLayout();
      return;
    }
    if (!live) return;
    termRef.current?.fit();
    const term = termRef.current?.getTerminal();
    const cols = term?.cols ?? terminalSizeRef.current.cols;
    const rows = term?.rows ?? terminalSizeRef.current.rows;
    terminalSizeRef.current = { cols, rows };
    setResizeAuthorityState(true);
    send({
      id: `resize-control-${Date.now()}`,
      cmd: 'terminal.resize',
      args: { sessionId: session.id, cols, rows },
    });
    termRef.current?.focus();
  }, [
    session.id,
    session.status,
    active,
    terminalReady,
    live,
    send,
    setResizeAuthorityState,
    setEndedReplayFitToContainerState,
    scrollTerminalToBottomAfterLayout,
  ]);

  const handleData = useCallback(
    (data: string) => {
      if (!active || !live) return;
      const collectedInput = collectSubmittedTerminalInput(pendingInputRef.current, data);
      pendingInputRef.current = collectedInput.buffer;
      if (collectedInput.submitted) onPromptSubmitted?.(session.id);
      send({
        id: `input-${Date.now()}`,
        cmd: 'terminal.input',
        args: { sessionId: session.id, data },
      });
    },
    [session.id, active, live, send, onPromptSubmitted],
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      terminalSizeRef.current = { cols, rows };
      if (!active || !live || !resizeAuthorityRef.current) return;
      send({
        id: `resize-${Date.now()}`,
        cmd: 'terminal.resize',
        args: { sessionId: session.id, cols, rows },
      });
    },
    [session.id, active, live, send],
  );

  const showEmptyEndedHistory =
    session.status === 'ended' && replayState.loaded && !replayState.hasHistory;
  const showRecoveryError = live && recoveryError !== null;
  const currentStatusTone = executing
    ? {
        label: 'Executing',
        color: '#22c8f2',
        border: '#245564',
        background: '#071a1f',
      }
    : statusTone(session.status);
  const showTerminalSizeControl = live || session.status === 'ended';
  const terminalSizeControlActive =
    session.status === 'ended' ? endedReplayFitToContainer : resizeAuthority;
  const terminalSizeControlTitle =
    session.status === 'ended'
      ? endedReplayFitToContainer
        ? 'Replay fits this pane width'
        : 'Fit replay to this pane width'
      : resizeAuthority
        ? 'This view controls terminal size'
        : 'Use this view to control terminal size';

  return (
    <div
      data-testid="session-view"
      data-session-id={session.id}
      data-active={active ? 'true' : 'false'}
      aria-hidden={!active}
      style={{
        display: 'flex',
        flexDirection: 'column',
        position: 'absolute',
        inset: 0,
        visibility: active ? 'visible' : 'hidden',
        pointerEvents: active ? 'auto' : 'none',
        zIndex: active ? 1 : 0,
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
            color: '#ffffff',
            fontSize: '13px',
            fontWeight: 650,
          }}
        >
          {session.title ?? session.provider}
        </span>
        <span
          data-testid="session-status"
          title={currentStatusTone.label}
          style={{
            position: 'relative',
            flexShrink: 0,
            width: '22px',
            height: '22px',
            border: `1px solid ${currentStatusTone.border}`,
            borderRadius: '999px',
            background: currentStatusTone.background,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            aria-hidden="true"
            className="session-status-dot"
            data-live={live ? 'true' : 'false'}
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '999px',
              background: currentStatusTone.color,
              boxShadow: executing
                ? '0 0 0 3px rgba(34, 200, 242, 0.14)'
                : live
                  ? '0 0 0 3px rgba(143, 191, 115, 0.14)'
                  : 'none',
            }}
          />
          <span style={VISUALLY_HIDDEN_STYLE}>{executing ? 'executing' : session.status}</span>
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
          {showTerminalSizeControl && (
            <button
              type="button"
              aria-label="Control terminal size"
              aria-pressed={terminalSizeControlActive}
              title={terminalSizeControlTitle}
              onClick={handleControlTerminalSize}
              disabled={!active || !terminalReady}
              style={{
                width: '28px',
                height: '28px',
                border: terminalSizeControlActive ? '1px solid #245564' : '1px solid #303030',
                borderRadius: '6px',
                background: terminalSizeControlActive ? '#071a1f' : '#171717',
                color: terminalSizeControlActive ? '#78e4ff' : '#a9a9a3',
                cursor: active && terminalReady ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
            >
              <MonitorUp {...ACTION_ICON_PROPS} />
            </button>
          )}
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
          {session.status === 'ended' && supportsResume(session) && (
            <button
              type="button"
              onClick={handleResume}
              style={{
                padding: '5px 12px',
                border: '1px solid #303030',
                borderRadius: '6px',
                background: '#171717',
                color: '#ffffff',
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
        data-testid="terminal-frame"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
          background: '#050606',
          padding: '12px 14px 14px',
        }}
      >
        <TerminalView
          ref={termRef}
          fitToContainer={fitTerminalToContainer}
          interactive={live && active}
          onData={handleData}
          onResize={handleResize}
          onReady={() => setTerminalReady(true)}
        />
        {showEmptyEndedHistory && (
          <div
            style={{
              position: 'absolute',
              inset: '12px 14px 14px',
              pointerEvents: 'none',
            }}
          >
            <EmptyEndedHistory />
          </div>
        )}
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
              color: '#ffffff',
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
