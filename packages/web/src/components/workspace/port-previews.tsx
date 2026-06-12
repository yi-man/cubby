import { Copy, ExternalLink, Loader2, MonitorUp, RefreshCw, Server, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { relativePathFromRoot } from './file-explorer-model.js';
import {
  formatPreviewLastActivity,
  isPreviewListResponse,
  type PreviewPort,
  previewAbsoluteUrl,
} from './port-preview-model.js';

interface PortPreviewsProps {
  rootPath: string;
  initialPorts?: PreviewPort[] | null;
  onClose: () => void;
  onPortsChange?: (ports: PreviewPort[]) => void;
}

const ICON_PROPS = { size: 15, strokeWidth: 2.1, 'aria-hidden': true } as const;
const PORT_PREVIEWS_Z_INDEX = 1000;

export function PortPreviews({
  rootPath,
  initialPorts = null,
  onClose,
  onPortsChange,
}: PortPreviewsProps) {
  const copyResetTimeoutRef = useRef<number | null>(null);
  const [ports, setPorts] = useState<PreviewPort[]>(initialPorts ?? []);
  const [loading, setLoading] = useState(initialPorts === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [copiedPort, setCopiedPort] = useState<number | null>(null);
  const sortedPorts = useMemo(
    () => [...ports].sort((left, right) => left.port - right.port),
    [ports],
  );

  const updatePorts = useCallback(
    (nextPorts: PreviewPort[]) => {
      setPorts(nextPorts);
      onPortsChange?.(nextPorts);
    },
    [onPortsChange],
  );

  const loadPorts = useCallback(
    async (mode: 'initial' | 'refresh' = 'refresh') => {
      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError('');
      try {
        const query = new URLSearchParams({ root: rootPath });
        const response = await fetch(`/api/previews?${query.toString()}`);
        if (!response.ok) {
          setError('Preview ports unavailable');
          return;
        }

        const data = await response.json();
        if (!isPreviewListResponse(data)) {
          setError('Preview ports unavailable');
          return;
        }

        updatePorts(data.ports);
      } catch {
        setError('Preview ports unavailable');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [rootPath, updatePorts],
  );

  useEffect(() => {
    if (initialPorts !== null) return;
    void loadPorts('initial');
  }, [initialPorts, loadPorts]);

  useEffect(() => {
    if (initialPorts === null) return;
    setPorts(initialPorts);
  }, [initialPorts]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const copyLink = useCallback(async (port: PreviewPort) => {
    setError('');
    try {
      await navigator.clipboard.writeText(previewAbsoluteUrl(port.url, window.location.origin));
      setCopiedPort(port.port);
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCopiedPort(null);
      }, 1400);
    } catch {
      setError('Failed to copy preview link');
    }
  }, []);

  const dismissPort = useCallback(
    async (port: PreviewPort) => {
      setError('');
      try {
        const query = new URLSearchParams({ root: rootPath });
        const response = await fetch(`/api/previews/${port.port}?${query.toString()}`, {
          method: 'DELETE',
        });
        if (!response.ok) {
          setError('Failed to dismiss preview');
          return;
        }
        updatePorts(ports.filter((candidate) => candidate.port !== port.port));
      } catch {
        setError('Failed to dismiss preview');
      }
    },
    [ports, rootPath, updatePorts],
  );

  return (
    <div
      data-testid="port-previews-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: PORT_PREVIEWS_Z_INDEX,
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
        aria-labelledby="port-previews-title"
        style={{
          width: 'min(880px, 100%)',
          height: 'min(560px, calc(100dvh - 36px))',
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
          <MonitorUp {...ICON_PROPS} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              id="port-previews-title"
              style={{ margin: 0, color: '#ffffff', fontSize: '14px', fontWeight: 700 }}
            >
              Port Previews
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
            aria-label="Refresh port previews"
            title="Refresh"
            onClick={() => void loadPorts('refresh')}
            disabled={loading || refreshing}
            style={iconButtonStyle(!loading && !refreshing)}
          >
            {loading || refreshing ? <Loader2 {...ICON_PROPS} /> : <RefreshCw {...ICON_PROPS} />}
          </button>
          <button
            type="button"
            aria-label="Close port previews"
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
            overflowY: 'auto',
            padding: '12px',
            background: '#050606',
          }}
        >
          {loading && sortedPorts.length === 0 ? (
            <EmptyState label="Loading preview ports" />
          ) : sortedPorts.length === 0 ? (
            <EmptyState label="No active workspace ports" />
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {sortedPorts.map((port) => (
                <PortPreviewRow
                  key={port.id}
                  port={port}
                  rootPath={rootPath}
                  copied={copiedPort === port.port}
                  onCopy={() => void copyLink(port)}
                  onDismiss={() => void dismissPort(port)}
                />
              ))}
            </div>
          )}
        </div>
        {error && <InlineError>{error}</InlineError>}
      </div>
    </div>
  );
}

function PortPreviewRow({
  port,
  rootPath,
  copied,
  onCopy,
  onDismiss,
}: {
  port: PreviewPort;
  rootPath: string;
  copied: boolean;
  onCopy: () => void;
  onDismiss: () => void;
}) {
  const cwdLabel = relativePathFromRoot(port.cwd, rootPath);
  const activityLabel = formatPreviewLastActivity(port.lastActivityAt);
  const href = previewAbsoluteUrl(port.url, window.location.origin);

  return (
    <article
      style={{
        border: '1px solid #242a26',
        borderRadius: '6px',
        background: '#090b0a',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          minHeight: '44px',
          borderBottom: '1px solid #1b201d',
          padding: '8px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <span
          style={{
            width: '28px',
            height: '28px',
            border: '1px solid #253b40',
            borderRadius: '6px',
            background: '#071a1f',
            color: '#9ce8f8',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Server {...ICON_PROPS} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              minWidth: 0,
            }}
          >
            <strong style={{ color: '#ffffff', fontSize: '14px' }}>:{port.port}</strong>
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: '#cbc8b8',
                fontFamily: 'monospace',
                fontSize: '12px',
                fontWeight: 650,
              }}
            >
              {port.command}
            </span>
          </div>
          <div
            title={port.cwd}
            style={{
              marginTop: '3px',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: '#777c76',
              fontFamily: 'monospace',
              fontSize: '11px',
            }}
          >
            {cwdLabel}
          </div>
        </div>
        <a
          aria-label={`Open preview ${port.port}`}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          title="Open preview"
          style={iconLinkStyle()}
        >
          <ExternalLink {...ICON_PROPS} />
        </a>
        <button
          type="button"
          aria-label={`Copy preview link ${port.port}`}
          title="Copy link"
          onClick={onCopy}
          style={iconButtonStyle(true)}
        >
          <Copy {...ICON_PROPS} />
        </button>
        <button
          type="button"
          aria-label={`Dismiss preview ${port.port}`}
          title="Dismiss"
          onClick={onDismiss}
          style={iconButtonStyle(true)}
        >
          <X {...ICON_PROPS} />
        </button>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '1px',
          background: '#1b201d',
        }}
      >
        <MetaCell label="PID" value={String(port.pid)} />
        <MetaCell label="Host" value={port.host} />
        <MetaCell label="Activity" value={copied ? 'Copied' : activityLabel} />
      </div>
    </article>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0, background: '#0c0e0d', padding: '8px 10px' }}>
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

function EmptyState({ label }: { label: string }) {
  return (
    <div
      style={{
        minHeight: '100%',
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

function iconLinkStyle() {
  return {
    width: '30px',
    height: '30px',
    border: '1px solid #303331',
    borderRadius: '6px',
    background: '#141715',
    color: '#d7d5ca',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    flexShrink: 0,
    textDecoration: 'none',
  } as const;
}
