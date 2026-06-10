import Editor from '@monaco-editor/react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  GitBranch,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fileExplorerLayoutMode } from './file-explorer-model.js';
import {
  buildGitChangeTree,
  type GitChangeTreeNode,
  type GitDiffResponse,
  type GitStatusEntry,
  type GitStatusResponse,
  gitChangeCountLabel,
  isGitDiffResponse,
} from './git-status-model.js';

interface GitChangesProps {
  rootPath: string;
  status: GitStatusResponse;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

type CompactPanel = 'files' | 'preview';

const ICON_PROPS = { size: 15, strokeWidth: 2.1, 'aria-hidden': true } as const;
const GIT_CHANGES_Z_INDEX = 1000;

export function GitChanges({ rootPath, status, onClose, onRefresh }: GitChangesProps) {
  const viewportWidth = useViewportWidth();
  const compact = fileExplorerLayoutMode(viewportWidth) === 'compact';
  const tree = useMemo(() => buildGitChangeTree(status.entries), [status.entries]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [selectedEntry, setSelectedEntry] = useState<GitStatusEntry | null>(null);
  const [preview, setPreview] = useState<GitDiffResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [compactPanel, setCompactPanel] = useState<CompactPanel>('files');
  const showFilesPanel = !compact || compactPanel === 'files';
  const showPreviewPanel = !compact || compactPanel === 'preview';

  const toggleDirectory = useCallback((path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const openEntry = useCallback(
    async (entry: GitStatusEntry) => {
      setSelectedEntry(entry);
      setPreview(null);
      setPreviewError('');
      setPreviewLoading(true);
      setCompactPanel('preview');
      try {
        const query = new URLSearchParams({ root: rootPath, path: entry.path });
        const response = await fetch(`/api/git/diff?${query.toString()}`);
        if (!response.ok) {
          setPreviewError('Failed to load diff');
          return;
        }

        const data = await response.json();
        if (!isGitDiffResponse(data)) {
          setPreviewError('Failed to read diff');
          return;
        }

        setPreview(data);
      } catch {
        setPreviewError('Failed to load diff');
      } finally {
        setPreviewLoading(false);
      }
    },
    [rootPath],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (!selectedEntry && status.entries[0]) {
      void openEntry(status.entries[0]);
    }
  }, [openEntry, selectedEntry, status.entries]);

  return (
    <div
      data-testid="git-changes-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: GIT_CHANGES_Z_INDEX,
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
        aria-labelledby="git-changes-title"
        style={{
          width: 'min(1040px, 100%)',
          height: 'min(720px, calc(100dvh - 36px))',
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
          <GitBranch {...ICON_PROPS} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              id="git-changes-title"
              style={{ margin: 0, color: '#ffffff', fontSize: '14px', fontWeight: 700 }}
            >
              Git Changes
            </h2>
            <div
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
              {status.branch ?? 'Git'} · {gitChangeCountLabel(status.entries.length)}
            </div>
          </div>
          <button
            type="button"
            aria-label="Refresh git changes"
            title="Refresh"
            onClick={refresh}
            disabled={refreshing}
            style={iconButtonStyle(!refreshing)}
          >
            {refreshing ? <Loader2 {...ICON_PROPS} /> : <RefreshCw {...ICON_PROPS} />}
          </button>
          <button
            type="button"
            aria-label="Close git changes"
            title="Close"
            onClick={onClose}
            style={iconButtonStyle(true)}
          >
            <X {...ICON_PROPS} />
          </button>
        </div>

        <div style={{ minHeight: 0, flex: 1, display: 'flex', overflow: 'hidden' }}>
          <section
            aria-label="Changed files"
            style={{
              minWidth: compact ? 0 : '300px',
              width: compact ? '100%' : undefined,
              height: compact ? '100%' : undefined,
              flex: compact ? '0 0 100%' : '1 1 340px',
              minHeight: 0,
              borderRight: compact ? 'none' : '1px solid #242624',
              display: showFilesPanel ? 'flex' : 'none',
              flexDirection: 'column',
              background: '#090b0a',
            }}
          >
            <div style={{ minHeight: 0, flex: 1, overflowY: 'auto', padding: '8px' }}>
              {tree.length === 0 ? (
                <EmptyState label="No Git changes" />
              ) : (
                tree.map((node) => (
                  <GitTreeNodeView
                    key={node.path}
                    node={node}
                    depth={0}
                    expandedPaths={expandedPaths}
                    selectedPath={selectedEntry?.path ?? null}
                    onToggleDirectory={toggleDirectory}
                    onOpenEntry={openEntry}
                  />
                ))
              )}
            </div>
          </section>

          <section
            aria-label="Git diff preview"
            style={{
              minWidth: compact ? 0 : '300px',
              width: compact ? '100%' : undefined,
              height: compact ? '100%' : undefined,
              flex: compact ? '0 0 100%' : '2 1 560px',
              minHeight: 0,
              display: showPreviewPanel ? 'flex' : 'none',
              flexDirection: 'column',
              background: '#050606',
            }}
          >
            <div
              style={{
                minHeight: '42px',
                borderBottom: '1px solid #202320',
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                minWidth: 0,
              }}
            >
              {compact && (
                <button
                  type="button"
                  aria-label="Back to changed files"
                  title="Back to changed files"
                  onClick={() => setCompactPanel('files')}
                  style={textButtonStyle()}
                >
                  <ArrowLeft {...ICON_PROPS} />
                  Files
                </button>
              )}
              <div
                title={selectedEntry?.path ?? ''}
                style={{
                  minWidth: 0,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: selectedEntry ? '#f5f4ec' : '#777c76',
                  fontFamily: selectedEntry ? 'monospace' : undefined,
                  fontSize: '12px',
                  fontWeight: selectedEntry ? 500 : 650,
                }}
              >
                {selectedEntry?.path ?? 'Select a changed file'}
              </div>
              {selectedEntry && <StatusChip status={selectedEntry.status} />}
            </div>
            {previewLoading ? (
              <EmptyState label="Loading diff" />
            ) : previewError ? (
              <EmptyState label={previewError} />
            ) : preview ? (
              <div
                data-testid="git-diff-preview"
                style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
              >
                <Editor
                  height="100%"
                  path={`git:${preview.path}`}
                  language={preview.language}
                  value={preview.content}
                  theme="vs-dark"
                  loading={<PlainTextPreview content={preview.content} />}
                  options={{
                    readOnly: true,
                    domReadOnly: true,
                    automaticLayout: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineHeight: 20,
                    lineNumbers: 'on',
                    renderLineHighlight: 'line',
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                    wordWrap: 'off',
                    tabSize: 2,
                    readOnlyMessage: { value: 'Git preview is read-only' },
                    overviewRulerBorder: false,
                    padding: { top: 12, bottom: 12 },
                  }}
                />
              </div>
            ) : (
              <EmptyState label="No file selected" />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function GitTreeNodeView({
  node,
  depth,
  expandedPaths,
  selectedPath,
  onToggleDirectory,
  onOpenEntry,
}: {
  node: GitChangeTreeNode;
  depth: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  onToggleDirectory: (path: string) => void;
  onOpenEntry: (entry: GitStatusEntry) => void;
}) {
  if (node.type === 'directory') {
    const expanded = expandedPaths.has(node.path);
    return (
      <div>
        <button
          type="button"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} folder ${node.name}`}
          onClick={() => onToggleDirectory(node.path)}
          style={treeButtonStyle(depth, false)}
        >
          {expanded ? <ChevronDown {...ICON_PROPS} /> : <ChevronRight {...ICON_PROPS} />}
          <Folder {...ICON_PROPS} />
          <span style={treeLabelStyle}>{node.name}</span>
        </button>
        {expanded &&
          node.children.map((child) => (
            <GitTreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              onToggleDirectory={onToggleDirectory}
              onOpenEntry={onOpenEntry}
            />
          ))}
      </div>
    );
  }

  const selected = selectedPath === node.entry.path;
  return (
    <button
      type="button"
      aria-label={`Open git change ${node.entry.path}`}
      onClick={() => onOpenEntry(node.entry)}
      style={treeButtonStyle(depth, selected)}
    >
      <span style={{ width: '15px', flexShrink: 0 }} />
      <FileCode2 {...ICON_PROPS} />
      <span style={treeLabelStyle}>{node.name}</span>
      <StatusChip status={node.entry.status} />
    </button>
  );
}

function StatusChip({ status }: { status: string }) {
  return (
    <span
      style={{
        flexShrink: 0,
        border: '1px solid #253b40',
        borderRadius: '999px',
        background: '#071a1f',
        color: '#9ce8f8',
        padding: '2px 7px',
        fontSize: '11px',
        fontWeight: 800,
      }}
    >
      {status}
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

function PlainTextPreview({ content }: { content: string }) {
  return (
    <pre
      style={{
        height: '100%',
        margin: 0,
        overflow: 'auto',
        padding: '12px',
        background: '#050606',
        color: '#f5f4ec',
        fontFamily: 'monospace',
        fontSize: '12px',
        lineHeight: '20px',
        whiteSpace: 'pre',
      }}
    >
      {content}
    </pre>
  );
}

const treeLabelStyle = {
  minWidth: 0,
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '13px',
  fontWeight: 650,
} as const;

function treeButtonStyle(depth: number, selected: boolean) {
  return {
    width: '100%',
    minHeight: '34px',
    border: `1px solid ${selected ? '#315f6b' : 'transparent'}`,
    borderRadius: '6px',
    background: selected ? '#071a1f' : 'transparent',
    color: '#f3f1e7',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    padding: `6px 8px 6px ${8 + depth * 14}px`,
    textAlign: 'left',
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

function textButtonStyle() {
  return {
    flexShrink: 0,
    height: '30px',
    border: '1px solid #303331',
    borderRadius: '6px',
    background: '#141715',
    color: '#d7d5ca',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '0 9px',
    fontSize: '11px',
    fontWeight: 700,
  } as const;
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth,
  );

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return width;
}
