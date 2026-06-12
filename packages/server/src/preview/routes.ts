import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import WebSocket from 'ws';

export interface WorkspacePort {
  port: number;
  pid: number;
  command: string;
  cwd: string;
  host: string;
  lastActivityAt?: string;
}

export interface PreviewPort extends WorkspacePort {
  id: string;
  url: string;
  lastActivityAt: string;
}

export interface RegisterPreviewRoutesOptions {
  detectPorts?: (root: string) => Promise<WorkspacePort[]>;
  registry?: PreviewRegistry;
}

interface LsofPortRecord {
  port: number;
  pid: number;
  command: string;
  host: string;
}

interface PartialLsofPortRecord extends Partial<LsofPortRecord> {
  protocol?: string;
}

const execFileAsync = promisify(execFile);
const DEFAULT_PREVIEW_HOST = '127.0.0.1';
const LSOF_TIMEOUT_MS = 2500;

export class PreviewRegistry {
  private dismissedPortsByRoot = new Map<string, Set<number>>();

  dismiss(root: string, port: number): void {
    let dismissed = this.dismissedPortsByRoot.get(root);
    if (!dismissed) {
      dismissed = new Set();
      this.dismissedPortsByRoot.set(root, dismissed);
    }
    dismissed.add(port);
  }

  visible(root: string, ports: WorkspacePort[]): PreviewPort[] {
    const dismissed = this.dismissedPortsByRoot.get(root);
    const activePorts = new Set(ports.map((port) => port.port));
    if (dismissed) {
      for (const port of Array.from(dismissed)) {
        if (!activePorts.has(port)) dismissed.delete(port);
      }
    }

    return ports
      .filter((port) => !dismissed?.has(port.port))
      .map((port) => ({
        ...port,
        id: String(port.port),
        url: `/preview/${port.port}/`,
        lastActivityAt: port.lastActivityAt ?? new Date().toISOString(),
      }));
  }
}

const defaultRegistry = new PreviewRegistry();

export function registerPreviewRoutes(
  app: FastifyInstance,
  options: RegisterPreviewRoutesOptions = {},
) {
  const registry = options.registry ?? defaultRegistry;
  const detectPorts = options.detectPorts ?? detectWorkspacePorts;

  app.get('/api/previews', async (request, reply) => {
    const { root } = request.query as { root?: string };
    if (!root) return reply.code(400).send({ error: 'Workspace root is required' });

    try {
      const workspaceRoot = await realpath(root);
      const ports = registry.visible(workspaceRoot, await detectPorts(workspaceRoot));
      return { root: workspaceRoot, ports };
    } catch (err) {
      return sendPreviewError(reply, err);
    }
  });

  app.delete('/api/previews/:port', async (request, reply) => {
    const { root } = request.query as { root?: string };
    const port = portFromParams(request.params);
    if (!root) return reply.code(400).send({ error: 'Workspace root is required' });
    if (!port) return reply.code(400).send({ error: 'Valid preview port is required' });

    try {
      registry.dismiss(await realpath(root), port);
      return { ok: true, port };
    } catch (err) {
      return sendPreviewError(reply, err);
    }
  });

  app.route({
    method: 'GET',
    url: '/preview/:port/*',
    handler: proxyHttpPreview,
    wsHandler: proxyWebSocketPreview,
  });

  app.route({
    method: ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    url: '/preview/:port/*',
    handler: proxyHttpPreview,
  });
}

export async function detectWorkspacePorts(root: string): Promise<WorkspacePort[]> {
  const workspaceRoot = await realpath(root);
  const rootCandidates = uniquePaths([workspaceRoot, resolve(root)]);
  const records = parseLsofListeningPorts(
    await runLsof(['-nP', '-iTCP', '-sTCP:LISTEN', '-FpPcLn']),
  );
  const ports = (
    await Promise.all(
      records.map(async (record): Promise<WorkspacePort | null> => {
        const cwd = await cwdForPid(record.pid);
        if (!cwd || !isPathInsideAnyRoot(rootCandidates, cwd)) return null;

        let resolvedCwd = cwd;
        try {
          resolvedCwd = await realpath(cwd);
        } catch {}

        if (!isPathInsideRoot(workspaceRoot, resolvedCwd)) return null;
        return {
          ...record,
          cwd: resolvedCwd,
          lastActivityAt: new Date().toISOString(),
        };
      }),
    )
  ).filter((port): port is WorkspacePort => port !== null);

  return ports.sort((left, right) => left.port - right.port);
}

export function parseLsofListeningPorts(output: string): LsofPortRecord[] {
  const records: LsofPortRecord[] = [];
  let current: PartialLsofPortRecord = {};

  const flush = () => {
    if (
      typeof current.pid === 'number' &&
      typeof current.port === 'number' &&
      current.command &&
      current.host &&
      (!current.protocol || current.protocol === 'TCP')
    ) {
      records.push({
        pid: current.pid,
        port: current.port,
        command: current.command,
        host: current.host,
      });
    }
  };

  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const type = line[0];
    const value = line.slice(1);
    if (type === 'p') {
      flush();
      current = { pid: Number(value) };
      continue;
    }
    if (type === 'c') {
      current.command = value;
      continue;
    }
    if (type === 'P') {
      current.protocol = value;
      continue;
    }
    if (type === 'n') {
      const endpoint = parseListenEndpoint(value);
      if (endpoint) {
        current.port = endpoint.port;
        current.host = endpoint.host;
      }
    }
  }
  flush();

  return records;
}

async function proxyHttpPreview(request: FastifyRequest, reply: FastifyReply) {
  const target = previewTargetUrl(request, 'http');
  if (!target) return reply.code(400).send({ error: 'Valid preview port is required' });

  try {
    const init: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers: proxyRequestHeaders(request.headers),
      redirect: 'manual',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = Readable.toWeb(request.raw) as unknown as BodyInit;
      init.duplex = 'half';
    }

    const response = await fetch(target, init);

    reply.code(response.status);
    response.headers.forEach((value, key) => {
      if (isHopByHopHeader(key)) return;
      reply.header(key, value);
    });
    return reply.send(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    request.log.warn({ err, target }, 'Preview HTTP proxy failed');
    return reply.code(502).send({ error: 'Preview target is not reachable' });
  }
}

function proxyWebSocketPreview(socket: WebSocket, request: FastifyRequest): void {
  const target = previewTargetUrl(request, 'ws');
  if (!target) {
    socket.close(1008, 'Valid preview port is required');
    return;
  }

  const upstream = new WebSocket(target);
  const queuedMessages: WebSocket.RawData[] = [];

  socket.on('message', (message) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(message);
      return;
    }
    queuedMessages.push(message);
  });

  upstream.on('open', () => {
    for (const message of queuedMessages.splice(0)) upstream.send(message);
  });
  upstream.on('message', (message) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  });
  upstream.on('close', (code, reason) => {
    if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
  });
  upstream.on('error', () => {
    if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'Preview target failed');
  });
  socket.on('close', () => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  });
}

function previewTargetUrl(request: FastifyRequest, protocol: 'http' | 'ws'): string | null {
  const port = portFromParams(request.params);
  if (!port) return null;
  const prefix = `/preview/${port}`;
  const originalPath = request.url.startsWith(prefix) ? request.url.slice(prefix.length) : '/';
  const path = originalPath.startsWith('/') ? originalPath : `/${originalPath}`;
  return `${protocol}://${DEFAULT_PREVIEW_HOST}:${port}${path || '/'}`;
}

function portFromParams(params: unknown): number | null {
  const port = Number((params as { port?: string } | undefined)?.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return port;
}

function proxyRequestHeaders(headers: FastifyRequest['headers']): Headers {
  const nextHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (isHopByHopHeader(key) || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) nextHeaders.append(key, item);
    } else {
      nextHeaders.set(key, String(value));
    }
  }
  nextHeaders.set('host', DEFAULT_PREVIEW_HOST);
  return nextHeaders;
}

function isHopByHopHeader(header: string): boolean {
  return [
    'connection',
    'content-encoding',
    'content-length',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ].includes(header.toLowerCase());
}

async function cwdForPid(pid: number): Promise<string | null> {
  const output = await runLsof(['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const cwd = output
    .split(/\r?\n/)
    .find((line) => line.startsWith('n'))
    ?.slice(1);
  return cwd || null;
}

async function runLsof(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('lsof', args, {
      maxBuffer: 1024 * 1024,
      timeout: LSOF_TIMEOUT_MS,
    });
    return stdout;
  } catch {
    return '';
  }
}

function parseListenEndpoint(value: string): { host: string; port: number } | null {
  const endpoint = value.replace(/^TCP\s+/, '').replace(/\s+\(LISTEN\)$/, '');
  const bracketMatch = endpoint.match(/^\[(.+)\]:(\d+)$/);
  if (bracketMatch) {
    return { host: bracketMatch[1] || DEFAULT_PREVIEW_HOST, port: Number(bracketMatch[2]) };
  }

  const colonIndex = endpoint.lastIndexOf(':');
  if (colonIndex < 0) return null;
  const host = endpoint.slice(0, colonIndex);
  const port = Number(endpoint.slice(colonIndex + 1));
  if (!Number.isInteger(port)) return null;
  return { host: host || DEFAULT_PREVIEW_HOST, port };
}

function isPathInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function isPathInsideAnyRoot(roots: string[], target: string): boolean {
  return roots.some((root) => isPathInsideRoot(root, target));
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

function sendPreviewError(reply: FastifyReply, err: unknown) {
  if (isNodeError(err) && err.code === 'ENOENT') {
    return reply.code(404).send({ error: 'Workspace root not found' });
  }
  throw err;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
