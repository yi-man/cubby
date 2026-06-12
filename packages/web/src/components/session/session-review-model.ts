import type {
  SessionReview,
  SessionReviewChange,
  SessionReviewChangeStatus,
  SessionReviewSummary,
  VerificationRun,
} from '@cubby/core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSessionReviewChangeStatus(value: unknown): value is SessionReviewChangeStatus {
  return (
    value === 'added' ||
    value === 'modified' ||
    value === 'deleted' ||
    value === 'renamed' ||
    value === 'copied' ||
    value === 'untracked'
  );
}

function isSessionReviewChange(value: unknown): value is SessionReviewChange {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    (typeof value.originalPath === 'string' || value.originalPath === undefined) &&
    isSessionReviewChangeStatus(value.status)
  );
}

function isSessionReviewSummary(value: unknown): value is SessionReviewSummary {
  return (
    isRecord(value) &&
    typeof value.total === 'number' &&
    typeof value.added === 'number' &&
    typeof value.modified === 'number' &&
    typeof value.deleted === 'number' &&
    typeof value.renamed === 'number' &&
    typeof value.untracked === 'number'
  );
}

function isVerificationRun(value: unknown): value is VerificationRun {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.workspaceId === 'string' &&
    typeof value.command === 'string' &&
    (typeof value.exitCode === 'number' || value.exitCode === null) &&
    typeof value.durationMs === 'number' &&
    typeof value.outputSummary === 'string' &&
    typeof value.startedAt === 'string' &&
    typeof value.completedAt === 'string'
  );
}

export function isSessionReviewResponse(value: unknown): value is SessionReview {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.workspaceId === 'string' &&
    typeof value.generatedAt === 'string' &&
    (typeof value.baselineGitHead === 'string' || value.baselineGitHead === null) &&
    (typeof value.currentGitHead === 'string' || value.currentGitHead === null) &&
    Array.isArray(value.changedFiles) &&
    value.changedFiles.every(isSessionReviewChange) &&
    isSessionReviewSummary(value.summary) &&
    Array.isArray(value.verificationRuns) &&
    value.verificationRuns.every(isVerificationRun) &&
    typeof value.lastOutput === 'string' &&
    (typeof value.exitCode === 'number' || value.exitCode === null)
  );
}

export function sessionReviewSummaryLabel(summary: Pick<SessionReviewSummary, 'total'>): string {
  if (summary.total === 0) return 'No file changes';
  return `${summary.total} ${summary.total === 1 ? 'file' : 'files'} changed`;
}

export function sessionReviewStatusDisplay(status: SessionReviewChangeStatus): {
  label: string;
  title: string;
} {
  switch (status) {
    case 'added':
      return { label: 'Add', title: 'Added' };
    case 'modified':
      return { label: 'Mod', title: 'Modified' };
    case 'deleted':
      return { label: 'Del', title: 'Deleted' };
    case 'renamed':
      return { label: 'Ren', title: 'Renamed' };
    case 'copied':
      return { label: 'Copy', title: 'Copied' };
    case 'untracked':
      return { label: 'New', title: 'Untracked' };
  }
}

export function shortGitHead(head: string | null): string {
  return head ? head.slice(0, 7) : 'none';
}

export function verificationRunStatusLabel(exitCode: number | null): string {
  if (exitCode === 0) return 'Passed';
  if (exitCode === null) return 'No exit';
  return `Failed ${exitCode}`;
}

export function formatVerificationDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}
