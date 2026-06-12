import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export type WorkspacePackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm' | 'unknown';

export interface WorkspaceScript {
  name: string;
  command: string;
}

export interface WorkspaceMakeTarget {
  name: string;
  command: string;
}

export interface WorkspaceReadmeSummary {
  path: string;
  title: string | null;
  excerpt: string;
}

export interface WorkspaceFramework {
  name: string;
  evidence: string;
}

export interface WorkspaceRecommendedCommand {
  name: 'dev' | 'test' | 'lint' | 'build';
  command: string;
  source: string;
}

export interface WorkspaceProjectDoc {
  path: string;
  kind: 'agents' | 'claude' | 'other';
  title: string | null;
  excerpt: string;
}

export interface WorkspaceIntelligence {
  root: string;
  generatedAt: string;
  packageManager: WorkspacePackageManager;
  packageManagerEvidence: string | null;
  scripts: WorkspaceScript[];
  makeTargets: WorkspaceMakeTarget[];
  readme: WorkspaceReadmeSummary | null;
  frameworks: WorkspaceFramework[];
  recommendedCommands: WorkspaceRecommendedCommand[];
  projectDocs: WorkspaceProjectDoc[];
  contextPrompt: string;
}

const PACKAGE_MANAGER_EVIDENCE: Array<{
  file: string;
  packageManager: WorkspacePackageManager;
}> = [
  { file: 'bun.lock', packageManager: 'bun' },
  { file: 'bun.lockb', packageManager: 'bun' },
  { file: 'pnpm-lock.yaml', packageManager: 'pnpm' },
  { file: 'yarn.lock', packageManager: 'yarn' },
  { file: 'package-lock.json', packageManager: 'npm' },
];

const README_CANDIDATES = ['README.md', 'README.MD', 'readme.md'];
const PROJECT_DOC_CANDIDATES: Array<{ path: string; kind: WorkspaceProjectDoc['kind'] }> = [
  { path: 'AGENTS.md', kind: 'agents' },
  { path: 'CLAUDE.md', kind: 'claude' },
];
const FRAMEWORK_DEPENDENCIES = [
  ['next', 'Next.js'],
  ['react', 'React'],
  ['vite', 'Vite'],
  ['vitest', 'Vitest'],
  ['typescript', 'TypeScript'],
  ['@playwright/test', 'Playwright'],
  ['tailwindcss', 'Tailwind CSS'],
] as const;
const MAX_SCRIPTS = 24;
const MAX_MAKE_TARGETS = 24;
const MAX_README_BYTES = 32 * 1024;
const MAX_README_EXCERPT_CHARS = 240;

export async function readWorkspaceIntelligence(root: string): Promise<WorkspaceIntelligence> {
  const workspaceRoot = resolve(root);
  const packageJson = await readPackageJson(workspaceRoot);
  const packageManager = await detectPackageManager(workspaceRoot, Boolean(packageJson));
  const scripts = readScripts(packageJson);
  const makeTargets = await readMakeTargets(workspaceRoot);
  const readme = await readReadmeSummary(workspaceRoot);
  const frameworks = detectFrameworks(packageJson);
  const recommendedCommands = recommendCommands(scripts, packageManager.packageManager);
  const projectDocs = await readProjectDocs(workspaceRoot);
  const intelligence = {
    root: workspaceRoot,
    generatedAt: new Date().toISOString(),
    packageManager: packageManager.packageManager,
    packageManagerEvidence: packageManager.evidence,
    scripts,
    makeTargets,
    readme,
    frameworks,
    recommendedCommands,
    projectDocs,
    contextPrompt: '',
  };

  return {
    ...intelligence,
    contextPrompt: buildContextPrompt(intelligence),
  };
}

async function detectPackageManager(
  root: string,
  hasPackageJson: boolean,
): Promise<{ packageManager: WorkspacePackageManager; evidence: string | null }> {
  for (const evidence of PACKAGE_MANAGER_EVIDENCE) {
    if ((await readOptionalText(join(root, evidence.file), 1)) !== null) {
      return { packageManager: evidence.packageManager, evidence: evidence.file };
    }
  }

  if (hasPackageJson) {
    return { packageManager: 'npm', evidence: 'package.json' };
  }
  return { packageManager: 'unknown', evidence: null };
}

async function readPackageJson(root: string): Promise<Record<string, unknown> | null> {
  const content = await readOptionalText(join(root, 'package.json'));
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readScripts(packageJson: Record<string, unknown> | null): WorkspaceScript[] {
  const scripts = packageJson?.scripts;
  if (!isRecord(scripts)) return [];

  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .slice(0, MAX_SCRIPTS)
    .map(([name, command]) => ({ name, command }));
}

function detectFrameworks(packageJson: Record<string, unknown> | null): WorkspaceFramework[] {
  const dependencies = dependencyNames(packageJson);
  return FRAMEWORK_DEPENDENCIES.filter(([dependency]) => dependencies.has(dependency)).map(
    ([dependency, name]) => ({
      name,
      evidence: `package.json dependency ${dependency}`,
    }),
  );
}

function recommendCommands(
  scripts: WorkspaceScript[],
  packageManager: WorkspacePackageManager,
): WorkspaceRecommendedCommand[] {
  const scriptNames = new Set(scripts.map((script) => script.name));
  const runner = packageManager === 'unknown' ? 'npm' : packageManager;
  return (['dev', 'test', 'lint', 'build'] as const)
    .filter((name) => scriptNames.has(name))
    .map((name) => ({
      name,
      command: `${runner} run ${name}`,
      source: `package.json script ${name}`,
    }));
}

async function readMakeTargets(root: string): Promise<WorkspaceMakeTarget[]> {
  const content =
    (await readOptionalText(join(root, 'Makefile'))) ??
    (await readOptionalText(join(root, 'makefile')));
  if (!content) return [];

  const targets: WorkspaceMakeTarget[] = [];
  const seen = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith('\t') || line.startsWith(' ')) continue;
    const match = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?![=:])/.exec(line);
    const name = match?.[1];
    if (!name || seen.has(name) || name.includes('%')) continue;
    seen.add(name);
    targets.push({ name, command: `make ${name}` });
    if (targets.length >= MAX_MAKE_TARGETS) break;
  }
  return targets;
}

async function readReadmeSummary(root: string): Promise<WorkspaceReadmeSummary | null> {
  for (const candidate of README_CANDIDATES) {
    const content = await readOptionalText(join(root, candidate), MAX_README_BYTES);
    if (!content) continue;
    const summary = summarizeReadme(content);
    return {
      path: candidate,
      title: summary.title,
      excerpt: summary.excerpt,
    };
  }
  return null;
}

async function readProjectDocs(root: string): Promise<WorkspaceProjectDoc[]> {
  const docs: WorkspaceProjectDoc[] = [];
  for (const candidate of PROJECT_DOC_CANDIDATES) {
    const content = await readOptionalText(join(root, candidate.path), MAX_README_BYTES);
    if (!content) continue;
    const summary = summarizeReadme(content);
    docs.push({
      path: candidate.path,
      kind: candidate.kind,
      title: summary.title,
      excerpt: summary.excerpt,
    });
  }
  return docs;
}

function summarizeReadme(content: string): { title: string | null; excerpt: string } {
  const lines = content.split(/\r?\n/);
  const title =
    lines
      .map((line) => /^#\s+(.+)$/.exec(line.trim())?.[1]?.trim())
      .find((value): value is string => Boolean(value)) ?? null;
  const excerpt =
    lines
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('```'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, MAX_README_EXCERPT_CHARS)
      .trim() || '';
  return { title, excerpt };
}

function dependencyNames(packageJson: Record<string, unknown> | null): Set<string> {
  const names = new Set<string>();
  for (const key of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const dependencies = packageJson?.[key];
    if (!isRecord(dependencies)) continue;
    for (const dependency of Object.keys(dependencies)) names.add(dependency);
  }
  return names;
}

function buildContextPrompt(intelligence: Omit<WorkspaceIntelligence, 'contextPrompt'>): string {
  const lines = [
    `Workspace: ${intelligence.root}`,
    `Package manager: ${intelligence.packageManager}`,
  ];
  if (intelligence.frameworks.length > 0) {
    lines.push(
      `Frameworks: ${intelligence.frameworks.map((framework) => framework.name).join(', ')}`,
    );
  }
  if (intelligence.recommendedCommands.length > 0) {
    lines.push(
      `Recommended commands: ${intelligence.recommendedCommands
        .map((command) => command.command)
        .join(', ')}`,
    );
  }
  if (intelligence.projectDocs.length > 0) {
    lines.push(`Project docs: ${intelligence.projectDocs.map((doc) => doc.path).join(', ')}`);
  }
  if (intelligence.readme?.excerpt) {
    lines.push(`README: ${intelligence.readme.excerpt}`);
  }
  return lines.join('\n');
}

async function readOptionalText(path: string, maxBytes?: number): Promise<string | null> {
  try {
    const buffer = await readFile(path);
    return buffer.subarray(0, maxBytes ?? buffer.byteLength).toString('utf8');
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
