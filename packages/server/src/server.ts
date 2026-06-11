import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { WS_EVENTS, type WSRequest } from '@cubby/core';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { AuthService, buildAuthCookie, clearAuthCookie } from './auth/service.js';
import { DEFAULT_SERVER_PORT, loadRuntimeConfig, type RuntimeConfig } from './config/runtime.js';
import { Database } from './db/index.js';
import { registerRoutes } from './http/routes.js';
import { ClaudeCodeProvider } from './provider/claude-code.js';
import { CodexProvider } from './provider/codex.js';
import { MockClaudeCodeProvider } from './provider/mock-claude-code.js';
import { MockCodexProvider } from './provider/mock-codex.js';
import { MockOpenCodeProvider } from './provider/mock-opencode.js';
import { OpenCodeProvider } from './provider/opencode.js';
import { SessionManager } from './session/manager.js';
import { SessionStore } from './session/store.js';
import { WSCommandHandler } from './ws/handler.js';
import { WebSocketHub } from './ws/hub.js';

export async function createServer(
  port = DEFAULT_SERVER_PORT,
  runtimeConfig: RuntimeConfig = loadRuntimeConfig(process.env),
) {
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
  const dbPath = join(runtimeConfig.dataDir, 'cubby.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  const authService = new AuthService(db, runtimeConfig.auth);

  app.addHook('preHandler', async (request, reply) => {
    return authenticateHttpRequest(authService, request, reply);
  });

  // Core services
  const sessionStore = new SessionStore(db);
  const sessionManager = new SessionManager(sessionStore);
  sessionManager.registerProvider(createClaudeCodeProvider());
  sessionManager.registerProvider(createCodexProvider());
  sessionManager.registerProvider(createOpenCodeProvider());
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
  sessionManager.onSessionUpdate((session) => {
    hub.broadcastToAll({ evt: WS_EVENTS.SESSION_UPDATED, data: session });
  });

  // HTTP routes
  registerRoutes(app, sessionManager, {
    onSessionUpdated: (session) => {
      hub.broadcastToAll({ evt: WS_EVENTS.SESSION_UPDATED, data: session });
    },
    onSessionDeleted: (sessionId) => {
      hub.broadcastToAll({ evt: WS_EVENTS.SESSION_DELETED, data: { sessionId } });
    },
  });
  registerAuthRoutes(app, authService);
  app.get('/healthz', async () => ({ status: 'ok' }));

  // WebSocket
  app.register(async function wsRoutes(fastify) {
    fastify.get(
      '/ws',
      {
        websocket: true,
        preValidation: async (request, reply) => {
          return authenticateProtectedRequest(authService, request, reply);
        },
      },
      (socket) => {
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
      },
    );
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

function registerAuthRoutes(app: FastifyInstance, authService: AuthService) {
  app.get('/auth/status', async (request) => ({
    enabled: authService.enabled,
    authenticated: authService.isRequestAuthenticated(request),
  }));

  app.post('/auth/login', async (request, reply) => {
    if (!authService.enabled) return { ok: true };
    const body = request.body as { password?: unknown } | undefined;
    if (typeof body?.password !== 'string') {
      return reply.code(400).send({ error: 'Password is required' });
    }

    const result = await authService.login(body.password, request.ip);
    if (result.status === 'blocked') {
      return reply.code(429).send({ error: 'Too many failed login attempts' });
    }
    if (result.status !== 'ok' || !result.token) {
      return reply.code(401).send({ error: 'Invalid password' });
    }

    reply.header('Set-Cookie', buildAuthCookie(result.token));
    return { ok: true };
  });

  app.post('/auth/logout', async (request, reply) => {
    authService.logout(request);
    reply.header('Set-Cookie', clearAuthCookie());
    return { ok: true };
  });
}

function authenticateHttpRequest(
  authService: AuthService,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!authService.isOriginAllowed(request)) {
    return reply.code(403).send({ error: 'Origin is not allowed' });
  }
  if (isPublicHttpPath(request.url)) return;
  return authenticateProtectedRequest(authService, request, reply);
}

function authenticateProtectedRequest(
  authService: AuthService,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (authService.isRequestAuthenticated(request)) return;
  return reply.code(401).send({ error: 'Authentication required' });
}

function isPublicHttpPath(url: string): boolean {
  const pathname = url.split('?', 1)[0] ?? '/';
  if (pathname === '/' || pathname === '/login' || pathname === '/healthz') return true;
  if (pathname.startsWith('/auth/')) return true;
  if (pathname.startsWith('/assets/')) return true;
  return hasPublicAssetExtension(pathname);
}

function hasPublicAssetExtension(pathname: string): boolean {
  return /\.(?:css|js|mjs|map|ico|png|jpg|jpeg|gif|webp|svg|woff2?)$/i.test(pathname);
}

function createClaudeCodeProvider() {
  if (process.env.CUBBY_MOCK_CLAUDE_PROVIDER === '1') {
    return new MockClaudeCodeProvider();
  }
  return new ClaudeCodeProvider();
}

function createCodexProvider() {
  if (process.env.CUBBY_MOCK_CODEX_PROVIDER === '1') {
    return new MockCodexProvider();
  }
  return new CodexProvider();
}

function createOpenCodeProvider() {
  if (process.env.CUBBY_MOCK_OPENCODE_PROVIDER === '1') {
    return new MockOpenCodeProvider();
  }
  return new OpenCodeProvider();
}
