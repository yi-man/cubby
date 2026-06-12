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

export interface SessionReview {
  sessionId: string;
  workspaceId: string;
  generatedAt: string;
  baselineGitHead: string | null;
  currentGitHead: string | null;
  changedFiles: SessionReviewChange[];
  summary: SessionReviewSummary;
  lastOutput: string;
  exitCode: number | null;
}
