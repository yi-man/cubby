import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockClaudeCodeProvider } from './mock-claude-code.js';

describe('MockClaudeCodeProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('emits a single startup ready line before waiting for input', async () => {
    const provider = new MockClaudeCodeProvider();
    const output: string[] = [];

    await provider.spawn(
      '32979fa6-0000-4000-8000-000000000000',
      { cwd: '/tmp', cols: 80, rows: 24 },
      (data) => output.push(data),
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(
      output.filter((line) => line.includes('Mock Claude Code ready for 32979fa6')),
    ).toHaveLength(1);
    expect(output).toContain('Mock Claude Code ready; waiting for input\r\n');
  });
});
