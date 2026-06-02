import Fastify from 'fastify';

export async function createServer(port = 3000) {
  const app = Fastify({ logger: true });

  app.get('/healthz', async () => ({ status: 'ok' }));

  return { app };
}
