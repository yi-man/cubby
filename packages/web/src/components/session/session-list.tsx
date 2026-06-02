import type { Session } from '@cubby/core';

interface SessionListProps {
  sessions: Session[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function SessionList({ sessions, currentId, onSelect, onCreate }: SessionListProps) {
  return (
    <div
      style={{ padding: '8px', borderRight: '1px solid #333', height: '100%', overflowY: 'auto' }}
    >
      <button onClick={onCreate} style={{ width: '100%', marginBottom: '8px', padding: '8px' }}>
        + New Session
      </button>
      {sessions.map((s) => (
        <div
          key={s.id}
          onClick={() => onSelect(s.id)}
          style={{
            padding: '8px',
            cursor: 'pointer',
            background: s.id === currentId ? '#2a2a3e' : 'transparent',
            borderRadius: '4px',
            marginBottom: '4px',
          }}
        >
          <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{s.title ?? s.provider}</div>
          <div style={{ fontSize: '12px', color: '#888' }}>{s.status}</div>
        </div>
      ))}
    </div>
  );
}
