import { promises as fs } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { z } from 'zod';
import type { Tool } from '@airiel/agent-core';
import { DEFAULT_IGNORES, type Workspace } from './workspace.js';

const MAX_FILE_BYTES = 200_000;

const parse =
  <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>) =>
  (raw: string): T =>
    schema.parse(JSON.parse(raw || '{}'));

// ── list_directory ──
const ListArgs = z.object({
  path: z.string().default('.'),
  /** 1 = immediate children only. */
  depth: z.number().int().min(1).max(3).default(1),
});

export function listDirectoryTool(ws: Workspace): Tool<z.infer<typeof ListArgs>> {
  return {
    kind: 'read',
    definition: {
      name: 'list_directory',
      description:
        'List files and folders under a directory (relative to the workspace root). Returns one entry per line, folders end with "/".',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path, default "."' },
          depth: { type: 'integer', minimum: 1, maximum: 3, description: 'Levels to descend (1–3)' },
        },
      },
    },
    parseArgs: parse(ListArgs),
    describe: (a) => `List ${a.path}`,
    async execute(a) {
      const abs = await ws.resolveReal(a.path);
      const lines: string[] = [];
      const walk = async (dir: string, level: number) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        entries.sort((x, y) => Number(y.isDirectory()) - Number(x.isDirectory()) || x.name.localeCompare(y.name));
        for (const e of entries) {
          if (['node_modules', '.git', 'bin', 'obj', '.vs'].includes(e.name)) continue;
          const full = path.join(dir, e.name);
          lines.push(`${ws.display(full)}${e.isDirectory() ? '/' : ''}`);
          if (e.isDirectory() && level < a.depth) await walk(full, level + 1);
          if (lines.length > 2000) return;
        }
      };
      await walk(abs, 1);
      return { ok: true, content: lines.join('\n') || '(empty)' };
    },
  };
}

// ── read_file ──
const ReadArgs = z.object({
  path: z.string(),
  /** 1-based first line to return. */
  startLine: z.number().int().min(1).optional(),
  /** Max lines to return. */
  lineCount: z.number().int().min(1).max(5000).optional(),
});

export function readFileTool(ws: Workspace): Tool<z.infer<typeof ReadArgs>> {
  return {
    kind: 'read',
    definition: {
      name: 'read_file',
      description:
        'Read a text file. Output is prefixed with line numbers ("12| code"). Use startLine/lineCount for large files.',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string' },
          startLine: { type: 'integer', minimum: 1 },
          lineCount: { type: 'integer', minimum: 1, maximum: 5000 },
        },
      },
    },
    parseArgs: parse(ReadArgs),
    describe: (a) => `Read ${a.path}`,
    async execute(a) {
      const abs = await ws.resolveReal(a.path);
      const stat = await fs.stat(abs);
      if (stat.isDirectory()) return { ok: false, content: `${a.path} is a directory; use list_directory.` };
      if (stat.size > MAX_FILE_BYTES && !a.startLine) {
        return {
          ok: false,
          content: `${a.path} is ${stat.size} bytes; read a range with startLine/lineCount or grep it first.`,
        };
      }
      const buf = await fs.readFile(abs);
      if (buf.subarray(0, 8000).includes(0)) return { ok: false, content: `${a.path} looks binary.` };
      const lines = buf.toString('utf8').split(/\r?\n/);
      const start = (a.startLine ?? 1) - 1;
      const end = Math.min(lines.length, start + (a.lineCount ?? lines.length));
      const width = String(end).length;
      const body = lines
        .slice(start, end)
        .map((l, i) => `${String(start + i + 1).padStart(width)}| ${l}`)
        .join('\n');
      const note = end < lines.length ? `\n… (${lines.length - end} more lines)` : '';
      return { ok: true, content: body + note };
    },
  };
}

// ── glob ──
const GlobArgs = z.object({
  pattern: z.string(),
  path: z.string().default('.'),
});

export function globTool(ws: Workspace): Tool<z.infer<typeof GlobArgs>> {
  return {
    kind: 'read',
    definition: {
      name: 'glob',
      description: 'Find files by glob pattern, e.g. "**/*.cs" or "src/**/Controller*.ts". Returns up to 500 paths.',
      parameters: {
        type: 'object',
        required: ['pattern'],
        properties: { pattern: { type: 'string' }, path: { type: 'string', description: 'Sub-folder to search' } },
      },
    },
    parseArgs: parse(GlobArgs),
    describe: (a) => `Glob ${a.pattern}`,
    async execute(a) {
      const cwd = await ws.resolveReal(a.path);
      const hits = await fg(a.pattern, { cwd, ignore: DEFAULT_IGNORES, dot: true, onlyFiles: true, suppressErrors: true });
      const shown = hits.slice(0, 500).map((h) => ws.display(path.join(cwd, h)));
      const more = hits.length > 500 ? `\n… (${hits.length - 500} more)` : '';
      return { ok: true, content: shown.join('\n') + more || 'No matches.' };
    },
  };
}
