import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';

export interface TerminalHandle {
  write: (data: string) => void;
  clear: () => void;
  fit: () => void;
  getTerminal: () => Terminal | null;
}

interface TerminalViewProps {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onReady?: () => void;
}

export const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(function TerminalView(
  { onData, onResize, onReady },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useImperativeHandle(ref, () => ({
    write: (data: string) => {
      terminalRef.current?.write(data);
    },
    clear: () => {
      terminalRef.current?.clear();
    },
    fit: () => {
      fitAddonRef.current?.fit();
    },
    getTerminal: () => terminalRef.current,
  }));

  useEffect(() => {
    if (!containerRef.current) return;
    let lastCols = 0;
    let lastRows = 0;
    const notifyResize = (cols: number, rows: number) => {
      if (cols <= 0 || rows <= 0) return;
      if (cols === lastCols && rows === lastRows) return;
      lastCols = cols;
      lastRows = rows;
      onResizeRef.current?.(cols, rows);
    };

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.onResize(({ cols, rows }) => notifyResize(cols, rows));
    term.open(containerRef.current);
    fitAddon.fit();
    notifyResize(term.cols, term.rows);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    onReadyRef.current?.();

    term.onData((data) => onDataRef.current?.(data));

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      notifyResize(term.cols, term.rows);
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      term.dispose();
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 0 }} />;
});
