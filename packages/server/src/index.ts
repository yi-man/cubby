// Cubby Server - Fastify backend
import { createServer } from './server.js';

export { createServer };

// Start if run directly
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.CUBBY_PORT ?? 6300);
  const host = process.env.CUBBY_HOST ?? '0.0.0.0';
  const { app } = await createServer(port);
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      console.error(`Failed to close Cubby server after ${signal}`, err);
      process.exit(1);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  await app.listen({ port, host });
  console.log(`Cubby server listening on http://${host}:${port}`);
}
