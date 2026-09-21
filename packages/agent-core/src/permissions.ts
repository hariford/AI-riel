import type { PermissionDecision, PermissionMode, PermissionRequest } from '@airiel/protocol';
import type { ToolKind } from './tool-registry.js';

export type Verdict = 'allow' | 'ask' | 'deny';

/** Called when the engine needs the user's decision; resolved by the UI. */
export type PermissionPrompter = (req: PermissionRequest) => Promise<PermissionDecision>;

/**
 * Decides whether a tool call may run.
 *  - read tools are always allowed (they are already confined to the workspace)
 *  - plan mode denies anything that mutates
 *  - auto-edit allows edits but still asks for commands
 *  - "allow for session" remembers a tool name until the session ends
 */
export class PermissionEngine {
  private mode: PermissionMode;
  private readonly sessionAllowed = new Set<string>();

  constructor(mode: PermissionMode = 'ask') {
    this.mode = mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  verdict(toolName: string, kind: ToolKind): Verdict {
    if (kind === 'read') return 'allow';
    if (this.mode === 'plan') return 'deny';
    if (this.sessionAllowed.has(toolName)) return 'allow';
    if (this.mode === 'auto-edit' && kind === 'edit') return 'allow';
    return 'ask';
  }

  record(toolName: string, decision: PermissionDecision): void {
    if (decision === 'allow-session') this.sessionAllowed.add(toolName);
  }

  reset(): void {
    this.sessionAllowed.clear();
  }
}
