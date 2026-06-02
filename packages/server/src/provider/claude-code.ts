import { spawn } from 'node:child_process';
import type { AgentProcess, AgentProvider, SpawnOptions } from '@cubby/core';
import { RingBuffer } from '../terminal/ring-buffer.js';

export class ClaudeCodeProvider implements AgentProvider {
  readonly name = 'claude-code';

  buildArgs(options: { model?: string }): string[] {
    const args = ['--print'];
    if (options.model) {
      args.push('--model', options.model);
    }
    return args;
  }

  async spawn(
    _sessionId: string,
    options: SpawnOptions,
    onOutput: (data: string) => void,
    onExit: (code: number) => void,
  ): Promise<AgentProcess & { ringBuffer: RingBuffer }> {
    const args = this.buildArgs({});
    const ringBuffer = new RingBuffer(5000);

    const child = spawn('claude', args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      ringBuffer.push(text);
      onOutput(text);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      ringBuffer.push(text);
      onOutput(text);
    });

    child.on('exit', (code) => {
      onExit(code ?? 1);
    });

    const agentProcess: AgentProcess & { ringBuffer: RingBuffer } = {
      pid: child.pid ?? 0,
      onData: (cb) => {
        child.stdout?.on('data', (d: Buffer) => cb(d.toString()));
      },
      onExit: (cb) => {
        child.on('exit', (c) => cb(c ?? 1));
      },
      write: (data) => {
        child.stdin?.write(data);
      },
      resize: () => {},
      kill: () => {
        child.kill('SIGTERM');
      },
      ringBuffer,
    };

    return agentProcess;
  }

  async kill(agentProcess: AgentProcess): Promise<void> {
    agentProcess.kill();
  }
}
