import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ModelProvider } from '@airiel/agent-core';
import type { AgentEvent, ChatStreamEvent } from '@airiel/protocol';
import { AgentHost } from '../src/main/agent-host.js';
import type { Conversation, ConversationStore } from '../src/main/conversation-store.js';

const dir = mkdtempSync(path.join(tmpdir(), 'airiel-host-'));
writeFileSync(path.join(dir, 'hello.txt'), 'hi');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const provider: ModelProvider = {
  contextWindowTokens: 100_000,
  async *stream(): AsyncIterable<ChatStreamEvent> {
    yield { type: 'text', delta: 'Done.' };
    yield { type: 'done', finishReason: 'stop' };
  },
};

class RecordingStore implements ConversationStore {
  saved: Conversation[] = [];
  log: string[] = [];
  async list() {
    return this.saved.map(({ id, title, workspaceRoot, updatedAt }) => ({ id, title, workspaceRoot, updatedAt }));
  }
  async load(id: string) {
    return this.saved.find((c) => c.id === id) ?? null;
  }
  async save(conv: Conversation) {
    await new Promise((r) => setTimeout(r, 20)); // real stores hit the disk
    this.saved.push(conv);
    this.log.push('save');
  }
  async remove() {}
}

describe('AgentHost', () => {
  it('saves the conversation before signalling turn_done so the sidebar refresh sees it', async () => {
    const store = new RecordingStore();
    const events: AgentEvent[] = [];
    const host = new AgentHost({
      provider,
      store,
      emit: (_id, ev) => {
        events.push(ev);
        if (ev.type === 'turn_done') store.log.push('turn_done');
      },
    });
    host.setWorkspace(dir);
    await host.send('conv-1', 'hello');

    expect(events.map((e) => e.type)).toEqual(['text', 'turn_done']);
    expect(store.log).toEqual(['save', 'turn_done']);
    expect(store.saved[0]).toMatchObject({ id: 'conv-1', title: 'hello', workspaceRoot: dir });
    expect(store.saved[0]!.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('refuses to send before a folder is open', async () => {
    const host = new AgentHost({ provider, store: new RecordingStore(), emit: () => {} });
    await expect(host.send('c', 'x')).rejects.toThrow(/Open a folder/);
  });
});
