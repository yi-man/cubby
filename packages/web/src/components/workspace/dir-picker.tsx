import { useCallback, useEffect, useRef, useState } from 'react';

interface DirPickerProps {
  onConfirm: (path: string) => void;
  onCancel: () => void;
}

export function DirPicker({ onConfirm, onCancel }: DirPickerProps) {
  const [path, setPath] = useState('/');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!path.trim()) {
      setError('Path is required');
      return;
    }
    try {
      const res = await fetch(`/api/browse?path=${encodeURIComponent(path.trim())}`);
      if (!res.ok) {
        setError('Directory not found or not accessible');
        return;
      }
      onConfirm(path.trim());
    } catch {
      setError('Failed to verify path');
    }
  }, [path, onConfirm]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-picker-title"
        style={{
          background: '#2a2a3e',
          padding: '24px',
          borderRadius: '8px',
          width: '420px',
          color: '#cdd6f4',
        }}
      >
        <h3 id="workspace-picker-title" style={{ margin: '0 0 16px', fontSize: '16px' }}>
          Open Workspace
        </h3>
        <div style={{ marginBottom: '12px' }}>
          <input
            ref={inputRef}
            aria-label="Workspace path"
            type="text"
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="/path/to/project"
            style={{
              width: '100%',
              padding: '8px 12px',
              background: '#1e1e2e',
              border: '1px solid #444',
              borderRadius: '4px',
              color: '#cdd6f4',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        {error && (
          <div style={{ color: '#f38ba8', fontSize: '12px', marginBottom: '8px' }}>{error}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '6px 16px',
              background: 'transparent',
              border: '1px solid #444',
              borderRadius: '4px',
              color: '#cdd6f4',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            style={{
              padding: '6px 16px',
              background: '#89b4fa',
              border: 'none',
              borderRadius: '4px',
              color: '#1e1e2e',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
