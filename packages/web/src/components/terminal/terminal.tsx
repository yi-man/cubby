import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';

export interface TerminalHandle {
  write: (data: string) => void;
  writeAsync: (data: string) => Promise<void>;
  clear: () => void;
  reset: () => void;
  fit: () => void;
  focus: () => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  getTerminal: () => Terminal | null;
}

interface TerminalViewProps {
  interactive?: boolean;
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onReady?: () => void;
}

export const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(function TerminalView(
  { interactive = true, onData, onResize, onReady },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const onReadyRef = useRef(onReady);
  const interactiveRef = useRef(interactive);

  interactiveRef.current = interactive;
  onDataRef.current = onData;
  onResizeRef.current = onResize;
  onReadyRef.current = onReady;

  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.disableStdin = !interactive;
    if (!interactive) term.blur();
  }, [interactive]);

  useImperativeHandle(ref, () => ({
    write: (data: string) => {
      terminalRef.current?.write(data);
    },
    writeAsync: (data: string) => {
      return new Promise((resolve) => {
        const term = terminalRef.current;
        if (!term) {
          resolve();
          return;
        }
        term.write(data, resolve);
      });
    },
    clear: () => {
      terminalRef.current?.clear();
    },
    reset: () => {
      const term = terminalRef.current;
      if (!term) return;
      term.reset();
      term.clear();
      term.options.disableStdin = !interactiveRef.current;
      fitAddonRef.current?.fit();
    },
    fit: () => {
      fitAddonRef.current?.fit();
    },
    focus: () => {
      terminalRef.current?.focus();
    },
    scrollToTop: () => {
      terminalRef.current?.scrollToTop();
    },
    scrollToBottom: () => {
      terminalRef.current?.scrollToBottom();
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
      disableStdin: !interactiveRef.current,
      fontSize: 14,
      fontFamily: '"SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
      theme: {
        background: '#050606',
        foreground: '#e6e2da',
        cursor: '#22c8f2',
        selectionBackground: '#263238',
        black: '#050606',
        brightBlack: '#6f6f6a',
        red: '#d58c7f',
        brightRed: '#f1a092',
        green: '#9bd37f',
        brightGreen: '#b6ed9b',
        yellow: '#d0b873',
        brightYellow: '#e6cf8a',
        blue: '#8fb8ff',
        brightBlue: '#a8c8ff',
        magenta: '#c6a4f2',
        brightMagenta: '#d7b8ff',
        cyan: '#58d7f5',
        brightCyan: '#78e4ff',
        white: '#dedbd2',
        brightWhite: '#ffffff',
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

    term.onData((data) => {
      if (interactiveRef.current) onDataRef.current?.(data);
    });

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
