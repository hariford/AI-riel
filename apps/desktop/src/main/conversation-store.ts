import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ChatMessage, ConversationSummary } from '@airiel/protocol';

export interface Conversation extends ConversationSummary {
  messages: ChatMessage[];
}

/**
 * Conversation persistence. JSON-per-conversation under userData for now;
 * the interface is what the rest of the app depends on, so swapping in SQLite later is local.
 */
export interface ConversationStore {
  list(): Promise<ConversationSummary[]>;
  load(id: string): Promise<Conversation | null>;
  save(conv: Conversation): Promise<void>;
  remove(id: string): Promise<void>;
}

export class JsonConversationStore implements ConversationStore {
  constructor(private readonly dir: string) {}

  private file(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('bad conversation id');
    return path.join(this.dir, `${id}.json`);
  }

  async list(): Promise<ConversationSummary[]> {
    await fs.mkdir(this.dir, { recursive: true });
    const names = (await fs.readdir(this.dir)).filter((n) => n.endsWith('.json'));
    const items = await Promise.all(
      names.map(async (n) => {
        try {
          const c = JSON.parse(await fs.readFile(path.join(this.dir, n), 'utf8')) as Conversation;
          return { id: c.id, title: c.title, workspaceRoot: c.workspaceRoot, updatedAt: c.updatedAt };
        } catch {
          return null;
        }
      }),
    );
    return items
      .filter((x): x is ConversationSummary => x !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async load(id: string): Promise<Conversation | null> {
    try {
      return JSON.parse(await fs.readFile(this.file(id), 'utf8')) as Conversation;
    } catch {
      return null;
    }
  }

  async save(conv: Conversation): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file(conv.id)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(conv), 'utf8');
    await fs.rename(tmp, this.file(conv.id));
  }

  async remove(id: string): Promise<void> {
    await fs.rm(this.file(id), { force: true });
  }
}

/** Title from the first user message; the small model can improve it later. */
export function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  const text = first && 'content' in first ? first.content : '';
  const line = text.split('\n')[0]?.trim() ?? '';
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'New conversation';
}
