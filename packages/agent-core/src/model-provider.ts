import type { ChatMessage, ChatStreamEvent, ToolDefinition } from '@airiel/protocol';

export interface ModelRequest {
  conversationId: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  model?: 'default' | 'small';
  signal?: AbortSignal;
}

/**
 * Anything that can stream a chat completion. The desktop app uses
 * GatewayModelProvider; tests use a scripted fake.
 */
export interface ModelProvider {
  stream(req: ModelRequest): AsyncIterable<ChatStreamEvent>;
  /** Approximate context window (tokens) of the default model, used for compaction. */
  contextWindowTokens: number;
}

export interface GatewayProviderOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string>;
  contextWindowTokens?: number;
  fetchImpl?: typeof fetch;
}

/** Streams from the AI'riel Gateway (POST /v1/chat, server-sent events). */
export class GatewayModelProvider implements ModelProvider {
  readonly contextWindowTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: GatewayProviderOptions) {
    this.contextWindowTokens = opts.contextWindowTokens ?? 128_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async *stream(req: ModelRequest): AsyncIterable<ChatStreamEvent> {
    const token = await this.opts.getAccessToken();
    const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, '')}/v1/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        conversationId: req.conversationId,
        messages: req.messages,
        tools: req.tools,
        model: req.model ?? 'default',
      }),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      yield { type: 'error', message: `Gateway ${res.status}: ${text || res.statusText}` };
      return;
    }
    yield* parseSse(res.body);
  }
}

/** Minimal SSE parser: yields the JSON payload of each `data:` line. */
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          yield JSON.parse(data) as ChatStreamEvent;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
