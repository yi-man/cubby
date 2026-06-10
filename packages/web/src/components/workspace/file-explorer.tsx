import Editor from '@monaco-editor/react';
import { ArrowLeft, ArrowUp, FileText, Folder, Loader2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type FileExplorerEntry,
  fileExplorerLayoutMode,
  fileLanguageFromPath,
  isFileBrowseResponse,
  isFilePreviewResponse,
  parentPathWithinRoot,
} from './file-explorer-model.js';

interface FileExplorerProps {
  rootPath: string;
  onClose: () => void;
}

interface SelectedFile {
  name: string;
  path: string;
  content: string;
  truncated: boolean;
}

type CompactPanel = 'files' | 'preview';

const ICON_PROPS = { size: 15, strokeWidth: 2.1, 'aria-hidden': true } as const;
const FILE_EXPLORER_Z_INDEX = 1000;

export function FileExplorer({ rootPath, onClose }: FileExplorerProps) {
  const viewportWidth = useViewportWidth();
  const [root, setRoot] = useState(rootPath);
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [entries, setEntries] = useState<FileExplorerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [navigatingPath, setNavigatingPath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [previewLoadingPath, setPreviewLoadingPath] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [wordWrap, setWordWrap] = useState(true);
  const [compactPanel, setCompactPanel] = useState<CompactPanel>('files');
  const parent = useMemo(() => parentPathWithinRoot(currentPath, root), [currentPath, root]);
  const canGoParent = currentPath !== parent;
  const compact = fileExplorerLayoutMode(viewportWidth) === 'compact';
  const showFilesPanel = !compact || compactPanel === 'files';
  const showPreviewPanel = !compact || compactPanel === 'preview';
  const selectedLanguage = useMemo(
    () => (selectedFile ? fileLanguageFromPath(selectedFile.path) : 'plaintext'),
    [selectedFile],
  );

  const loadDirectory = useCallback(
    async (targetPath: string) => {
      setLoading(true);
      setError('');
      setPreviewError('');
      try {
        const query = new URLSearchParams({ root: rootPath, path: targetPath });
        const res = await fetch(`/api/browse?${query.toString()}`);
        if (!res.ok) {
          setError(res.status === 403 ? 'Path is outside this workspace' : 'Directory unavailable');
          return;
        }

        const data = await res.json();
        if (!isFileBrowseResponse(data)) {
          setError('Failed to read directory');
          return;
        }

        setRoot(data.root ?? rootPath);
        setCurrentPath(data.path);
        setEntries(data.entries);
      } catch {
        setError('Failed to load directory');
      } finally {
        setLoading(false);
        setNavigatingPath(null);
      }
    },
    [rootPath],
  );

  useEffect(() => {
    void loadDirectory(rootPath);
  }, [rootPath, loadDirectory]);

  const openDirectory = useCallback(
    (path: string) => {
      setSelectedFile(null);
      setCompactPanel('files');
      setNavigatingPath(path);
      void loadDirectory(path);
    },
    [loadDirectory],
  );

  const openFile = useCallback(
    async (entry: FileExplorerEntry) => {
      setPreviewLoadingPath(entry.path);
      setPreviewError('');
      try {
        const query = new URLSearchParams({ root: rootPath, path: entry.path });
        const res = await fetch(`/api/file?${query.toString()}`);
        if (res.status === 415) {
          setSelectedFile(null);
          setPreviewError('This file is not previewable');
          setCompactPanel('preview');
          return;
        }
        if (!res.ok) {
          setSelectedFile(null);
          setPreviewError('Failed to open file');
          setCompactPanel('preview');
          return;
        }

        const data = await res.json();
        if (!isFilePreviewResponse(data)) {
          setSelectedFile(null);
          setPreviewError('Failed to read file');
          setCompactPanel('preview');
          return;
        }

        setSelectedFile({
          name: entry.name,
          path: data.path,
          content: data.content,
          truncated: data.truncated,
        });
        setCompactPanel('preview');
      } catch {
        setSelectedFile(null);
        setPreviewError('Failed to open file');
        setCompactPanel('preview');
      } finally {
        setPreviewLoadingPath(null);
      }
    },
    [rootPath],
  );

  return (
    <div
      data-testid="file-explorer-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: FILE_EXPLORER_Z_INDEX,
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
        aria-labelledby="file-explorer-title"
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
          <Folder {...ICON_PROPS} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              id="file-explorer-title"
              style={{ margin: 0, color: '#ffffff', fontSize: '14px', fontWeight: 700 }}
            >
              File Explorer
            </h2>
            <div
              title={root}
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
              {root}
            </div>
          </div>
          <button
            type="button"
            aria-label="Refresh directory"
            title="Refresh directory"
            onClick={() => void loadDirectory(currentPath)}
            disabled={loading}
            style={iconButtonStyle(!loading)}
          >
            {loading ? <Loader2 {...ICON_PROPS} /> : <RefreshCw {...ICON_PROPS} />}
          </button>
          <button
            type="button"
            aria-label="Close file explorer"
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
            display: 'flex',
            flexWrap: compact ? 'nowrap' : 'wrap',
            overflow: 'hidden',
          }}
        >
          <section
            aria-label="Workspace files"
            style={{
              minWidth: compact ? 0 : '280px',
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
            <div
              style={{
                minHeight: '42px',
                borderBottom: '1px solid #202320',
                display: 'grid',
                gridTemplateColumns: '32px minmax(0, 1fr)',
                gap: '8px',
                alignItems: 'center',
                padding: '0 10px',
              }}
            >
              <button
                type="button"
                aria-label="Go to parent folder"
                title="Go to parent folder"
                onClick={() => openDirectory(parent)}
                disabled={!canGoParent || loading}
                style={iconButtonStyle(canGoParent && !loading)}
              >
                <ArrowUp {...ICON_PROPS} />
              </button>
              <div
                title={currentPath}
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: '#aeb4ad',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              >
                {currentPath}
              </div>
            </div>
            <div style={{ minHeight: 0, flex: 1, overflowY: 'auto', padding: '8px' }}>
              {loading && entries.length === 0 ? (
                <EmptyState label="Loading directory" />
              ) : entries.length === 0 ? (
                <EmptyState label="No files in this directory" />
              ) : (
                entries.map((entry) => {
                  const entryLoading =
                    navigatingPath === entry.path || previewLoadingPath === entry.path;
                  const selected = selectedFile?.path === entry.path;
                  return (
                    <button
                      key={entry.path}
                      type="button"
                      aria-label={`${entry.isDir ? 'Open folder' : 'Open file'} ${entry.name}`}
                      onClick={() => {
                        if (entry.isDir) {
                          openDirectory(entry.path);
                          return;
                        }
                        void openFile(entry);
                      }}
                      disabled={loading || Boolean(previewLoadingPath)}
                      style={{
                        width: '100%',
                        minHeight: '42px',
                        border: `1px solid ${selected ? '#315f6b' : 'transparent'}`,
                        borderRadius: '6px',
                        background: selected ? '#071a1f' : entryLoading ? '#151917' : 'transparent',
                        color: '#f3f1e7',
                        cursor: loading || previewLoadingPath ? 'default' : 'pointer',
                        display: 'grid',
                        gridTemplateColumns: '24px minmax(0, 1fr)',
                        gap: '9px',
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
                          background: entry.isDir ? '#172114' : '#151817',
                          color: entry.isDir ? '#bde0a8' : '#83d9ec',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {entryLoading ? (
                          <Loader2 {...ICON_PROPS} />
                        ) : entry.isDir ? (
                          <Folder {...ICON_PROPS} />
                        ) : (
                          <FileText {...ICON_PROPS} />
                        )}
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
                            color: '#767c75',
                            fontFamily: 'monospace',
                            fontSize: '11px',
                          }}
                        >
                          {entry.isDir ? 'folder' : 'file'}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {error && <InlineError>{error}</InlineError>}
          </section>

          <section
            aria-label="File preview"
            style={{
              minWidth: compact ? 0 : '300px',
              width: compact ? '100%' : undefined,
              height: compact ? '100%' : undefined,
              flex: compact ? '0 0 100%' : '2 1 520px',
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
                  aria-label="Back to file list"
                  title="Back to file list"
                  onClick={() => setCompactPanel('files')}
                  style={{
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
                  }}
                >
                  <ArrowLeft {...ICON_PROPS} />
                  Files
                </button>
              )}
              <div
                title={selectedFile?.path ?? ''}
                style={{
                  minWidth: 0,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: selectedFile ? '#f5f4ec' : '#777c76',
                  fontFamily: selectedFile ? 'monospace' : undefined,
                  fontSize: '12px',
                  fontWeight: selectedFile ? 500 : 650,
                }}
              >
                {selectedFile?.path ?? 'Select a file'}
              </div>
              {selectedFile && (
                <>
                  <span
                    style={{
                      flexShrink: 0,
                      border: '1px solid #253b40',
                      borderRadius: '999px',
                      background: '#071a1f',
                      color: '#9ce8f8',
                      padding: '3px 8px',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    {selectedLanguage}
                  </span>
                  <button
                    type="button"
                    aria-label="Toggle line wrap"
                    aria-pressed={wordWrap}
                    title="Toggle line wrap"
                    onClick={() => setWordWrap((wrapped) => !wrapped)}
                    style={{
                      flexShrink: 0,
                      height: '28px',
                      border: `1px solid ${wordWrap ? '#315f6b' : '#303331'}`,
                      borderRadius: '6px',
                      background: wordWrap ? '#071a1f' : '#141715',
                      color: wordWrap ? '#9ce8f8' : '#d7d5ca',
                      cursor: 'pointer',
                      padding: '0 9px',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    Wrap
                  </button>
                </>
              )}
            </div>
            {previewError ? (
              <EmptyState label={previewError} />
            ) : selectedFile ? (
              <>
                {selectedFile.truncated && (
                  <div
                    style={{
                      flexShrink: 0,
                      borderBottom: '1px solid #253b40',
                      background: '#071a1f',
                      color: '#9ce8f8',
                      padding: '8px 12px',
                      fontSize: '12px',
                      fontWeight: 650,
                    }}
                  >
                    Preview truncated
                  </div>
                )}
                <div
                  data-testid="file-preview-editor"
                  style={{
                    flex: 1,
                    minHeight: 0,
                    background: '#050606',
                    overflow: 'hidden',
                  }}
                >
                  <Editor
                    height="100%"
                    path={selectedFile.path}
                    language={selectedLanguage}
                    value={selectedFile.content}
                    theme="vs-dark"
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
                      wordWrap: wordWrap ? 'on' : 'off',
                      wrappingIndent: 'same',
                      tabSize: 2,
                      detectIndentation: true,
                      readOnlyMessage: { value: 'File preview is read-only' },
                      bracketPairColorization: { enabled: true },
                      guides: { indentation: true, bracketPairs: true },
                      overviewRulerBorder: false,
                      padding: { top: 12, bottom: 12 },
                    }}
                  />
                </div>
              </>
            ) : (
              <EmptyState label="No file selected" />
            )}
          </section>
        </div>
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
