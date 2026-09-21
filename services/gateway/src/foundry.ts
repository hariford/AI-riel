import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { AzureOpenAI } from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { ChatMessage, ChatStreamEvent, ToolDefinition } from '@airiel/protocol';
import type { Config } from './config.js';

export interface FoundryStreamRequest {
  model: 'default' | 'small';
  messages: ChatMessage[];
  tools?: ToolDefinition[] | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  signal?: AbortSignal;
}

/** Abstraction over the model backend so routes can be tested with a fake. */
export interface FoundryClient {
  stream(req: FoundryStreamRequest): AsyncIterable<ChatStreamEvent>;
  deploymentFor(model: 'default' | 'small'): string;
}

export function toOpenAiMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((m): ChatCompletionMessageParam => {
    switch (m.role) {
      case 'system':
        return { role: 'system', content: m.content };
      case 'user':
        return { role: 'user', content: m.content };
      case 'assistant':
        return {
          role: 'assistant',
          content: m.content,
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: { name: tc.name, arguments: tc.arguments },
                })),
              }
            : {}),
        };
      case 'tool':
        return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
  });
}

export function toOpenAiTools(tools: ToolDefinition[] | undefined): ChatCompletionTool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** Translate one Azure OpenAI streaming chunk into zero or more protocol events. */
export function chunkToEvents(chunk: ChatCompletionChunk): ChatStreamEvent[] {
  const events: ChatStreamEvent[] = [];
  const choice = chunk.choices?.[0];
  if (choice) {
    if (choice.delta?.content) events.push({ type: 'text', delta: choice.delta.content });
    for (const tc of choice.delta?.tool_calls ?? []) {
      events.push({
        type: 'tool_call',
        index: tc.index,
        ...(tc.id ? { id: tc.id } : {}),
        ...(tc.function?.name ? { name: tc.function.name } : {}),
        ...(tc.function?.arguments ? { argumentsDelta: tc.function.arguments } : {}),
      });
    }
    if (choice.finish_reason) {
      const reason = choice.finish_reason === 'function_call' ? 'tool_calls' : choice.finish_reason;
      events.push({
        type: 'done',
        finishReason: reason,
        ...(chunk.usage ? { usage: usageOf(chunk) } : {}),
      });
    }
  }
  // Azure sends usage in a trailing chunk with an empty choices array.
  if (!choice && chunk.usage) {
    events.push({ type: 'done', finishReason: 'stop', usage: usageOf(chunk) });
  }
  return events;
}

function usageOf(chunk: ChatCompletionChunk) {
  const u = chunk.usage!;
  return {
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

export const FOUNDRY_NOT_CONFIGURED =
  'The gateway has no model endpoint configured (FOUNDRY_ENDPOINT). Ask an administrator to configure Azure AI Foundry.';

export function createFoundryClient(cfg: Config): FoundryClient {
  // Created on first use so the gateway can start (health, config) before Foundry is provisioned.
  let client: AzureOpenAI | undefined;
  const getClient = (): AzureOpenAI => {
    if (!cfg.FOUNDRY_ENDPOINT) throw new Error(FOUNDRY_NOT_CONFIGURED);
    client ??= cfg.FOUNDRY_API_KEY
      ? new AzureOpenAI({ endpoint: cfg.FOUNDRY_ENDPOINT, apiKey: cfg.FOUNDRY_API_KEY, apiVersion: cfg.FOUNDRY_API_VERSION })
      : new AzureOpenAI({
          endpoint: cfg.FOUNDRY_ENDPOINT,
          apiVersion: cfg.FOUNDRY_API_VERSION,
          azureADTokenProvider: getBearerTokenProvider(
            new DefaultAzureCredential(),
            'https://cognitiveservices.azure.com/.default',
          ),
        });
    return client;
  };

  const deploymentFor = (m: 'default' | 'small') =>
    m === 'small' ? cfg.FOUNDRY_DEPLOYMENT_SMALL : cfg.FOUNDRY_DEPLOYMENT_DEFAULT;

  return {
    deploymentFor,
    async *stream(req) {
      const tools = toOpenAiTools(req.tools);
      const completion = await getClient().chat.completions.create(
        {
          model: deploymentFor(req.model),
          messages: toOpenAiMessages(req.messages),
          stream: true,
          stream_options: { include_usage: true },
          ...(tools ? { tools, tool_choice: 'auto' } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.maxTokens !== undefined ? { max_completion_tokens: req.maxTokens } : {}),
        },
        req.signal ? { signal: req.signal } : undefined,
      );
      // Emit 'done' exactly once: hold the finish event until usage (trailing chunk) arrives.
      let pendingDone: Extract<ChatStreamEvent, { type: 'done' }> | undefined;
      for await (const chunk of completion) {
        for (const ev of chunkToEvents(chunk)) {
          if (ev.type === 'done') {
            pendingDone = { ...pendingDone, ...ev, finishReason: pendingDone?.finishReason ?? ev.finishReason };
          } else {
            yield ev;
          }
        }
      }
      yield pendingDone ?? { type: 'done', finishReason: 'stop' };
    },
  };
}
