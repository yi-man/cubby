import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const coreBuild = spawnSync('bun', ['run', '--filter', '@cubby/core', 'build'], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

if (coreBuild.status !== 0) {
  process.exit(coreBuild.status ?? 1);
}

const core = spawn('bun', ['run', '--filter', '@cubby/core', 'dev'], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

const server = spawn('bun', ['--watch', 'packages/server/src/index.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CUBBY_HOST: process.env.CUBBY_HOST ?? '0.0.0.0',
  },
  stdio: 'inherit',
});

const web = spawn('bunx', ['vite', '--host', process.env.CUBBY_WEB_HOST ?? '0.0.0.0'], {
  cwd: join(process.cwd(), 'packages/web'),
  stdio: 'inherit',
});

process.on('SIGINT', () => {
  core.kill('SIGTERM');
  server.kill('SIGTERM');
  web.kill('SIGTERM');
  process.exit(0);
});
