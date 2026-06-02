import type { WSRequest, WSResponse, WSCommand } from '@cubby/core';
import { WS_COMMANDS } from '@cubby/core';
import type { SessionManager } from '../session/manager.js';
import type { WebSocketHub } from './hub.js';
import type { WebSocket } from 'ws';

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
        case WS_COMMANDS.SESSION_KILL:
          return this.sessionKill(request);
        case WS_COMMANDS.SESSION_LIST:
          return this.sessionList();
        case WS_COMMANDS.SESSION_GET:
          return this.sessionGet(request);
        case WS_COMMANDS.TERMINAL_SUBSCRIBE:
          return this.terminalSubscribe(ws, request);
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
    const { sessionId, cwd } = req.args as { sessionId: string; cwd: string };
    const topic = `terminal:${sessionId}`;
    this.hub.subscribe(ws, topic);

    await this.sessionManager.startSession(
      sessionId,
      { cwd, cols: 80, rows: 24 },
      (data) => {
        this.hub.broadcast(topic, { evt: 'terminal.output', data: { sessionId, data } });
      },
    );

    return { id: req.id, ok: true, data: { sessionId } };
  }

  private async sessionKill(req: WSRequest): Promise<WSResponse> {
    const { sessionId } = req.args as { sessionId: string };
    await this.sessionManager.killSession(sessionId);
    return { id: req.id, ok: true };
  }

  private sessionList(): WSResponse {
    const sessions = this.sessionManager.listSessions();
    return { id: 'list', ok: true, data: sessions };
  }

  private sessionGet(req: WSRequest): WSResponse {
    const { sessionId } = req.args as { sessionId: string };
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return { id: req.id, ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } };
    }
    return { id: req.id, ok: true, data: session };
  }

  private terminalSubscribe(ws: WebSocket, req: WSRequest): WSResponse {
    const { sessionId } = req.args as { sessionId: string };
    const topic = `terminal:${sessionId}`;
    this.hub.subscribe(ws, topic);
    return { id: req.id, ok: true };
  }
}
