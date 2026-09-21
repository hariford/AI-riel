import { afterEach, describe, expect, it } from 'vitest';
import { SnapshotStore, editFileTool, writeFileTool } from '../src/edit-tools.js';
import { tempWorkspace } from './helpers.js';

describe('edit tools', () => {
  let cleanup = async () => {};
  afterEach(() => cleanup());

  it('edit_file replaces a unique snippet and returns a diff', async () => {
    const t = await tempWorkspace({ 'a.ts': 'const x = 1;\nconst y = 2;\n' });
    cleanup = t.cleanup;
    const snaps = new SnapshotStore();
    const out = await editFileTool(t.ws, snaps).execute({ path: 'a.ts', oldString: 'const y = 2;', newString: 'const y = 3;', replaceAll: false });
    expect(out.ok).toBe(true);
    expect(await t.read('a.ts')).toBe('const x = 1;\nconst y = 3;\n');
    expect(out.content).toContain('-const y = 2;');
    expect(out.content).toContain('+const y = 3;');
    expect(snaps.touched).toHaveLength(1);
  });

  it('edit_file refuses ambiguous or missing matches', async () => {
    const t = await tempWorkspace({ 'a.ts': 'foo\nfoo\n' });
    cleanup = t.cleanup;
    const tool = editFileTool(t.ws, new SnapshotStore());
    await expect(tool.execute({ path: 'a.ts', oldString: 'foo', newString: 'bar', replaceAll: false })).rejects.toThrow(/matches 2 places/);
    await expect(tool.execute({ path: 'a.ts', oldString: 'nope', newString: 'bar', replaceAll: false })).rejects.toThrow(/not found/);
    expect(await t.read('a.ts')).toBe('foo\nfoo\n'); // untouched
  });

  it('edit_file replaceAll replaces every occurrence', async () => {
    const t = await tempWorkspace({ 'a.ts': 'foo\nfoo\n' });
    cleanup = t.cleanup;
    await editFileTool(t.ws, new SnapshotStore()).execute({ path: 'a.ts', oldString: 'foo', newString: 'bar', replaceAll: true });
    expect(await t.read('a.ts')).toBe('bar\nbar\n');
  });

  it('preview produces the diff without writing', async () => {
    const t = await tempWorkspace({ 'a.ts': 'one\n' });
    cleanup = t.cleanup;
    const diff = await editFileTool(t.ws, new SnapshotStore()).preview!({ path: 'a.ts', oldString: 'one', newString: 'two', replaceAll: false });
    expect(diff).toContain('+two');
    expect(await t.read('a.ts')).toBe('one\n');
  });

  it('write_file creates nested files and undoAll removes them', async () => {
    const t = await tempWorkspace();
    cleanup = t.cleanup;
    const snaps = new SnapshotStore();
    const out = await writeFileTool(t.ws, snaps).execute({ path: 'deep/new.txt', content: 'hi' });
    expect(out.content).toMatch(/^Created/);
    expect(await t.read('deep/new.txt')).toBe('hi');
    await snaps.undoAll();
    expect(await t.exists('deep/new.txt')).toBe(false);
  });

  it('undoAll restores the first snapshot even after several edits', async () => {
    const t = await tempWorkspace({ 'a.ts': 'v1' });
    cleanup = t.cleanup;
    const snaps = new SnapshotStore();
    const tool = editFileTool(t.ws, snaps);
    await tool.execute({ path: 'a.ts', oldString: 'v1', newString: 'v2', replaceAll: false });
    await tool.execute({ path: 'a.ts', oldString: 'v2', newString: 'v3', replaceAll: false });
    expect(await t.read('a.ts')).toBe('v3');
    await snaps.undoAll();
    expect(await t.read('a.ts')).toBe('v1');
  });
});
