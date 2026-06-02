import { describe, expect, it } from 'vitest';
import { ClaudeCodeProvider } from './claude-code.js';

describe('ClaudeCodeProvider', () => {
  it('has correct name', () => {
    const provider = new ClaudeCodeProvider();
    expect(provider.name).toBe('claude-code');
  });

  it('builds correct command args with model', () => {
    const provider = new ClaudeCodeProvider();
    const args = provider.buildArgs({ model: 'sonnet' });
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args).toContain('--print');
  });

  it('builds args without model', () => {
    const provider = new ClaudeCodeProvider();
    const args = provider.buildArgs({});
    expect(args).toContain('--print');
    expect(args).not.toContain('--model');
  });
});
