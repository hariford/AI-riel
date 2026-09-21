import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const cfg = loadConfig();
const app = await buildApp({ cfg });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
