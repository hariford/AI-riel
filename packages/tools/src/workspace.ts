import { promises as fs } from 'node:fs';
import path from 'node:path';

export class WorkspaceError extends Error {}

/**
 * The single place that turns model-supplied relative paths into absolute paths.
 * Every tool goes through here, so path traversal is blocked in one spot.
 */
export class Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Resolve a relative (or absolute-inside-root) path; throws if it escapes the root. */
  resolve(relOrAbs: string): string {
    const abs = path.resolve(this.root, relOrAbs);
    const back = path.relative(this.root, abs);
    if (back.startsWith('..') || path.isAbsolute(back)) {
      throw new WorkspaceError(`Path is outside the workspace: ${relOrAbs}`);
    }
    return abs;
  }

  /**
   * Like resolve(), but also follows symlinks on the existing portion of the path
   * so a link inside the workspace cannot point outside it.
   */
  async resolveReal(relOrAbs: string): Promise<string> {
    const abs = this.resolve(relOrAbs);
    const realRoot = await fs.realpath(this.root);
    let probe = abs;
    // Walk up to the first existing ancestor (the file itself may not exist yet).
    for (;;) {
      try {
        const real = await fs.realpath(probe);
        const back = path.relative(realRoot, real);
        if (back.startsWith('..') || path.isAbsolute(back)) {
          throw new WorkspaceError(`Path resolves outside the workspace: ${relOrAbs}`);
        }
        return abs;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        const parent = path.dirname(probe);
        if (parent === probe) return abs;
        probe = parent;
      }
    }
  }

  /** Display form for the model/UI: forward slashes, relative to root. */
  display(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join('/') || '.';
  }
}

export const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/bin/**',
  '**/obj/**',
  '**/dist/**',
  '**/out/**',
  '**/.vs/**',
  '**/packages/**/*.nupkg',
];
