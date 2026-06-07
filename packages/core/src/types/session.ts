export const SESSION_STATUS = ['draft', 'starting', 'running', 'idle', 'ended'] as const;
export type SessionStatus = (typeof SESSION_STATUS)[number];

export interface Session {
  id: string;
  workspaceId: string;
  title: string | null;
  provider: string;
  providerSessionId: string | null;
  model: string | null;
  status: SessionStatus;
  pid: number | null;
  exitCode: number | null;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface CreateSessionInput {
  workspaceId: string;
  provider: string;
  model?: string;
  title?: string;
}
