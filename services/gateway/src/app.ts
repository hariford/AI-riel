import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { createAuthenticator } from './auth.js';
import type { Config } from './config.js';
import { createFoundryClient, type FoundryClient } from './foundry.js';
import { registerChatRoute } from './routes/chat.js';
import { createSpeechTokenIssuer, registerSpeechRoute, type SpeechTokenIssuer } from './routes/speech.js';
import { registerUsageRoutes } from './routes/usage.js';
import { MemoryUsageStore, SqlUsageStore, type UsageStore } from './usage-store.js';

export interface AppDeps {
  cfg: Config;
  foundry?: FoundryClient;
  usage?: UsageStore;
  speech?: SpeechTokenIssuer;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { cfg } = deps;
  const foundry = deps.foundry ?? createFoundryClient(cfg);
  const usage =
    deps.usage ?? (cfg.SQL_CONNECTION_STRING ? new SqlUsageStore(cfg.SQL_CONNECTION_STRING) : new MemoryUsageStore());
  const speech = deps.speech ?? createSpeechTokenIssuer(cfg);

  const app = Fastify({
    logger: cfg.NODE_ENV !== 'test',
    bodyLimit: 8 * 1024 * 1024, // long conversations with file contents
    // Never log request bodies: they contain source code and prompts.
    disableRequestLogging: true,
  });

  await app.register(cors, { origin: false }); // desktop app, not a browser origin
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.get('/healthz', async () => ({ ok: true, version: process.env['APP_VERSION'] ?? 'dev' }));
  app.get('/v1/config', { preHandler: createAuthenticator(cfg) }, async (req) => ({
    user: { id: req.user.id, name: req.user.name, email: req.user.email, isAdmin: req.user.isAdmin },
    contextWindowTokens: cfg.FOUNDRY_CONTEXT_WINDOW,
    speechEnabled: Boolean(cfg.SPEECH_REGION && cfg.SPEECH_KEY),
    dailyTokenBudget: cfg.DAILY_TOKEN_BUDGET,
  }));

  await app.register(async (authed) => {
    authed.addHook('preHandler', createAuthenticator(cfg));
    registerChatRoute(authed, { cfg, foundry, usage });
    registerSpeechRoute(authed, cfg, speech);
    registerUsageRoutes(authed, usage);
  });

  app.addHook('onClose', async () => usage.close());
  return app;
}
