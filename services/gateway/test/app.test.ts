import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatStreamEvent } from '@airiel/protocol';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { FoundryClient } from '../src/foundry.js';
import { MemoryUsageStore } from '../src/usage-store.js';

const cfg = loadConfig({
  NODE_ENV: 'test',
  AUTH_DISABLED: 'true',
  FOUNDRY_DEPLOYMENT_DEFAULT: 'dep-default',
  SPEECH_REGION: 'australiaeast',
  SPEECH_KEY: 'k',
});

const fakeFoundry: FoundryClient = {
  deploymentFor: (m) => (m === 'small' ? 'dep-small' : 'dep-default'),
  async *stream(req) {
    yield { type: 'text', delta: 'Hel' };
    yield { type: 'text', delta: 'lo' };
    yield {
      type: 'tool_call', index: 0, id: 'c1', name: 'read_file', argumentsDelta: '{"path":"a"}',
    };
    yield {
      type: 'done',
      finishReason: 'tool_calls',
      usage: { promptTokens: 10 + req.messages.length, completionTokens: 5, cachedTokens: 2 },
    };
  },
};

function parseSse(body: string): ChatStreamEvent[] {
  return body
    .split('\n\n')
    .filter((f) => f.startsWith('data:'))
    .map((f) => f.slice(5).trim())
    .filter((d) => d && d !== '[DONE]')
    .map((d) => JSON.parse(d) as ChatStreamEvent);
}

describe('gateway', () => {
  const usage = new MemoryUsageStore();
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp({ cfg, foundry: fakeFoundry, usage, speech: async () => 'speech-token' });
    await app.ready();
  });
  afterAll(() => app.close());

  it('serves health without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('rejects malformed chat requests', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/chat', payload: { nope: 1 } });
    expect(res.statusCode).toBe(400);
  });

  it('streams model events as SSE and records usage', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: {
        conversationId: 'conv-1',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 'read_file', description: 'r', parameters: { type: 'object' } }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = parseSse(res.body);
    expect(events.map((e) => e.type)).toEqual(['text', 'text', 'tool_call', 'done']);
    expect(res.body.trim().endsWith('data: [DONE]')).toBe(true);

    expect(usage.records).toHaveLength(1);
    expect(usage.records[0]).toMatchObject({
      userId: 'dev-user',
      conversationId: 'conv-1',
      model: 'dep-default',
      promptTokens: 11,
      completionTokens: 5,
      cachedTokens: 2,
      toolCalls: 1,
    });
  });

  it('returns a speech token with region and expiry', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/speech/token' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ token: 'speech-token', region: 'australiaeast' });
  });

  it('exposes per-user usage and admin summary', async () => {
    const me = await app.inject({ method: 'GET', url: '/v1/usage/me' });
    expect(me.statusCode).toBe(200);
    expect(me.json().rows).toHaveLength(1);
    const all = await app.inject({ method: 'GET', url: '/v1/usage/summary.csv' });
    expect(all.statusCode).toBe(200);
    expect(all.body.split('\n')[0]).toBe('day,userId,userName,model,requests,promptTokens,completionTokens,cachedTokens');
  });

  it('enforces the daily token budget', async () => {
    const budgeted = await buildApp({
      cfg: { ...cfg, DAILY_TOKEN_BUDGET: 10 },
      foundry: fakeFoundry,
      usage, // already has 16 tokens for dev-user today
      speech: async () => 't',
    });
    const res = await budgeted.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { conversationId: 'c', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(429);
    await budgeted.close();
  });
});

describe('config', () => {
  it('refuses AUTH_DISABLED in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_DISABLED: 'true' })).toThrow(/not allowed/);
  });
  it('requires Entra settings when auth is on', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).toThrow(/ENTRA_TENANT_ID/);
  });
});
