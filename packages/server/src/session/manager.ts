import type {
  AgentProcess,
  AgentProvider,
  CreateSessionInput,
  Session,
  SpawnOptions,
} from '@cubby/core';
import type { SessionStore } from './store.js';

export class SessionManager {
  private providers = new Map<string, AgentProvider>();
  private processes = new Map<string, AgentProcess>();

  constructor(private store: SessionStore) {}

  registerProvider(provider: AgentProvider): void {
    this.providers.set(provider.name, provider);
  }

  createSession(input: CreateSessionInput): Session {
    return this.store.create(input);
  }

  getSession(id: string): Session | null {
    return this.store.get(id);
  }

  listSessions(): Session[] {
    return this.store.list();
  }

  async startSession(
    sessionId: string,
    options: SpawnOptions,
    onOutput?: (data: string) => void,
  ): Promise<void> {
    const session = this.store.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.status !== 'draft')
      throw new Error(`Session not in draft status: ${session.status}`);

    const provider = this.providers.get(session.provider);
    if (!provider) throw new Error(`Provider not found: ${session.provider}`);

    this.store.updateStatus(sessionId, 'starting');

    try {
      const spawnFn = provider.spawn as (
        sessionId: string,
        options: SpawnOptions,
        onOutput: (data: string) => void,
        onExit: (code: number) => void,
      ) => Promise<AgentProcess>;

      const process = await spawnFn(
        sessionId,
        options,
        (data) => {
          if (this.processes.has(sessionId)) {
            this.store.updateStatus(sessionId, 'running');
          }
          onOutput?.(data);
        },
        (code) => {
          if (this.processes.has(sessionId)) {
            this.store.updateStatus(sessionId, 'ended', { exitCode: code, pid: process.pid });
            this.processes.delete(sessionId);
          }
        },
      );

      this.processes.set(sessionId, process);
      this.store.updateStatus(sessionId, 'running', { pid: process.pid });
    } catch (err) {
      this.store.updateStatus(sessionId, 'ended', { exitCode: 1 });
      throw err;
    }
  }

  async killSession(sessionId: string): Promise<void> {
    const process = this.processes.get(sessionId);
    if (process) {
      process.kill();
      this.processes.delete(sessionId);
    }
    this.store.updateStatus(sessionId, 'ended');
  }

  getProcess(sessionId: string): AgentProcess | undefined {
    return this.processes.get(sessionId);
  }
}
