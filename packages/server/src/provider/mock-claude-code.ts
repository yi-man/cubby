import type { AgentProcess, AgentProvider, SpawnOptions } from '@cubby/core';

type DataListener = (data: string) => void;
type ExitListener = (code: number) => void;

export class MockClaudeCodeProvider implements AgentProvider {
  readonly name = 'claude-code';
  private nextPid = 50_000;

  async spawn(
    sessionId: string,
    options: SpawnOptions,
    onOutput: DataListener = () => {},
    onExit: ExitListener = () => {},
  ): Promise<AgentProcess> {
    const dataListeners: DataListener[] = [];
    const exitListeners: ExitListener[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let exited = false;

    const emitData = (data: string) => {
      if (exited) return;
      onOutput(data);
      for (const listener of dataListeners) listener(data);
    };

    const emitExit = (code: number) => {
      if (exited) return;
      exited = true;
      for (const timer of timers) clearTimeout(timer);
      onExit(code);
      for (const listener of exitListeners) listener(code);
    };

    const startupMessage = () => {
      const mode = options.resume ? 'resumed' : 'ready';
      emitData(`Mock Claude Code ${mode} for ${sessionId.slice(0, 8)}\r\n`);
    };
    for (const delay of [50, 200, 500]) {
      timers.push(
        setTimeout(() => {
          startupMessage();
        }, delay),
      );
    }
    timers.push(
      setTimeout(() => {
        const mode = options.resume ? 'resumed' : 'ready';
        emitData(`Mock Claude Code ${mode}; waiting for input\r\n`);
      }, 1000),
    );

    return {
      pid: this.nextPid++,
      onData: (callback) => {
        dataListeners.push(callback);
      },
      onExit: (callback) => {
        exitListeners.push(callback);
      },
      write: (data) => {
        emitData(data);
      },
      resize: () => {},
      kill: () => {
        emitExit(0);
      },
    };
  }

  async kill(process: AgentProcess): Promise<void> {
    process.kill();
  }
}
