import type {
  SessionSupervisorState,
  SessionSupervisorStatus,
  SupervisorReview,
} from '@cubby/core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSupervisorStatus(value: unknown): value is SessionSupervisorStatus {
  return (
    value === 'unconfigured' ||
    value === 'watching' ||
    value === 'idle' ||
    value === 'stuck' ||
    value === 'ended'
  );
}

export function isSupervisorReviewResponse(value: unknown): value is SupervisorReview {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.workspaceId === 'string' &&
    (typeof value.objective === 'string' || value.objective === null) &&
    typeof value.createdAt === 'string' &&
    typeof value.summary === 'string' &&
    Array.isArray(value.suggestions) &&
    value.suggestions.every((suggestion) => typeof suggestion === 'string') &&
    typeof value.terminalTail === 'string'
  );
}

export function isSupervisorStateResponse(value: unknown): value is SessionSupervisorState {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.workspaceId === 'string' &&
    (typeof value.objective === 'string' || value.objective === null) &&
    isSupervisorStatus(value.status) &&
    (typeof value.lastOutputAt === 'string' || value.lastOutputAt === null) &&
    typeof value.idleForMs === 'number' &&
    Array.isArray(value.stuckReasons) &&
    value.stuckReasons.every((reason) => typeof reason === 'string') &&
    Array.isArray(value.reviews) &&
    value.reviews.every(isSupervisorReviewResponse)
  );
}

export function supervisorStatusLabel(status: SessionSupervisorStatus): string {
  switch (status) {
    case 'unconfigured':
      return 'No objective';
    case 'watching':
      return 'Watching';
    case 'idle':
      return 'Idle';
    case 'stuck':
      return 'Stuck';
    case 'ended':
      return 'Ended';
  }
}

export function supervisorSuggestionPreview(suggestion: string): string {
  if (suggestion.length <= 80) return suggestion;
  return `${suggestion.slice(0, 77)}...`;
}
