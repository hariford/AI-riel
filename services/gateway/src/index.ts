import { existsSync } from 'node:fs';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

// Local development: read services/gateway/.env if present. Real environments set variables directly.
if (existsSync('.env')) process.loadEnvFile('.env');

const cfg = loadConfig();
const app = await buildApp({ cfg });
if (!cfg.FOUNDRY_ENDPOINT) app.log.warn('FOUNDRY_ENDPOINT is empty: chat requests will fail until Azure AI Foundry is configured');

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
