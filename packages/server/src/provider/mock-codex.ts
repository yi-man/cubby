import type { AgentProcess, AgentProvider, SpawnOptions } from '@cubby/core';

type DataListener = (data: string) => void;
type ExitListener = (code: number) => void;

export class MockCodexProvider implements AgentProvider {
  readonly name = 'codex';
  readonly supportsResume = false;
  private nextPid = 60_000;

  async spawn(
    sessionId: string,
    options: SpawnOptions,
    onOutput: DataListener = () => {},
    onExit: ExitListener = () => {},
  ): Promise<AgentProcess> {
    if (options.resume) {
      throw new Error('Mock Codex sessions cannot be resumed');
    }

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

    timers.push(
      setTimeout(() => {
        emitData(`Mock Codex ready for ${sessionId.slice(0, 8)}\r\n`);
      }, 50),
    );
    timers.push(
      setTimeout(() => {
        emitData('Mock Codex ready; waiting for input\r\n');
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

  hasConversation(_sessionId: string, _cwd: string): boolean {
    return false;
  }

  getTranscriptHistory(_sessionId: string, _cwd: string): string[] {
    return [];
  }

  async kill(process: AgentProcess): Promise<void> {
    process.kill();
  }
}
