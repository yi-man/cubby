import { describe, expect, it } from 'vitest';
import { sanitizeEndedReplayChunks } from './terminal-replay.js';

describe('sanitizeEndedReplayChunks', () => {
  it('removes Claude CLI resume instructions from ended replay history', () => {
    const chunks = [
      'before\r\n',
      'Resume this session with:\r\nclaude --resume 2000108b-e27a-48e8-be3a-64c8159d618c\r\n',
      'after',
    ];

    expect(sanitizeEndedReplayChunks(chunks).join('')).toBe('before\r\nafter');
  });

  it('removes background colors while preserving foreground and cursor control sequences', () => {
    const chunks = [
      '\x1b[48;2;55;55;55m/theme    \x1b[39m\r\n',
      '\x1b[100mwide prompt\x1b[49m\r\n',
      '\x1b[38;2;255;255;255mvisible\x1b[39m\x1b[12G',
    ];

    const sanitized = sanitizeEndedReplayChunks(chunks).join('');

    expect(sanitized).toContain('/theme');
    expect(sanitized).toContain('\x1b[38;2;255;255;255mvisible\x1b[39m');
    expect(sanitized).toContain('\x1b[12G');
    expect(sanitized).not.toContain('48;2;55;55;55');
    expect(sanitized).not.toContain('\x1b[100m');
    expect(sanitized).not.toContain('\x1b[49m');
  });
});
