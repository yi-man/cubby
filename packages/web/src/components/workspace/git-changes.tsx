import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  GitBranch,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fileExplorerLayoutMode } from './file-explorer-model.js';
import {
  buildGitChangeTree,
  type GitChangeTreeNode,
  type GitDiffResponse,
  type GitStatusEntry,
  type GitStatusResponse,
  gitChangeCountLabel,
  gitChangeStatusDisplay,
  isGitDiffResponse,
} from './git-status-model.js';

interface GitChangesProps {
  rootPath: string;
  status: GitStatusResponse;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

type CompactPanel = 'files' | 'preview';
type DiffLoadState =
  | { state: 'loading' }
  | { state: 'loaded'; preview: GitDiffResponse }
  | { state: 'error'; message: string };

const ICON_PROPS = { size: 15, strokeWidth: 2.1, 'aria-hidden': true } as const;
const GIT_CHANGES_Z_INDEX = 1000;

export function GitChanges({ rootPath, status, onClose, onRefresh }: GitChangesProps) {
  const viewportWidth = useViewportWidth();
  const compact = fileExplorerLayoutMode(viewportWidth) === 'compact';
  const tree = useMemo(() => buildGitChangeTree(status.entries), [status.entries]);
  const directoryPaths = useMemo(() => collectDirectoryPaths(tree), [tree]);
  const statusKey = useMemo(
    () =>
      status.entries
        .map((entry) => `${entry.path}\0${entry.staged}\0${entry.worktree}\0${entry.status}`)
        .join('\n'),
    [status.entries],
  );
  const resetKey = `${rootPath}\0${statusKey}`;
  const requestedDiffPaths = useRef<Set<string>>(new Set());
  const lastResetKey = useRef(resetKey);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(directoryPaths));
  const [selectedEntry, setSelectedEntry] = useState<GitStatusEntry | null>(null);
  const [diffsByPath, setDiffsByPath] = useState<Record<string, DiffLoadState>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [compactPanel, setCompactPanel] = useState<CompactPanel>('preview');
  const showFilesPanel = !compact || compactPanel === 'files';
  const showPreviewPanel = !compact || compactPanel === 'preview';
  const visibleEntries = useMemo(() => {
    if (selectedEntry) return [selectedEntry];
    return status.entries;
  }, [selectedEntry, status.entries]);

  const loadDiff = useCallback(
    async (entry: GitStatusEntry) => {
      if (requestedDiffPaths.current.has(entry.path)) return;

      requestedDiffPaths.current.add(entry.path);
      setDiffsByPath((current) => ({ ...current, [entry.path]: { state: 'loading' } }));

      try {
        const query = new URLSearchParams({ root: rootPath, path: entry.path });
        const response = await fetch(`/api/git/diff?${query.toString()}`);
        if (!response.ok) {
          setDiffsByPath((current) => ({
            ...current,
            [entry.path]: { state: 'error', message: 'Failed to load diff' },
          }));
          return;
        }

        const data = await response.json();
        if (!isGitDiffResponse(data)) {
          setDiffsByPath((current) => ({
            ...current,
            [entry.path]: { state: 'error', message: 'Failed to read diff' },
          }));
          return;
        }

        setDiffsByPath((current) => ({
          ...current,
          [entry.path]: { state: 'loaded', preview: data },
        }));
      } catch {
        setDiffsByPath((current) => ({
          ...current,
          [entry.path]: { state: 'error', message: 'Failed to load diff' },
        }));
      }
    },
    [rootPath],
  );

  const showAllChanges = useCallback(() => {
    setSelectedEntry(null);
    setCompactPanel('preview');
  }, []);

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

  const openEntry = useCallback((entry: GitStatusEntry) => {
    setSelectedEntry(entry);
    setCompactPanel('preview');
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (lastResetKey.current === resetKey) return;

    lastResetKey.current = resetKey;
    setExpandedPaths(new Set(directoryPaths));
    setSelectedEntry(null);
    setDiffsByPath({});
    requestedDiffPaths.current.clear();
  });

  useEffect(() => {
    for (const entry of visibleEntries) {
      if (!diffsByPath[entry.path]) {
        void loadDiff(entry);
      }
    }
  }, [diffsByPath, loadDiff, visibleEntries]);

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
              minWidth: compact ? 0 : '260px',
              width: compact ? '100%' : undefined,
              height: compact ? '100%' : undefined,
              flex: compact ? '0 0 100%' : '0 0 280px',
              minHeight: 0,
              borderRight: compact ? 'none' : '1px solid #242624',
              display: showFilesPanel ? 'flex' : 'none',
              flexDirection: 'column',
              background: '#090b0a',
            }}
          >
            <div style={{ minHeight: 0, flex: 1, overflowY: 'auto', padding: '8px' }}>
              {status.entries.length === 0 ? (
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
                title={previewTitle(selectedEntry)}
                style={{
                  minWidth: 0,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: '#f5f4ec',
                  fontFamily: selectedEntry ? 'monospace' : undefined,
                  fontSize: '12px',
                  fontWeight: selectedEntry ? 500 : 700,
                }}
              >
                {previewTitle(selectedEntry)}
              </div>
              {selectedEntry && (
                <button
                  type="button"
                  aria-label="Show all git changes"
                  onClick={showAllChanges}
                  style={textButtonStyle()}
                >
                  <GitBranch {...ICON_PROPS} />
                  All changes
                </button>
              )}
              {selectedEntry ? (
                <StatusChip status={selectedEntry.status} />
              ) : (
                <CountChip count={visibleEntries.length} />
              )}
            </div>
            <GitDiffPreviewStack
              entries={visibleEntries}
              diffsByPath={diffsByPath}
              selectedPath={selectedEntry?.path ?? null}
              onOpenEntry={openEntry}
            />
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
  if (node.type === 'file') {
    const selected = selectedPath === node.entry.path;
    return (
      <button
        type="button"
        aria-label={`Open git change ${node.entry.path}`}
        onClick={() => onOpenEntry(node.entry)}
        style={fileTreeButtonStyle(depth, selected)}
      >
        <FileCode2 {...ICON_PROPS} />
        <span style={treeLabelStyle}>{node.name}</span>
        <StatusChip status={node.entry.status} />
      </button>
    );
  }

  const expanded = expandedPaths.has(node.path);
  return (
    <div>
      <button
        type="button"
        aria-label={`${expanded ? 'Collapse' : 'Expand'} folder ${node.name}`}
        onClick={() => onToggleDirectory(node.path)}
        style={directoryButtonStyle(depth, false)}
      >
        {expanded ? <ChevronDown {...ICON_PROPS} /> : <ChevronRight {...ICON_PROPS} />}
        <Folder {...ICON_PROPS} />
        <span style={treeLabelStyle}>{node.name}</span>
        <CountChip count={countGitTreeFiles(node)} />
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

function GitDiffPreviewStack({
  entries,
  diffsByPath,
  selectedPath,
  onOpenEntry,
}: {
  entries: GitStatusEntry[];
  diffsByPath: Record<string, DiffLoadState>;
  selectedPath: string | null;
  onOpenEntry: (entry: GitStatusEntry) => void;
}) {
  if (entries.length === 0) {
    return <EmptyState label="No Git changes in this directory" />;
  }

  return (
    <div
      data-testid="git-diff-preview"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '12px',
      }}
    >
      {entries.map((entry) => (
        <GitDiffSection
          key={entry.path}
          entry={entry}
          diffState={diffsByPath[entry.path]}
          selected={selectedPath === entry.path}
          onOpenEntry={onOpenEntry}
        />
      ))}
    </div>
  );
}

function GitDiffSection({
  entry,
  diffState,
  selected,
  onOpenEntry,
}: {
  entry: GitStatusEntry;
  diffState: DiffLoadState | undefined;
  selected: boolean;
  onOpenEntry: (entry: GitStatusEntry) => void;
}) {
  return (
    <article
      style={{
        border: `1px solid ${selected ? '#315f6b' : '#242a26'}`,
        borderRadius: '6px',
        background: '#090b0a',
        overflow: 'hidden',
        marginBottom: '12px',
      }}
    >
      <button
        type="button"
        aria-label={`Open git change ${entry.path}`}
        onClick={() => onOpenEntry(entry)}
        style={fileHeaderButtonStyle(selected)}
      >
        <FileCode2 {...ICON_PROPS} />
        <span style={filePathStyle} title={entry.path}>
          {entry.path}
        </span>
        <StatusChip status={entry.status} />
      </button>
      {diffState?.state === 'loaded' ? (
        diffState.preview.mode === 'binary' ? (
          <BinaryPreview preview={diffState.preview} />
        ) : (
          <DiffTextPreview content={diffState.preview.content} />
        )
      ) : diffState?.state === 'error' ? (
        <InlineDiffState label={diffState.message} />
      ) : (
        <InlineDiffState label="Loading diff" />
      )}
    </article>
  );
}

function BinaryPreview({ preview }: { preview: GitDiffResponse }) {
  const isImage = preview.mimeType?.startsWith('image/') && preview.dataUrl;

  return (
    <div
      style={{
        borderTop: '1px solid #1b201d',
        padding: '14px',
        background: '#050606',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: '#cbc8b8',
          fontSize: '12px',
          fontWeight: 750,
        }}
      >
        <ImageIcon {...ICON_PROPS} />
        {isImage ? 'Binary image' : 'Binary file'}
      </div>
      {isImage ? (
        <div
          style={{
            marginTop: '12px',
            width: 'fit-content',
            maxWidth: '100%',
            border: '1px solid #252b27',
            borderRadius: '6px',
            background: '#101310',
            padding: '10px',
          }}
        >
          <img
            alt={`Preview ${preview.path}`}
            src={preview.dataUrl}
            style={{
              display: 'block',
              maxWidth: 'min(100%, 520px)',
              maxHeight: '300px',
              imageRendering: 'auto',
            }}
          />
        </div>
      ) : (
        <div style={{ marginTop: '8px', color: '#777c76', fontSize: '12px' }}>
          No textual diff available.
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const display = gitChangeStatusDisplay(status);

  return (
    <span
      title={display.title}
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
      {display.label}
    </span>
  );
}

function CountChip({ count }: { count: number }) {
  return (
    <span
      style={{
        flexShrink: 0,
        border: '1px solid #343832',
        borderRadius: '999px',
        background: '#131712',
        color: '#cbc8b8',
        padding: '2px 7px',
        fontSize: '11px',
        fontWeight: 800,
      }}
    >
      {count}
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

function InlineDiffState({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: '18px 14px',
        color: '#777c76',
        fontSize: '12px',
      }}
    >
      {label}
    </div>
  );
}

function DiffTextPreview({ content }: { content: string }) {
  const lines = diffPreviewLines(content);

  return (
    <pre
      style={{
        margin: 0,
        overflowX: 'auto',
        padding: '10px 0',
        background: '#050606',
        color: '#f5f4ec',
        fontFamily: 'monospace',
        fontSize: '12px',
        lineHeight: '20px',
        whiteSpace: 'pre',
      }}
    >
      {lines.map(({ key, line }) => (
        <span
          key={key}
          style={{
            ...diffLineStyle(line),
            display: 'block',
            minHeight: '20px',
            padding: '0 12px',
          }}
        >
          {line || ' '}
        </span>
      ))}
    </pre>
  );
}

function previewTitle(entry: GitStatusEntry | null): string {
  if (entry) return entry.path;
  return 'All changes';
}

function diffPreviewLines(content: string): Array<{ key: string; line: string }> {
  if (content.length === 0) return [{ key: 'empty', line: 'No textual diff' }];

  let offset = 0;
  return content.split('\n').map((line) => {
    const key = `${offset}:${line}`;
    offset += line.length + 1;
    return { key, line };
  });
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

const filePathStyle = {
  minWidth: 0,
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: 'monospace',
  fontSize: '12px',
  fontWeight: 650,
} as const;

function directoryButtonStyle(depth: number, selected: boolean) {
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

function fileTreeButtonStyle(depth: number, selected: boolean) {
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
    padding: `6px 8px 6px ${29 + depth * 14}px`,
    textAlign: 'left',
  } as const;
}

function fileHeaderButtonStyle(selected: boolean) {
  return {
    width: '100%',
    minHeight: '38px',
    border: 'none',
    borderBottom: '1px solid #242a26',
    background: selected ? '#071a1f' : '#101310',
    color: '#f3f1e7',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    textAlign: 'left',
  } as const;
}

function diffLineStyle(line: string) {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return { background: 'rgba(36, 128, 68, 0.22)', color: '#bcf2ca' } as const;
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return { background: 'rgba(174, 58, 55, 0.24)', color: '#ffd0ca' } as const;
  }
  if (line.startsWith('@@')) {
    return { background: 'rgba(45, 74, 111, 0.34)', color: '#aacdff' } as const;
  }
  if (line.startsWith('diff --git')) {
    return { color: '#cbc8b8', fontWeight: 800 } as const;
  }
  return {} as const;
}

function collectDirectoryPaths(nodes: GitChangeTreeNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === 'file') return [];
    return [node.path, ...collectDirectoryPaths(node.children)];
  });
}

function countGitTreeFiles(node: GitChangeTreeNode): number {
  if (node.type === 'file') return 1;
  return node.children.reduce((count, child) => count + countGitTreeFiles(child), 0);
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
