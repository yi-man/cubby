#!/usr/bin/env node
import { type SpawnOptions, spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

interface CliIO {
  stdout: Pick<typeof process.stdout, 'write'>;
  stderr: Pick<typeof process.stderr, 'write'>;
}

interface DetachedProcess {
  pid?: number;
  unref: () => void;
}

interface SpawnDetachedOptions {
  detached: boolean;
  env: Record<string, string | undefined>;
  stdio: ['ignore', number, number];
}

interface CliRuntime {
  spawnDetached: (
    command: string,
    args: string[],
    options: SpawnDetachedOptions,
  ) => DetachedProcess;
  isProcessAlive: (pid: number) => boolean;
  killProcess: (pid: number, signal: NodeJS.Signals) => void;
  waitForExit: (pid: number, timeoutMs: number) => Promise<boolean>;
  waitForHealthy: (url: string, timeoutMs: number) => Promise<boolean>;
  openUrl: (url: string) => Promise<void>;
}

interface CliOptions {
  io?: CliIO;
  env?: Record<string, string | undefined>;
  runtime?: Partial<CliRuntime>;
}

interface RuntimeConfigFile {
  server?: {
    host?: unknown;
    port?: unknown;
  };
  auth?: {
    passwordHash?: unknown;
    allowedOrigins?: unknown;
  };
}

interface ParsedArgs {
  values: string[];
  dataDir?: string;
  host?: string;
  port?: number;
  foreground: boolean;
  errorsOnly: boolean;
  tail?: number;
}

interface ServerSettings {
  dataDir: string;
  host: string;
  port: number;
  configPath: string;
  config: RuntimeConfigFile;
}

interface ServerPidFile {
  pid: number;
  host: string;
  port: number;
  dataDir: string;
  url: string;
  startedAt: string;
  version: string;
  logs: {
    stdout: string;
    stderr: string;
  };
}

const VERSION = '0.1.0';
const DEFAULT_SERVER_HOST = '0.0.0.0';
const DEFAULT_SERVER_PORT = 6310;
const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 5_000;
const FOREGROUND_SHUTDOWN_TIMEOUT_MS = 3_000;

export async function runCli(args: string[], options: CliOptions = {}): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const env = options.env ?? process.env;
  const runtime = createRuntime(options.runtime);
  const command = args[0];

  if (command === 'auth' && args[1] === 'set-password') {
    return setPassword(args.slice(2), env, io);
  }
  if (command === 'serve') return serveCommand(args.slice(1), env, io, runtime);
  if (command === 'open') return openCommand(args.slice(1), env, io, runtime);
  if (command === 'stop') return stopCommand(args.slice(1), env, io, runtime);
  if (command === 'status') return statusCommand(args.slice(1), env, io, runtime);
  if (command === 'logs') return logsCommand(args.slice(1), env, io);
  if (command === 'config') return configCommand(args.slice(1), env, io);

  io.stdout.write(helpText());
  return args.length === 0 || command === '--help' || command === '-h' ? 0 : 1;
}

export async function closeServerWithTimeout(
  closeApp: () => Promise<void>,
  signal: string,
  io: CliIO,
  timeoutMs = FOREGROUND_SHUTDOWN_TIMEOUT_MS,
): Promise<number> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      closeApp().then(() => 'closed' as const),
      new Promise<'timeout'>((resolve) => {
        timeout = setTimeout(() => resolve('timeout'), timeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (result === 'timeout') {
      io.stderr.write(`Timed out closing Cubby server after ${signal}; forcing shutdown.\n`);
      return 0;
    }
    io.stdout.write(`Cubby server stopped after ${signal}\n`);
    return 0;
  } catch (err) {
    if (timeout) clearTimeout(timeout);
    io.stderr.write(`Failed to close Cubby server after ${signal}: ${String(err)}\n`);
    return 1;
  }
}

function setPassword(args: string[], env: Record<string, string | undefined>, io: CliIO): number {
  const parsed = parseArgs(args);
  const password = parsed.values[0];
  if (!password) {
    io.stderr.write('Usage: cubby auth set-password <password> [--data-dir <path>]\n');
    return 1;
  }

  const dataDir = parsed.dataDir ?? defaultDataDir(env);
  const configPath = join(dataDir, 'config.json');
  const config = readConfigFile(configPath);
  const nextConfig: RuntimeConfigFile = {
    server: {
      host: stringValue(config.server?.host) ?? DEFAULT_SERVER_HOST,
      port: portValue(config.server?.port) ?? DEFAULT_SERVER_PORT,
    },
    auth: {
      passwordHash: bcrypt.hashSync(password, 10),
      allowedOrigins: originsFromConfig(config.auth?.allowedOrigins) ?? [],
    },
  };

  writeConfigFile(dataDir, nextConfig);
  io.stdout.write(`Updated Cubby password hash in ${configPath}\n`);
  io.stdout.write('Restart Cubby if the server is already running.\n');
  return 0;
}

async function serveCommand(
  args: string[],
  env: Record<string, string | undefined>,
  io: CliIO,
  runtime: CliRuntime,
): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.foreground) return serveForeground(env, io);

  const settings = resolveServerSettings(parsed, env);
  const existing = readPidFile(pidFilePath(settings.dataDir));
  if (existing && runtime.isProcessAlive(existing.pid)) {
    io.stdout.write(`Cubby is already running on ${existing.url} (PID ${existing.pid})\n`);
    return 0;
  }
  removePidFile(settings.dataDir);

  const logs = ensureLogFiles(settings.dataDir);
  const stdoutFd = openSync(logs.stdout, 'a');
  const stderrFd = openSync(logs.stderr, 'a');
  let child: DetachedProcess;
  const foregroundRuntime = foregroundRuntimeCommand(env);
  try {
    child = runtime.spawnDetached(
      foregroundRuntime.command,
      [...foregroundRuntime.args, cliEntrypointPath(), 'serve', '--foreground'],
      {
        detached: true,
        env: {
          ...process.env,
          ...env,
          CUBBY_DATA_DIR: settings.dataDir,
          CUBBY_HOST: settings.host,
          CUBBY_PORT: String(settings.port),
        },
        stdio: ['ignore', stdoutFd, stderrFd],
      },
    );
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  if (!child.pid) {
    io.stderr.write('Failed to start Cubby: child process did not expose a PID\n');
    return 1;
  }
  child.unref();

  const metadata = writePidFile(settings, child.pid, logs);
  const healthy = await runtime.waitForHealthy(healthUrl(settings.port), START_TIMEOUT_MS);
  if (!healthy) {
    io.stderr.write(`Cubby did not become healthy within ${START_TIMEOUT_MS}ms\n`);
    return 1;
  }

  io.stdout.write(`Cubby started on ${metadata.url} (PID ${metadata.pid})\n`);
  io.stdout.write(`Logs: ${metadata.logs.stdout}\n`);
  return 0;
}

async function serveForeground(
  env: Record<string, string | undefined>,
  io: CliIO,
): Promise<number> {
  const { createServer, loadRuntimeConfig } = await import('@cubby/server');
  const runtimeConfig = loadRuntimeConfig(env, { createDefaultConfig: true });
  const { host, port } = runtimeConfig.server;
  const { app } = await createServer(port, runtimeConfig);
  let closing = false;

  const close = async (signal: string): Promise<number> => {
    if (closing) return 0;
    closing = true;
    return closeServerWithTimeout(() => app.close(), signal, io);
  };

  await app.listen({ port, host });
  if (runtimeConfig.createdDefaultConfig) {
    io.stdout.write(`Cubby created default config at ${runtimeConfig.configPath}\n`);
    io.stdout.write(
      `Cubby initial password: ${runtimeConfig.createdDefaultConfig.initialPassword}\n`,
    );
  }
  io.stdout.write(`Cubby server listening on http://${host}:${port}\n`);

  return new Promise<number>((resolve) => {
    process.once('SIGINT', () => void close('SIGINT').then(resolve));
    process.once('SIGTERM', () => void close('SIGTERM').then(resolve));
  });
}

async function openCommand(
  args: string[],
  env: Record<string, string | undefined>,
  io: CliIO,
  runtime: CliRuntime,
): Promise<number> {
  const parsed = parseArgs(args);
  let metadata = runningPidMetadata(parsed, env, runtime);
  if (!metadata) {
    const exitCode = await serveCommand(args, env, io, runtime);
    if (exitCode !== 0) return exitCode;
    metadata = runningPidMetadata(parsed, env, runtime);
  }

  const settings = resolveServerSettings(parsed, env);
  const url = metadata?.url ?? localUrl(settings.host, settings.port);
  await runtime.openUrl(url);
  io.stdout.write(`Opened ${url}\n`);
  return 0;
}

async function stopCommand(
  args: string[],
  env: Record<string, string | undefined>,
  io: CliIO,
  runtime: CliRuntime,
): Promise<number> {
  const settings = resolveServerSettings(parseArgs(args), env);
  const metadata = readPidFile(pidFilePath(settings.dataDir));
  if (!metadata || !runtime.isProcessAlive(metadata.pid)) {
    removePidFile(settings.dataDir);
    io.stdout.write('Cubby is not running\n');
    return 0;
  }

  runtime.killProcess(metadata.pid, 'SIGTERM');
  const stopped = await runtime.waitForExit(metadata.pid, STOP_TIMEOUT_MS);
  if (!stopped) {
    io.stderr.write(`Cubby did not stop within ${STOP_TIMEOUT_MS}ms (PID ${metadata.pid})\n`);
    return 1;
  }

  removePidFile(settings.dataDir);
  io.stdout.write(`Cubby stopped (PID ${metadata.pid})\n`);
  return 0;
}

function statusCommand(
  args: string[],
  env: Record<string, string | undefined>,
  io: CliIO,
  runtime: CliRuntime,
): number {
  const settings = resolveServerSettings(parseArgs(args), env);
  const metadata = readPidFile(pidFilePath(settings.dataDir));
  const running = metadata ? runtime.isProcessAlive(metadata.pid) : false;
  if (metadata && !running) removePidFile(settings.dataDir);

  io.stdout.write(`Status: ${running ? 'running' : 'stopped'}\n`);
  if (running && metadata) {
    io.stdout.write(`PID: ${metadata.pid}\n`);
    io.stdout.write(`URL: ${metadata.url}\n`);
    io.stdout.write(`Port: ${metadata.port}\n`);
  } else {
    io.stdout.write(`URL: ${localUrl(settings.host, settings.port)}\n`);
    io.stdout.write(`Port: ${settings.port}\n`);
  }
  io.stdout.write(`Data dir: ${settings.dataDir}\n`);
  io.stdout.write(`Version: ${VERSION}\n`);
  return 0;
}

function logsCommand(args: string[], env: Record<string, string | undefined>, io: CliIO): number {
  const parsed = parseArgs(args);
  const dataDir = parsed.dataDir ?? defaultDataDir(env);
  const logs = logPaths(dataDir);
  const tailCount = parsed.tail ?? 100;

  if (parsed.errorsOnly) {
    io.stdout.write(tailFile(logs.stderr, tailCount));
    return 0;
  }

  io.stdout.write(tailFile(logs.stdout, tailCount));
  const stderr = tailFile(logs.stderr, tailCount);
  if (stderr.trim()) {
    io.stdout.write(stderr.startsWith('\n') ? stderr : `\n${stderr}`);
  }
  return 0;
}

function configCommand(args: string[], env: Record<string, string | undefined>, io: CliIO): number {
  const parsed = parseArgs(args);
  const [action, key, value] = parsed.values;
  const settings = resolveServerSettings(parsed, env);

  if (!action || action === 'show') {
    printConfig(settings, io);
    return 0;
  }

  if (action === 'get') {
    return printConfigValue(settings, key, io);
  }

  if (action !== 'set' || !key || value === undefined) {
    io.stderr.write(configUsage());
    return 1;
  }

  const nextConfig = applyConfigValue(settings.config, key, value, io);
  if (!nextConfig) return 1;
  writeConfigFile(settings.dataDir, nextConfig);
  io.stdout.write(`Updated ${settings.configPath}\n`);
  return 0;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { values: [], foreground: false, errorsOnly: false };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--foreground') {
      parsed.foreground = true;
      continue;
    }
    if (arg === '--errors-only') {
      parsed.errorsOnly = true;
      continue;
    }
    if (arg === '--data-dir') {
      parsed.dataDir = stringValue(args[index + 1]);
      index++;
      continue;
    }
    if (arg.startsWith('--data-dir=')) {
      parsed.dataDir = stringValue(arg.slice('--data-dir='.length));
      continue;
    }
    if (arg === '--host') {
      parsed.host = stringValue(args[index + 1]);
      index++;
      continue;
    }
    if (arg.startsWith('--host=')) {
      parsed.host = stringValue(arg.slice('--host='.length));
      continue;
    }
    if (arg === '--port') {
      parsed.port = portValue(args[index + 1]);
      index++;
      continue;
    }
    if (arg.startsWith('--port=')) {
      parsed.port = portValue(arg.slice('--port='.length));
      continue;
    }
    if (arg === '--tail') {
      parsed.tail = positiveInteger(args[index + 1]);
      index++;
      continue;
    }
    if (arg.startsWith('--tail=')) {
      parsed.tail = positiveInteger(arg.slice('--tail='.length));
      continue;
    }
    parsed.values.push(arg);
  }

  return parsed;
}

function resolveServerSettings(
  parsed: Pick<ParsedArgs, 'dataDir' | 'host' | 'port'>,
  env: Record<string, string | undefined>,
): ServerSettings {
  const dataDir = parsed.dataDir ?? defaultDataDir(env);
  const configPath = join(dataDir, 'config.json');
  const config = readConfigFile(configPath);
  return {
    dataDir,
    configPath,
    config,
    host:
      parsed.host ??
      stringValue(env.CUBBY_HOST) ??
      stringValue(config.server?.host) ??
      DEFAULT_SERVER_HOST,
    port:
      parsed.port ??
      portValue(env.CUBBY_PORT) ??
      portValue(config.server?.port) ??
      DEFAULT_SERVER_PORT,
  };
}

function applyConfigValue(config: RuntimeConfigFile, key: string, value: string, io: CliIO) {
  const nextConfig: RuntimeConfigFile = {
    server: {
      host: stringValue(config.server?.host) ?? DEFAULT_SERVER_HOST,
      port: portValue(config.server?.port) ?? DEFAULT_SERVER_PORT,
    },
    auth: {
      passwordHash: stringValue(config.auth?.passwordHash),
      allowedOrigins: originsFromConfig(config.auth?.allowedOrigins) ?? [],
    },
  };

  switch (normalizeConfigKey(key)) {
    case 'server.host':
      nextConfig.server = { ...nextConfig.server, host: stringValue(value) ?? DEFAULT_SERVER_HOST };
      return nextConfig;
    case 'server.port': {
      const port = portValue(value);
      if (!port) {
        io.stderr.write('Port must be an integer from 1 to 65535\n');
        return undefined;
      }
      nextConfig.server = { ...nextConfig.server, port };
      return nextConfig;
    }
    case 'auth.allowedorigins':
      nextConfig.auth = { ...nextConfig.auth, allowedOrigins: parseOrigins(value) };
      return nextConfig;
    case 'auth.enabled': {
      const enabled = booleanValue(value);
      if (enabled === undefined) {
        io.stderr.write('auth.enabled must be true or false\n');
        return undefined;
      }
      if (!enabled) {
        const { passwordHash: _passwordHash, ...auth } = nextConfig.auth ?? {};
        nextConfig.auth = auth;
        return nextConfig;
      }
      if (!nextConfig.auth?.passwordHash) {
        io.stderr.write('Use cubby auth set-password <password> to enable auth\n');
        return undefined;
      }
      return nextConfig;
    }
    default:
      io.stderr.write(configUsage());
      return undefined;
  }
}

function printConfig(settings: ServerSettings, io: CliIO): void {
  const authEnabled = Boolean(stringValue(settings.config.auth?.passwordHash));
  const origins = originsFromConfig(settings.config.auth?.allowedOrigins) ?? [];
  io.stdout.write(`Data dir: ${settings.dataDir}\n`);
  io.stdout.write(`Config: ${settings.configPath}\n`);
  io.stdout.write(`Host: ${settings.host}\n`);
  io.stdout.write(`Port: ${settings.port}\n`);
  io.stdout.write(`Auth: ${authEnabled ? 'enabled' : 'disabled'}\n`);
  io.stdout.write(`Allowed origins: ${origins.length > 0 ? origins.join(', ') : '(none)'}\n`);
}

function printConfigValue(settings: ServerSettings, key: string | undefined, io: CliIO): number {
  if (!key) {
    io.stderr.write(configUsage());
    return 1;
  }

  const origins = originsFromConfig(settings.config.auth?.allowedOrigins) ?? [];
  switch (normalizeConfigKey(key)) {
    case 'datadir':
      io.stdout.write(`${settings.dataDir}\n`);
      return 0;
    case 'config':
    case 'configpath':
      io.stdout.write(`${settings.configPath}\n`);
      return 0;
    case 'server.host':
      io.stdout.write(`${settings.host}\n`);
      return 0;
    case 'server.port':
      io.stdout.write(`${settings.port}\n`);
      return 0;
    case 'auth.enabled':
      io.stdout.write(`${Boolean(stringValue(settings.config.auth?.passwordHash))}\n`);
      return 0;
    case 'auth.allowedorigins':
      io.stdout.write(`${origins.join(',')}\n`);
      return 0;
    default:
      io.stderr.write(configUsage());
      return 1;
  }
}

function normalizeConfigKey(key: string): string {
  const normalized = key.toLowerCase().replace(/_/g, '-');
  if (normalized === 'host') return 'server.host';
  if (normalized === 'port') return 'server.port';
  if (normalized === 'data-dir') return 'datadir';
  if (normalized === 'config-path') return 'configpath';
  if (normalized === 'allowed-origins') return 'auth.allowedorigins';
  if (normalized === 'auth.allowed-origins') return 'auth.allowedorigins';
  return normalized.replace(/-/g, '');
}

function writeConfigFile(dataDir: string, config: RuntimeConfigFile): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}

function readConfigFile(configPath: string): RuntimeConfigFile {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as RuntimeConfigFile;
  } catch (err) {
    if (isMissingFileError(err)) return {};
    throw err;
  }
}

function writePidFile(settings: ServerSettings, pid: number, logs: ServerPidFile['logs']) {
  const metadata: ServerPidFile = {
    pid,
    host: settings.host,
    port: settings.port,
    dataDir: settings.dataDir,
    url: localUrl(settings.host, settings.port),
    startedAt: new Date().toISOString(),
    version: VERSION,
    logs,
  };
  mkdirSync(settings.dataDir, { recursive: true });
  writeFileSync(pidFilePath(settings.dataDir), `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600,
  });
  return metadata;
}

function readPidFile(path: string): ServerPidFile | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ServerPidFile>;
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.host !== 'string' ||
      typeof parsed.port !== 'number' ||
      typeof parsed.dataDir !== 'string'
    ) {
      return undefined;
    }
    return {
      pid: parsed.pid,
      host: parsed.host,
      port: parsed.port,
      dataDir: parsed.dataDir,
      url: parsed.url ?? localUrl(parsed.host, parsed.port),
      startedAt: parsed.startedAt ?? '',
      version: parsed.version ?? VERSION,
      logs: parsed.logs ?? logPaths(parsed.dataDir),
    };
  } catch (err) {
    if (isMissingFileError(err) || err instanceof SyntaxError) return undefined;
    throw err;
  }
}

function runningPidMetadata(
  parsed: Pick<ParsedArgs, 'dataDir' | 'host' | 'port'>,
  env: Record<string, string | undefined>,
  runtime: CliRuntime,
): ServerPidFile | undefined {
  const settings = resolveServerSettings(parsed, env);
  const metadata = readPidFile(pidFilePath(settings.dataDir));
  if (metadata && runtime.isProcessAlive(metadata.pid)) return metadata;
  return undefined;
}

function removePidFile(dataDir: string): void {
  rmSync(pidFilePath(dataDir), { force: true });
}

function ensureLogFiles(dataDir: string): ServerPidFile['logs'] {
  const logs = logPaths(dataDir);
  mkdirSync(join(dataDir, 'logs'), { recursive: true });
  closeSync(openSync(logs.stdout, 'a'));
  closeSync(openSync(logs.stderr, 'a'));
  return logs;
}

function logPaths(dataDir: string): ServerPidFile['logs'] {
  return {
    stdout: join(dataDir, 'logs', 'server.out.log'),
    stderr: join(dataDir, 'logs', 'server.err.log'),
  };
}

function pidFilePath(dataDir: string): string {
  return join(dataDir, 'server.pid.json');
}

function tailFile(path: string, lineCount: number): string {
  if (!existsSync(path)) return '';
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  const tailed = lines.slice(Math.max(0, lines.length - lineCount)).join('\n');
  return tailed.endsWith('\n') || tailed.length === 0 ? tailed : `${tailed}\n`;
}

function createRuntime(overrides: Partial<CliRuntime> = {}): CliRuntime {
  const runtime: CliRuntime = {
    spawnDetached: (command, args, options) =>
      spawn(command, args, options as SpawnOptions) as DetachedProcess,
    isProcessAlive,
    killProcess: (pid, signal) => process.kill(pid, signal),
    waitForExit: async (pid, timeoutMs) => waitForProcessExit(pid, timeoutMs),
    waitForHealthy,
    openUrl,
  };
  return { ...runtime, ...overrides };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err instanceof Error && 'code' in err) {
      return (err as NodeJS.ErrnoException).code !== 'ESRCH';
    }
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await sleep(100);
  }
  return !isProcessAlive(pid);
}

async function waitForHealthy(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {}
    await sleep(100);
  }
  return false;
}

async function openUrl(url: string): Promise<void> {
  const command = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform() === 'win32' ? ['/c', 'start', '', url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function cliEntrypointPath(): string {
  return fileURLToPath(import.meta.url);
}

function foregroundRuntimeCommand(env: Record<string, string | undefined>): {
  command: string;
  args: string[];
} {
  const configuredBun = stringValue(env.CUBBY_BUN_PATH);
  if (configuredBun) return { command: configuredBun, args: [] };
  if ('bun' in process.versions) return { command: process.execPath, args: [] };
  return { command: 'bun', args: [] };
}

function healthUrl(port: number): string {
  return `http://127.0.0.1:${port}/healthz`;
}

function localUrl(host: string, port: number): string {
  const localHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return `http://${localHost}:${port}`;
}

function defaultDataDir(env: Record<string, string | undefined>): string {
  return stringValue(env.CUBBY_DATA_DIR) ?? join(homedir(), '.cubby');
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function portValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(stringValue(value));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) return undefined;
  return parsed;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(stringValue(value));
  if (!Number.isInteger(parsed) || parsed < 1) return undefined;
  return parsed;
}

function booleanValue(value: unknown): boolean | undefined {
  const normalized = stringValue(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function originsFromConfig(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((origin) => stringValue(origin)).filter((origin) => origin !== undefined);
}

function parseOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isMissingFileError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function configUsage(): string {
  return [
    'Usage:',
    '  cubby config show [--data-dir <path>]',
    '  cubby config get <host|port|data-dir|config-path|auth.enabled|allowed-origins>',
    '  cubby config set <host|port|allowed-origins|auth.enabled> <value> [--data-dir <path>]',
    '',
  ].join('\n');
}

function helpText(): string {
  return [
    `cubby ${VERSION}`,
    '',
    'Commands:',
    '  cubby serve [--host <host>] [--port <port>] [--data-dir <path>]',
    '  cubby open [--host <host>] [--port <port>] [--data-dir <path>]',
    '  cubby stop [--data-dir <path>]',
    '  cubby status [--data-dir <path>]',
    '  cubby logs [--tail <lines>] [--errors-only] [--data-dir <path>]',
    '  cubby config show|get|set ... [--data-dir <path>]',
    '  cubby auth set-password <password> [--data-dir <path>]',
    '',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}
