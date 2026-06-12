import { describe, expect, it } from 'vitest';
import {
  isWorkspaceIntelligenceResponse,
  workspaceIntelligenceButtonLabel,
} from './workspace-intelligence-model.js';

describe('workspace intelligence model', () => {
  it('accepts workspace intelligence responses', () => {
    expect(
      isWorkspaceIntelligenceResponse({
        root: '/repo',
        generatedAt: '2026-06-11T10:00:00.000Z',
        packageManager: 'bun',
        packageManagerEvidence: 'bun.lock',
        scripts: [{ name: 'test', command: 'vitest run' }],
        makeTargets: [{ name: 'check', command: 'make check' }],
        readme: {
          path: 'README.md',
          title: 'Cubby',
          excerpt: 'Local agent workspace.',
        },
        frameworks: [{ name: 'React', evidence: 'package.json dependency react' }],
        recommendedCommands: [
          { name: 'test', command: 'bun run test', source: 'package.json script test' },
        ],
        projectDocs: [
          {
            path: 'AGENTS.md',
            kind: 'agents',
            title: 'Agent Notes',
            excerpt: 'Use TDD.',
          },
        ],
        contextPrompt: 'Package manager: bun',
      }),
    ).toBe(true);
  });

  it('rejects malformed workspace intelligence responses', () => {
    expect(isWorkspaceIntelligenceResponse({ root: '/repo', scripts: 'test' })).toBe(false);
    expect(
      isWorkspaceIntelligenceResponse({
        root: '/repo',
        generatedAt: '2026-06-11T10:00:00.000Z',
        packageManager: 'bun',
        packageManagerEvidence: 'bun.lock',
        scripts: [],
        makeTargets: [],
        readme: null,
      }),
    ).toBe(false);
  });

  it('formats toolbar labels', () => {
    expect(workspaceIntelligenceButtonLabel(null)).toBe('Workspace');
    expect(
      workspaceIntelligenceButtonLabel({
        root: '/repo',
        generatedAt: '2026-06-11T10:00:00.000Z',
        packageManager: 'bun',
        packageManagerEvidence: 'bun.lock',
        scripts: [{ name: 'test', command: 'vitest run' }],
        makeTargets: [],
        readme: null,
        frameworks: [],
        recommendedCommands: [],
        projectDocs: [],
        contextPrompt: 'Package manager: bun',
      }),
    ).toBe('bun workspace');
  });
});
