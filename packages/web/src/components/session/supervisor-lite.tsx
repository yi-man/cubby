import type { SessionSupervisorState, SupervisorReview } from '@cubby/core';
import { Loader2, MessageSquareText, RefreshCw, Send, Target, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  isSupervisorReviewResponse,
  isSupervisorStateResponse,
  supervisorStatusLabel,
  supervisorSuggestionPreview,
} from './supervisor-lite-model.js';

interface SupervisorLiteProps {
  sessionId: string;
  rootPath: string;
  canInject: boolean;
  onClose: () => void;
  onInjectSuggestion?: (suggestion: string) => void;
}

const ICON_PROPS = { size: 15, strokeWidth: 2.1, 'aria-hidden': true } as const;
const SUPERVISOR_Z_INDEX = 1000;

export function SupervisorLite({
  sessionId,
  rootPath,
  canInject,
  onClose,
  onInjectSuggestion,
}: SupervisorLiteProps) {
  const [state, setState] = useState<SessionSupervisorState | null>(null);
  const [objectiveInput, setObjectiveInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');
  const latestReview = state?.reviews[0] ?? null;
  const statusTone = state ? supervisorStatusTone(state.status) : supervisorStatusTone('watching');
  const sortedReviews = useMemo(() => state?.reviews ?? [], [state]);

  const applyState = useCallback((nextState: SessionSupervisorState) => {
    setState(nextState);
    setObjectiveInput(nextState.objective ?? '');
  }, []);

  const loadState = useCallback(async () => {
    setError('');
    try {
      const response = await fetch(`/api/sessions/${sessionId}/supervisor`);
      if (!response.ok) {
        setError('Supervisor unavailable');
        return;
      }
      const data = await response.json();
      if (!isSupervisorStateResponse(data)) {
        setError('Supervisor unavailable');
        return;
      }
      applyState(data);
    } catch {
      setError('Supervisor unavailable');
    } finally {
      setLoading(false);
    }
  }, [applyState, sessionId]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const saveObjective = useCallback(async () => {
    const objective = objectiveInput.trim();
    if (!objective) {
      setError('Session objective is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/sessions/${sessionId}/supervisor/objective`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective }),
      });
      if (!response.ok) {
        setError('Objective could not be saved');
        return;
      }
      const data = await response.json();
      if (!isSupervisorStateResponse(data)) {
        setError('Objective could not be saved');
        return;
      }
      applyState(data);
    } catch {
      setError('Objective could not be saved');
    } finally {
      setSaving(false);
    }
  }, [applyState, objectiveInput, sessionId]);

  const runReviewer = useCallback(async () => {
    setReviewing(true);
    setError('');
    try {
      const response = await fetch(`/api/sessions/${sessionId}/supervisor/reviews`, {
        method: 'POST',
      });
      if (!response.ok) {
        setError('Reviewer failed');
        return;
      }
      const data = await response.json();
      if (!isSupervisorReviewResponse(data)) {
        setError('Reviewer failed');
        return;
      }
      await loadState();
    } catch {
      setError('Reviewer failed');
    } finally {
      setReviewing(false);
    }
  }, [loadState, sessionId]);

  const injectSuggestion = useCallback(
    (suggestion: string) => {
      if (!onInjectSuggestion || !canInject) return;
      if (!window.confirm('Inject this suggestion into the terminal?')) return;
      onInjectSuggestion(suggestion);
    },
    [canInject, onInjectSuggestion],
  );

  return (
    <div
      data-testid="supervisor-lite-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: SUPERVISOR_Z_INDEX,
        background: 'rgba(0, 0, 0, 0.66)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '18px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="supervisor-lite-title"
        style={{
          width: 'min(900px, 100%)',
          height: 'min(640px, calc(100dvh - 36px))',
          minHeight: 0,
          border: '1px solid #2a2d2a',
          borderRadius: '8px',
          background: '#0c0e0d',
          color: '#f4f3ea',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.56)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            minHeight: '46px',
            borderBottom: '1px solid #242624',
            padding: '0 12px 0 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'linear-gradient(180deg, #111412 0%, #0c0e0d 100%)',
          }}
        >
          <Target {...ICON_PROPS} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              id="supervisor-lite-title"
              style={{ margin: 0, color: '#ffffff', fontSize: '14px', fontWeight: 700 }}
            >
              Supervisor
            </h2>
            <div
              title={rootPath}
              style={{
                marginTop: '2px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: '#8d928b',
                fontFamily: 'monospace',
                fontSize: '11px',
              }}
            >
              {rootPath}
            </div>
          </div>
          <button
            type="button"
            aria-label="Refresh supervisor"
            title="Refresh"
            onClick={() => void loadState()}
            disabled={loading}
            style={iconButtonStyle(!loading)}
          >
            {loading ? <Loader2 {...ICON_PROPS} /> : <RefreshCw {...ICON_PROPS} />}
          </button>
          <button
            type="button"
            aria-label="Close supervisor"
            title="Close"
            onClick={onClose}
            style={iconButtonStyle(true)}
          >
            <X {...ICON_PROPS} />
          </button>
        </div>

        <div
          style={{
            minHeight: 0,
            flex: 1,
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 0.86fr) minmax(340px, 1.14fr)',
            overflow: 'hidden',
            background: '#050606',
          }}
        >
          <section
            aria-label="Supervisor status"
            style={{
              minWidth: 0,
              minHeight: 0,
              borderRight: '1px solid #242624',
              display: 'flex',
              flexDirection: 'column',
              padding: '14px',
              gap: '12px',
              overflow: 'auto',
            }}
          >
            <div>
              <label
                htmlFor="supervisor-objective"
                style={{
                  display: 'block',
                  marginBottom: '7px',
                  color: '#d7d5ca',
                  fontSize: '12px',
                  fontWeight: 750,
                }}
              >
                Session objective
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  id="supervisor-objective"
                  aria-label="Session objective"
                  value={objectiveInput}
                  onChange={(event) => setObjectiveInput(event.target.value)}
                  style={objectiveInputStyle}
                />
                <button
                  type="button"
                  onClick={() => void saveObjective()}
                  disabled={saving || !objectiveInput.trim()}
                  style={primaryButtonStyle(!saving && Boolean(objectiveInput.trim()))}
                >
                  {saving ? 'Saving' : 'Save objective'}
                </button>
              </div>
            </div>

            <div
              data-testid="supervisor-status"
              style={{
                border: `1px solid ${statusTone.border}`,
                borderRadius: '6px',
                background: statusTone.background,
                color: statusTone.color,
                padding: '10px 11px',
                fontSize: '12px',
                fontWeight: 800,
              }}
            >
              {state ? supervisorStatusLabel(state.status) : 'Loading'}
            </div>

            <div style={{ color: '#8d928b', fontSize: '12px', lineHeight: 1.5 }}>
              <div>
                Last output: {state?.lastOutputAt ? formatDateTime(state.lastOutputAt) : 'none'}
              </div>
              <div>Idle: {formatIdleFor(state?.idleForMs ?? 0)}</div>
            </div>

            {state?.stuckReasons.length ? (
              <div style={{ display: 'grid', gap: '7px' }}>
                {state.stuckReasons.map((reason) => (
                  <div
                    key={reason}
                    style={{
                      border: '1px solid #4a3c20',
                      borderRadius: '6px',
                      background: '#1b160b',
                      color: '#e4ca7e',
                      padding: '8px 9px',
                      fontSize: '12px',
                      fontWeight: 650,
                    }}
                  >
                    {reason}
                  </div>
                ))}
              </div>
            ) : null}

            {error ? (
              <div
                role="alert"
                style={{
                  border: '1px solid #4a2b29',
                  borderRadius: '6px',
                  background: '#1f100f',
                  color: '#f0c1b8',
                  padding: '9px 10px',
                  fontSize: '12px',
                  fontWeight: 700,
                }}
              >
                {error}
              </div>
            ) : null}

            <button
              type="button"
              aria-label="Run reviewer"
              onClick={() => void runReviewer()}
              disabled={reviewing || loading}
              style={reviewButtonStyle(!reviewing && !loading)}
            >
              {reviewing ? <Loader2 {...ICON_PROPS} /> : <MessageSquareText {...ICON_PROPS} />}
              <span>{reviewing ? 'Reviewing' : 'Run reviewer'}</span>
            </button>
          </section>

          <section
            aria-label="Supervisor reviews"
            data-testid="supervisor-reviews"
            style={{
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {loading && !state ? (
              <EmptyState label="Loading supervisor" />
            ) : latestReview ? (
              <ReviewList
                reviews={sortedReviews}
                canInject={canInject}
                onInjectSuggestion={injectSuggestion}
              />
            ) : (
              <EmptyState label="No supervisor reviews" />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ReviewList({
  reviews,
  canInject,
  onInjectSuggestion,
}: {
  reviews: SupervisorReview[];
  canInject: boolean;
  onInjectSuggestion: (suggestion: string) => void;
}) {
  return (
    <div
      style={{
        minHeight: 0,
        flex: 1,
        overflow: 'auto',
        padding: '14px',
        display: 'grid',
        gap: '12px',
      }}
    >
      {reviews.map((review) => (
        <article
          key={review.id}
          style={{
            border: '1px solid #252925',
            borderRadius: '8px',
            background: '#0b0d0c',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              borderBottom: '1px solid #202320',
              padding: '10px 11px',
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: '#ffffff', fontSize: '12px', fontWeight: 800 }}>
                {review.objective ?? 'No objective'}
              </div>
              <div style={{ marginTop: '3px', color: '#777c76', fontSize: '11px' }}>
                {formatDateTime(review.createdAt)}
              </div>
            </div>
          </div>
          <div style={{ padding: '11px', display: 'grid', gap: '10px' }}>
            <p style={{ margin: 0, color: '#d7d5ca', fontSize: '12px', lineHeight: 1.55 }}>
              {review.summary}
            </p>
            <div style={{ display: 'grid', gap: '8px' }}>
              {review.suggestions.map((suggestion) => (
                <div
                  key={suggestion}
                  data-testid="supervisor-suggestion"
                  style={{
                    border: '1px solid #2a2d2a',
                    borderRadius: '6px',
                    background: '#101211',
                    padding: '9px',
                    display: 'grid',
                    gap: '8px',
                  }}
                >
                  <div
                    data-testid="supervisor-suggestion-text"
                    title={suggestion}
                    style={{ color: '#f4f3ea', fontSize: '12px', lineHeight: 1.45 }}
                  >
                    {supervisorSuggestionPreview(suggestion)}
                  </div>
                  <button
                    type="button"
                    aria-label="Inject suggestion"
                    onClick={() => onInjectSuggestion(suggestion)}
                    disabled={!canInject}
                    style={secondaryButtonStyle(canInject)}
                  >
                    <Send {...ICON_PROPS} />
                    <span>Inject suggestion</span>
                  </button>
                </div>
              ))}
            </div>
            {review.terminalTail ? (
              <pre
                style={{
                  maxHeight: '130px',
                  margin: 0,
                  overflow: 'auto',
                  border: '1px solid #202320',
                  borderRadius: '6px',
                  background: '#050606',
                  color: '#a9aea7',
                  padding: '9px',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {review.terminalTail}
              </pre>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div
      style={{
        minHeight: 0,
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '22px',
        color: '#777c76',
        fontSize: '12px',
        fontWeight: 650,
      }}
    >
      {label}
    </div>
  );
}

function supervisorStatusTone(status: SessionSupervisorState['status']) {
  switch (status) {
    case 'stuck':
      return { color: '#f0c1b8', border: '#4a2b29', background: '#1f100f' };
    case 'idle':
      return { color: '#e4ca7e', border: '#4a3c20', background: '#1b160b' };
    case 'watching':
      return { color: '#cfe5c4', border: '#2d3b29', background: '#172114' };
    case 'ended':
      return { color: '#b0b0aa', border: '#333633', background: '#171918' };
    case 'unconfigured':
      return { color: '#9ce8f8', border: '#245564', background: '#071a1f' };
  }
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatIdleFor(idleForMs: number): string {
  if (idleForMs < 1000) return '0s';
  if (idleForMs < 60_000) return `${Math.round(idleForMs / 1000)}s`;
  return `${Math.round(idleForMs / 60_000)}m`;
}

function iconButtonStyle(enabled: boolean) {
  return {
    width: '28px',
    height: '28px',
    border: '1px solid #303030',
    borderRadius: '6px',
    background: '#171717',
    color: enabled ? '#d7d5ca' : '#5f645e',
    cursor: enabled ? 'pointer' : 'not-allowed',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  } as const;
}

const objectiveInputStyle = {
  minWidth: 0,
  flex: 1,
  height: '32px',
  border: '1px solid #303030',
  borderRadius: '6px',
  background: '#050606',
  color: '#ffffff',
  padding: '0 10px',
  fontSize: '12px',
  outline: 'none',
} as const;

function primaryButtonStyle(enabled: boolean) {
  return {
    height: '32px',
    border: enabled ? '1px solid #2d3b29' : '1px solid #262826',
    borderRadius: '6px',
    background: enabled ? '#172114' : '#101110',
    color: enabled ? '#cfe5c4' : '#6f746d',
    cursor: enabled ? 'pointer' : 'not-allowed',
    padding: '0 10px',
    fontSize: '12px',
    fontWeight: 750,
    whiteSpace: 'nowrap',
  } as const;
}

function reviewButtonStyle(enabled: boolean) {
  return {
    minHeight: '34px',
    border: enabled ? '1px solid #245564' : '1px solid #262826',
    borderRadius: '6px',
    background: enabled ? '#071a1f' : '#101110',
    color: enabled ? '#9ce8f8' : '#6f746d',
    cursor: enabled ? 'pointer' : 'not-allowed',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '0 10px',
    fontSize: '12px',
    fontWeight: 800,
  } as const;
}

function secondaryButtonStyle(enabled: boolean) {
  return {
    justifySelf: 'start',
    minHeight: '28px',
    border: enabled ? '1px solid #303030' : '1px solid #242624',
    borderRadius: '6px',
    background: enabled ? '#171717' : '#101110',
    color: enabled ? '#d7d5ca' : '#6f746d',
    cursor: enabled ? 'pointer' : 'not-allowed',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    padding: '0 9px',
    fontSize: '12px',
    fontWeight: 750,
  } as const;
}
