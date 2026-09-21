import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import type { Tool } from '@airiel/agent-core';
import type { Workspace } from './workspace.js';

/**
 * Remembers the pre-edit content of every file touched during a turn so the UI
 * can offer "Undo this turn". First capture wins; `null` means the file was created.
 */
export class SnapshotStore {
  private readonly originals = new Map<string, string | null>();

  async capture(abs: string): Promise<void> {
    if (this.originals.has(abs)) return;
    try {
      this.originals.set(abs, await fs.readFile(abs, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') this.originals.set(abs, null);
      else throw err;
    }
  }

  get touched(): string[] {
    return [...this.originals.keys()];
  }

  async undoAll(): Promise<string[]> {
    const restored: string[] = [];
    for (const [abs, original] of this.originals) {
      if (original === null) await fs.rm(abs, { force: true });
      else await fs.writeFile(abs, original, 'utf8');
      restored.push(abs);
    }
    this.originals.clear();
    return restored;
  }

  clear(): void {
    this.originals.clear();
  }
}

export interface EditUi {
  kind: 'diff';
  path: string;
  diff: string;
  created: boolean;
}

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await fs.readFile(abs, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function unifiedDiff(rel: string, before: string | null, after: string): string {
  return createTwoFilesPatch(
    before === null ? '/dev/null' : `a/${rel}`,
    `b/${rel}`,
    before ?? '',
    after,
    undefined,
    undefined,
    { context: 3 },
  );
}

// ── edit_file ──
const EditArgs = z.object({
  path: z.string(),
  oldString: z.string().min(1),
  newString: z.string(),
  replaceAll: z.boolean().default(false),
});
type EditArgsT = z.infer<typeof EditArgs>;

export function editFileTool(ws: Workspace, snapshots: SnapshotStore): Tool<EditArgsT> {
  async function plan(a: EditArgsT) {
    const abs = await ws.resolveReal(a.path);
    const before = await readOrNull(abs);
    if (before === null) throw new Error(`${a.path} does not exist. Use write_file to create it.`);
    const count = before.split(a.oldString).length - 1;
    if (count === 0) throw new Error(`oldString not found in ${a.path}. Read the file and copy the text exactly.`);
    if (count > 1 && !a.replaceAll) {
      throw new Error(`oldString matches ${count} places in ${a.path}; include more context or set replaceAll.`);
    }
    const after = a.replaceAll ? before.split(a.oldString).join(a.newString) : before.replace(a.oldString, () => a.newString);
    return { abs, before, after, diff: unifiedDiff(ws.display(abs), before, after), count };
  }

  return {
    kind: 'edit',
    definition: {
      name: 'edit_file',
      description:
        'Replace an exact text snippet in a file. oldString must match exactly once (or set replaceAll). Read the file first.',
      parameters: {
        type: 'object',
        required: ['path', 'oldString', 'newString'],
        properties: {
          path: { type: 'string' },
          oldString: { type: 'string', description: 'Exact text to replace, including whitespace' },
          newString: { type: 'string' },
          replaceAll: { type: 'boolean' },
        },
      },
    },
    parseArgs: (raw) => EditArgs.parse(JSON.parse(raw)),
    describe: (a) => `Edit ${a.path}`,
    preview: async (a) => (await plan(a)).diff,
    async execute(a) {
      const p = await plan(a);
      await snapshots.capture(p.abs);
      await fs.writeFile(p.abs, p.after, 'utf8');
      const ui: EditUi = { kind: 'diff', path: ws.display(p.abs), diff: p.diff, created: false };
      return { ok: true, content: `Edited ${ui.path} (${p.count} replacement${p.count === 1 ? '' : 's'}).\n${p.diff}`, ui };
    },
  };
}

// ── write_file ──
const WriteArgs = z.object({ path: z.string(), content: z.string() });
type WriteArgsT = z.infer<typeof WriteArgs>;

export function writeFileTool(ws: Workspace, snapshots: SnapshotStore): Tool<WriteArgsT> {
  async function plan(a: WriteArgsT) {
    const abs = await ws.resolveReal(a.path);
    const before = await readOrNull(abs);
    return { abs, before, diff: unifiedDiff(ws.display(abs), before, a.content) };
  }
  return {
    kind: 'edit',
    definition: {
      name: 'write_file',
      description: 'Create a file or overwrite it entirely. Prefer edit_file for changes to existing files.',
      parameters: {
        type: 'object',
        required: ['path', 'content'],
        properties: { path: { type: 'string' }, content: { type: 'string' } },
      },
    },
    parseArgs: (raw) => WriteArgs.parse(JSON.parse(raw)),
    describe: (a) => `Write ${a.path}`,
    preview: async (a) => (await plan(a)).diff,
    async execute(a) {
      const p = await plan(a);
      await snapshots.capture(p.abs);
      await fs.mkdir(path.dirname(p.abs), { recursive: true });
      await fs.writeFile(p.abs, a.content, 'utf8');
      const ui: EditUi = { kind: 'diff', path: ws.display(p.abs), diff: p.diff, created: p.before === null };
      return { ok: true, content: `${p.before === null ? 'Created' : 'Overwrote'} ${ui.path}.`, ui };
    },
  };
}
