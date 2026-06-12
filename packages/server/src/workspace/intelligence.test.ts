import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWorkspaceIntelligence } from './intelligence.js';

describe('workspace intelligence', () => {
  it('summarizes package manager, scripts, make targets, and README content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cubby-workspace-intelligence-'));
    writeFileSync(join(root, 'bun.lock'), '');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify(
        {
          scripts: {
            dev: 'vite --host 0.0.0.0',
            test: 'vitest run',
            lint: 'biome check .',
            build: 'bun run --filter "*" build',
          },
          dependencies: {
            next: '^15.0.0',
            react: '^19.0.0',
          },
          devDependencies: {
            typescript: '^5.7.0',
            vite: '^6.0.0',
            vitest: '^3.0.0',
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(root, 'Makefile'),
      ['.PHONY: test build', 'test:', '\tvitest run', 'build: dist', '\tbun run build'].join('\n'),
    );
    writeFileSync(
      join(root, 'README.md'),
      ['# Demo Workspace', '', 'A compact project for testing workspace intelligence.', ''].join(
        '\n',
      ),
    );
    writeFileSync(join(root, 'AGENTS.md'), '# Agent Notes\n\nUse TDD for changes.\n');
    writeFileSync(join(root, 'CLAUDE.md'), '# Claude Notes\n\nRun lint before handoff.\n');

    const intelligence = await readWorkspaceIntelligence(root);

    expect(intelligence).toMatchObject({
      root,
      packageManager: 'bun',
      packageManagerEvidence: 'bun.lock',
      scripts: [
        { name: 'dev', command: 'vite --host 0.0.0.0' },
        { name: 'test', command: 'vitest run' },
        { name: 'lint', command: 'biome check .' },
        { name: 'build', command: 'bun run --filter "*" build' },
      ],
      makeTargets: [
        { name: 'test', command: 'make test' },
        { name: 'build', command: 'make build' },
      ],
      readme: {
        path: 'README.md',
        title: 'Demo Workspace',
        excerpt: 'A compact project for testing workspace intelligence.',
      },
      frameworks: [
        { name: 'Next.js', evidence: 'package.json dependency next' },
        { name: 'React', evidence: 'package.json dependency react' },
        { name: 'Vite', evidence: 'package.json dependency vite' },
        { name: 'Vitest', evidence: 'package.json dependency vitest' },
        { name: 'TypeScript', evidence: 'package.json dependency typescript' },
      ],
      recommendedCommands: [
        { name: 'dev', command: 'bun run dev', source: 'package.json script dev' },
        { name: 'test', command: 'bun run test', source: 'package.json script test' },
        { name: 'lint', command: 'bun run lint', source: 'package.json script lint' },
        { name: 'build', command: 'bun run build', source: 'package.json script build' },
      ],
      projectDocs: [
        {
          path: 'AGENTS.md',
          kind: 'agents',
          title: 'Agent Notes',
          excerpt: 'Use TDD for changes.',
        },
        {
          path: 'CLAUDE.md',
          kind: 'claude',
          title: 'Claude Notes',
          excerpt: 'Run lint before handoff.',
        },
      ],
    });
    expect(intelligence.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(intelligence.contextPrompt).toContain('Package manager: bun');
    expect(intelligence.contextPrompt).toContain('Recommended commands: bun run dev');
    expect(intelligence.contextPrompt).toContain('Project docs: AGENTS.md, CLAUDE.md');
  });
});
