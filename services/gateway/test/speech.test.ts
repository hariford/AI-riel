import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createSpeechTokenIssuer, resolveSpeechTarget, speechEndpointFromFoundry } from '../src/routes/speech.js';

const base = { NODE_ENV: 'test', AUTH_DISABLED: 'true' } as const;

describe('speech target resolution', () => {
  it('derives the AI Services custom domain from Foundry endpoints', () => {
    expect(speechEndpointFromFoundry('https://ariel-aifoundry.services.ai.azure.com/')).toBe(
      'https://ariel-aifoundry.cognitiveservices.azure.com',
    );
    expect(speechEndpointFromFoundry('https://foo.openai.azure.com')).toBe('https://foo.cognitiveservices.azure.com');
    expect(speechEndpointFromFoundry('https://example.com')).toBe('');
  });

  it('reuses the Foundry key against the custom-domain STS when no Speech resource is set', () => {
    const cfg = loadConfig({ ...base, FOUNDRY_ENDPOINT: 'https://ariel-aifoundry.services.ai.azure.com/', FOUNDRY_API_KEY: 'fk' });
    expect(resolveSpeechTarget(cfg)).toEqual({
      key: 'fk',
      region: '',
      host: 'ariel-aifoundry.cognitiveservices.azure.com',
      stsUrl: 'https://ariel-aifoundry.cognitiveservices.azure.com/sts/v1.0/issuetoken',
    });
  });

  it('prefers a standalone Speech resource when region and key are given', () => {
    const cfg = loadConfig({ ...base, SPEECH_REGION: 'australiaeast', SPEECH_KEY: 'sk', FOUNDRY_API_KEY: 'fk' });
    expect(resolveSpeechTarget(cfg)).toEqual({
      key: 'sk',
      region: 'australiaeast',
      stsUrl: 'https://australiaeast.api.cognitive.microsoft.com/sts/v1.0/issueToken',
    });
  });

  it('is null with nothing usable and the issuer explains why', async () => {
    const cfg = loadConfig(base);
    expect(resolveSpeechTarget(cfg)).toBeNull();
    await expect(createSpeechTokenIssuer(cfg)()).rejects.toThrow(/not configured/);
  });

  it('posts the key to the STS endpoint and returns the token text', async () => {
    const cfg = loadConfig({ ...base, FOUNDRY_ENDPOINT: 'https://r.services.ai.azure.com/', FOUNDRY_API_KEY: 'fk' });
    const calls: { url: string; key: string }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), key: String((init?.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']) });
      return new Response('tok', { status: 200 });
    }) as typeof fetch;
    await expect(createSpeechTokenIssuer(cfg, fetchImpl)()).resolves.toBe('tok');
    expect(calls).toEqual([{ url: 'https://r.cognitiveservices.azure.com/sts/v1.0/issuetoken', key: 'fk' }]);
  });
});
