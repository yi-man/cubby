import type { FastifyInstance } from 'fastify';
import type { SessionManager } from '../session/manager.js';

export function registerRoutes(app: FastifyInstance, sessionManager: SessionManager) {
  app.get('/api/sessions', async () => {
    return sessionManager.listSessions();
  });

  app.get('/api/sessions/:id', async (request) => {
    const { id } = request.params as { id: string };
    const session = sessionManager.getSession(id);
    if (!session) {
      return { error: 'Not found' };
    }
    return session;
  });

  app.post('/api/sessions', async (request) => {
    const body = request.body as {
      workspaceId?: string;
      provider?: string;
      model?: string;
      title?: string;
    };
    const session = sessionManager.createSession({
      workspaceId: body.workspaceId ?? process.cwd(),
      provider: body.provider ?? 'claude-code',
      model: body.model,
      title: body.title,
    });
    return session;
  });

  app.post('/api/sessions/:id/start', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { cwd?: string } | undefined;
    await sessionManager.startSession(id, {
      cwd: body?.cwd ?? process.cwd(),
      cols: 80,
      rows: 24,
    });
    return { ok: true };
  });

  app.post('/api/sessions/:id/kill', async (request) => {
    const { id } = request.params as { id: string };
    await sessionManager.killSession(id);
    return { ok: true };
  });
}
