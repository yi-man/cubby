import { describe, expect, it } from 'vitest';
import {
  formatPreviewLastActivity,
  isPreviewListResponse,
  previewAbsoluteUrl,
  previewButtonLabel,
} from './port-preview-model.js';

describe('port preview model', () => {
  it('accepts preview list responses with process metadata', () => {
    expect(
      isPreviewListResponse({
        root: '/repo',
        ports: [
          {
            id: '5173',
            port: 5173,
            pid: 1200,
            command: 'vite',
            cwd: '/repo',
            host: '127.0.0.1',
            url: '/preview/5173/',
            lastActivityAt: '2026-06-11T10:00:00.000Z',
          },
        ],
      }),
    ).toBe(true);
  });

  it('rejects malformed preview list responses', () => {
    expect(isPreviewListResponse({ root: '/repo', ports: [{ port: '5173' }] })).toBe(false);
    expect(isPreviewListResponse({ root: '/repo', ports: '5173' })).toBe(false);
  });

  it('formats preview button labels from port counts', () => {
    expect(previewButtonLabel(null)).toBe('Previews');
    expect(previewButtonLabel([])).toBe('Previews');
    expect(previewButtonLabel([{ id: '3000' }])).toBe('1 preview');
    expect(previewButtonLabel([{ id: '3000' }, { id: '5173' }])).toBe('2 previews');
  });

  it('formats recent activity relative to a stable clock', () => {
    const now = new Date('2026-06-11T10:10:00.000Z').getTime();

    expect(formatPreviewLastActivity('2026-06-11T10:09:35.000Z', now)).toBe('just now');
    expect(formatPreviewLastActivity('2026-06-11T10:04:00.000Z', now)).toBe('6m ago');
    expect(formatPreviewLastActivity('2026-06-11T08:00:00.000Z', now)).toBe('2h ago');
    expect(formatPreviewLastActivity('bad-date', now)).toBe('Activity unknown');
  });

  it('resolves preview links against the current origin', () => {
    expect(previewAbsoluteUrl('/preview/5173/', 'http://127.0.0.1:7420')).toBe(
      'http://127.0.0.1:7420/preview/5173/',
    );
  });
});
