import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import {
  PreviewRegistry,
  parseLsofListeningPorts,
  registerPreviewRoutes,
  type WorkspacePort,
} from './routes.js';

const dataDirs: string[] = [];

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cubby-preview-'));
  dataDirs.push(dir);
  return dir;
}

function detectPorts(ports: WorkspacePort[]) {
  return async () => ports;
}

describe('preview routes', () => {
  afterEach(() => {
    for (const dir of dataDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses lsof field output for TCP listening ports', () => {
    expect(
      parseLsofListeningPorts(
        ['p36086', 'cnode', 'Lapple', 'f14', 'PTCP', 'n127.0.0.1:52526', ''].join('\n'),
      ),
    ).toEqual([
      {
        pid: 36086,
        command: 'node',
        host: '127.0.0.1',
        port: 52526,
      },
    ]);
  });

  it('lists detected workspace ports and can dismiss a port record', async () => {
    const workspace = tempWorkspace();
    const app = Fastify();
    registerPreviewRoutes(app, {
      detectPorts: detectPorts([
        {
          port: 5173,
          pid: 123,
          command: 'vite',
          cwd: realpathSync(workspace),
          host: '127.0.0.1',
        },
      ]),
      registry: new PreviewRegistry(),
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: `/api/previews?root=${encodeURIComponent(workspace)}`,
    });
    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/previews/5173?root=${encodeURIComponent(workspace)}`,
    });
    const afterDeleteResponse = await app.inject({
      method: 'GET',
      url: `/api/previews?root=${encodeURIComponent(workspace)}`,
    });
    await app.close();

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      root: realpathSync(workspace),
      ports: [
        {
          port: 5173,
          pid: 123,
          command: 'vite',
          cwd: realpathSync(workspace),
          url: '/preview/5173/',
        },
      ],
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ ok: true, port: 5173 });
    expect(afterDeleteResponse.json().ports).toEqual([]);
  });

  it('proxies HTTP requests to a local preview port', async () => {
    const upstream = createHttpServer((request, response) => {
      response.setHeader('content-type', 'text/plain');
      response.end(`upstream ${request.method} ${request.url}`);
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

    const app = Fastify();
    await app.register(fastifyWebsocket);
    registerPreviewRoutes(app);
    const response = await app.inject({
      method: 'GET',
      url: `/preview/${address.port}/hello?name=cubby`,
    });
    await app.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toBe('upstream GET /hello?name=cubby');
  });

  it('proxies WebSocket traffic to a local preview port', async () => {
    const upstreamServer = createHttpServer();
    const upstreamWs = new WebSocketServer({ server: upstreamServer });
    upstreamWs.on('connection', (socket) => {
      socket.on('message', (message) => {
        socket.send(`echo:${message.toString()}`);
      });
    });
    await new Promise<void>((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve));
    const upstreamAddress = upstreamServer.address();
    if (!upstreamAddress || typeof upstreamAddress === 'string') {
      throw new Error('Expected TCP server address');
    }

    const app = Fastify();
    await app.register(fastifyWebsocket);
    registerPreviewRoutes(app);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const proxyAddress = app.server.address();
    if (!proxyAddress || typeof proxyAddress === 'string') {
      throw new Error('Expected TCP server address');
    }

    const message = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${proxyAddress.port}/preview/${upstreamAddress.port}/ws`,
      );
      socket.once('open', () => socket.send('hello'));
      socket.once('message', (data) => {
        resolve(data.toString());
        socket.close();
      });
      socket.once('error', reject);
    });

    await app.close();
    upstreamWs.close();
    await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));

    expect(message).toBe('echo:hello');
  });
});
