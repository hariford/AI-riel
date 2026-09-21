import type { FastifyInstance } from 'fastify';
import type { SpeechTokenResponse } from '@airiel/protocol';
import type { Config } from '../config.js';

export type SpeechTokenIssuer = () => Promise<string>;

/** Exchanges the Speech resource key for a 10-minute token so the key never leaves the server. */
export function createSpeechTokenIssuer(cfg: Config, fetchImpl: typeof fetch = fetch): SpeechTokenIssuer {
  return async () => {
    if (!cfg.SPEECH_REGION || !cfg.SPEECH_KEY) throw new Error('Speech is not configured');
    const res = await fetchImpl(`https://${cfg.SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': cfg.SPEECH_KEY, 'content-length': '0' },
    });
    if (!res.ok) throw new Error(`Speech token request failed: ${res.status}`);
    return res.text();
  };
}

export function registerSpeechRoute(app: FastifyInstance, cfg: Config, issue: SpeechTokenIssuer): void {
  app.get('/v1/speech/token', async (_req, reply) => {
    try {
      const token = await issue();
      const body: SpeechTokenResponse = {
        token,
        region: cfg.SPEECH_REGION,
        expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
      };
      return body;
    } catch (err) {
      return reply.code(503).send({ error: (err as Error).message });
    }
  });
}
