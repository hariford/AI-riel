import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AgentEvent, ChatMessage, PermissionDecision } from '@airiel/protocol';
import { AgentLoop, PermissionEngine, ToolRegistry, type Tool } from '../src/index.js';
import { FakeProvider, callTool, textThenStop } from './fake-provider.js';

const echoTool: Tool<{ text: string }> = {
  definition: { name: 'echo', description: 'echo', parameters: { type: 'object' } },
  kind: 'read',
  parseArgs: (raw) => z.object({ text: z.string() }).parse(JSON.parse(raw)),
  describe: (a) => `Echo ${a.text}`,
  execute: async (a) => ({ ok: true, content: `echoed:${a.text}` }),
};

const editTool: Tool<{ path: string }> = {
  definition: { name: 'edit_file', description: 'edit', parameters: { type: 'object' } },
  kind: 'edit',
  parseArgs: (raw) => z.object({ path: z.string() }).parse(JSON.parse(raw)),
  describe: (a) => `Edit ${a.path}`,
  execute: async () => ({ ok: true, content: 'edited' }),
};

async function drain(loop: AgentLoop, messages: ChatMessage[]) {
  const gen = loop.run({ conversationId: 'c1', messages });
  const events: AgentEvent[] = [];
  let r = await gen.next();
  while (!r.done) {
    events.push(r.value);
    r = await gen.next();
  }
  return { events, out: r.value };
}

function firstToolResult(events: AgentEvent[]) {
  const ev = events.find((e) => e.type === 'tool_result');
  if (!ev || ev.type !== 'tool_result') throw new Error('no tool_result event');
  return ev.result;
}

const base: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'hi' },
];

describe('AgentLoop', () => {
  it('streams text and stops when the model stops', async () => {
    const provider = new FakeProvider([textThenStop('hello')]);
    const loop = new AgentLoop({
      provider,
      tools: new ToolRegistry(),
      permissions: new PermissionEngine(),
      prompt: async () => 'allow',
    });
    const { events, out } = await drain(loop, base);
    expect(events.map((e) => e.type)).toEqual(['text', 'turn_done']);
    expect(out.messages.at(-1)).toEqual({ role: 'assistant', content: 'hello' });
    expect(out.toolCallCount).toBe(0);
  });

  it('executes a read tool without asking and feeds the result back', async () => {
    const provider = new FakeProvider([callTool('echo', { text: 'x' }), textThenStop('done')]);
    let asked = 0;
    const loop = new AgentLoop({
      provider,
      tools: new ToolRegistry().register(echoTool),
      permissions: new PermissionEngine(),
      prompt: async () => {
        asked++;
        return 'allow';
      },
    });
    const { events, out } = await drain(loop, base);
    expect(asked).toBe(0);
    expect(events.map((e) => e.type)).toEqual(['tool_start', 'tool_result', 'text', 'turn_done']);
    expect(provider.calls[1]!.messages.at(-1)).toEqual({
      role: 'tool',
      toolCallId: 'call_1',
      content: 'echoed:x',
    });
    expect(out.toolCallCount).toBe(1);
  });

  it('asks before an edit and tells the model when the user declines', async () => {
    const provider = new FakeProvider([callTool('edit_file', { path: 'a.ts' }), textThenStop('ok')]);
    const decisions: PermissionDecision[] = ['deny'];
    const loop = new AgentLoop({
      provider,
      tools: new ToolRegistry().register(editTool),
      permissions: new PermissionEngine('ask'),
      prompt: async () => decisions.shift()!,
    });
    const { events } = await drain(loop, base);
    const result = firstToolResult(events);
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/declined/);
  });

  it('denies edits outright in plan mode without prompting', async () => {
    const provider = new FakeProvider([callTool('edit_file', { path: 'a.ts' }), textThenStop('ok')]);
    const loop = new AgentLoop({
      provider,
      tools: new ToolRegistry().register(editTool),
      permissions: new PermissionEngine('plan'),
      prompt: async () => {
        throw new Error('should not prompt');
      },
    });
    const { events } = await drain(loop, base);
    expect(firstToolResult(events).content).toMatch(/plan mode/);
  });

  it('reports invalid arguments instead of crashing', async () => {
    const provider = new FakeProvider([callTool('echo', { nope: 1 }), textThenStop('ok')]);
    const loop = new AgentLoop({
      provider,
      tools: new ToolRegistry().register(echoTool),
      permissions: new PermissionEngine(),
      prompt: async () => 'allow',
    });
    const { events } = await drain(loop, base);
    expect(firstToolResult(events).content).toMatch(/Invalid arguments/);
  });

  it('stops at the tool-call cap and lets the model wrap up without tools', async () => {
    const script = Array.from({ length: 5 }, (_, i) => callTool('echo', { text: String(i) }, `c${i}`));
    script.push(textThenStop('wrapping up'));
    const provider = new FakeProvider(script);
    const loop = new AgentLoop({
      provider,
      tools: new ToolRegistry().register(echoTool),
      permissions: new PermissionEngine(),
      prompt: async () => 'allow',
      maxToolCallsPerTurn: 2,
    });
    const { out } = await drain(loop, base);
    expect(out.toolCallCount).toBe(3); // 2 executed + 1 refused with the limit message
    expect(out.messages.some((m) => m.role === 'tool' && /limit/.test(m.content))).toBe(true);
    // The wrap-up call must not offer tools.
    expect(provider.calls.at(-1)!.tools).toBeUndefined();
    expect(out.messages.at(-1)).toEqual({ role: 'assistant', content: 'wrapping up' });
  });
});
