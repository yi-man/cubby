import { useState, useCallback, useEffect } from 'react';
import { useAtom } from 'jotai';
import type { Session } from '@cubby/core';
import { useWebSocket } from './hooks/use-ws.js';
import { sessionsAtom, currentSessionIdAtom } from './atoms/session.js';
import { SessionList } from './components/session/session-list.js';
import { SessionView } from './components/session/session-view.js';

export function App() {
  const { send, onMessage, connected } = useWebSocket('ws://localhost:3000/ws');
  const [sessions, setSessions] = useAtom(sessionsAtom);
  const [currentId, setCurrentId] = useAtom(currentSessionIdAtom);
  const currentSession = sessions.find((s) => s.id === currentId) ?? null;

  // Load sessions on connect
  useEffect(() => {
    if (connected) {
      send({ id: 'init', cmd: 'session.list' });
    }
  }, [connected, send]);

  // Handle responses
  useEffect(() => {
    return onMessage((msg: any) => {
      if (msg.ok && msg.id === 'init' && Array.isArray(msg.data)) {
        setSessions(msg.data);
      }
      if (msg.ok && msg.id === 'create' && msg.data) {
        setSessions((prev) => [msg.data, ...prev]);
        setCurrentId(msg.data.id);
      }
      if (msg.evt === 'session.status') {
        setSessions((prev) =>
          prev.map((s) => (s.id === msg.data.sessionId ? { ...s, status: msg.data.status } : s))
        );
      }
    });
  }, [onMessage, setSessions, setCurrentId]);

  const handleCreate = useCallback(() => {
    send({ id: 'create', cmd: 'session.create', args: { workspaceId: '/', provider: 'claude-code' } });
  }, [send]);

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#1e1e2e', color: '#cdd6f4', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: '240px', flexShrink: 0 }}>
        <SessionList
          sessions={sessions}
          currentId={currentId}
          onSelect={setCurrentId}
          onCreate={handleCreate}
        />
      </div>
      <div style={{ flex: 1 }}>
        {currentSession ? (
          <SessionView session={currentSession} send={send} onMessage={onMessage} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>
            Select or create a session
          </div>
        )}
      </div>
    </div>
  );
}
