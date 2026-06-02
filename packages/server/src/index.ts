// Cubby Server - Fastify backend
import { createServer } from './server.js';

export { createServer };

// Start if run directly
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { app, port } = await createServer(3000);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Cubby server listening on http://0.0.0.0:${port}`);
}
