import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@airiel/protocol';
import { compact, estimateTokens, needsCompaction, splitForCompaction } from '../src/compaction.js';
import { truncateOutput } from '../src/tool-registry.js';

const turn = (i: number): ChatMessage[] => [
  { role: 'user', content: `q${i}` },
  { role: 'assistant', content: null, toolCalls: [{ id: `t${i}`, name: 'read_file', arguments: '{}' }] },
  { role: 'tool', toolCallId: `t${i}`, content: 'x'.repeat(400) },
  { role: 'assistant', content: `a${i}` },
];

describe('compaction', () => {
  const history: ChatMessage[] = [
    { role: 'system', content: 'sys' },
    ...[1, 2, 3, 4, 5, 6].flatMap(turn),
  ];

  it('estimates tokens roughly at 4 chars/token', () => {
    expect(estimateTokens([{ role: 'user', content: 'x'.repeat(400) }])).toBe(102);
  });
  it('flags compaction above threshold', () => {
    expect(needsCompaction(history, { contextWindowTokens: 500 })).toBe(true);
    expect(needsCompaction(history, { contextWindowTokens: 100_000 })).toBe(false);
  });
  it('keeps tool call/result pairs together when splitting', () => {
    const { system, older, recent } = splitForCompaction(history, 2);
    expect(system).toHaveLength(1);
    expect(recent[0]).toEqual({ role: 'user', content: 'q5' });
    expect(older.at(-1)).toEqual({ role: 'assistant', content: 'a4' });
  });
  it('replaces older turns with a summary', async () => {
    const out = await compact(history, async (older) => `summary of ${older.length}`, 2);
    expect(out[0]!.role).toBe('system');
    expect(out[1]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('summary of 16'),
    });
    expect(out.length).toBe(2 + 8);
  });
});

describe('truncateOutput', () => {
  it('leaves short output alone', () => {
    expect(truncateOutput('abc', 10)).toBe('abc');
  });
  it('keeps head and tail and reports omitted count', () => {
    const out = truncateOutput('a'.repeat(50) + 'b'.repeat(50), 20);
    expect(out.startsWith('a'.repeat(12))).toBe(true);
    expect(out.endsWith('b'.repeat(8))).toBe(true);
    expect(out).toContain('80 characters omitted');
  });
});
