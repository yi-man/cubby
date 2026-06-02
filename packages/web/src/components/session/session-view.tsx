import type { Session } from '@cubby/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TerminalView } from '../terminal/terminal.js';

interface SessionViewProps {
  session: Session;
  send: (req: { id: string; cmd: string; args?: Record<string, unknown> }) => void;
  onMessage: (handler: (msg: unknown) => void) => () => void;
}

export function SessionView({ session, send, onMessage }: SessionViewProps) {
  const [output, setOutput] = useState('');
  const termRef = useRef<any>(null);

  useEffect(() => {
    const unsub = onMessage((msg: any) => {
      if (msg.evt === 'terminal.output' && msg.data?.sessionId === session.id) {
        setOutput((prev) => prev + msg.data.data);
      }
    });
    return unsub;
  }, [session.id, onMessage]);

  useEffect(() => {
    if (output && termRef.current) {
      termRef.current.write(output);
      setOutput('');
    }
  }, [output]);

  const handleStart = useCallback(() => {
    send({ id: 'start', cmd: 'session.start', args: { sessionId: session.id, cwd: '/' } });
  }, [session.id, send]);

  const handleKill = useCallback(() => {
    send({ id: 'kill', cmd: 'session.kill', args: { sessionId: session.id } });
  }, [session.id, send]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          padding: '8px',
          borderBottom: '1px solid #333',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 'bold' }}>{session.title ?? session.provider}</span>
        <span style={{ color: '#888', fontSize: '12px' }}>{session.status}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
          {session.status === 'draft' && (
            <button onClick={handleStart} style={{ padding: '4px 12px' }}>
              Start
            </button>
          )}
          {(session.status === 'running' || session.status === 'starting') && (
            <button onClick={handleKill} style={{ padding: '4px 12px', color: 'red' }}>
              Kill
            </button>
          )}
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <TerminalView />
      </div>
    </div>
  );
}
