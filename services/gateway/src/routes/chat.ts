import type { FastifyInstance } from 'fastify';
import { ChatRequestSchema, type ChatStreamEvent } from '@airiel/protocol';
import type { Config } from '../config.js';
import type { FoundryClient } from '../foundry.js';
import { SseWriter } from '../sse.js';
import type { UsageStore } from '../usage-store.js';

export interface ChatRouteDeps {
  cfg: Config;
  foundry: FoundryClient;
  usage: UsageStore;
}

export function registerChatRoute(app: FastifyInstance, deps: ChatRouteDeps): void {
  app.post('/v1/chat', async (req, reply) => {
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request', issues: parsed.error.issues });
    }
    const body = parsed.data;

    if (deps.cfg.DAILY_TOKEN_BUDGET > 0) {
      const used = await deps.usage.todayTokens(req.user.id);
      if (used >= deps.cfg.DAILY_TOKEN_BUDGET) {
        return reply.code(429).send({
          error: 'daily token budget exhausted',
          used,
          budget: deps.cfg.DAILY_TOKEN_BUDGET,
        });
      }
    }

    const sse = new SseWriter(reply);
    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());

    const started = Date.now();
    let usage: Extract<ChatStreamEvent, { type: 'done' }>['usage'];
    let toolCalls = 0;
    const seenToolIdx = new Set<number>();

    try {
      for await (const ev of deps.foundry.stream({
        model: body.model,
        messages: body.messages,
        tools: body.tools,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        signal: abort.signal,
      })) {
        if (ev.type === 'tool_call' && !seenToolIdx.has(ev.index)) {
          seenToolIdx.add(ev.index);
          toolCalls++;
        }
        if (ev.type === 'done') usage = ev.usage;
        sse.send(ev);
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        req.log.error({ err }, 'foundry stream failed');
        sse.send({ type: 'error', message: friendlyError(err), code: 'upstream' } satisfies ChatStreamEvent);
      }
    } finally {
      sse.end();
    }

    try {
      await deps.usage.record({
        userId: req.user.id,
        userName: req.user.name,
        conversationId: body.conversationId,
        model: deps.foundry.deploymentFor(body.model),
        promptTokens: usage?.promptTokens ?? 0,
        completionTokens: usage?.completionTokens ?? 0,
        cachedTokens: usage?.cachedTokens ?? 0,
        toolCalls,
        latencyMs: Date.now() - started,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      req.log.error({ err }, 'usage record failed');
    }
  });
}

function friendlyError(err: unknown): string {
  const e = err as { status?: number; message?: string };
  if (e.status === 429) return 'The model is busy (rate limited). Please retry in a moment.';
  if (e.status === 400 && /content_filter|ResponsibleAIPolicy/i.test(e.message ?? '')) {
    return 'The request was blocked by the content filter.';
  }
  return e.message ?? 'Upstream model error';
}
