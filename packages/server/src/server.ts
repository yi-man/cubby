import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WSRequest } from '@cubby/core';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import { Database } from './db/index.js';
import { registerRoutes } from './http/routes.js';
import { ClaudeCodeProvider } from './provider/claude-code.js';
import { SessionManager } from './session/manager.js';
import { SessionStore } from './session/store.js';
import { WSCommandHandler } from './ws/handler.js';
import { WebSocketHub } from './ws/hub.js';

export async function createServer(port = 3000) {
  const app = Fastify({ logger: true });

  // Plugins
  await app.register(fastifyWebsocket);
  await app.register(fastifyCors, { origin: true });

  // Database — ensure .cubby directory exists
  const dbPath = join(process.cwd(), '.cubby', 'cubby.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  // Core services
  const sessionStore = new SessionStore(db);
  const sessionManager = new SessionManager(sessionStore);
  sessionManager.registerProvider(new ClaudeCodeProvider());

  const hub = new WebSocketHub();
  const wsHandler = new WSCommandHandler(sessionManager, hub);

  // HTTP routes
  registerRoutes(app, sessionManager);
  app.get('/healthz', async () => ({ status: 'ok' }));

  // WebSocket
  app.register(async function wsRoutes(fastify) {
    fastify.get('/ws', { websocket: true }, (socket) => {
      socket.on('message', async (raw) => {
        try {
          const request = JSON.parse(raw.toString()) as WSRequest;
          const response = await wsHandler.handle(socket, request);
          socket.send(JSON.stringify(response));
        } catch (_err) {
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
    db.close();
  });

  return { app, port };
}
