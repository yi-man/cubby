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
          return this.sessionResume(request);
        case WS_COMMANDS.SESSION_KILL:
          return this.sessionKill(request);
        case WS_COMMANDS.SESSION_LIST:
          return this.sessionList(request);
        case WS_COMMANDS.SESSION_GET:
          return this.sessionGet(request);
        case WS_COMMANDS.TERMINAL_SUBSCRIBE:
          return this.terminalSubscribe(ws, request);
        case WS_COMMANDS.TERMINAL_UNSUBSCRIBE:
          return this.terminalUnsubscribe(ws, request);
        case WS_COMMANDS.TERMINAL_REPLAY:
          return this.terminalReplay(request);
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

  private async sessionStart(_ws: WebSocket, req: WSRequest): Promise<WSResponse> {
    const { sessionId, cwd, cols, rows } = req.args as {
      sessionId: string;
      cwd: string;
      cols?: number;
      rows?: number;
    };
    const topic = `terminal:${sessionId}`;
    const size = terminalSizeFromArgs(cols, rows);

    await this.sessionManager.startSession(sessionId, { cwd, ...size }, (data) => {
      this.hub.broadcast(topic, { evt: 'terminal.output', data: { sessionId, data } });
    });

    return { id: req.id, ok: true, data: { sessionId } };
  }

  private async sessionKill(req: WSRequest): Promise<WSResponse> {
    const { sessionId } = req.args as { sessionId: string };
    await this.sessionManager.killSession(sessionId);
    return { id: req.id, ok: true };
  }

  private async sessionResume(req: WSRequest): Promise<WSResponse> {
    const { sessionId, cwd, cols, rows } = req.args as {
      sessionId: string;
      cwd: string;
      cols?: number;
      rows?: number;
    };
    const topic = `terminal:${sessionId}`;
    const size = terminalSizeFromArgs(cols, rows);

    await this.sessionManager.resumeSession(sessionId, { cwd, ...size }, (data) => {
      this.hub.broadcast(topic, { evt: 'terminal.output', data: { sessionId, data } });
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
    process.write(data);
    const updated = this.sessionManager.recordTerminalInput(sessionId, data);
    if (updated) {
      this.hub.broadcastToAll({ evt: WS_EVENTS.SESSION_UPDATED, data: updated });
    }
    return { id: req.id, ok: true };
  }

  private terminalResize(req: WSRequest): WSResponse {
    const { sessionId, cols, rows } = req.args as { sessionId: string; cols: number; rows: number };
    const process = this.sessionManager.getProcess(sessionId);
    if (!process) {
      return {
        id: req.id,
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Session process not found' },
      };
    }
    process.resize(cols, rows);
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
    const { sessionId } = req.args as { sessionId: string };
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return { id: req.id, ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } };
    }
    return {
      id: req.id,
      ok: true,
      data: { sessionId, chunks: this.sessionManager.getOutputHistory(sessionId) },
    };
  }
}

function terminalSizeFromArgs(cols: unknown, rows: unknown): { cols: number; rows: number } {
  return {
    cols: normalizeTerminalDimension(cols, 80, 20, 500),
    rows: normalizeTerminalDimension(rows, 24, 5, 200),
  };
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
