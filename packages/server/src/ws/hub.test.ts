import { describe, expect, it, vi } from 'vitest';
import { WebSocketHub } from './hub.js';

function createMockSocket() {
  const sent: unknown[] = [];
  return {
    readyState: 1, // OPEN
    send: vi.fn((data: string) => sent.push(data)),
    sent,
  };
}

describe('WebSocketHub', () => {
  it('subscribes and broadcasts to topic', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.subscribe(ws as any, 'session:1');
    hub.broadcast('session:1', { evt: 'test', data: { ok: true } });
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws.sent[0] as string)).toEqual({ evt: 'test', data: { ok: true } });
  });

  it('does not broadcast to unsubscribed', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.subscribe(ws as any, 'session:1');
    hub.broadcast('session:2', { evt: 'test', data: {} });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('unsubscribes correctly', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.subscribe(ws as any, 'session:1');
    hub.unsubscribe(ws as any, 'session:1');
    hub.broadcast('session:1', { evt: 'test', data: {} });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('removes all subscriptions on disconnect', () => {
    const hub = new WebSocketHub();
    const ws = createMockSocket();
    hub.subscribe(ws as any, 'session:1');
    hub.subscribe(ws as any, 'session:2');
    hub.removeClient(ws as any);
    hub.broadcast('session:1', { evt: 'test', data: {} });
    hub.broadcast('session:2', { evt: 'test', data: {} });
    expect(ws.send).not.toHaveBeenCalled();
  });
});
