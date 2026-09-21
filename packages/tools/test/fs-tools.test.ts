import { afterEach, describe, expect, it } from 'vitest';
import { globTool, listDirectoryTool, readFileTool } from '../src/fs-tools.js';
import { grepTool } from '../src/grep-tool.js';
import { tempWorkspace } from './helpers.js';

const files = {
  'README.md': '# Hello\nsecond line\nthird line\n',
  'src/app.ts': 'export const answer = 42;\nconsole.log(answer);\n',
  'src/util/math.ts': 'export const add = (a: number, b: number) => a + b;\n',
  'node_modules/dep/index.js': 'module.exports = 1;\n',
};

describe('read tools', () => {
  let cleanup = async () => {};
  afterEach(() => cleanup());

  it('list_directory skips noise folders and marks directories', async () => {
    const t = await tempWorkspace(files);
    cleanup = t.cleanup;
    const out = await listDirectoryTool(t.ws).execute({ path: '.', depth: 2 });
    expect(out.content).toContain('src/');
    expect(out.content).toContain('src/app.ts');
    expect(out.content).not.toContain('node_modules');
  });

  it('read_file numbers lines and supports ranges', async () => {
    const t = await tempWorkspace(files);
    cleanup = t.cleanup;
    const tool = readFileTool(t.ws);
    const all = await tool.execute({ path: 'README.md' });
    expect(all.content).toBe('1| # Hello\n2| second line\n3| third line\n4| ');
    const range = await tool.execute({ path: 'README.md', startLine: 2, lineCount: 1 });
    expect(range.content).toBe('2| second line\n… (2 more lines)');
  });

  it('read_file refuses paths outside the workspace', async () => {
    const t = await tempWorkspace(files);
    cleanup = t.cleanup;
    await expect(readFileTool(t.ws).execute({ path: '../x' })).rejects.toThrow(/outside the workspace/);
  });

  it('glob finds files and ignores node_modules', async () => {
    const t = await tempWorkspace(files);
    cleanup = t.cleanup;
    const out = await globTool(t.ws).execute({ pattern: '**/*.{ts,js}', path: '.' });
    expect(out.content.split('\n').sort()).toEqual(['src/app.ts', 'src/util/math.ts']);
  });

  it('grep returns path:line matches with workspace-relative paths', async () => {
    const t = await tempWorkspace(files);
    cleanup = t.cleanup;
    const out = await grepTool(t.ws).execute({ pattern: 'answer', path: '.', caseInsensitive: false, context: 0, maxResults: 200 });
    expect(out.ok).toBe(true);
    const lines = out.content.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^src\/app\.ts:1:export const answer = 42;$/);
  });

  it('grep reports no matches cleanly', async () => {
    const t = await tempWorkspace(files);
    cleanup = t.cleanup;
    const out = await grepTool(t.ws).execute({ pattern: 'zzz_not_here', path: '.', caseInsensitive: false, context: 0, maxResults: 200 });
    expect(out).toEqual({ ok: true, content: 'No matches.' });
  });
});
