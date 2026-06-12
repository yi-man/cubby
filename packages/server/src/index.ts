// Cubby Server - Fastify backend
import { loadRuntimeConfig } from './config/runtime.js';
import { createServer } from './server.js';

export { createServer, loadRuntimeConfig };

// Start if run directly
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const runtimeConfig = loadRuntimeConfig(process.env, { createDefaultConfig: true });
  const { host, port } = runtimeConfig.server;
  const { app } = await createServer(port, runtimeConfig);
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
  if (runtimeConfig.createdDefaultConfig) {
    console.log(`Cubby created default config at ${runtimeConfig.configPath}`);
    console.log(`Cubby initial password: ${runtimeConfig.createdDefaultConfig.initialPassword}`);
  }
  console.log(`Cubby server listening on http://${host}:${port}`);
}
