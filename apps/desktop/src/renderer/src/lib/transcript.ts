import type { ChatMessage } from '@airiel/protocol';
import type { TranscriptItem } from '../hooks/useAgent';

/** Rebuild the UI transcript from a persisted conversation. */
export function fromMessages(messages: ChatMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let n = 0;
  const id = () => `h${++n}`;
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.content.startsWith('[Conversation summary')) continue;
      items.push({ kind: 'user', id: id(), text: m.content });
    } else if (m.role === 'assistant') {
      if (m.content) items.push({ kind: 'assistant', id: id(), text: m.content, streaming: false });
      for (const call of m.toolCalls ?? []) items.push({ kind: 'tool', id: id(), call });
    } else if (m.role === 'tool') {
      const idx = items.findIndex((i) => i.kind === 'tool' && i.call.id === m.toolCallId && !i.result);
      if (idx >= 0) {
        const it = items[idx] as Extract<TranscriptItem, { kind: 'tool' }>;
        items[idx] = { ...it, result: { toolCallId: m.toolCallId, ok: !/^(Denied|Refused|Tool .* failed|Invalid)/.test(m.content), content: m.content } };
      }
    }
  }
  return items;
}
