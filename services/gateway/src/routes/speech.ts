import type { FastifyInstance } from 'fastify';
import type { SpeechTokenResponse } from '@airiel/protocol';
import type { Config } from '../config.js';

export type SpeechTokenIssuer = () => Promise<string>;

export interface SpeechTarget {
  /** Where to exchange the key for a 10-minute token. */
  stsUrl: string;
  key: string;
  /** Region for standalone Speech resources (SDK: fromAuthorizationToken). */
  region: string;
  /** Custom-domain host for AI Services / Foundry resources (SDK: fromHost). */
  host?: string;
}

/** https://name.services.ai.azure.com/ | https://name.openai.azure.com/ | https://name.cognitiveservices.azure.com/ */
export function speechEndpointFromFoundry(foundryEndpoint: string): string {
  const m = /^https:\/\/([^./]+)\.(services\.ai\.azure\.com|openai\.azure\.com|cognitiveservices\.azure\.com)\/?/i.exec(
    foundryEndpoint,
  );
  return m ? `https://${m[1]}.cognitiveservices.azure.com` : '';
}

/** Which Speech backend the configuration describes, or null when none is usable. */
export function resolveSpeechTarget(cfg: Config): SpeechTarget | null {
  if (cfg.SPEECH_KEY && cfg.SPEECH_REGION) {
    return {
      key: cfg.SPEECH_KEY,
      region: cfg.SPEECH_REGION,
      stsUrl: `https://${cfg.SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
    };
  }
  const key = cfg.SPEECH_KEY || cfg.FOUNDRY_API_KEY;
  const endpoint = cfg.SPEECH_ENDPOINT || speechEndpointFromFoundry(cfg.FOUNDRY_ENDPOINT);
  if (!key || !endpoint) return null;
  const host = new URL(endpoint).host;
  return { key, region: cfg.SPEECH_REGION, host, stsUrl: `https://${host}/sts/v1.0/issuetoken` };
}

/** Exchanges the resource key for a short-lived token so the key never leaves the server. */
export function createSpeechTokenIssuer(cfg: Config, fetchImpl: typeof fetch = fetch): SpeechTokenIssuer {
  return async () => {
    const target = resolveSpeechTarget(cfg);
    if (!target) {
      throw new Error('Speech is not configured (set SPEECH_REGION + SPEECH_KEY, or SPEECH_ENDPOINT / FOUNDRY_API_KEY)');
    }
    const res = await fetchImpl(target.stsUrl, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': target.key, 'content-length': '0' },
    });
    if (!res.ok) throw new Error(`Speech token request failed: ${res.status}`);
    return res.text();
  };
}

export function registerSpeechRoute(app: FastifyInstance, cfg: Config, issue: SpeechTokenIssuer): void {
  app.get('/v1/speech/token', async (_req, reply) => {
    try {
      const token = await issue();
      const target = resolveSpeechTarget(cfg);
      const body: SpeechTokenResponse = {
        token,
        region: target?.region ?? cfg.SPEECH_REGION,
        ...(target?.host ? { host: target.host } : {}),
        expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
      };
      return body;
    } catch (err) {
      return reply.code(503).send({ error: (err as Error).message });
    }
  });
}
