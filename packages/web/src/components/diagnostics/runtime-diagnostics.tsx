import { Activity, Loader2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  type DiagnosticCheck,
  type DiagnosticStatus,
  diagnosticStatusLabel,
  isRuntimeDiagnosticsResponse,
  type RuntimeDiagnosticsResponse,
} from './runtime-diagnostics-model.js';

interface RuntimeDiagnosticsProps {
  onClose: () => void;
}

const ICON_PROPS = { size: 15, strokeWidth: 2.1, 'aria-hidden': true } as const;
const RUNTIME_DIAGNOSTICS_Z_INDEX = 1000;

export function RuntimeDiagnostics({ onClose }: RuntimeDiagnosticsProps) {
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDiagnostics = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/diagnostics/runtime');
      if (!response.ok) {
        setError('Runtime diagnostics unavailable');
        return;
      }
      const data = await response.json();
      if (!isRuntimeDiagnosticsResponse(data)) {
        setError('Runtime diagnostics unavailable');
        return;
      }
      setDiagnostics(data);
    } catch {
      setError('Runtime diagnostics unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDiagnostics();
  }, [loadDiagnostics]);

  return (
    <div
      data-testid="runtime-diagnostics-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: RUNTIME_DIAGNOSTICS_Z_INDEX,
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
        aria-labelledby="runtime-diagnostics-title"
        style={{
          width: 'min(920px, 100%)',
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
        <div style={headerStyle()}>
          <Activity {...ICON_PROPS} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              id="runtime-diagnostics-title"
              style={{ margin: 0, color: '#ffffff', fontSize: '14px', fontWeight: 700 }}
            >
              Runtime Diagnostics
            </h2>
            <div style={{ marginTop: '2px', color: '#8d928b', fontSize: '11px' }}>
              {diagnostics
                ? `${diagnostics.server.host}:${diagnostics.server.port}`
                : 'Checking runtime'}
            </div>
          </div>
          <button
            type="button"
            aria-label="Refresh runtime diagnostics"
            title="Refresh"
            onClick={() => void loadDiagnostics()}
            disabled={loading}
            style={iconButtonStyle(!loading)}
          >
            {loading ? <Loader2 {...ICON_PROPS} /> : <RefreshCw {...ICON_PROPS} />}
          </button>
          <button
            type="button"
            aria-label="Close runtime diagnostics"
            title="Close"
            onClick={onClose}
            style={iconButtonStyle(true)}
          >
            <X {...ICON_PROPS} />
          </button>
        </div>

        <div style={bodyStyle()}>
          {loading && !diagnostics ? (
            <EmptyState label="Loading runtime diagnostics" />
          ) : diagnostics ? (
            <>
              <section style={sectionStyle()}>
                <div style={{ color: '#f5f4ec', fontSize: '12px', fontWeight: 850 }}>Server</div>
                <div style={metaGridStyle()}>
                  <MetaCell label="Host" value={diagnostics.server.host} />
                  <MetaCell label="Port" value={String(diagnostics.server.port)} />
                  <MetaCell label="Data dir" value={diagnostics.server.dataDir} />
                  <MetaCell label="Config" value={diagnostics.server.configPath} />
                </div>
              </section>
              <section style={sectionStyle()}>
                <div style={{ color: '#f5f4ec', fontSize: '12px', fontWeight: 850 }}>Checks</div>
                <div style={{ display: 'grid', gap: '8px' }}>
                  {diagnostics.checks.map((check) => (
                    <DiagnosticRow check={check} key={check.id} />
                  ))}
                </div>
              </section>
            </>
          ) : (
            <EmptyState label="Runtime diagnostics unavailable" />
          )}
        </div>
        {error && <InlineError>{error}</InlineError>}
      </div>
    </div>
  );
}

function DiagnosticRow({ check }: { check: DiagnosticCheck }) {
  return (
    <article style={checkRowStyle()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: '#f5f4ec', fontSize: '12px', fontWeight: 800 }}>{check.label}</div>
          <div title={check.detail} style={detailStyle()}>
            {check.detail}
          </div>
        </div>
        <span style={statusChipStyle(check.status)}>{diagnosticStatusLabel(check.status)}</span>
      </div>
      {check.recommendation && (
        <div style={{ color: '#d9c28a', fontSize: '12px', lineHeight: '18px' }}>
          {check.recommendation}
        </div>
      )}
    </article>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={metaCellStyle()}>
      <div style={{ color: '#777c76', fontSize: '10px', fontWeight: 800 }}>{label}</div>
      <div title={value} style={metaValueStyle()}>
        {value}
      </div>
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

function headerStyle() {
  return {
    minHeight: '46px',
    borderBottom: '1px solid #242624',
    padding: '0 12px 0 16px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    background: 'linear-gradient(180deg, #111412 0%, #0c0e0d 100%)',
  } as const;
}

function bodyStyle() {
  return {
    minHeight: 0,
    flex: 1,
    overflow: 'auto',
    background: '#050606',
    display: 'grid',
    alignContent: 'start',
    gap: '10px',
    padding: '12px',
  } as const;
}

function sectionStyle() {
  return {
    border: '1px solid #242624',
    borderRadius: '6px',
    background: '#090b0a',
    display: 'grid',
    gap: '10px',
    padding: '10px',
  } as const;
}

function metaGridStyle() {
  return {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '8px',
  } as const;
}

function metaCellStyle() {
  return {
    minWidth: 0,
    border: '1px solid #242a26',
    borderRadius: '6px',
    background: '#050606',
    padding: '8px',
  } as const;
}

function metaValueStyle() {
  return {
    marginTop: '3px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#d7d5ca',
    fontFamily: 'monospace',
    fontSize: '12px',
  } as const;
}

function checkRowStyle() {
  return {
    border: '1px solid #242a26',
    borderRadius: '6px',
    background: '#050606',
    display: 'grid',
    gap: '6px',
    padding: '8px',
  } as const;
}

function detailStyle() {
  return {
    marginTop: '2px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#8d928b',
    fontFamily: 'monospace',
    fontSize: '11px',
  } as const;
}

function statusChipStyle(status: DiagnosticStatus) {
  const color =
    status === 'ok'
      ? { border: '#2d3b29', background: '#172114', text: '#cfe5c4' }
      : status === 'warning'
        ? { border: '#4a3c22', background: '#1c170d', text: '#f3d58b' }
        : { border: '#4a2b29', background: '#2a1514', text: '#f0c1b8' };
  return {
    flexShrink: 0,
    border: `1px solid ${color.border}`,
    borderRadius: '999px',
    background: color.background,
    color: color.text,
    padding: '2px 7px',
    fontSize: '11px',
    fontWeight: 800,
  } as const;
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
