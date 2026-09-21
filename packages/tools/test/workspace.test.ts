import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceError } from '../src/workspace.js';
import { tempWorkspace } from './helpers.js';

describe('Workspace path confinement', () => {
  let cleanup = async () => {};
  afterEach(() => cleanup());

  it('resolves relative paths inside the root', async () => {
    const t = await tempWorkspace({ 'src/a.ts': 'x' });
    cleanup = t.cleanup;
    expect(t.ws.resolve('src/a.ts')).toBe(path.join(t.root, 'src', 'a.ts'));
    expect(t.ws.resolve('.')).toBe(t.root);
    expect(t.ws.display(path.join(t.root, 'src', 'a.ts'))).toBe('src/a.ts');
  });

  it('rejects traversal and foreign absolute paths', async () => {
    const t = await tempWorkspace();
    cleanup = t.cleanup;
    expect(() => t.ws.resolve('../outside.txt')).toThrow(WorkspaceError);
    expect(() => t.ws.resolve('src/../../x')).toThrow(WorkspaceError);
    const foreign = process.platform === 'win32' ? 'C:\\Windows\\system.ini' : '/etc/passwd';
    expect(() => t.ws.resolve(foreign)).toThrow(WorkspaceError);
  });

  it('accepts absolute paths that are inside the root', async () => {
    const t = await tempWorkspace();
    cleanup = t.cleanup;
    expect(t.ws.resolve(path.join(t.root, 'b.txt'))).toBe(path.join(t.root, 'b.txt'));
  });

  it('resolveReal allows not-yet-existing files inside the root', async () => {
    const t = await tempWorkspace();
    cleanup = t.cleanup;
    await expect(t.ws.resolveReal('new/deep/file.txt')).resolves.toBe(path.join(t.root, 'new', 'deep', 'file.txt'));
  });
});
