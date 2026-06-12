import { describe, expect, it } from 'vitest';
import {
  definitionLineForSymbol,
  extractedWorkspaceFileRefs,
  fileExplorerLayoutMode,
  fileLanguageFromPath,
  filePreviewKind,
  importTargetForSymbol,
  isFileBrowseResponse,
  isFilePreviewResponse,
  isWorkspaceSearchResponse,
  markdownPreviewBlocks,
  parentPathWithinRoot,
  relativePathFromRoot,
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

  it('validates workspace search responses', () => {
    expect(
      isWorkspaceSearchResponse({
        root: '/work',
        query: 'roadmap',
        truncated: false,
        results: [
          {
            path: 'docs/ROADMAP.md',
            absolutePath: '/work/docs/ROADMAP.md',
            line: 8,
            column: 12,
            excerpt: 'Runtime diagnostics',
            matchType: 'content',
          },
          {
            path: 'src/App.tsx',
            absolutePath: '/work/src/App.tsx',
            line: 1,
            column: 1,
            excerpt: 'src/App.tsx',
            matchType: 'path',
          },
        ],
      }),
    ).toBe(true);

    expect(
      isWorkspaceSearchResponse({
        root: '/work',
        query: 'roadmap',
        truncated: false,
        results: [{ path: 'README.md', line: '1' }],
      }),
    ).toBe(false);
  });

  it('calculates parent paths without moving above the root', () => {
    expect(parentPathWithinRoot('/work/src/components', '/work')).toBe('/work/src');
    expect(parentPathWithinRoot('/work/src', '/work')).toBe('/work');
    expect(parentPathWithinRoot('/work', '/work')).toBe('/work');
    expect(parentPathWithinRoot('/work-alpha', '/work')).toBe('/work');
  });

  it('maps file paths to Monaco languages', () => {
    expect(fileLanguageFromPath('/work/packages/web/src/app.tsx')).toBe('typescript');
    expect(fileLanguageFromPath('/work/package.json')).toBe('json');
    expect(fileLanguageFromPath('/work/docs/README.md')).toBe('markdown');
    expect(fileLanguageFromPath('/work/styles/global.css')).toBe('css');
    expect(fileLanguageFromPath('/work/scripts/dev.ts')).toBe('typescript');
    expect(fileLanguageFromPath('/work/unknown.config')).toBe('plaintext');
  });

  it('classifies file preview modes for text, markdown, and images', () => {
    expect(filePreviewKind('/work/src/app.ts')).toBe('text');
    expect(filePreviewKind('/work/README.md')).toBe('markdown');
    expect(filePreviewKind('/work/assets/logo.png')).toBe('image');
    expect(filePreviewKind('/work/assets/photo.webp')).toBe('image');
  });

  it('builds safe markdown preview blocks without raw HTML', () => {
    expect(
      markdownPreviewBlocks(
        ['# Title', '', '- first', '- second', '', '```ts', '<script>', '```'].join('\n'),
      ),
    ).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'list', items: ['first', 'second'] },
      { kind: 'code', language: 'ts', text: '<script>' },
    ]);
  });

  it('extracts workspace file references from verification output', () => {
    expect(
      extractedWorkspaceFileRefs(
        ['src/app.ts:12:5 - error TS2322: mismatch', 'docs/README.md:3 failed check'].join('\n'),
        '/work',
      ),
    ).toEqual([
      { path: '/work/src/app.ts', displayPath: 'src/app.ts', line: 12 },
      { path: '/work/docs/README.md', displayPath: 'docs/README.md', line: 3 },
    ]);
  });

  it('uses compact layout on mobile-sized viewports', () => {
    expect(fileExplorerLayoutMode(390)).toBe('compact');
    expect(fileExplorerLayoutMode(719)).toBe('compact');
    expect(fileExplorerLayoutMode(720)).toBe('split');
    expect(fileExplorerLayoutMode(1040)).toBe('split');
  });

  it('formats paths relative to the workspace root', () => {
    expect(relativePathFromRoot('/work', '/work')).toBe('.');
    expect(relativePathFromRoot('/work/package.json', '/work')).toBe('package.json');
    expect(relativePathFromRoot('/work/src/App.tsx', '/work')).toBe('src/App.tsx');
    expect(relativePathFromRoot('/work-alpha/package.json', '/work')).toBe(
      '/work-alpha/package.json',
    );
  });

  it('resolves default import targets for clicked symbols', () => {
    const source = [
      "import { StrictMode } from 'react';",
      "import App from './App.tsx';",
      '',
      '<App />',
    ].join('\n');

    expect(importTargetForSymbol(source, '/work/src/main.tsx', '/work', 'App')).toEqual({
      candidates: ['/work/src/App.tsx'],
      importPath: './App.tsx',
      targetSymbol: 'App',
    });

    expect(importTargetForSymbol(source, '/work/src/main.tsx', '/work', 'StrictMode')).toBeNull();
  });

  it('resolves named import targets with extension fallbacks', () => {
    const source = "import { Button as PrimaryButton } from '../components/Button';";

    expect(
      importTargetForSymbol(source, '/work/src/pages/Home.tsx', '/work', 'PrimaryButton'),
    ).toEqual({
      candidates: [
        '/work/src/components/Button.ts',
        '/work/src/components/Button.tsx',
        '/work/src/components/Button.js',
        '/work/src/components/Button.jsx',
        '/work/src/components/Button.json',
        '/work/src/components/Button.css',
        '/work/src/components/Button/index.ts',
        '/work/src/components/Button/index.tsx',
        '/work/src/components/Button/index.js',
        '/work/src/components/Button/index.jsx',
      ],
      importPath: '../components/Button',
      targetSymbol: 'Button',
    });
  });

  it('resolves js import specifiers to TypeScript source fallbacks', () => {
    const source = "import { App } from './app.js';";

    expect(
      importTargetForSymbol(source, '/work/packages/web/src/main.tsx', '/work', 'App'),
    ).toEqual({
      candidates: [
        '/work/packages/web/src/app.js',
        '/work/packages/web/src/app.ts',
        '/work/packages/web/src/app.tsx',
        '/work/packages/web/src/app.jsx',
      ],
      importPath: './app.js',
      targetSymbol: 'App',
    });
  });

  it('finds likely definition lines for imported symbols', () => {
    expect(
      definitionLineForSymbol(
        ['const value = 1;', 'export function App() {', '}'].join('\n'),
        'App',
      ),
    ).toBe(2);
    expect(
      definitionLineForSymbol(
        ['type Props = {};', 'const App = () => null;', 'export default App;'].join('\n'),
        'App',
      ),
    ).toBe(2);
    expect(
      definitionLineForSymbol(['export default function App() {', '}'].join('\n'), 'App'),
    ).toBe(1);
  });
});
