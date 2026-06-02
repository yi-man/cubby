import { spawn } from 'node:child_process';

const server = spawn('bun', ['--watch', 'packages/server/src/index.ts'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: true,
});

const web = spawn('bunx', ['vite'], {
  cwd: join(process.cwd(), 'packages/web'),
  stdio: 'inherit',
  shell: true,
});

process.on('SIGINT', () => {
  server.kill('SIGTERM');
  web.kill('SIGTERM');
  process.exit(0);
});
