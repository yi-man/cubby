import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultDataDir, loadRuntimeConfig } from './runtime.js';

describe('runtime config', () => {
  it('defaults runtime data to the user-level Cubby directory', () => {
    expect(defaultDataDir({}, '/Users/example')).toBe('/Users/example/.cubby');
  });

  it('defaults the product entrypoint to a remotely reachable host and port 6310', () => {
    expect(loadRuntimeConfig({}).server).toEqual({ host: '0.0.0.0', port: 6310 });
  });

  it('creates a default config with generated password auth when requested', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-runtime-config-'));

    const config = loadRuntimeConfig(
      { CUBBY_DATA_DIR: dataDir },
      {
        createDefaultConfig: true,
        generateInitialPassword: () => 'generated-secret',
        hashPassword: () => '$2a$10$generated-hash',
      },
    );

    const configPath = join(dataDir, 'config.json');
    const configFile = JSON.parse(readFileSync(configPath, 'utf8'));

    expect(config).toMatchObject({
      configPath,
      createdDefaultConfig: {
        initialPassword: 'generated-secret',
      },
      server: { host: '0.0.0.0', port: 6310 },
      auth: { passwordHash: '$2a$10$generated-hash', allowedOrigins: [] },
    });
    expect(configFile).toEqual({
      server: { host: '0.0.0.0', port: 6310 },
      auth: { passwordHash: '$2a$10$generated-hash', allowedOrigins: [] },
    });
    expect(existsSync(join(dataDir, 'initial-password.txt'))).toBe(false);
  });

  it('uses cubby as the default initial password', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-runtime-config-'));
    let passwordToHash: string | undefined;

    const config = loadRuntimeConfig(
      { CUBBY_DATA_DIR: dataDir },
      {
        createDefaultConfig: true,
        hashPassword: (password) => {
          passwordToHash = password;
          return '$2a$10$cubby-hash';
        },
      },
    );

    expect(passwordToHash).toBe('cubby');
    expect(config.createdDefaultConfig?.initialPassword).toBe('cubby');
    expect(existsSync(join(dataDir, 'initial-password.txt'))).toBe(false);
  });

  it('does not overwrite an existing config when default creation is requested', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-runtime-config-'));
    const configPath = join(dataDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        server: { host: '127.0.0.1', port: 7310 },
        auth: { passwordHash: '$2a$10$existing-hash' },
      }),
    );

    const config = loadRuntimeConfig(
      { CUBBY_DATA_DIR: dataDir },
      {
        createDefaultConfig: true,
        generateInitialPassword: () => 'should-not-be-used',
        hashPassword: () => '$2a$10$should-not-be-used',
      },
    );

    expect(config.createdDefaultConfig).toBeUndefined();
    expect(config.auth.passwordHash).toBe('$2a$10$existing-hash');
    expect(existsSync(join(dataDir, 'initial-password.txt'))).toBe(false);
    expect(JSON.parse(readFileSync(configPath, 'utf8')).auth.passwordHash).toBe(
      '$2a$10$existing-hash',
    );
  });

  it('loads server and auth settings from config.json in the data dir', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-runtime-config-'));
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({
        server: { host: '127.0.0.1', port: 7310 },
        auth: {
          passwordHash: '$2a$10$config-hash',
          allowedOrigins: ['https://cubby.example.com'],
        },
      }),
    );

    const config = loadRuntimeConfig({ CUBBY_DATA_DIR: dataDir });

    expect(config).toMatchObject({
      dataDir,
      configPath: join(dataDir, 'config.json'),
      server: { host: '127.0.0.1', port: 7310 },
      auth: {
        passwordHash: '$2a$10$config-hash',
        allowedOrigins: ['https://cubby.example.com'],
      },
    });
  });

  it('uses environment variables as explicit overrides', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-runtime-config-'));
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({
        server: { host: '127.0.0.1', port: 7310 },
        auth: {
          passwordHash: '$2a$10$config-hash',
          allowedOrigins: ['https://cubby.example.com'],
        },
      }),
    );

    const config = loadRuntimeConfig({
      CUBBY_DATA_DIR: dataDir,
      CUBBY_HOST: '0.0.0.0',
      CUBBY_PORT: '6412',
      CUBBY_AUTH_PASSWORD_HASH: '$2a$10$env-hash',
      CUBBY_ALLOWED_ORIGINS: 'https://one.example, https://two.example',
    });

    expect(config).toMatchObject({
      dataDir,
      server: { host: '0.0.0.0', port: 6412 },
      auth: {
        passwordHash: '$2a$10$env-hash',
        allowedOrigins: ['https://one.example', 'https://two.example'],
      },
    });
  });

  it('supports an explicit auth disable override for tests and local-only runs', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cubby-runtime-config-'));
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({
        auth: { passwordHash: '$2a$10$config-hash' },
      }),
    );

    const config = loadRuntimeConfig({
      CUBBY_DATA_DIR: dataDir,
      CUBBY_AUTH_DISABLED: '1',
    });

    expect(config.auth.password).toBeUndefined();
    expect(config.auth.passwordHash).toBeUndefined();
  });
});
