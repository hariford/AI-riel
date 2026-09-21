import { describe, expect, it } from 'vitest';
import { PermissionEngine } from '../src/permissions.js';

describe('PermissionEngine', () => {
  it('always allows reads', () => {
    for (const mode of ['ask', 'auto-edit', 'plan'] as const) {
      expect(new PermissionEngine(mode).verdict('read_file', 'read')).toBe('allow');
    }
  });
  it('asks for edits and commands in ask mode', () => {
    const p = new PermissionEngine('ask');
    expect(p.verdict('edit_file', 'edit')).toBe('ask');
    expect(p.verdict('run_command', 'command')).toBe('ask');
  });
  it('auto-edit allows edits but still asks for commands', () => {
    const p = new PermissionEngine('auto-edit');
    expect(p.verdict('edit_file', 'edit')).toBe('allow');
    expect(p.verdict('run_command', 'command')).toBe('ask');
  });
  it('plan mode denies mutations', () => {
    const p = new PermissionEngine('plan');
    expect(p.verdict('edit_file', 'edit')).toBe('deny');
    expect(p.verdict('run_command', 'command')).toBe('deny');
  });
  it('remembers allow-session per tool and clears on reset', () => {
    const p = new PermissionEngine('ask');
    p.record('run_command', 'allow-session');
    expect(p.verdict('run_command', 'command')).toBe('allow');
    expect(p.verdict('edit_file', 'edit')).toBe('ask');
    p.reset();
    expect(p.verdict('run_command', 'command')).toBe('ask');
  });
});
