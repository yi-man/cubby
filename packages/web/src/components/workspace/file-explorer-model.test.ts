import { describe, expect, it } from 'vitest';
import {
  definitionLineForSymbol,
  fileExplorerLayoutMode,
  fileLanguageFromPath,
  importTargetForSymbol,
  isFileBrowseResponse,
  isFilePreviewResponse,
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
