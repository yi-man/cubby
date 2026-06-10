import Editor from '@monaco-editor/react';
import { ArrowLeft, ArrowUp, FileText, Folder, Loader2, RefreshCw, X } from 'lucide-react';
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  definitionLineForSymbol,
  type FileExplorerEntry,
  type FilePreviewResponse,
  fileExplorerLayoutMode,
  fileLanguageFromPath,
  type ImportTarget,
  importTargetForSymbol,
  isFileBrowseResponse,
  isFilePreviewResponse,
  parentPathWithinRoot,
  relativePathFromRoot,
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
type EditorMount = NonNullable<ComponentProps<typeof Editor>['onMount']>;
type MonacoEditorInstance = Parameters<EditorMount>[0];

interface PendingReveal {
  path: string;
  line: number;
}

type FilePreviewLoadResult =
  | { kind: 'ok'; preview: FilePreviewResponse }
  | { kind: 'not-previewable' }
  | { kind: 'error' };

const ICON_PROPS = { size: 15, strokeWidth: 2.1, 'aria-hidden': true } as const;
const FILE_EXPLORER_Z_INDEX = 1000;

export function FileExplorer({ rootPath, onClose }: FileExplorerProps) {
  const viewportWidth = useViewportWidth();
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const rootRef = useRef(rootPath);
  const selectedFileRef = useRef<SelectedFile | null>(null);
  const openImportTargetRef = useRef<(target: ImportTarget) => void>(() => undefined);
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
  const [pendingReveal, setPendingReveal] = useState<PendingReveal | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const parent = useMemo(() => parentPathWithinRoot(currentPath, root), [currentPath, root]);
  const canGoParent = currentPath !== parent;
  const compact = fileExplorerLayoutMode(viewportWidth) === 'compact';
  const showFilesPanel = !compact || compactPanel === 'files';
  const showPreviewPanel = !compact || compactPanel === 'preview';
  const rootDisplayPath = relativePathFromRoot(root, root);
  const currentDisplayPath = relativePathFromRoot(currentPath, root);
  const selectedDisplayPath = selectedFile ? relativePathFromRoot(selectedFile.path, root) : '';
  const selectedLanguage = useMemo(
    () => (selectedFile ? fileLanguageFromPath(selectedFile.path) : 'plaintext'),
    [selectedFile],
  );

  useEffect(() => {
    rootRef.current = root;
  }, [root]);

  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

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
      setPendingReveal(null);
      setCompactPanel('files');
      setNavigatingPath(path);
      void loadDirectory(path);
    },
    [loadDirectory],
  );

  const loadFilePreview = useCallback(
    async (path: string): Promise<FilePreviewLoadResult> => {
      const query = new URLSearchParams({ root: rootPath, path });
      const res = await fetch(`/api/file?${query.toString()}`);
      if (res.status === 415) return { kind: 'not-previewable' };
      if (!res.ok) return { kind: 'error' };

      const data = await res.json();
      if (!isFilePreviewResponse(data)) return { kind: 'error' };

      return { kind: 'ok', preview: data };
    },
    [rootPath],
  );

  const openFilePath = useCallback(
    async (path: string, name: string) => {
      setPreviewLoadingPath(path);
      setPreviewError('');
      setPendingReveal(null);
      try {
        const result = await loadFilePreview(path);
        if (result.kind === 'not-previewable') {
          setSelectedFile(null);
          setPreviewError('This file is not previewable');
          setCompactPanel('preview');
          return;
        }
        if (result.kind === 'error') {
          setSelectedFile(null);
          setPreviewError('Failed to open file');
          setCompactPanel('preview');
          return;
        }

        const { preview } = result;
        setSelectedFile({
          name,
          path: preview.path,
          content: preview.content,
          truncated: preview.truncated,
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
    [loadFilePreview],
  );

  const openFile = useCallback(
    async (entry: FileExplorerEntry) => {
      await openFilePath(entry.path, entry.name);
    },
    [openFilePath],
  );

  const openImportTarget = useCallback(
    async (target: ImportTarget) => {
      setPreviewError('');
      setPendingReveal(null);

      for (const candidate of target.candidates) {
        setPreviewLoadingPath(candidate);
        try {
          const result = await loadFilePreview(candidate);
          if (result.kind !== 'ok') continue;

          const { preview } = result;
          setSelectedFile({
            name: fileNameFromPath(preview.path),
            path: preview.path,
            content: preview.content,
            truncated: preview.truncated,
          });
          setPendingReveal({
            path: preview.path,
            line: definitionLineForSymbol(preview.content, target.targetSymbol),
          });
          setCompactPanel('preview');
          setPreviewLoadingPath(null);
          return;
        } catch {}
      }

      setSelectedFile(null);
      setPreviewError('Definition file unavailable');
      setCompactPanel('preview');
      setPreviewLoadingPath(null);
    },
    [loadFilePreview],
  );

  useEffect(() => {
    openImportTargetRef.current = (target) => {
      void openImportTarget(target);
    };
  }, [openImportTarget]);

  const handleEditorMount: EditorMount = useCallback((editor) => {
    editorRef.current = editor;
    setEditorReady(true);

    const resolveTargetAtPosition = (position?: { lineNumber: number; column: number } | null) => {
      const selected = selectedFileRef.current;
      const model = editor.getModel();
      if (!selected || !model || !position) return null;

      const word = model.getWordAtPosition(position);
      if (!word?.word) return null;

      return importTargetForSymbol(model.getValue(), selected.path, rootRef.current, word.word);
    };

    const mouseMoveDisposable = editor.onMouseMove((event) => {
      const target = resolveTargetAtPosition(event.target.position);
      const editorNode = editor.getDomNode();
      if (editorNode) editorNode.style.cursor = target ? 'pointer' : '';
    });

    const mouseDownDisposable = editor.onMouseDown((event) => {
      const target = resolveTargetAtPosition(event.target.position);
      if (target) openImportTargetRef.current(target);
    });

    editor.onDidDispose(() => {
      mouseMoveDisposable.dispose();
      mouseDownDisposable.dispose();
      editorRef.current = null;
      setEditorReady(false);
    });
  }, []);

  useEffect(() => {
    if (
      !editorReady ||
      !pendingReveal ||
      !selectedFile ||
      selectedFile.path !== pendingReveal.path
    ) {
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;

    const animationFrame = window.requestAnimationFrame(() => {
      editor.setPosition({ lineNumber: pendingReveal.line, column: 1 });
      editor.revealLineInCenter(pendingReveal.line);
      editor.focus();
      setPendingReveal(null);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [editorReady, pendingReveal, selectedFile]);

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
              {rootDisplayPath}
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
                {currentDisplayPath}
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
                  const entryDisplayPath = relativePathFromRoot(entry.path, root);
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
                          {entryDisplayPath}
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
                {selectedDisplayPath || 'Select a file'}
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
                    onMount={handleEditorMount}
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

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
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
