import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { WebSocketHub } from './hub.js';

function createMockSocket() {
  const handlers = new Map<string, Array<() => void>>();
  const sent: unknown[] = [];
  return {
    readyState: 1, // OPEN
    send: vi.fn((data: string) => sent.push(data)),
    ping: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    emit: (event: string) => {
      for (const handler of handlers.get(event) ?? []) handler();
    },
    sent,
  };
}

function asWebSocket(socket: ReturnType<typeof createMockSocket>): WebSocket {
  return socket as unknown as WebSocket;
}

describe('WebSocketHub', () => {
  it('subscribes and broadcasts to topic', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.subscribe(asWebSocket(ws), 'session:1');
    hub.broadcast('session:1', { evt: 'test', data: { ok: true } });
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws.sent[0] as string)).toEqual({ evt: 'test', data: { ok: true } });
  });

  it('does not broadcast to unsubscribed', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.subscribe(asWebSocket(ws), 'session:1');
    hub.broadcast('session:2', { evt: 'test', data: {} });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('unsubscribes correctly', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.subscribe(asWebSocket(ws), 'session:1');
    hub.unsubscribe(asWebSocket(ws), 'session:1');
    hub.broadcast('session:1', { evt: 'test', data: {} });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('removes all subscriptions on disconnect', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.subscribe(asWebSocket(ws), 'session:1');
    hub.subscribe(asWebSocket(ws), 'session:2');
    hub.removeClient(asWebSocket(ws));
    hub.broadcast('session:1', { evt: 'test', data: {} });
    hub.broadcast('session:2', { evt: 'test', data: {} });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('pings open clients and keeps clients that answer pong', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.addClient(asWebSocket(ws));

    hub.pingClients(1000, { timeoutMs: 100 });
    ws.emit('pong');
    hub.pingClients(1101, { timeoutMs: 100 });

    expect(ws.ping).toHaveBeenCalledTimes(2);
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it('terminates open clients that miss the keepalive timeout', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.addClient(asWebSocket(ws));

    hub.pingClients(1000, { timeoutMs: 100 });
    hub.pingClients(1101, { timeoutMs: 100 });

    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.terminate).toHaveBeenCalledTimes(1);
  });

  it('closes all clients and removes their subscriptions during shutdown', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.addClient(asWebSocket(ws));
    hub.subscribe(asWebSocket(ws), 'session:1');

    hub.closeAll();
    hub.broadcast('session:1', { evt: 'test', data: {} });

    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(ws.send).not.toHaveBeenCalled();
  });
});
