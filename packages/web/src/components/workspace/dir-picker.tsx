import { ArrowUp, Folder, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type AgentProviderId = 'claude-code' | 'codex';

export interface WorkspaceOpenSelection {
  path: string;
  provider: AgentProviderId;
}

interface DirPickerProps {
  onConfirm: (selection: WorkspaceOpenSelection) => void;
  onCancel: () => void;
}

interface BrowseEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface BrowseResponse {
  path: string;
  entries: BrowseEntry[];
}

const ICON_PROPS = { size: 15, strokeWidth: 2.1, 'aria-hidden': true } as const;
const PROVIDER_OPTIONS: Array<{ id: AgentProviderId; label: string }> = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBrowseEntry(value: unknown): value is BrowseEntry {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    typeof value.isDir === 'boolean'
  );
}

function isBrowseResponse(value: unknown): value is BrowseResponse {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    Array.isArray(value.entries) &&
    value.entries.every(isBrowseEntry)
  );
}

function parentPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '/';
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  if (!withoutTrailingSlash || withoutTrailingSlash === '/') return '/';
  const slashIndex = withoutTrailingSlash.lastIndexOf('/');
  if (slashIndex <= 0) return '/';
  return withoutTrailingSlash.slice(0, slashIndex);
}

export function DirPicker({ onConfirm, onCancel }: DirPickerProps) {
  const [path, setPath] = useState('');
  const [provider, setProvider] = useState<AgentProviderId>('claude-code');
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [navigatingPath, setNavigatingPath] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const parent = useMemo(() => parentPath(currentPath), [currentPath]);
  const canGoParent = Boolean(currentPath) && currentPath !== parent;

  const loadDirectory = useCallback(async (targetPath?: string) => {
    const requestedPath = targetPath?.trim() ?? '';
    setLoading(true);
    setError('');
    try {
      const query = requestedPath ? `?path=${encodeURIComponent(requestedPath)}` : '';
      const res = await fetch(`/api/browse${query}`);
      if (!res.ok) {
        setError('Directory not found or not accessible');
        return;
      }

      const data = await res.json();
      if (!isBrowseResponse(data)) {
        setError('Failed to read directory');
        return;
      }

      setPath(data.path);
      setCurrentPath(data.path);
      setEntries(data.entries.filter((entry) => entry.isDir));
    } catch {
      setError('Failed to load directory');
    } finally {
      setLoading(false);
      setNavigatingPath(null);
    }
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    void loadDirectory();
  }, [loadDirectory]);

  const handleBrowsePath = useCallback(() => {
    void loadDirectory(path);
  }, [path, loadDirectory]);

  const handleSubmit = useCallback(async () => {
    if (!path.trim()) {
      setError('Path is required');
      return;
    }
    try {
      const res = await fetch(`/api/browse?path=${encodeURIComponent(path.trim())}`);
      if (!res.ok) {
        setError('Directory not found or not accessible');
        return;
      }

      const data = await res.json();
      onConfirm({ path: isBrowseResponse(data) ? data.path : path.trim(), provider });
    } catch {
      setError('Failed to verify path');
    }
  }, [path, provider, onConfirm]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-picker-title"
        style={{
          background: '#2a2a3e',
          padding: '18px',
          borderRadius: '8px',
          width: 'min(560px, 100%)',
          maxHeight: 'min(680px, calc(100dvh - 40px))',
          color: '#cdd6f4',
          border: '1px solid #3a3a52',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          boxShadow: '0 24px 70px rgba(0, 0, 0, 0.48)',
        }}
      >
        <h3 id="workspace-picker-title" style={{ margin: '0 0 16px', fontSize: '16px' }}>
          Open Workspace
        </h3>
        <div
          role="radiogroup"
          aria-label="Agent provider"
          style={{
            marginBottom: '12px',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '8px',
          }}
        >
          {PROVIDER_OPTIONS.map((option) => {
            const selected = provider === option.id;
            return (
              <label
                key={option.id}
                style={{
                  minWidth: 0,
                  height: '38px',
                  border: `1px solid ${selected ? '#89b4fa' : '#3a3a52'}`,
                  borderRadius: '6px',
                  background: selected ? '#202a3f' : '#202033',
                  color: selected ? '#f4f8ff' : '#b8bfd8',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '0 10px',
                  boxSizing: 'border-box',
                }}
              >
                <input
                  type="radio"
                  name="agent-provider"
                  aria-label={option.label}
                  value={option.id}
                  checked={selected}
                  onChange={() => setProvider(option.id)}
                  style={{ margin: 0, accentColor: '#89b4fa', flexShrink: 0 }}
                />
                <span
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: '13px',
                    fontWeight: 650,
                  }}
                >
                  {option.label}
                </span>
              </label>
            );
          })}
        </div>
        <div
          style={{
            marginBottom: '12px',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 34px',
            gap: '8px',
          }}
        >
          <input
            ref={inputRef}
            aria-label="Workspace path"
            type="text"
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              handleBrowsePath();
            }}
            placeholder="/path/to/project"
            style={{
              width: '100%',
              height: '34px',
              padding: '0 11px',
              background: '#1e1e2e',
              border: '1px solid #444',
              borderRadius: '6px',
              color: '#cdd6f4',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <button
            type="button"
            aria-label="Browse path"
            title="Browse path"
            onClick={handleBrowsePath}
            disabled={loading}
            style={{
              width: '34px',
              height: '34px',
              border: '1px solid #444',
              borderRadius: '6px',
              background: '#202033',
              color: loading ? '#77778f' : '#cdd6f4',
              cursor: loading ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            {loading ? <Loader2 {...ICON_PROPS} /> : <RefreshCw {...ICON_PROPS} />}
          </button>
        </div>
        <div
          style={{
            minHeight: 0,
            flex: 1,
            border: '1px solid #38384f',
            borderRadius: '7px',
            background: '#1e1e2e',
            overflow: 'hidden',
            marginBottom: '12px',
          }}
        >
          <div
            style={{
              height: '38px',
              borderBottom: '1px solid #38384f',
              display: 'grid',
              gridTemplateColumns: '34px minmax(0, 1fr)',
              gap: '8px',
              alignItems: 'center',
              padding: '0 8px',
              background: '#242438',
            }}
          >
            <button
              type="button"
              aria-label="Go to parent folder"
              title="Go to parent folder"
              onClick={() => {
                setNavigatingPath(parent);
                void loadDirectory(parent);
              }}
              disabled={!canGoParent || loading}
              style={{
                width: '28px',
                height: '28px',
                border: '1px solid #44445e',
                borderRadius: '6px',
                background: canGoParent && !loading ? '#2b2b41' : '#242438',
                color: canGoParent && !loading ? '#cdd6f4' : '#696982',
                cursor: canGoParent && !loading ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
            >
              <ArrowUp {...ICON_PROPS} />
            </button>
            <div
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: '#aeb4d0',
                fontSize: '12px',
                fontFamily: 'monospace',
              }}
            >
              {currentPath || 'Loading'}
            </div>
          </div>
          <div
            data-testid="workspace-directory-list"
            style={{
              maxHeight: '360px',
              minHeight: '180px',
              overflowY: 'auto',
              padding: '8px',
            }}
          >
            {loading && entries.length === 0 ? (
              <div style={{ color: '#8f8fa8', fontSize: '13px', padding: '18px 10px' }}>
                Loading
              </div>
            ) : entries.length === 0 ? (
              <div style={{ color: '#8f8fa8', fontSize: '13px', padding: '18px 10px' }}>
                No folders in this directory
              </div>
            ) : (
              entries.map((entry) => {
                const entryLoading = navigatingPath === entry.path;
                return (
                  <button
                    key={entry.path}
                    type="button"
                    aria-label={`Open folder ${entry.name}`}
                    onClick={() => {
                      setNavigatingPath(entry.path);
                      void loadDirectory(entry.path);
                    }}
                    disabled={loading}
                    style={{
                      width: '100%',
                      minHeight: '42px',
                      border: '1px solid transparent',
                      borderRadius: '6px',
                      background: entryLoading ? '#2a2a41' : 'transparent',
                      color: '#d7dcf5',
                      cursor: loading ? 'default' : 'pointer',
                      display: 'grid',
                      gridTemplateColumns: '24px minmax(0, 1fr)',
                      gap: '8px',
                      alignItems: 'center',
                      padding: '7px 8px',
                      textAlign: 'left',
                    }}
                  >
                    <span
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '6px',
                        background: '#282842',
                        color: '#89b4fa',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Folder {...ICON_PROPS} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: '13px',
                          fontWeight: 650,
                        }}
                      >
                        {entry.name}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: '#8f8fa8',
                          fontSize: '11px',
                          fontFamily: 'monospace',
                        }}
                      >
                        {entry.path}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
        {error && (
          <div style={{ color: '#f38ba8', fontSize: '12px', marginBottom: '8px' }}>{error}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '6px 16px',
              background: 'transparent',
              border: '1px solid #444',
              borderRadius: '4px',
              color: '#cdd6f4',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            style={{
              padding: '6px 16px',
              background: '#89b4fa',
              border: 'none',
              borderRadius: '4px',
              color: '#1e1e2e',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
