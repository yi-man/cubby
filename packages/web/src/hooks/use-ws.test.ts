import { describe, expect, it } from 'vitest';
import { parseWSMessage, serializeWSRequest } from './use-ws.js';

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
});
