import type { ToolDefinition } from '@airiel/protocol';

export type ToolKind = 'read' | 'edit' | 'command' | 'other';

export interface ToolExecutionResult {
  ok: boolean;
  content: string;
  ui?: unknown;
}

export interface Tool<TArgs = unknown> {
  definition: ToolDefinition;
  kind: ToolKind;
  /** Parse + validate raw JSON arguments from the model. Throw on invalid input. */
  parseArgs(raw: string): TArgs;
  /** One-line human title for approval dialogs, e.g. "Edit src/app.ts". */
  describe(args: TArgs): string;
  /** Optional preview (diff, command line) shown before approval. */
  preview?(args: TArgs): Promise<string | undefined>;
  execute(args: TArgs, signal?: AbortSignal): Promise<ToolExecutionResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(tool: Tool<any>): this {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Tool already registered: ${tool.definition.name}`);
    }
    this.tools.set(tool.definition.name, tool as Tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }
}

/** Cap tool output so one noisy command can't blow the context window. */
export function truncateOutput(text: string, maxChars = 30_000): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head;
  const omitted = text.length - maxChars;
  return `${text.slice(0, head)}\n\n… [${omitted} characters omitted] …\n\n${text.slice(-tail)}`;
}
