import type { AgentProcess, AgentProvider, SpawnOptions } from '@cubby/core';

type DataListener = (data: string) => void;
type ExitListener = (code: number) => void;

export class MockOpenCodeProvider implements AgentProvider {
  readonly name = 'opencode';
  readonly supportsResume = true;
  private nextPid = 70_000;

  async spawn(
    sessionId: string,
    options: SpawnOptions,
    onOutput: DataListener = () => {},
    onExit: ExitListener = () => {},
    onProviderSessionId: (providerSessionId: string) => void = () => {},
  ): Promise<AgentProcess> {
    if (options.resume && !options.providerSessionId) {
      throw new Error('Mock OpenCode resume requires a provider session id');
    }
    if (!options.resume) onProviderSessionId(`mock-opencode-${sessionId}`);

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
        emitData(`Mock OpenCode ready for ${sessionId.slice(0, 8)}\r\n`);
      }, 50),
    );
    timers.push(
      setTimeout(() => {
        emitData('Mock OpenCode ready; waiting for input\r\n');
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

  hasConversation(_sessionId: string, _cwd: string, providerSessionId?: string): boolean {
    return Boolean(providerSessionId);
  }

  getTranscriptHistory(_sessionId: string, _cwd: string): string[] {
    return [];
  }

  async kill(process: AgentProcess): Promise<void> {
    process.kill();
  }
}
