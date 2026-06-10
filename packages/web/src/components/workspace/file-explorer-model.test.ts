import { describe, expect, it } from 'vitest';
import {
  isFileBrowseResponse,
  isFilePreviewResponse,
  parentPathWithinRoot,
} from './file-explorer-model.js';

describe('file explorer model', () => {
  it('validates directory browse responses', () => {
    expect(
      isFileBrowseResponse({
        path: '/work',
        root: '/work',
        entries: [
          { name: 'src', path: '/work/src', isDir: true, previewable: false },
          { name: 'README.md', path: '/work/README.md', isDir: false, previewable: true },
        ],
      }),
    ).toBe(true);

    expect(
      isFileBrowseResponse({
        path: '/work',
        root: '/work',
        entries: [{ name: 'README.md', path: '/work/README.md', isDir: 'false' }],
      }),
    ).toBe(false);
  });

  it('validates file preview responses', () => {
    expect(
      isFilePreviewResponse({
        path: '/work/README.md',
        content: '# Cubby\n',
        truncated: false,
      }),
    ).toBe(true);

    expect(
      isFilePreviewResponse({
        path: '/work/README.md',
        content: '# Cubby\n',
        truncated: 'false',
      }),
    ).toBe(false);
  });

  it('calculates parent paths without moving above the root', () => {
    expect(parentPathWithinRoot('/work/src/components', '/work')).toBe('/work/src');
    expect(parentPathWithinRoot('/work/src', '/work')).toBe('/work');
    expect(parentPathWithinRoot('/work', '/work')).toBe('/work');
    expect(parentPathWithinRoot('/work-alpha', '/work')).toBe('/work');
  });
});
