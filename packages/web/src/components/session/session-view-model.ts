import type { Session, WSResponse } from '@cubby/core';

export type ResumeActionState =
  | { kind: 'enabled' }
  | { kind: 'hidden' }
  | { kind: 'unavailable'; label: string; reason: string };

export function resumeActionState(session: Session): ResumeActionState {
  if (session.status !== 'ended') return { kind: 'hidden' };
  if (session.resumable === false) {
    return {
      kind: 'unavailable',
      label: 'Not resumable',
      reason: session.resumeUnavailableReason?.trim() || 'This session cannot be resumed.',
    };
  }
  if (
    (session.provider === 'codex' || session.provider === 'opencode') &&
    !session.providerSessionId
  ) {
    return {
      kind: 'unavailable',
      label: 'Not resumable',
      reason: 'Provider conversation not found',
    };
  }
  return { kind: 'enabled' };
}

export function resumeErrorMessage(response: WSResponse): string | null {
  if (response.ok) return null;
  const message = response.error?.message?.trim();
  return message ? `Resume failed: ${message}` : 'Resume failed';
}
