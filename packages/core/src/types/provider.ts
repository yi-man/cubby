export interface SpawnOptions {
  cwd: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
}

export interface AgentProvider {
  name: string;
  spawn(sessionId: string, options: SpawnOptions): Promise<AgentProcess>;
  kill(process: AgentProcess): Promise<void>;
}

export interface AgentProcess {
  pid: number;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (code: number) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}
