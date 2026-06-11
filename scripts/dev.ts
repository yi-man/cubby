import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const coreBuild = spawnSync('bun', ['run', '--filter', '@cubby/core', 'build'], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

if (coreBuild.status !== 0) {
  process.exit(coreBuild.status ?? 1);
}

const webHost = process.env.CUBBY_WEB_HOST ?? '0.0.0.0';
const webPort = portFromEnv(process.env.CUBBY_WEB_PORT, '6310');
const devBackendPort = portFromEnv(process.env.CUBBY_DEV_BACKEND_PORT, '6300');

console.log(`Cubby dev browser entrypoint: http://${webHost}:${webPort}`);
console.log(`Cubby dev backend proxy target: http://localhost:${devBackendPort}`);

const core = spawn('bun', ['run', '--filter', '@cubby/core', 'dev'], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

const server = spawn('bun', ['--watch', 'packages/server/src/index.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CUBBY_HOST: process.env.CUBBY_HOST ?? '0.0.0.0',
    CUBBY_PORT: devBackendPort,
  },
  stdio: 'inherit',
});

const web = spawn('bunx', ['vite', '--host', webHost, '--port', webPort], {
  cwd: join(process.cwd(), 'packages/web'),
  env: {
    ...process.env,
    CUBBY_WEB_PORT: webPort,
    CUBBY_DEV_BACKEND_PORT: devBackendPort,
  },
  stdio: 'inherit',
});

process.on('SIGINT', () => {
  core.kill('SIGTERM');
  server.kill('SIGTERM');
  web.kill('SIGTERM');
  process.exit(0);
});

function portFromEnv(value: string | undefined, fallback: string): string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) return fallback;
  return String(parsed);
}
