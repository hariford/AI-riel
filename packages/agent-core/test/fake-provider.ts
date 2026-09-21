import type { ChatStreamEvent } from '@airiel/protocol';
import type { ModelProvider, ModelRequest } from '../src/model-provider.js';

/** Scripted provider: each call to stream() yields the next scripted event list. */
export class FakeProvider implements ModelProvider {
  contextWindowTokens = 1000;
  calls: ModelRequest[] = [];
  constructor(private readonly script: ChatStreamEvent[][]) {}
  async *stream(req: ModelRequest): AsyncIterable<ChatStreamEvent> {
    this.calls.push(req);
    const events = this.script.shift() ?? [{ type: 'done', finishReason: 'stop' }];
    for (const e of events) yield e;
  }
}

export const textThenStop = (text: string): ChatStreamEvent[] => [
  { type: 'text', delta: text },
  { type: 'done', finishReason: 'stop' },
];

export const callTool = (name: string, args: unknown, id = 'call_1'): ChatStreamEvent[] => [
  { type: 'tool_call', index: 0, id, name, argumentsDelta: JSON.stringify(args) },
  { type: 'done', finishReason: 'tool_calls' },
];
