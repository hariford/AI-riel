import type {
  AgentEvent,
  ChatMessage,
  PermissionRequest,
  ToolCall,
  ToolResult,
} from '@airiel/protocol';
import { compact, needsCompaction, type Summarizer } from './compaction.js';
import type { ModelProvider } from './model-provider.js';
import { PermissionEngine, type PermissionPrompter } from './permissions.js';
import { ToolRegistry, truncateOutput } from './tool-registry.js';

export interface AgentLoopOptions {
  provider: ModelProvider;
  tools: ToolRegistry;
  permissions: PermissionEngine;
  prompt: PermissionPrompter;
  summarize?: Summarizer;
  /** Hard cap on tool calls per user turn. Default 50. */
  maxToolCallsPerTurn?: number;
  /** Max chars of tool output fed back to the model. Default 30k. */
  toolOutputBudget?: number;
  idFactory?: () => string;
}

export interface RunTurnInput {
  conversationId: string;
  /** Full history including the system message and the new user message. */
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export interface RunTurnOutput {
  /** History after this turn (possibly compacted). */
  messages: ChatMessage[];
  toolCallCount: number;
}

type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';

/**
 * The AI'riel agent loop: model → tool calls → results → model … until the model
 * stops calling tools, the step cap is hit, or the turn is aborted.
 */
export class AgentLoop {
  constructor(private readonly opts: AgentLoopOptions) {}

  async *run(input: RunTurnInput): AsyncGenerator<AgentEvent, RunTurnOutput> {
    const { provider, tools, permissions } = this.opts;
    const maxCalls = this.opts.maxToolCallsPerTurn ?? 50;
    const budget = this.opts.toolOutputBudget ?? 30_000;
    const newId = this.opts.idFactory ?? (() => crypto.randomUUID());

    let messages = input.messages;
    let toolCallCount = 0;
    let capReached = false;
    // After the cap, the model is called without tools. If it keeps requesting
    // them anyway we answer with the limit message a few times, then force-stop.
    const maxWrapUpRounds = 3;
    let wrapUpRounds = 0;

    while (!input.signal?.aborted) {
      if (
        this.opts.summarize &&
        needsCompaction(messages, { contextWindowTokens: provider.contextWindowTokens })
      ) {
        messages = await compact(messages, this.opts.summarize);
      }

      // ── one model call ──
      let text = '';
      const pending = new Map<number, { id: string; name: string; args: string }>();
      let finish: FinishReason = 'stop';

      for await (const ev of provider.stream({
        conversationId: input.conversationId,
        messages,
        // After the cap, withhold tools so the model can only wrap up.
        ...(capReached ? {} : { tools: tools.definitions() }),
        ...(input.signal ? { signal: input.signal } : {}),
      })) {
        if (ev.type === 'text') {
          text += ev.delta;
          yield { type: 'text', delta: ev.delta };
        } else if (ev.type === 'tool_call') {
          const slot = pending.get(ev.index) ?? { id: '', name: '', args: '' };
          if (ev.id) slot.id = ev.id;
          if (ev.name) slot.name = ev.name;
          if (ev.argumentsDelta) slot.args += ev.argumentsDelta;
          pending.set(ev.index, slot);
        } else if (ev.type === 'done') {
          finish = ev.finishReason;
        } else if (ev.type === 'error') {
          finish = 'error';
          yield { type: 'error', message: ev.message };
        }
      }

      if (finish === 'error') break;

      const toolCalls: ToolCall[] = [...pending.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, s]) => ({ id: s.id || newId(), name: s.name, arguments: s.args || '{}' }));

      messages = [
        ...messages,
        {
          role: 'assistant',
          content: text || null,
          ...(toolCalls.length ? { toolCalls } : {}),
        },
      ];

      if (toolCalls.length === 0) break;

      if (capReached && ++wrapUpRounds > maxWrapUpRounds) {
        // Drop the dangling tool calls so the history stays valid for the next turn.
        messages = [
          ...messages.slice(0, -1),
          {
            role: 'assistant',
            content: text || `Stopped: tool call limit (${maxCalls}) reached for this turn.`,
          },
        ];
        break;
      }

      // ── execute tool calls sequentially (deterministic, approval-friendly) ──
      for (const call of toolCalls) {
        if (input.signal?.aborted) break;
        yield { type: 'tool_start', toolCall: call };

        let result: ToolResult;
        if (capReached || ++toolCallCount > maxCalls) {
          capReached = true;
          result = {
            toolCallId: call.id,
            ok: false,
            content: `Tool call limit (${maxCalls}) reached for this turn. Summarise progress and ask the user how to proceed.`,
          };
        } else {
          result = await this.executeOne(call, permissions, budget, newId, input.signal);
        }
        yield { type: 'tool_result', result };
        messages = [
          ...messages,
          { role: 'tool', toolCallId: result.toolCallId, content: result.content },
        ];
      }
    }

    yield { type: 'turn_done' };
    return { messages, toolCallCount };
  }

  private async executeOne(
    call: ToolCall,
    permissions: PermissionEngine,
    budget: number,
    newId: () => string,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    const tool = this.opts.tools.get(call.name);
    if (!tool) {
      return { toolCallId: call.id, ok: false, content: `Unknown tool: ${call.name}` };
    }
    let args: unknown;
    try {
      args = tool.parseArgs(call.arguments);
    } catch (err) {
      return {
        toolCallId: call.id,
        ok: false,
        content: `Invalid arguments for ${call.name}: ${(err as Error).message}`,
      };
    }

    const verdict = permissions.verdict(call.name, tool.kind);
    if (verdict === 'deny') {
      return {
        toolCallId: call.id,
        ok: false,
        content: `Denied: ${call.name} is not allowed in ${permissions.getMode()} mode.`,
      };
    }
    if (verdict === 'ask') {
      const preview = tool.preview ? await tool.preview(args) : undefined;
      const req: PermissionRequest = {
        requestId: newId(),
        toolCall: call,
        title: tool.describe(args),
        kind: tool.kind,
        ...(preview !== undefined ? { preview } : {}),
      };
      const decision = await this.opts.prompt(req);
      permissions.record(call.name, decision);
      if (decision === 'deny') {
        return {
          toolCallId: call.id,
          ok: false,
          content: `The user declined: ${req.title}. Do not retry the same action; ask or propose an alternative.`,
        };
      }
    }

    try {
      const out = await tool.execute(args, signal);
      return {
        toolCallId: call.id,
        ok: out.ok,
        content: truncateOutput(out.content, budget),
        ...(out.ui !== undefined ? { ui: out.ui } : {}),
      };
    } catch (err) {
      return {
        toolCallId: call.id,
        ok: false,
        content: `Tool ${call.name} failed: ${(err as Error).message}`,
      };
    }
  }
}
