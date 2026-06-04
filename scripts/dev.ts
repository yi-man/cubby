import { spawn } from 'node:child_process';
import { join } from 'node:path';

const server = spawn('bun', ['--watch', 'packages/server/src/index.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CUBBY_HOST: process.env.CUBBY_HOST ?? '0.0.0.0',
  },
  stdio: 'inherit',
  shell: true,
});

const web = spawn('bunx', ['vite', '--host', process.env.CUBBY_WEB_HOST ?? '0.0.0.0'], {
  cwd: join(process.cwd(), 'packages/web'),
  stdio: 'inherit',
  shell: true,
});

process.on('SIGINT', () => {
  server.kill('SIGTERM');
  web.kill('SIGTERM');
  process.exit(0);
});
