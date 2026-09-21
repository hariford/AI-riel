import { spawn, type ChildProcess } from 'node:child_process';
import { z } from 'zod';
import type { Tool } from '@airiel/agent-core';
import type { Workspace } from './workspace.js';

/**
 * Commands that are refused outright, even if the user would approve them.
 * Anything not here still requires approval (unless allowed for the session).
 */
export const DENY_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(\/|~|\$HOME|\*)\s*$/i, // rm -rf / ~ *
  /\bRemove-Item\b[^|;]*-Recurse[^|;]*\s(?:[A-Za-z]:\\?|\\|~|\/)\s*$/i, // Remove-Item -Recurse C:\ or /
  /\b(rd|rmdir)\s+\/s\b[^&|]*\s[A-Za-z]:\\?\s*$/i, // rd /s C:\
  /\bdel\b[^&|]*\/s[^&|]*\s[A-Za-z]:\\\*?\s*$/i,
  /\bformat(\.com)?\s+[A-Za-z]:/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b|\breboot\b|\bRestart-Computer\b|\bStop-Computer\b/i,
  /\bgit\s+push\b[^|;&]*(--force\b|-f\b)/i,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f[a-z]*d|checkout\s+--\s+\.)/i,
  /\breg\s+delete\b/i,
  /\b(curl|wget|Invoke-WebRequest|iwr)\b[^|]*\|\s*(sh|bash|powershell|pwsh|iex)\b/i, // pipe-to-shell
  /:\(\)\s*\{\s*:\|\s*:&\s*\};:/, // fork bomb
];

export function isDenied(command: string): RegExp | undefined {
  return DENY_PATTERNS.find((re) => re.test(command));
}

export type ShellKind = 'powershell' | 'cmd' | 'bash';

export interface CommandToolOptions {
  shell?: ShellKind;
  defaultTimeoutMs?: number;
  maxOutputChars?: number;
  /** Streams live output to the UI (xterm pane). */
  onOutput?: (chunk: string) => void;
}

const CommandArgs = z.object({
  command: z.string().min(1),
  cwd: z.string().default('.'),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
});
type CommandArgsT = z.infer<typeof CommandArgs>;

export function defaultShell(): ShellKind {
  return process.platform === 'win32' ? 'powershell' : 'bash';
}

export function shellInvocation(shell: ShellKind, command: string): { file: string; args: string[] } {
  switch (shell) {
    case 'powershell':
      return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command] };
    case 'cmd':
      return { file: 'cmd.exe', args: ['/d', '/s', '/c', command] };
    case 'bash':
      return { file: 'bash', args: ['-lc', command] };
  }
}

export function runCommandTool(ws: Workspace, opts: CommandToolOptions = {}): Tool<CommandArgsT> {
  const shell = opts.shell ?? defaultShell();
  const defaultTimeout = opts.defaultTimeoutMs ?? 120_000;
  const maxOut = opts.maxOutputChars ?? 30_000;

  return {
    kind: 'command',
    definition: {
      name: 'run_command',
      description: `Run a shell command (${shell}) inside the workspace and return its exit code and output. Non-interactive only; one command per call; default timeout 120 s.`,
      parameters: {
        type: 'object',
        required: ['command'],
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string', description: 'Working directory relative to the workspace root' },
          timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000 },
        },
      },
    },
    parseArgs: (raw) => CommandArgs.parse(JSON.parse(raw)),
    describe: (a) => `Run: ${a.command}`,
    preview: async (a) => `$ ${a.command}\n(cwd: ${a.cwd})`,
    async execute(a, signal) {
      const denied = isDenied(a.command);
      if (denied) return { ok: false, content: `Refused: this command matches the safety deny-list (${denied.source}). Ask the user to run it manually if it is really needed.` };

      const cwd = await ws.resolveReal(a.cwd);
      const { file, args } = shellInvocation(shell, a.command);
      const timeoutMs = a.timeoutMs ?? defaultTimeout;
      const started = Date.now();

      const result = await new Promise<{ code: number | null; output: string; timedOut: boolean }>((resolve) => {
        let output = '';
        let timedOut = false;
        const child: ChildProcess = spawn(file, args, { cwd, windowsHide: true, env: { ...process.env, CI: '1', TERM: 'dumb' } });
        const push = (d: Buffer) => {
          const s = d.toString('utf8');
          output += s;
          opts.onOutput?.(s);
          if (output.length > maxOut * 4) {
            output = output.slice(-maxOut * 2);
          }
        };
        child.stdout?.on('data', push);
        child.stderr?.on('data', push);
        const timer = setTimeout(() => {
          timedOut = true;
          kill(child);
        }, timeoutMs);
        const onAbort = () => kill(child);
        signal?.addEventListener('abort', onAbort, { once: true });
        child.on('error', (err) => {
          clearTimeout(timer);
          resolve({ code: null, output: `${output}\n[spawn error] ${err.message}`, timedOut });
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve({ code, output, timedOut });
        });
      });

      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const header = result.timedOut
        ? `[timed out after ${timeoutMs} ms and was killed]`
        : `[exit code ${result.code ?? 'unknown'} in ${secs}s]`;
      return {
        ok: !result.timedOut && result.code === 0,
        content: `${header}\n${result.output.trim()}`,
        ui: { kind: 'command', command: a.command, exitCode: result.code, timedOut: result.timedOut },
      };
    },
  };
}

function kill(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}
