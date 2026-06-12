import type {
  SessionReviewChange,
  SessionReview as SessionReviewData,
  VerificationRun,
} from '@cubby/core';
import { ClipboardList, FileCode2, Loader2, Play, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { extractedWorkspaceFileRefs } from '../workspace/file-explorer-model.js';
import {
  formatVerificationDuration,
  isSessionReviewResponse,
  sessionReviewStatusDisplay,
  sessionReviewSummaryLabel,
  shortGitHead,
  verificationRunStatusLabel,
} from './session-review-model.js';

interface SessionReviewProps {
  sessionId: string;
  rootPath: string;
  onOpenWorkspaceFile?: (path: string, line?: number) => void;
  onClose: () => void;
}

const ICON_PROPS = { size: 15, strokeWidth: 2.1, 'aria-hidden': true } as const;
const SESSION_REVIEW_Z_INDEX = 1000;
const QUICK_VERIFICATION_COMMANDS = ['bun test', 'bun run lint', 'bun run build'] as const;

export function SessionReview({
  sessionId,
  rootPath,
  onClose,
  onOpenWorkspaceFile,
}: SessionReviewProps) {
  const [review, setReview] = useState<SessionReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningCommand, setRunningCommand] = useState('');
  const [commandInput, setCommandInput] = useState('bun test');
  const [error, setError] = useState('');
  const changedFiles = useMemo(
    () =>
      [...(review?.changedFiles ?? [])].sort((left, right) => left.path.localeCompare(right.path)),
    [review],
  );

  const loadReview = useCallback(
    async (method: 'GET' | 'POST' = 'GET') => {
      if (method === 'GET') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError('');
      try {
        const response = await fetch(`/api/sessions/${sessionId}/review`, { method });
        if (!response.ok) {
          setError('Session review unavailable');
          return;
        }

        const data = await response.json();
        if (!isSessionReviewResponse(data)) {
          setError('Session review unavailable');
          return;
        }

        setReview(data);
      } catch {
        setError('Session review unavailable');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [sessionId],
  );

  const runVerification = useCallback(
    async (command: string) => {
      const trimmedCommand = command.trim();
      if (!trimmedCommand) return;
      setRunningCommand(trimmedCommand);
      setError('');
      try {
        const response = await fetch(`/api/sessions/${sessionId}/verification-runs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: trimmedCommand }),
        });
        if (!response.ok) {
          setError('Verification command failed');
          return;
        }
        await loadReview('POST');
      } catch {
        setError('Verification command failed');
      } finally {
        setRunningCommand('');
      }
    },
    [loadReview, sessionId],
  );

  useEffect(() => {
    void loadReview('GET');
  }, [loadReview]);

  return (
    <div
      data-testid="session-review-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: SESSION_REVIEW_Z_INDEX,
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
        aria-labelledby="session-review-title"
        style={{
          width: 'min(980px, 100%)',
          height: 'min(680px, calc(100dvh - 36px))',
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
          <ClipboardList {...ICON_PROPS} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              id="session-review-title"
              style={{ margin: 0, color: '#ffffff', fontSize: '14px', fontWeight: 700 }}
            >
              Session Review
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
            aria-label="Refresh session review"
            title="Refresh"
            onClick={() => void loadReview('POST')}
            disabled={loading || refreshing}
            style={iconButtonStyle(!loading && !refreshing)}
          >
            {loading || refreshing ? <Loader2 {...ICON_PROPS} /> : <RefreshCw {...ICON_PROPS} />}
          </button>
          <button
            type="button"
            aria-label="Close session review"
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
            gridTemplateColumns: 'minmax(260px, 0.9fr) minmax(320px, 1.1fr)',
            overflow: 'hidden',
            background: '#050606',
          }}
        >
          <section
            aria-label="Reviewed files"
            style={{
              minWidth: 0,
              minHeight: 0,
              borderRight: '1px solid #242624',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {loading && !review ? (
              <EmptyState label="Loading session review" />
            ) : review ? (
              <>
                <ReviewMeta review={review} />
                <div style={{ minHeight: 0, flex: 1, overflowY: 'auto', padding: '10px' }}>
                  {changedFiles.length === 0 ? (
                    <EmptyState label="No file changes" />
                  ) : (
                    <div style={{ display: 'grid', gap: '8px' }}>
                      {changedFiles.map((change) => (
                        <ChangedFileRow
                          key={`${change.status}:${change.path}`}
                          change={change}
                          onOpenWorkspaceFile={onOpenWorkspaceFile}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <EmptyState label="Session review unavailable" />
            )}
          </section>

          <section
            aria-label="Session output"
            style={{
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <VerificationRunsPanel
              commandInput={commandInput}
              onCommandInputChange={setCommandInput}
              onRun={runVerification}
              review={review}
              rootPath={rootPath}
              runningCommand={runningCommand}
              onOpenWorkspaceFile={onOpenWorkspaceFile}
            />
            <div
              style={{
                minHeight: '42px',
                borderBottom: '1px solid #202320',
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
              }}
            >
              <div style={{ color: '#f5f4ec', fontSize: '12px', fontWeight: 800 }}>Last Output</div>
              {review && <ExitChip exitCode={review.exitCode} />}
            </div>
            {review?.lastOutput ? (
              <pre
                style={{
                  flex: 1,
                  minHeight: 0,
                  margin: 0,
                  overflow: 'auto',
                  padding: '12px',
                  background: '#050606',
                  color: '#f5f4ec',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  lineHeight: '20px',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {review.lastOutput}
              </pre>
            ) : (
              <EmptyState label="No terminal output" />
            )}
          </section>
        </div>
        {error && <InlineError>{error}</InlineError>}
      </div>
    </div>
  );
}

function ReviewMeta({ review }: { review: SessionReviewData }) {
  return (
    <div
      style={{
        flexShrink: 0,
        borderBottom: '1px solid #202320',
        padding: '10px',
        display: 'grid',
        gap: '8px',
      }}
    >
      <div style={{ color: '#ffffff', fontSize: '13px', fontWeight: 800 }}>
        {sessionReviewSummaryLabel(review.summary)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <MetaCell label="Baseline" value={shortGitHead(review.baselineGitHead)} />
        <MetaCell label="Current" value={shortGitHead(review.currentGitHead)} />
      </div>
    </div>
  );
}

function VerificationRunsPanel({
  commandInput,
  onCommandInputChange,
  onOpenWorkspaceFile,
  onRun,
  review,
  rootPath,
  runningCommand,
}: {
  commandInput: string;
  onCommandInputChange: (value: string) => void;
  onOpenWorkspaceFile?: (path: string, line?: number) => void;
  onRun: (command: string) => void;
  review: SessionReviewData | null;
  rootPath: string;
  runningCommand: string;
}) {
  const runs = review?.verificationRuns ?? [];
  const running = Boolean(runningCommand);
  return (
    <div
      data-testid="verification-runs"
      style={{
        flexShrink: 0,
        borderBottom: '1px solid #202320',
        background: '#070808',
        display: 'grid',
        gap: '10px',
        padding: '10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ minWidth: 0, flex: 1, color: '#f5f4ec', fontSize: '12px', fontWeight: 800 }}>
          Verification
        </div>
        {running && (
          <span style={{ color: '#90978f', fontSize: '11px', fontWeight: 750 }}>
            Running {runningCommand}
          </span>
        )}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onRun(commandInput);
        }}
        style={{ display: 'flex', gap: '8px', minWidth: 0 }}
      >
        <input
          aria-label="Verification command"
          value={commandInput}
          onChange={(event) => onCommandInputChange(event.currentTarget.value)}
          disabled={running}
          style={commandInputStyle()}
        />
        <button
          type="submit"
          aria-label="Run custom verification"
          disabled={running || !commandInput.trim()}
          style={commandButtonStyle(!running && Boolean(commandInput.trim()))}
        >
          {running ? <Loader2 {...ICON_PROPS} /> : <Play {...ICON_PROPS} />}
          Run
        </button>
      </form>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {QUICK_VERIFICATION_COMMANDS.map((command) => (
          <button
            key={command}
            type="button"
            aria-label={`Run verification ${command}`}
            disabled={running}
            onClick={() => {
              onCommandInputChange(command);
              onRun(command);
            }}
            style={quickCommandStyle(!running)}
          >
            <Play {...ICON_PROPS} />
            {command}
          </button>
        ))}
      </div>
      {runs.length === 0 ? (
        <div style={{ color: '#777c76', fontSize: '12px', padding: '4px 0' }}>
          No verification runs
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '8px', maxHeight: '210px', overflowY: 'auto' }}>
          {runs.map((run) => (
            <VerificationRunRow
              key={run.id}
              run={run}
              rootPath={rootPath}
              onOpenWorkspaceFile={onOpenWorkspaceFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VerificationRunRow({
  run,
  rootPath,
  onOpenWorkspaceFile,
}: {
  run: VerificationRun;
  rootPath: string;
  onOpenWorkspaceFile?: (path: string, line?: number) => void;
}) {
  const fileRefs = run.outputSummary ? extractedWorkspaceFileRefs(run.outputSummary, rootPath) : [];
  return (
    <article
      style={{
        border: '1px solid #242a26',
        borderRadius: '6px',
        background: '#090b0a',
        padding: '8px',
        display: 'grid',
        gap: '6px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <code
          title={run.command}
          style={{
            minWidth: 0,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: '#f5f4ec',
            fontSize: '12px',
          }}
        >
          {run.command}
        </code>
        <span style={verificationChipStyle(run.exitCode)}>
          {verificationRunStatusLabel(run.exitCode)}
        </span>
        <span style={{ color: '#8d928b', fontSize: '11px', fontWeight: 750 }}>
          {formatVerificationDuration(run.durationMs)}
        </span>
      </div>
      {run.outputSummary ? (
        <pre
          style={{
            margin: 0,
            maxHeight: '82px',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            color: '#d7d5ca',
            fontFamily: 'monospace',
            fontSize: '11px',
            lineHeight: '17px',
          }}
        >
          {run.outputSummary}
        </pre>
      ) : null}
      {onOpenWorkspaceFile && fileRefs.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {fileRefs.map((ref) => (
            <button
              key={`${ref.path}:${ref.line}`}
              type="button"
              aria-label={`Open verification file ${ref.displayPath} line ${ref.line}`}
              onClick={() => onOpenWorkspaceFile(ref.path, ref.line)}
              style={fileRefButtonStyle()}
            >
              <FileCode2 {...ICON_PROPS} />
              {ref.displayPath}:{ref.line}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function ChangedFileRow({
  change,
  onOpenWorkspaceFile,
}: {
  change: SessionReviewChange;
  onOpenWorkspaceFile?: (path: string, line?: number) => void;
}) {
  const status = sessionReviewStatusDisplay(change.status);
  return (
    <button
      type="button"
      aria-label={`Open reviewed file ${change.path}`}
      onClick={() => onOpenWorkspaceFile?.(change.path)}
      style={{
        width: '100%',
        minHeight: '40px',
        border: '1px solid #242a26',
        borderRadius: '6px',
        background: '#090b0a',
        color: '#f5f4ec',
        cursor: onOpenWorkspaceFile ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px',
        textAlign: 'left',
      }}
    >
      <FileCode2 {...ICON_PROPS} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          title={change.path}
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: '#f5f4ec',
            fontFamily: 'monospace',
            fontSize: '12px',
            fontWeight: 650,
          }}
        >
          {change.path}
        </div>
        {change.originalPath && (
          <div
            title={change.originalPath}
            style={{
              marginTop: '2px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: '#777c76',
              fontFamily: 'monospace',
              fontSize: '11px',
            }}
          >
            {change.originalPath}
          </div>
        )}
      </div>
      <span title={status.title} style={statusChipStyle()}>
        {status.label}
      </span>
    </button>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        minWidth: 0,
        border: '1px solid #242a26',
        borderRadius: '6px',
        background: '#090b0a',
        padding: '8px',
      }}
    >
      <div style={{ color: '#777c76', fontSize: '10px', fontWeight: 800 }}>{label}</div>
      <div
        title={value}
        style={{
          marginTop: '3px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: '#d7d5ca',
          fontFamily: 'monospace',
          fontSize: '12px',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ExitChip({ exitCode }: { exitCode: number | null }) {
  const success = exitCode === 0;
  const label = exitCode === null ? 'No exit' : `Exit ${exitCode}`;
  return (
    <span
      style={{
        flexShrink: 0,
        border: `1px solid ${success ? '#2d3b29' : '#4a2b29'}`,
        borderRadius: '999px',
        background: success ? '#172114' : '#2a1514',
        color: success ? '#cfe5c4' : '#f0c1b8',
        padding: '2px 7px',
        fontSize: '11px',
        fontWeight: 800,
      }}
    >
      {label}
    </span>
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
        padding: '24px',
        color: '#777c76',
        fontSize: '13px',
        textAlign: 'center',
      }}
    >
      {label}
    </div>
  );
}

function InlineError({ children }: { children: string }) {
  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: '1px solid #3c2220',
        background: '#1b0d0c',
        color: '#f1b4aa',
        padding: '8px 10px',
        fontSize: '12px',
        fontWeight: 650,
      }}
    >
      {children}
    </div>
  );
}

function iconButtonStyle(enabled: boolean) {
  return {
    width: '30px',
    height: '30px',
    border: `1px solid ${enabled ? '#303331' : '#202220'}`,
    borderRadius: '6px',
    background: enabled ? '#141715' : '#0d0f0e',
    color: enabled ? '#d7d5ca' : '#5f645e',
    cursor: enabled ? 'pointer' : 'default',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    flexShrink: 0,
  } as const;
}

function statusChipStyle() {
  return {
    flexShrink: 0,
    border: '1px solid #253b40',
    borderRadius: '999px',
    background: '#071a1f',
    color: '#9ce8f8',
    padding: '2px 7px',
    fontSize: '11px',
    fontWeight: 800,
  } as const;
}

function verificationChipStyle(exitCode: number | null) {
  const success = exitCode === 0;
  const neutral = exitCode === null;
  return {
    flexShrink: 0,
    border: `1px solid ${success ? '#2d3b29' : neutral ? '#343832' : '#4a2b29'}`,
    borderRadius: '999px',
    background: success ? '#172114' : neutral ? '#161816' : '#2a1514',
    color: success ? '#cfe5c4' : neutral ? '#b9bdb5' : '#f0c1b8',
    padding: '2px 7px',
    fontSize: '11px',
    fontWeight: 800,
  } as const;
}

function fileRefButtonStyle() {
  return {
    height: '26px',
    border: '1px solid #253b40',
    borderRadius: '6px',
    background: '#071a1f',
    color: '#9ce8f8',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '0 8px',
    fontFamily: 'monospace',
    fontSize: '11px',
    fontWeight: 800,
  } as const;
}

function commandInputStyle() {
  return {
    minWidth: 0,
    flex: 1,
    height: '30px',
    border: '1px solid #303331',
    borderRadius: '6px',
    background: '#050606',
    color: '#f4f3ea',
    padding: '0 9px',
    fontFamily: 'monospace',
    fontSize: '12px',
    outline: 'none',
  } as const;
}

function commandButtonStyle(enabled: boolean) {
  return {
    height: '30px',
    border: `1px solid ${enabled ? '#31422f' : '#202220'}`,
    borderRadius: '6px',
    background: enabled ? '#172114' : '#0d0f0e',
    color: enabled ? '#cfe5c4' : '#5f645e',
    cursor: enabled ? 'pointer' : 'default',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '0 10px',
    fontSize: '12px',
    fontWeight: 800,
    flexShrink: 0,
  } as const;
}

function quickCommandStyle(enabled: boolean) {
  return {
    height: '28px',
    border: `1px solid ${enabled ? '#2c302d' : '#202220'}`,
    borderRadius: '6px',
    background: enabled ? '#101311' : '#0d0f0e',
    color: enabled ? '#d7d5ca' : '#5f645e',
    cursor: enabled ? 'pointer' : 'default',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '0 8px',
    fontSize: '11px',
    fontWeight: 750,
  } as const;
}
