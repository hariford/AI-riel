import type { ChatMessage } from '@airiel/protocol';

/** Cheap token estimate: ~4 chars per token for English/code mixes. */
export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += 8; // role/framing overhead
    if ('content' in m && m.content) chars += m.content.length;
    if (m.role === 'assistant' && m.toolCalls) {
      for (const tc of m.toolCalls) chars += tc.name.length + tc.arguments.length;
    }
  }
  return Math.ceil(chars / 4);
}

export interface CompactionOptions {
  contextWindowTokens: number;
  /** Compact once history exceeds this fraction of the window. Default 0.7. */
  threshold?: number;
}

export function needsCompaction(messages: ChatMessage[], opts: CompactionOptions): boolean {
  const limit = opts.contextWindowTokens * (opts.threshold ?? 0.7);
  return estimateTokens(messages) > limit;
}

/**
 * Split history into [older, recent] where `recent` starts at the Nth most recent
 * user message so tool-call/tool-result pairs are never separated.
 */
export function splitForCompaction(
  messages: ChatMessage[],
  keepRecentTurns = 4,
): { system: ChatMessage[]; older: ChatMessage[]; recent: ChatMessage[] } {
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  let userSeen = 0;
  let cut = 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (rest[i]!.role === 'user') {
      userSeen++;
      if (userSeen === keepRecentTurns) {
        cut = i;
        break;
      }
    }
  }
  return { system, older: rest.slice(0, cut), recent: rest.slice(cut) };
}

export type Summarizer = (older: ChatMessage[]) => Promise<string>;

/** Replace older turns with a single summary message. */
export async function compact(
  messages: ChatMessage[],
  summarize: Summarizer,
  keepRecentTurns = 4,
): Promise<ChatMessage[]> {
  const { system, older, recent } = splitForCompaction(messages, keepRecentTurns);
  if (older.length === 0) return messages;
  const summary = await summarize(older);
  return [
    ...system,
    {
      role: 'user',
      content: `[Conversation summary — earlier turns were compacted]\n${summary}`,
    },
    ...recent,
  ];
}
