import { spawn } from 'node:child_process';
import { z } from 'zod';
import { rgPath } from '@vscode/ripgrep';
import type { Tool } from '@airiel/agent-core';
import type { Workspace } from './workspace.js';

const GrepArgs = z.object({
  pattern: z.string().min(1),
  path: z.string().default('.'),
  /** Filter files by glob, e.g. "*.cs". */
  glob: z.string().optional(),
  caseInsensitive: z.boolean().default(false),
  /** Lines of context around each match. */
  context: z.number().int().min(0).max(5).default(0),
  maxResults: z.number().int().min(1).max(1000).default(200),
});

export function grepTool(ws: Workspace): Tool<z.infer<typeof GrepArgs>> {
  return {
    kind: 'read',
    definition: {
      name: 'grep',
      description:
        'Search file contents with a regular expression (ripgrep). Output lines are "path:line: text". Respects .gitignore.',
      parameters: {
        type: 'object',
        required: ['pattern'],
        properties: {
          pattern: { type: 'string', description: 'Rust-style regex' },
          path: { type: 'string', description: 'Folder or file to search, default "."' },
          glob: { type: 'string', description: 'File filter, e.g. "*.cs" or "**/*.test.ts"' },
          caseInsensitive: { type: 'boolean' },
          context: { type: 'integer', minimum: 0, maximum: 5 },
          maxResults: { type: 'integer', minimum: 1, maximum: 1000 },
        },
      },
    },
    parseArgs: (raw) => GrepArgs.parse(JSON.parse(raw || '{}')),
    describe: (a) => `Grep /${a.pattern}/ in ${a.path}`,
    async execute(a, signal) {
      const target = await ws.resolveReal(a.path);
      const args = ['--line-number', '--no-heading', '--color', 'never', '--max-count', '50'];
      if (a.caseInsensitive) args.push('-i');
      if (a.context) args.push('-C', String(a.context));
      if (a.glob) args.push('-g', a.glob);
      for (const ig of ['!node_modules', '!.git', '!bin', '!obj', '!.vs']) args.push('-g', ig);
      args.push('-e', a.pattern, '--', target);

      const { code, stdout, stderr } = await run(rgPath, args, ws.root, signal);
      if (code === 1) return { ok: true, content: 'No matches.' };
      if (code !== 0) return { ok: false, content: `ripgrep failed (${code}): ${stderr.trim()}` };

      const lines = stdout.split(/\r?\n/).filter(Boolean).map((l) => relativise(l, ws));
      const shown = lines.slice(0, a.maxResults);
      const more = lines.length > shown.length ? `\n… (${lines.length - shown.length} more lines; narrow the pattern or glob)` : '';
      return { ok: true, content: shown.join('\n') + more };
    },
  };
}

function relativise(line: string, ws: Workspace): string {
  // rg prints absolute paths because we passed an absolute target; trim them.
  if (line.startsWith(ws.root)) {
    const rest = line.slice(ws.root.length).replace(/^[\\/]/, '');
    return rest.split('\\').join('/');
  }
  return line;
}

function run(cmd: string, args: string[], cwd: string, signal?: AbortSignal) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true, ...(signal ? { signal } : {}) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
