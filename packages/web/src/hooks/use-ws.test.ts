import { WS_COMMANDS } from '@cubby/core';
import { describe, expect, it } from 'vitest';
import {
  buildResubscribeRequests,
  parseWSMessage,
  reconnectDelayMs,
  rememberTerminalSubscription,
  serializeWSRequest,
} from './use-ws.js';

describe('WS utils', () => {
  it('serializes request', () => {
    const msg = serializeWSRequest({ id: '1', cmd: 'session.list' });
    const parsed = JSON.parse(msg);
    expect(parsed.id).toBe('1');
    expect(parsed.cmd).toBe('session.list');
  });

  it('parses response', () => {
    const msg = JSON.stringify({ id: '1', ok: true, data: [] });
    const parsed = parseWSMessage(msg);
    expect(parsed).toEqual({ id: '1', ok: true, data: [] });
  });

  it('parses event', () => {
    const msg = JSON.stringify({ evt: 'terminal.output', data: { data: 'hello' } });
    const parsed = parseWSMessage(msg);
    expect(parsed).toEqual({ evt: 'terminal.output', data: { data: 'hello' } });
  });

  it('uses capped exponential reconnect delays', () => {
    expect([0, 1, 2, 3, 4, 5].map((attempt) => reconnectDelayMs(attempt))).toEqual([
      250, 500, 1000, 2000, 4000, 5000,
    ]);
    expect(reconnectDelayMs(12)).toBe(5000);
  });

  it('remembers terminal subscriptions and builds resubscribe requests', () => {
    const subscriptions = new Map<string, { sessionId: string }>();

    rememberTerminalSubscription(subscriptions, {
      id: 'sub-1',
      cmd: WS_COMMANDS.TERMINAL_SUBSCRIBE,
      args: { sessionId: 's1' },
    });
    rememberTerminalSubscription(subscriptions, {
      id: 'sub-2',
      cmd: WS_COMMANDS.TERMINAL_SUBSCRIBE,
      args: { sessionId: 's2' },
    });
    rememberTerminalSubscription(subscriptions, {
      id: 'unsub-1',
      cmd: WS_COMMANDS.TERMINAL_UNSUBSCRIBE,
      args: { sessionId: 's1' },
    });

    expect(buildResubscribeRequests(subscriptions, () => 123)).toEqual([
      {
        id: 'resub-s2-123',
        cmd: WS_COMMANDS.TERMINAL_SUBSCRIBE,
        args: { sessionId: 's2' },
      },
    ]);
  });
});
