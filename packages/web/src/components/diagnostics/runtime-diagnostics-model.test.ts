import { describe, expect, it } from 'vitest';
import {
  diagnosticStatusLabel,
  isRuntimeDiagnosticsResponse,
} from './runtime-diagnostics-model.js';

describe('runtime diagnostics model', () => {
  it('accepts runtime diagnostics responses', () => {
    expect(
      isRuntimeDiagnosticsResponse({
        generatedAt: '2026-06-11T10:00:00.000Z',
        server: {
          host: '127.0.0.1',
          port: 6310,
          dataDir: '/tmp/cubby',
          configPath: '/tmp/cubby/config.json',
        },
        checks: [
          {
            id: 'tool.git',
            label: 'git',
            status: 'ok',
            detail: 'git version 2.0.0',
          },
        ],
      }),
    ).toBe(true);
  });

  it('rejects malformed diagnostics responses', () => {
    expect(isRuntimeDiagnosticsResponse({ checks: 'ok' })).toBe(false);
  });

  it('formats status labels', () => {
    expect(diagnosticStatusLabel('ok')).toBe('OK');
    expect(diagnosticStatusLabel('warning')).toBe('Warning');
    expect(diagnosticStatusLabel('error')).toBe('Error');
  });
});
