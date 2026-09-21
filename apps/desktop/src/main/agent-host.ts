import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  AgentLoop,
  GatewayModelProvider,
  PermissionEngine,
  ToolRegistry,
  buildSystemPrompt,
  type ModelProvider,
} from '@airiel/agent-core';
import { Workspace, createDefaultTools, type SnapshotStore } from '@airiel/tools';
import type {
  AgentEvent,
  ChatMessage,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
} from '@airiel/protocol';
import { titleFrom, type Conversation, type ConversationStore } from './conversation-store.js';

export interface AgentHostDeps {
  provider: ModelProvider;
  store: ConversationStore;
  /** Push an event to the renderer. */
  emit: (conversationId: string, ev: AgentEvent) => void;
}

/**
 * Owns the per-workspace agent state in the main process: tools, permissions,
 * running turns and pending approval prompts.
 */
export class AgentHost {
  private workspace: Workspace | null = null;
  private tools: ToolRegistry | null = null;
  private snapshots: SnapshotStore | null = null;
  private readonly permissions = new PermissionEngine('ask');
  private readonly running = new Map<string, AbortController>();
  private readonly pendingPrompts = new Map<string, (d: PermissionDecision) => void>();

  constructor(private readonly deps: AgentHostDeps) {}

  setWorkspace(root: string): void {
    this.workspace = new Workspace(root);
    const { registry, snapshots } = createDefaultTools(this.workspace);
    this.tools = registry;
    this.snapshots = snapshots;
    this.permissions.reset();
  }

  get workspaceRoot(): string | null {
    return this.workspace?.root ?? null;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissions.setMode(mode);
  }

  respondToPermission(requestId: string, decision: PermissionDecision): void {
    this.pendingPrompts.get(requestId)?.(decision);
    this.pendingPrompts.delete(requestId);
  }

  cancel(conversationId: string): void {
    this.running.get(conversationId)?.abort();
    // Any prompt still open for this turn is answered "deny" so the loop can unwind.
    for (const [id, resolve] of this.pendingPrompts) {
      resolve('deny');
      this.pendingPrompts.delete(id);
    }
  }

  async undoLastTurn(): Promise<string[]> {
    return this.snapshots ? this.snapshots.undoAll() : [];
  }

  async send(conversationId: string, userText: string): Promise<void> {
    if (!this.workspace || !this.tools || !this.snapshots) throw new Error('Open a folder first');
    if (this.running.has(conversationId)) throw new Error('A turn is already running');

    const existing = await this.deps.store.load(conversationId);
    const history = existing?.messages.filter((m) => m.role !== 'system') ?? [];
    const system: ChatMessage = { role: 'system', content: await this.systemPrompt() };
    const messages: ChatMessage[] = [system, ...history, { role: 'user', content: userText }];

    const abort = new AbortController();
    this.running.set(conversationId, abort);
    this.snapshots.clear();

    const loop = new AgentLoop({
      provider: this.deps.provider,
      tools: this.tools,
      permissions: this.permissions,
      prompt: (req) => this.prompt(conversationId, req),
      summarize: (older) => this.summarize(older),
    });

    let finalMessages = messages;
    try {
      const gen = loop.run({ conversationId, messages, signal: abort.signal });
      let r = await gen.next();
      while (!r.done) {
        this.deps.emit(conversationId, r.value);
        r = await gen.next();
      }
      finalMessages = r.value.messages;
    } catch (err) {
      this.deps.emit(conversationId, { type: 'error', message: (err as Error).message });
      this.deps.emit(conversationId, { type: 'turn_done' });
    } finally {
      this.running.delete(conversationId);
    }

    const conv: Conversation = {
      id: conversationId,
      title: existing?.title ?? titleFrom(finalMessages),
      workspaceRoot: this.workspace.root,
      updatedAt: new Date().toISOString(),
      messages: finalMessages.filter((m) => m.role !== 'system'),
    };
    await this.deps.store.save(conv);
  }

  private prompt(conversationId: string, req: PermissionRequest): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      this.pendingPrompts.set(req.requestId, resolve);
      this.deps.emit(conversationId, { type: 'permission_request', request: req });
    });
  }

  private async systemPrompt(): Promise<string> {
    const root = this.workspace!.root;
    const [instructions, outline] = await Promise.all([
      fs.readFile(path.join(root, 'AIRIEL.md'), 'utf8').catch(() => undefined),
      fs.readdir(root, { withFileTypes: true }).then(
        (es) => es.filter((e) => !['node_modules', '.git', 'bin', 'obj', '.vs'].includes(e.name)).slice(0, 60).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)),
        () => [],
      ),
    ]);
    return buildSystemPrompt({
      workspaceRoot: root,
      ...(instructions !== undefined ? { projectInstructions: instructions } : {}),
      workspaceOutline: outline,
      platform: process.platform,
      permissionMode: this.permissions.getMode(),
      today: new Date().toISOString().slice(0, 10),
    });
  }

  /** Compaction summary via the small model. */
  private async summarize(older: ChatMessage[]): Promise<string> {
    let text = '';
    for await (const ev of this.deps.provider.stream({
      conversationId: 'compaction',
      model: 'small',
      messages: [
        {
          role: 'system',
          content:
            'Summarise the following coding-assistant conversation for continuity: goals, decisions, files touched, open problems. Be terse and concrete.',
        },
        { role: 'user', content: JSON.stringify(older).slice(0, 200_000) },
      ],
    })) {
      if (ev.type === 'text') text += ev.delta;
    }
    return text;
  }
}

export function createProvider(baseUrl: string, getAccessToken: () => Promise<string>): ModelProvider {
  return new GatewayModelProvider({ baseUrl, getAccessToken });
}
