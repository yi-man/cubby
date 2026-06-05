import type { WSCommand, WSRequest, WSResponse } from '@cubby/core';
import { WS_COMMANDS, WS_EVENTS } from '@cubby/core';
import type { WebSocket } from 'ws';
import type { SessionManager } from '../session/manager.js';
import type { WebSocketHub } from './hub.js';

export class WSCommandHandler {
  constructor(
    private sessionManager: SessionManager,
    private hub: WebSocketHub,
  ) {}

  async handle(ws: WebSocket, request: WSRequest): Promise<WSResponse> {
    const cmd = request.cmd as WSCommand;
    try {
      switch (cmd) {
        case WS_COMMANDS.SESSION_CREATE:
          return this.sessionCreate(request);
        case WS_COMMANDS.SESSION_START:
          return this.sessionStart(ws, request);
        case WS_COMMANDS.SESSION_RESUME:
          return this.sessionResume(ws, request);
        case WS_COMMANDS.SESSION_KILL:
          return this.sessionKill(request);
        case WS_COMMANDS.SESSION_LIST:
          return this.sessionList(request);
        case WS_COMMANDS.SESSION_GET:
          return this.sessionGet(request);
        case WS_COMMANDS.SESSION_RENAME:
          return this.sessionRename(request);
        case WS_COMMANDS.SESSION_DELETE:
          return this.sessionDelete(request);
        case WS_COMMANDS.RECOVERY_RECONCILE:
          return this.recoveryReconcile(request);
        case WS_COMMANDS.TERMINAL_SUBSCRIBE:
          return this.terminalSubscribe(ws, request);
        case WS_COMMANDS.TERMINAL_UNSUBSCRIBE:
          return this.terminalUnsubscribe(ws, request);
        case WS_COMMANDS.TERMINAL_REPLAY:
          return this.terminalReplay(request);
        case WS_COMMANDS.TERMINAL_SNAPSHOT:
          return this.terminalSnapshot(request);
        case WS_COMMANDS.TERMINAL_INPUT:
          return this.terminalInput(request);
        case WS_COMMANDS.TERMINAL_RESIZE:
          return this.terminalResize(request);
        default:
          return {
            id: request.id,
            ok: false,
            error: { code: 'UNKNOWN_CMD', message: `Unknown command: ${cmd}` },
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { id: request.id, ok: false, error: { code: 'INTERNAL', message } };
    }
  }

  private sessionCreate(req: WSRequest): WSResponse {
    const { workspaceId, provider, model, title } = req.args as {
      workspaceId: string;
      provider: string;
      model?: string;
      title?: string;
    };
    const session = this.sessionManager.createSession({ workspaceId, provider, model, title });
    return { id: req.id, ok: true, data: session };
  }

  private async sessionStart(ws: WebSocket, req: WSRequest): Promise<WSResponse> {
    const { sessionId, cwd, cols, rows } = req.args as {
      sessionId: string;
      cwd: string;
      cols?: number;
      rows?: number;
    };
    const topic = `terminal:${sessionId}`;
    const size = terminalSizeFromArgs(cols, rows);
    this.hub.subscribe(ws, topic);

    await this.sessionManager.startSession(sessionId, { cwd, ...size }, (chunk) => {
      this.hub.broadcast(topic, { evt: 'terminal.output', data: { sessionId, ...chunk } });
    });

    return { id: req.id, ok: true, data: { sessionId } };
  }

  private async sessionKill(req: WSRequest): Promise<WSResponse> {
    const { sessionId } = req.args as { sessionId: string };
    await this.sessionManager.killSession(sessionId);
    return { id: req.id, ok: true };
  }

  private async sessionResume(ws: WebSocket, req: WSRequest): Promise<WSResponse> {
    const { sessionId, cwd, cols, rows } = req.args as {
      sessionId: string;
      cwd: string;
      cols?: number;
      rows?: number;
    };
    const topic = `terminal:${sessionId}`;
    const size = terminalSizeFromArgs(cols, rows);
    this.hub.subscribe(ws, topic);

    await this.sessionManager.resumeSession(sessionId, { cwd, ...size }, (chunk) => {
      this.hub.broadcast(topic, { evt: 'terminal.output', data: { sessionId, ...chunk } });
    });

    return { id: req.id, ok: true, data: { sessionId } };
  }

  private sessionList(req: WSRequest): WSResponse {
    const sessions = this.sessionManager.listSessions();
    return { id: req.id, ok: true, data: sessions };
  }

  private sessionGet(req: WSRequest): WSResponse {
    const { sessionId } = req.args as { sessionId: string };
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return { id: req.id, ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } };
    }
    return { id: req.id, ok: true, data: session };
  }

  private sessionRename(req: WSRequest): WSResponse {
    const { sessionId, title } = req.args as { sessionId: string; title: string };
    if (typeof title !== 'string' || !title.trim()) {
      return {
        id: req.id,
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Session title is required' },
      };
    }

    try {
      const session = this.sessionManager.renameSession(sessionId, title);
      this.hub.broadcastToAll({ evt: WS_EVENTS.SESSION_UPDATED, data: session });
      return { id: req.id, ok: true, data: session };
    } catch (err) {
      if (isSessionNotFound(err)) {
        return {
          id: req.id,
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' },
        };
      }
      throw err;
    }
  }

  private async sessionDelete(req: WSRequest): Promise<WSResponse> {
    const { sessionId } = req.args as { sessionId: string };
    const deleted = await this.sessionManager.deleteSession(sessionId);
    if (!deleted) {
      return { id: req.id, ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } };
    }
    const data = { sessionId };
    this.hub.broadcastToAll({ evt: WS_EVENTS.SESSION_DELETED, data });
    return { id: req.id, ok: true, data };
  }

  private terminalInput(req: WSRequest): WSResponse {
    const { sessionId, data } = req.args as { sessionId: string; data: string };
    const process = this.sessionManager.getProcess(sessionId);
    if (!process) {
      return {
        id: req.id,
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Session process not found' },
      };
    }
    const input = this.sessionManager.prepareTerminalInput(sessionId, data);
    if (input) {
      process.write(input);
    }
    const updated = this.sessionManager.recordTerminalInput(sessionId, data);
    if (updated) {
      this.hub.broadcastToAll({ evt: WS_EVENTS.SESSION_UPDATED, data: updated });
    }
    return { id: req.id, ok: true };
  }

  private terminalResize(req: WSRequest): WSResponse {
    const { sessionId, cols, rows } = req.args as { sessionId: string; cols: number; rows: number };
    const size = terminalSizeFromArgs(cols, rows);
    if (!this.sessionManager.resizeTerminal(sessionId, size.cols, size.rows)) {
      return {
        id: req.id,
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Session process not found' },
      };
    }
    return { id: req.id, ok: true };
  }

  private terminalSubscribe(ws: WebSocket, req: WSRequest): WSResponse {
    const { sessionId } = req.args as { sessionId: string };
    const topic = `terminal:${sessionId}`;
    this.hub.subscribe(ws, topic);
    return { id: req.id, ok: true };
  }

  private terminalUnsubscribe(ws: WebSocket, req: WSRequest): WSResponse {
    const { sessionId } = req.args as { sessionId: string };
    const topic = `terminal:${sessionId}`;
    this.hub.unsubscribe(ws, topic);
    return { id: req.id, ok: true };
  }

  private terminalReplay(req: WSRequest): WSResponse {
    const { sessionId, lastSeq } = req.args as { sessionId: string; lastSeq?: number };
    return {
      id: req.id,
      ok: true,
      data: this.sessionManager.getOutputReplay(sessionId, lastSeq ?? 0),
    };
  }

  private async terminalSnapshot(req: WSRequest): Promise<WSResponse> {
    const { sessionId } = req.args as {
      sessionId: string;
    };
    return {
      id: req.id,
      ok: true,
      data: await this.sessionManager.getTerminalSnapshot(sessionId),
    };
  }

  private recoveryReconcile(req: WSRequest): WSResponse {
    const { sessionId, renderedSeq } = req.args as { sessionId: string; renderedSeq?: number };
    return {
      id: req.id,
      ok: true,
      data: this.sessionManager.reconcileTerminalRecovery(sessionId, renderedSeq ?? 0),
    };
  }
}

function terminalSizeFromArgs(cols: unknown, rows: unknown): { cols: number; rows: number } {
  return {
    cols: normalizeTerminalDimension(cols, 80, 20, 500),
    rows: normalizeTerminalDimension(rows, 24, 5, 200),
  };
}

function isSessionNotFound(err: unknown): boolean {
  return err instanceof Error && err.message === 'Session not found';
}

function normalizeTerminalDimension(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
