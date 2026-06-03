import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { WebSocketHub } from './hub.js';

function createMockSocket() {
  const sent: unknown[] = [];
  return {
    readyState: 1, // OPEN
    send: vi.fn((data: string) => sent.push(data)),
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
});
