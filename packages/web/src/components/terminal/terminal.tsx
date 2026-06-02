import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

export function TerminalView({ onData, onResize }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

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
    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;

    if (onData) {
      term.onData((data) => onData(data));
    }

    if (onResize) {
      term.onResize(({ cols, rows }) => onResize(cols, rows));
    }

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      term.dispose();
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: '200px' }} />;
}

export function useTerminalOutput(terminalRef: Terminal | null, output: string) {
  useEffect(() => {
    if (terminalRef && output) {
      terminalRef.write(output);
    }
  }, [terminalRef, output]);
}
