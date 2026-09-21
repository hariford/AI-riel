import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/workspace.js';

export async function tempWorkspace(files: Record<string, string> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airiel-ws-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
  return {
    root,
    ws: new Workspace(root),
    read: (rel: string) => fs.readFile(path.join(root, rel), 'utf8'),
    exists: (rel: string) => fs.access(path.join(root, rel)).then(() => true, () => false),
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}
