import { describe, expect, it } from 'vitest';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { toUser } from '../src/auth.js';
import { chunkToEvents, createFoundryClient, toOpenAiMessages, toOpenAiTools } from '../src/foundry.js';
import { loadConfig } from '../src/config.js';

const chunk = (partial: Partial<ChatCompletionChunk>): ChatCompletionChunk => ({
  id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [], ...partial,
});

describe('foundry translation', () => {
  it('maps protocol messages to OpenAI format including tool calls', () => {
    const out = toOpenAiMessages([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'assistant', content: null, toolCalls: [{ id: 't1', name: 'grep', arguments: '{}' }] },
      { role: 'tool', toolCallId: 't1', content: 'result' },
    ]);
    expect(out[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 't1', type: 'function', function: { name: 'grep', arguments: '{}' } }],
    });
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'result' });
  });

  it('maps tool definitions and returns undefined for none', () => {
    expect(toOpenAiTools(undefined)).toBeUndefined();
    expect(toOpenAiTools([{ name: 'a', description: 'd', parameters: { type: 'object' } }])).toEqual([
      { type: 'function', function: { name: 'a', description: 'd', parameters: { type: 'object' } } },
    ]);
  });

  it('translates text, tool-call and finish chunks', () => {
    expect(chunkToEvents(chunk({ choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] }))).toEqual([
      { type: 'text', delta: 'hi' },
    ]);
    expect(
      chunkToEvents(
        chunk({
          choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'grep', arguments: '{"p' } }] }, finish_reason: null }],
        }),
      ),
    ).toEqual([{ type: 'tool_call', index: 0, id: 'c1', name: 'grep', argumentsDelta: '{"p' }]);
    expect(chunkToEvents(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }))).toEqual([
      { type: 'done', finishReason: 'tool_calls' },
    ]);
  });

  it('reads usage from the trailing chunk', () => {
    const ev = chunkToEvents(
      chunk({ usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 50 } } }),
    );
    expect(ev).toEqual([{ type: 'done', finishReason: 'stop', usage: { promptTokens: 100, completionTokens: 20, cachedTokens: 50 } }]);
  });
});

describe('toUser', () => {
  it('extracts identity and admin flag from Entra claims', () => {
    const u = toUser(
      { oid: 'o1', name: 'Dev One', preferred_username: 'dev@corp.example', groups: ['g-users', 'g-admins'] },
      { ENTRA_ADMINS_GROUP_ID: 'g-admins' },
    );
    expect(u).toEqual({ id: 'o1', name: 'Dev One', email: 'dev@corp.example', groups: ['g-users', 'g-admins'], isAdmin: true });
    expect(toUser({ oid: 'o2', groups: ['g-users'] }, { ENTRA_ADMINS_GROUP_ID: 'g-admins' }).isAdmin).toBe(false);
  });
});

describe('createFoundryClient', () => {
  it('starts without an endpoint and fails per request with a clear message', async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', AUTH_DISABLED: 'true' });
    const client = createFoundryClient(cfg);
    expect(client.deploymentFor('small')).toBe('gpt-4.1-mini');
    const iterate = async () => {
      const it = client.stream({ model: 'default', messages: [{ role: 'user', content: 'hi' }] });
      await it[Symbol.asyncIterator]().next();
    };
    await expect(iterate()).rejects.toThrow(/FOUNDRY_ENDPOINT/);
  });
});
