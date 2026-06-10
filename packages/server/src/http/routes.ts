import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Session } from '@cubby/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SessionManager } from '../session/manager.js';

export interface SessionRouteCallbacks {
  onSessionUpdated?: (session: Session) => void;
  onSessionDeleted?: (sessionId: string) => void;
}

export function registerRoutes(
  app: FastifyInstance,
  sessionManager: SessionManager,
  callbacks: SessionRouteCallbacks = {},
) {
  app.get('/api/browse', async (request) => {
    const { path } = request.query as { path?: string };
    const target = resolve(path || homedir());
    const entries = await readdir(target);
    const items: { name: string; path: string; isDir: boolean }[] = [];
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      try {
        const s = await stat(join(target, name));
        items.push({ name, path: join(target, name), isDir: s.isDirectory() });
      } catch {}
    }
    items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    return { path: target, entries: items };
  });
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
      yolo?: unknown;
    };
    const session = sessionManager.createSession({
      workspaceId: body.workspaceId ?? process.cwd(),
      provider: body.provider ?? 'claude-code',
      model: body.model,
      title: body.title,
      yolo: typeof body.yolo === 'boolean' ? body.yolo : undefined,
    });
    return session;
  });

  app.patch('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { title?: unknown } | undefined;
    if (typeof body?.title !== 'string' || !body.title.trim()) {
      return reply.code(400).send({ error: 'Session title is required' });
    }

    try {
      const session = sessionManager.renameSession(id, body.title);
      callbacks.onSessionUpdated?.(session);
      return session;
    } catch (err) {
      if (isSessionNotFound(err)) {
        return sendNotFound(reply);
      }
      throw err;
    }
  });

  app.delete('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await sessionManager.deleteSession(id);
    if (!deleted) {
      return sendNotFound(reply);
    }
    callbacks.onSessionDeleted?.(id);
    return { ok: true, sessionId: id };
  });

  app.post('/api/sessions/:id/start', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { cwd?: string; cols?: number; rows?: number } | undefined;
    await sessionManager.startSession(id, {
      cwd: body?.cwd ?? process.cwd(),
      cols: normalizeTerminalDimension(body?.cols, 80, 20, 500),
      rows: normalizeTerminalDimension(body?.rows, 24, 5, 200),
    });
    return { ok: true };
  });

  app.post('/api/sessions/:id/kill', async (request) => {
    const { id } = request.params as { id: string };
    await sessionManager.killSession(id);
    return { ok: true };
  });

  app.post('/api/sessions/:id/resume', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { cwd?: string; cols?: number; rows?: number } | undefined;
    await sessionManager.resumeSession(id, {
      cwd: body?.cwd ?? process.cwd(),
      cols: normalizeTerminalDimension(body?.cols, 80, 20, 500),
      rows: normalizeTerminalDimension(body?.rows, 24, 5, 200),
    });
    return { ok: true };
  });
}

function sendNotFound(reply: FastifyReply) {
  return reply.code(404).send({ error: 'Not found' });
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
