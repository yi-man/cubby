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

export interface WorkspaceIntelligenceResponse {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPackageManager(value: unknown): value is WorkspacePackageManager {
  return (
    value === 'bun' ||
    value === 'pnpm' ||
    value === 'yarn' ||
    value === 'npm' ||
    value === 'unknown'
  );
}

function isCommandItem(value: unknown): value is WorkspaceScript | WorkspaceMakeTarget {
  return isRecord(value) && typeof value.name === 'string' && typeof value.command === 'string';
}

function isReadmeSummary(value: unknown): value is WorkspaceReadmeSummary {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    (typeof value.title === 'string' || value.title === null) &&
    typeof value.excerpt === 'string'
  );
}

function isFramework(value: unknown): value is WorkspaceFramework {
  return isRecord(value) && typeof value.name === 'string' && typeof value.evidence === 'string';
}

function isRecommendedCommand(value: unknown): value is WorkspaceRecommendedCommand {
  return (
    isRecord(value) &&
    (value.name === 'dev' ||
      value.name === 'test' ||
      value.name === 'lint' ||
      value.name === 'build') &&
    typeof value.command === 'string' &&
    typeof value.source === 'string'
  );
}

function isProjectDoc(value: unknown): value is WorkspaceProjectDoc {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    (value.kind === 'agents' || value.kind === 'claude' || value.kind === 'other') &&
    (typeof value.title === 'string' || value.title === null) &&
    typeof value.excerpt === 'string'
  );
}

export function isWorkspaceIntelligenceResponse(
  value: unknown,
): value is WorkspaceIntelligenceResponse {
  return (
    isRecord(value) &&
    typeof value.root === 'string' &&
    typeof value.generatedAt === 'string' &&
    isPackageManager(value.packageManager) &&
    (typeof value.packageManagerEvidence === 'string' || value.packageManagerEvidence === null) &&
    Array.isArray(value.scripts) &&
    value.scripts.every(isCommandItem) &&
    Array.isArray(value.makeTargets) &&
    value.makeTargets.every(isCommandItem) &&
    (value.readme === null || isReadmeSummary(value.readme)) &&
    Array.isArray(value.frameworks) &&
    value.frameworks.every(isFramework) &&
    Array.isArray(value.recommendedCommands) &&
    value.recommendedCommands.every(isRecommendedCommand) &&
    Array.isArray(value.projectDocs) &&
    value.projectDocs.every(isProjectDoc) &&
    typeof value.contextPrompt === 'string'
  );
}

export function workspaceIntelligenceButtonLabel(
  intelligence: WorkspaceIntelligenceResponse | null,
): string {
  if (!intelligence || intelligence.packageManager === 'unknown') return 'Workspace';
  return `${intelligence.packageManager} workspace`;
}
