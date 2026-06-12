import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { RuntimeConfig } from '../config/runtime.js';

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 1500;
const LOW_DISK_SPACE_BYTES = 512 * 1024 * 1024;

export type DiagnosticStatus = 'ok' | 'warning' | 'error';

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
  recommendation?: string;
}

export interface RuntimeDiagnostics {
  generatedAt: string;
  server: {
    host: string;
    port: number;
    dataDir: string;
    configPath: string;
  };
  checks: DiagnosticCheck[];
}

export interface CommandCheckResult {
  available: boolean;
  version?: string;
  error?: string;
}

export interface DiskSpaceResult {
  availableBytes: number | null;
  error?: string;
}

export interface RuntimeDiagnosticsOptions {
  checkCommand?: (command: string) => Promise<CommandCheckResult>;
  checkDiskSpace?: (path: string) => Promise<DiskSpaceResult>;
}

const TOOL_CHECKS = [
  {
    id: 'tool.claude',
    label: 'Claude Code',
    command: 'claude',
    recommendation: 'Install the Claude Code CLI or remove it from your provider list.',
  },
  {
    id: 'tool.codex',
    label: 'Codex',
    command: 'codex',
    recommendation: 'Install the Codex CLI or remove it from your provider list.',
  },
  {
    id: 'tool.opencode',
    label: 'OpenCode',
    command: 'opencode',
    recommendation: 'Install the OpenCode CLI or remove it from your provider list.',
  },
  {
    id: 'tool.git',
    label: 'git',
    command: 'git',
    recommendation: 'Install git and make sure it is available on PATH.',
  },
  {
    id: 'tool.node',
    label: 'node',
    command: 'node',
    recommendation: 'Install Node.js and make sure node is available on PATH.',
  },
  {
    id: 'tool.bun',
    label: 'bun',
    command: 'bun',
    recommendation: 'Install Bun and make sure bun is available on PATH.',
  },
  {
    id: 'tool.npm',
    label: 'npm',
    command: 'npm',
    recommendation: 'Install npm if this workspace relies on npm commands.',
  },
  {
    id: 'tool.pnpm',
    label: 'pnpm',
    command: 'pnpm',
    recommendation: 'Install pnpm if this workspace relies on pnpm commands.',
  },
  {
    id: 'tool.yarn',
    label: 'yarn',
    command: 'yarn',
    recommendation: 'Install yarn if this workspace relies on yarn commands.',
  },
] as const;

export async function readRuntimeDiagnostics(
  runtimeConfig: RuntimeConfig,
  options: RuntimeDiagnosticsOptions = {},
): Promise<RuntimeDiagnostics> {
  const checkCommand = options.checkCommand ?? defaultCheckCommand;
  const checkDiskSpace = options.checkDiskSpace ?? defaultCheckDiskSpace;
  const checks: DiagnosticCheck[] = [];

  checks.push(...(await Promise.all(TOOL_CHECKS.map((tool) => readToolCheck(tool, checkCommand)))));
  checks.push(await readDataDirWritableCheck(runtimeConfig.dataDir));
  checks.push(await readDiskSpaceCheck(runtimeConfig.dataDir, checkDiskSpace));
  checks.push(readRemoteBindCheck(runtimeConfig));
  checks.push(readRemoteAuthCheck(runtimeConfig));

  return {
    generatedAt: new Date().toISOString(),
    server: {
      host: runtimeConfig.server.host,
      port: runtimeConfig.server.port,
      dataDir: runtimeConfig.dataDir,
      configPath: runtimeConfig.configPath,
    },
    checks,
  };
}

async function readToolCheck(
  tool: (typeof TOOL_CHECKS)[number],
  checkCommand: (command: string) => Promise<CommandCheckResult>,
): Promise<DiagnosticCheck> {
  const result = await checkCommand(tool.command);
  if (result.available) {
    return {
      id: tool.id,
      label: tool.label,
      status: 'ok',
      detail: result.version ?? `${tool.command} is available`,
    };
  }

  return {
    id: tool.id,
    label: tool.label,
    status: 'warning',
    detail: result.error ?? `${tool.command} is not available`,
    recommendation: tool.recommendation,
  };
}

async function readDataDirWritableCheck(dataDir: string): Promise<DiagnosticCheck> {
  try {
    await access(dataDir, constants.W_OK);
    return {
      id: 'dataDir.writable',
      label: 'Data directory writable',
      status: 'ok',
      detail: dataDir,
    };
  } catch (err) {
    return {
      id: 'dataDir.writable',
      label: 'Data directory writable',
      status: 'error',
      detail: err instanceof Error ? err.message : String(err),
      recommendation: 'Fix CUBBY_DATA_DIR permissions or choose a writable data directory.',
    };
  }
}

async function readDiskSpaceCheck(
  dataDir: string,
  checkDiskSpace: (path: string) => Promise<DiskSpaceResult>,
): Promise<DiagnosticCheck> {
  const result = await checkDiskSpace(dataDir);
  if (typeof result.availableBytes === 'number') {
    const status = result.availableBytes < LOW_DISK_SPACE_BYTES ? 'warning' : 'ok';
    return {
      id: 'disk.free',
      label: 'Free disk space',
      status,
      detail: `${Math.round(result.availableBytes / 1024 / 1024)} MB available`,
      ...(status === 'warning'
        ? { recommendation: 'Free disk space or move CUBBY_DATA_DIR to a larger volume.' }
        : {}),
    };
  }

  return {
    id: 'disk.free',
    label: 'Free disk space',
    status: 'warning',
    detail: result.error ?? 'Unable to inspect disk space',
    recommendation: 'Check disk usage manually for the configured data directory.',
  };
}

function readRemoteBindCheck(runtimeConfig: RuntimeConfig): DiagnosticCheck {
  const host = runtimeConfig.server.host;
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    return {
      id: 'remote.bind',
      label: 'Remote bind address',
      status: 'warning',
      detail: `Cubby is bound to ${host}:${runtimeConfig.server.port}`,
      recommendation: 'Bind CUBBY_HOST=0.0.0.0 when you intentionally need remote access.',
    };
  }

  return {
    id: 'remote.bind',
    label: 'Remote bind address',
    status: 'ok',
    detail: `Cubby is bound to ${host}:${runtimeConfig.server.port}`,
  };
}

function readRemoteAuthCheck(runtimeConfig: RuntimeConfig): DiagnosticCheck {
  const host = runtimeConfig.server.host;
  const remoteCapable = host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';
  const auth = runtimeConfig.auth as { password?: string; passwordHash?: string };
  const authEnabled = Boolean(auth.password || auth.passwordHash);
  if (remoteCapable && !authEnabled) {
    return {
      id: 'remote.auth',
      label: 'Remote authentication',
      status: 'error',
      detail: 'Authentication is disabled while Cubby is bound for remote access.',
      recommendation: 'Set CUBBY_AUTH_PASSWORD or CUBBY_AUTH_PASSWORD_HASH before remote use.',
    };
  }

  return {
    id: 'remote.auth',
    label: 'Remote authentication',
    status: 'ok',
    detail: authEnabled
      ? 'Authentication is enabled.'
      : 'Authentication is disabled for local use.',
  };
}

async function defaultCheckCommand(command: string): Promise<CommandCheckResult> {
  try {
    const result = await execFileAsync(command, ['--version'], {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 128 * 1024,
    });
    const version = [result.stdout, result.stderr].join('').trim().split(/\r?\n/)[0];
    return { available: true, version: version || `${command} is available` };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function defaultCheckDiskSpace(path: string): Promise<DiskSpaceResult> {
  try {
    const { stdout } = await execFileAsync('df', ['-k', path], {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 128 * 1024,
    });
    const lines = stdout.trim().split(/\r?\n/);
    const fields = lines.at(-1)?.trim().split(/\s+/) ?? [];
    const availableKilobytes = Number(fields[3]);
    if (!Number.isFinite(availableKilobytes)) {
      return { availableBytes: null, error: 'Unable to parse df output' };
    }
    return { availableBytes: availableKilobytes * 1024 };
  } catch (err) {
    return {
      availableBytes: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
