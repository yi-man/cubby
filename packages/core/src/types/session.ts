export const SESSION_STATUS = ['draft', 'starting', 'running', 'idle', 'ended'] as const;
export type SessionStatus = (typeof SESSION_STATUS)[number];

export interface Session {
  id: string;
  workspaceId: string;
  title: string | null;
  provider: string;
  providerSessionId: string | null;
  model: string | null;
  yolo: boolean;
  baselineGitHead: string | null;
  status: SessionStatus;
  pid: number | null;
  exitCode: number | null;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  resumable?: boolean;
  resumeUnavailableReason?: string | null;
}

export interface CreateSessionInput {
  workspaceId: string;
  provider: string;
  model?: string;
  title?: string;
  yolo?: boolean;
  baselineGitHead?: string | null;
}

export type SessionReviewChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked';

export interface SessionReviewChange {
  path: string;
  originalPath?: string;
  status: SessionReviewChangeStatus;
}

export interface SessionReviewSummary {
  total: number;
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  untracked: number;
}

export interface VerificationRun {
  id: string;
  sessionId: string;
  workspaceId: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  outputSummary: string;
  startedAt: string;
  completedAt: string;
}

export interface CreateVerificationRunInput {
  sessionId: string;
  workspaceId: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  outputSummary: string;
  startedAt: string;
  completedAt: string;
}

export interface SessionReview {
  sessionId: string;
  workspaceId: string;
  generatedAt: string;
  baselineGitHead: string | null;
  currentGitHead: string | null;
  changedFiles: SessionReviewChange[];
  summary: SessionReviewSummary;
  verificationRuns: VerificationRun[];
  lastOutput: string;
  exitCode: number | null;
}

export type SessionSupervisorStatus = 'unconfigured' | 'watching' | 'idle' | 'stuck' | 'ended';

export interface SessionSupervisor {
  sessionId: string;
  workspaceId: string;
  objective: string;
  updatedAt: string;
}

export interface CreateSessionSupervisorInput {
  sessionId: string;
  workspaceId: string;
  objective: string;
}

export interface SupervisorReview {
  id: string;
  sessionId: string;
  workspaceId: string;
  objective: string | null;
  createdAt: string;
  summary: string;
  suggestions: string[];
  terminalTail: string;
}

export interface CreateSupervisorReviewInput {
  sessionId: string;
  workspaceId: string;
  objective: string | null;
  summary: string;
  suggestions: string[];
  terminalTail: string;
  createdAt?: string;
}

export interface SessionSupervisorState {
  sessionId: string;
  workspaceId: string;
  objective: string | null;
  status: SessionSupervisorStatus;
  lastOutputAt: string | null;
  idleForMs: number;
  stuckReasons: string[];
  reviews: SupervisorReview[];
}
