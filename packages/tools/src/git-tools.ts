import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { Tool } from '@airiel/agent-core';
import type { Workspace } from './workspace.js';

function git(args: string[], cwd: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (e) => resolve({ code: null, out: `git not available: ${e.message}` }));
    child.on('close', (code) => resolve({ code, out }));
  });
}

export function gitStatusTool(ws: Workspace): Tool<Record<string, never>> {
  return {
    kind: 'read',
    definition: {
      name: 'git_status',
      description: 'Show the current branch and changed files (git status --short --branch).',
      parameters: { type: 'object', properties: {} },
    },
    parseArgs: () => ({}),
    describe: () => 'git status',
    async execute() {
      const r = await git(['status', '--short', '--branch'], ws.root);
      return { ok: r.code === 0, content: r.out.trim() || '(clean)' };
    },
  };
}

const DiffArgs = z.object({ path: z.string().optional(), staged: z.boolean().default(false) });

export function gitDiffTool(ws: Workspace): Tool<z.infer<typeof DiffArgs>> {
  return {
    kind: 'read',
    definition: {
      name: 'git_diff',
      description: 'Show uncommitted changes as a unified diff, optionally for one path or only staged changes.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, staged: { type: 'boolean' } },
      },
    },
    parseArgs: (raw) => DiffArgs.parse(JSON.parse(raw || '{}')),
    describe: (a) => `git diff ${a.path ?? ''}`.trim(),
    async execute(a) {
      const args = ['diff', '--no-color'];
      if (a.staged) args.push('--cached');
      if (a.path) args.push('--', ws.display(await ws.resolveReal(a.path)));
      const r = await git(args, ws.root);
      return { ok: r.code === 0, content: r.out.trim() || '(no changes)' };
    },
  };
}
