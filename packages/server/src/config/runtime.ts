import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import type { AuthConfig } from '../auth/service.js';

export const DEFAULT_SERVER_HOST = '0.0.0.0';
export const DEFAULT_SERVER_PORT = 6310;
export const DEFAULT_INITIAL_PASSWORD = 'cubby';

interface ConfigFile {
  server?: {
    host?: unknown;
    port?: unknown;
  };
  auth?: {
    passwordHash?: unknown;
    allowedOrigins?: unknown;
  };
}

export interface RuntimeConfig {
  dataDir: string;
  configPath: string;
  createdDefaultConfig?: {
    initialPassword: string;
  };
  server: {
    host: string;
    port: number;
  };
  auth: AuthConfig;
}

export interface LoadRuntimeConfigOptions {
  createDefaultConfig?: boolean;
  generateInitialPassword?: () => string;
  hashPassword?: (password: string) => string;
}

export function defaultDataDir(
  env: Record<string, string | undefined> = process.env,
  homeDir = homedir(),
): string {
  return stringValue(env.CUBBY_DATA_DIR) ?? join(homeDir, '.cubby');
}

export function loadRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
  options: LoadRuntimeConfigOptions = {},
): RuntimeConfig {
  const dataDir = defaultDataDir(env);
  const configPath = join(dataDir, 'config.json');
  const createdDefaultConfig = options.createDefaultConfig
    ? ensureDefaultConfig(dataDir, configPath, options)
    : undefined;
  const file = readConfigFile(configPath);
  const envPassword = stringValue(env.CUBBY_AUTH_PASSWORD);
  const envPasswordHash = stringValue(env.CUBBY_AUTH_PASSWORD_HASH);
  const authDisabled = booleanValue(env.CUBBY_AUTH_DISABLED) === true;
  const allowedOrigins =
    originsFromEnv(env.CUBBY_ALLOWED_ORIGINS) ?? originsFromConfig(file.auth?.allowedOrigins);

  return {
    dataDir,
    configPath,
    ...(createdDefaultConfig ? { createdDefaultConfig } : {}),
    server: {
      host: stringValue(env.CUBBY_HOST) ?? stringValue(file.server?.host) ?? DEFAULT_SERVER_HOST,
      port: portValue(env.CUBBY_PORT) ?? portValue(file.server?.port) ?? DEFAULT_SERVER_PORT,
    },
    auth: authDisabled
      ? { allowedOrigins }
      : {
          password: envPassword,
          passwordHash:
            envPasswordHash ?? (envPassword ? undefined : stringValue(file.auth?.passwordHash)),
          allowedOrigins,
        },
  };
}

function ensureDefaultConfig(
  dataDir: string,
  configPath: string,
  options: LoadRuntimeConfigOptions,
): RuntimeConfig['createdDefaultConfig'] {
  if (existsSync(configPath)) return undefined;

  mkdirSync(dataDir, { recursive: true });
  const initialPassword = (options.generateInitialPassword ?? generateInitialPassword)();
  const configFile: ConfigFile = {
    server: {
      host: DEFAULT_SERVER_HOST,
      port: DEFAULT_SERVER_PORT,
    },
    auth: {
      passwordHash: (options.hashPassword ?? hashPassword)(initialPassword),
      allowedOrigins: [],
    },
  };

  try {
    writeFileSync(configPath, `${JSON.stringify(configFile, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (err) {
    if (isFileExistsError(err)) return undefined;
    throw err;
  }

  return { initialPassword };
}

function readConfigFile(configPath: string): ConfigFile {
  if (!existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, 'utf8')) as ConfigFile;
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

function booleanValue(value: unknown): boolean | undefined {
  const normalized = stringValue(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function originsFromEnv(value: string | undefined): string[] | undefined {
  const origins = stringValue(value)
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins && origins.length > 0 ? origins : undefined;
}

function originsFromConfig(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const origins = value
    .map((origin) => stringValue(origin))
    .filter((origin) => origin !== undefined);
  return origins;
}

function generateInitialPassword(): string {
  return DEFAULT_INITIAL_PASSWORD;
}

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

function isFileExistsError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST';
}
