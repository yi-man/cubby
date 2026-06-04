import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WSRequest } from '@cubby/core';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import { Database } from './db/index.js';
import { registerRoutes } from './http/routes.js';
import { ClaudeCodeProvider } from './provider/claude-code.js';
import { MockClaudeCodeProvider } from './provider/mock-claude-code.js';
import { SessionManager } from './session/manager.js';
import { SessionStore } from './session/store.js';
import { WSCommandHandler } from './ws/handler.js';
import { WebSocketHub } from './ws/hub.js';

export async function createServer(port = 6300) {
  const app = Fastify({ logger: true });

  // Plugins
  await app.register(fastifyWebsocket);
  await app.register(fastifyCors, { origin: true });

  // Serve web frontend static files
  const webDistDir = join(process.cwd(), 'packages/web/dist');
  if (existsSync(webDistDir)) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      prefix: '/',
      wildcard: false,
    });
    // SPA fallback: serve index.html for non-API routes
    app.setNotFoundHandler((request, reply) => {
      if (
        !request.url.startsWith('/api') &&
        !request.url.startsWith('/ws') &&
        !request.url.startsWith('/healthz')
      ) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'Not found' });
    });
  }

  // Database — ensure runtime data directory exists
  const dataDir = process.env.CUBBY_DATA_DIR ?? join(process.cwd(), '.cubby');
  const dbPath = join(dataDir, 'cubby.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  // Core services
  const sessionStore = new SessionStore(db);
  const sessionManager = new SessionManager(sessionStore);
  sessionManager.registerProvider(createClaudeCodeProvider());
  sessionManager.reconcileDetachedLiveSessions();

  const hub = new WebSocketHub();
  const wsHandler = new WSCommandHandler(sessionManager, hub);

  // Broadcast session status changes
  sessionManager.onStatusChange((sessionId, status) => {
    hub.broadcastToAll({
      evt: 'session.status',
      data: { sessionId, status },
    });
  });

  // HTTP routes
  registerRoutes(app, sessionManager);
  app.get('/healthz', async () => ({ status: 'ok' }));

  // WebSocket
  app.register(async function wsRoutes(fastify) {
    fastify.get('/ws', { websocket: true }, (socket) => {
      hub.addClient(socket);

      socket.on('message', async (raw) => {
        try {
          const request = JSON.parse(raw.toString()) as WSRequest;
          app.log.info({ cmd: request.cmd, id: request.id }, 'WS request');
          const response = await wsHandler.handle(socket, request);
          app.log.info({ cmd: request.cmd, id: request.id, ok: response.ok }, 'WS response');
          socket.send(JSON.stringify(response));
        } catch (err) {
          app.log.error({ err }, 'WS error');
          socket.send(
            JSON.stringify({
              id: 'error',
              ok: false,
              error: { code: 'PARSE_ERROR', message: 'Invalid JSON' },
            }),
          );
        }
      });

      socket.on('close', () => {
        hub.removeClient(socket);
      });
    });
  });

  // Graceful shutdown
  app.addHook('onClose', async () => {
    try {
      await sessionManager.shutdown();
    } finally {
      db.close();
    }
  });

  return { app, port };
}

function createClaudeCodeProvider() {
  if (process.env.CUBBY_MOCK_CLAUDE_PROVIDER === '1') {
    return new MockClaudeCodeProvider();
  }
  return new ClaudeCodeProvider();
}
