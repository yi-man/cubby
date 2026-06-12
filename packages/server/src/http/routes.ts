import { open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Session } from '@cubby/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { readGitDiff, readGitHead, readGitStatus } from '../git/git-service.js';
import type { SessionManager } from '../session/manager.js';
import { imageMimeTypeForPath, searchWorkspace } from '../workspace/review.js';

export interface SessionRouteCallbacks {
  onSessionUpdated?: (session: Session) => void;
  onSessionDeleted?: (sessionId: string) => void;
}

const MAX_FILE_PREVIEW_BYTES = 256 * 1024;

export function registerRoutes(
  app: FastifyInstance,
  sessionManager: SessionManager,
  callbacks: SessionRouteCallbacks = {},
) {
  app.get('/api/browse', async (request, reply) => {
    const { path, root } = request.query as { path?: string; root?: string };

    try {
      const target = await resolveWorkspacePath(path, root);
      const targetStat = await stat(target.path);
      if (!targetStat.isDirectory()) {
        return reply.code(400).send({ error: 'Path is not a directory' });
      }

      const entries = await readdir(target.path);
      const items: { name: string; path: string; isDir: boolean; previewable: boolean }[] = [];
      for (const name of entries) {
        if (name.startsWith('.')) continue;
        const entryPath = join(target.path, name);
        try {
          const s = await stat(entryPath);
          const isDir = s.isDirectory();
          items.push({
            name,
            path: entryPath,
            isDir,
            previewable: !isDir && s.isFile(),
          });
        } catch {}
      }
      items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      return { path: target.path, root: target.root, entries: items };
    } catch (err) {
      return sendFileSystemError(reply, err);
    }
  });

  app.get('/api/file', async (request, reply) => {
    const { path, root } = request.query as { path?: string; root?: string };
    if (!root) {
      return reply.code(400).send({ error: 'Workspace root is required' });
    }

    try {
      const target = await resolveWorkspacePath(path, root);
      const targetStat = await stat(target.path);
      if (!targetStat.isFile()) {
        return reply.code(400).send({ error: 'Path is not a file' });
      }

      const preview = await readTextPreview(target.path, targetStat.size);
      if (!preview.previewable) {
        return reply.code(415).send({ error: 'File is not previewable' });
      }

      return {
        path: target.path,
        content: preview.content,
        truncated: preview.truncated,
      };
    } catch (err) {
      return sendFileSystemError(reply, err);
    }
  });

  app.get('/api/file/raw', async (request, reply) => {
    const { path, root } = request.query as { path?: string; root?: string };
    if (!root) {
      return reply.code(400).send({ error: 'Workspace root is required' });
    }

    try {
      const target = await resolveWorkspacePath(path, root);
      const targetStat = await stat(target.path);
      if (!targetStat.isFile()) {
        return reply.code(400).send({ error: 'Path is not a file' });
      }

      const mimeType = imageMimeTypeForPath(target.path);
      if (!mimeType) {
        return reply.code(415).send({ error: 'File is not previewable' });
      }

      return reply.type(mimeType).send(await readFile(target.path));
    } catch (err) {
      return sendFileSystemError(reply, err);
    }
  });

  app.get('/api/workspace/search', async (request, reply) => {
    const { query, root } = request.query as { query?: string; root?: string };
    if (!root) {
      return reply.code(400).send({ error: 'Workspace root is required' });
    }
    if (typeof query !== 'string') {
      return reply.code(400).send({ error: 'Search query is required' });
    }

    try {
      const target = await resolveWorkspacePath(undefined, root);
      return await searchWorkspace(target.root ?? target.path, query);
    } catch (err) {
      return sendFileSystemError(reply, err);
    }
  });

  app.get('/api/git/status', async (request, reply) => {
    const { root } = request.query as { root?: string };
    if (!root) {
      return reply.code(400).send({ error: 'Workspace root is required' });
    }

    try {
      const target = await resolveWorkspacePath(undefined, root);
      return await readGitStatus(target.root ?? target.path);
    } catch (err) {
      return sendFileSystemError(reply, err);
    }
  });

  app.get('/api/git/diff', async (request, reply) => {
    const { path, root } = request.query as { path?: string; root?: string };
    if (!root) {
      return reply.code(400).send({ error: 'Workspace root is required' });
    }
    if (!path) {
      return reply.code(400).send({ error: 'File path is required' });
    }

    try {
      const target = await resolveWorkspacePath(path, root);
      const workspaceRoot = target.root ?? root;
      return await readGitDiff(workspaceRoot, relative(workspaceRoot, target.path));
    } catch (err) {
      return sendFileSystemError(reply, err);
    }
  });

  app.get('/api/sessions', async () => {
    return sessionManager.listSessions();
  });

  app.get('/api/sessions/:id/supervisor', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return sessionManager.getSupervisorState(id);
    } catch (err) {
      if (isSessionNotFound(err)) {
        return sendNotFound(reply);
      }
      throw err;
    }
  });

  app.put('/api/sessions/:id/supervisor/objective', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { objective?: unknown } | undefined;
    if (typeof body?.objective !== 'string' || !body.objective.trim()) {
      return reply.code(400).send({ error: 'Session objective is required' });
    }

    try {
      return sessionManager.setSessionObjective(id, body.objective);
    } catch (err) {
      if (isSessionNotFound(err)) {
        return sendNotFound(reply);
      }
      if (isSupervisorObjectiveError(err)) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post('/api/sessions/:id/supervisor/reviews', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await sessionManager.runSupervisorReview(id);
    } catch (err) {
      if (isSessionNotFound(err)) {
        return sendNotFound(reply);
      }
      throw err;
    }
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
    const workspaceId = body.workspaceId ?? process.cwd();
    const session = sessionManager.createSession({
      workspaceId,
      provider: body.provider ?? 'claude-code',
      model: body.model,
      title: body.title,
      yolo: typeof body.yolo === 'boolean' ? body.yolo : undefined,
      baselineGitHead: await readGitHead(workspaceId),
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

function sendFileSystemError(reply: FastifyReply, err: unknown) {
  if (err instanceof WorkspacePathError) {
    return reply.code(403).send({ error: err.message });
  }
  if (isNodeError(err) && err.code === 'ENOENT') {
    return reply.code(404).send({ error: 'Path not found' });
  }
  if (isNodeError(err) && (err.code === 'EACCES' || err.code === 'EPERM')) {
    return reply.code(403).send({ error: 'Path is not accessible' });
  }
  throw err;
}

class WorkspacePathError extends Error {}

async function resolveWorkspacePath(pathValue?: string, rootValue?: string) {
  if (!rootValue?.trim()) {
    return { path: resolve(pathValue || homedir()), root: undefined };
  }

  const root = await realpath(resolve(rootValue));
  const requestedPath = pathValue?.trim()
    ? isAbsolute(pathValue)
      ? resolve(pathValue)
      : resolve(root, pathValue)
    : root;
  const target = await realpath(requestedPath);
  if (!isPathInsideRoot(root, target)) {
    throw new WorkspacePathError('Path is outside workspace root');
  }
  return { path: target, root };
}

function isPathInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function readTextPreview(
  path: string,
  size: number,
): Promise<{ previewable: boolean; content: string; truncated: boolean }> {
  const bytesToRead = Math.min(size, MAX_FILE_PREVIEW_BYTES + 1);
  const buffer = Buffer.alloc(bytesToRead);
  const file = await open(path, 'r');
  try {
    const { bytesRead } = await file.read(buffer, 0, bytesToRead, 0);
    const readBuffer = buffer.subarray(0, bytesRead);
    if (isBinaryBuffer(readBuffer)) {
      return { previewable: false, content: '', truncated: false };
    }

    const contentBuffer = readBuffer.subarray(0, MAX_FILE_PREVIEW_BYTES);
    const content = contentBuffer.toString('utf8');
    if (content.includes('\uFFFD')) {
      return { previewable: false, content: '', truncated: false };
    }

    return {
      previewable: true,
      content,
      truncated: size > MAX_FILE_PREVIEW_BYTES || bytesRead > MAX_FILE_PREVIEW_BYTES,
    };
  } finally {
    await file.close();
  }
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

function isSessionNotFound(err: unknown): boolean {
  return err instanceof Error && err.message === 'Session not found';
}

function isSupervisorObjectiveError(err: unknown): err is Error {
  return err instanceof Error && err.message === 'Session objective is required';
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
