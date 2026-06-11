#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';

interface CliIO {
  stdout: Pick<typeof process.stdout, 'write'>;
  stderr: Pick<typeof process.stderr, 'write'>;
}

interface CliOptions {
  io?: CliIO;
  env?: Record<string, string | undefined>;
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

const DEFAULT_SERVER_HOST = '0.0.0.0';
const DEFAULT_SERVER_PORT = 6310;

export async function runCli(args: string[], options: CliOptions = {}): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const env = options.env ?? process.env;

  if (args[0] === 'auth' && args[1] === 'set-password') {
    return setPassword(args.slice(2), env, io);
  }

  io.stdout.write(helpText());
  return args.length === 0 || args[0] === '--help' || args[0] === '-h' ? 0 : 1;
}

function setPassword(args: string[], env: Record<string, string | undefined>, io: CliIO): number {
  const parsed = parseSetPasswordArgs(args);
  if (!parsed.password) {
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
      passwordHash: bcrypt.hashSync(parsed.password, 10),
      allowedOrigins: originsFromConfig(config.auth?.allowedOrigins) ?? [],
    },
  };

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, { mode: 0o600 });
  io.stdout.write(`Updated Cubby password hash in ${configPath}\n`);
  io.stdout.write('Restart Cubby if the server is already running.\n');
  return 0;
}

function parseSetPasswordArgs(args: string[]): { password?: string; dataDir?: string } {
  let password: string | undefined;
  let dataDir: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--data-dir') {
      dataDir = args[index + 1];
      index++;
      continue;
    }
    if (arg.startsWith('--data-dir=')) {
      dataDir = arg.slice('--data-dir='.length);
      continue;
    }
    if (!password) password = arg;
  }

  return { password: password || undefined, dataDir: stringValue(dataDir) };
}

function defaultDataDir(env: Record<string, string | undefined>): string {
  return stringValue(env.CUBBY_DATA_DIR) ?? join(homedir(), '.cubby');
}

function readConfigFile(configPath: string): RuntimeConfigFile {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as RuntimeConfigFile;
  } catch (err) {
    if (isMissingFileError(err)) return {};
    throw err;
  }
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

function originsFromConfig(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((origin) => stringValue(origin)).filter((origin) => origin !== undefined);
}

function isMissingFileError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function helpText(): string {
  return [
    'cubby 0.1.0',
    '',
    'Commands:',
    '  cubby auth set-password <password> [--data-dir <path>]',
    '',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}
