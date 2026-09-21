export interface SystemPromptInput {
  workspaceRoot: string;
  /** Contents of AIRIEL.md at the workspace root, if present. */
  projectInstructions?: string;
  /** Short listing of top-level entries for orientation. */
  workspaceOutline?: string[];
  platform: string;
  permissionMode: 'ask' | 'auto-edit' | 'plan';
  today: string;
}

export const SYSTEM_PROMPT_VERSION = '2026-09-21.1';

export function buildSystemPrompt(input: SystemPromptInput): string {
  const parts: string[] = [];
  parts.push(
    "You are AI'riel, an AI coding assistant for the company's developers. You help build features, debug, refactor, write tests and explain code in the developer's working directory.",
    'Be concise and precise. Prefer reading the relevant code before answering. Use tools rather than guessing about the codebase. When you change code, keep edits minimal and consistent with the surrounding style, and explain what you changed and why.',
    'Never fabricate file contents or command output. If a tool fails, say so and adapt.',
  );
  const planNote =
    input.permissionMode === 'plan'
      ? ' (read-only: propose changes, do not attempt edits or commands)'
      : '';
  parts.push(
    [
      '## Environment',
      `- Workspace root: ${input.workspaceRoot}`,
      `- Platform: ${input.platform}`,
      `- Date: ${input.today}`,
      `- Permission mode: ${input.permissionMode}${planNote}`,
    ].join('\n'),
  );
  if (input.workspaceOutline?.length) {
    parts.push(
      `## Workspace outline\n${input.workspaceOutline.map((e) => `- ${e}`).join('\n')}`,
    );
  }
  parts.push(
    [
      '## Tool guidance',
      '- Use grep/glob to locate code, then read_file for detail. Read before editing.',
      '- edit_file requires an exact match of the text to replace; include enough context to be unique.',
      '- run_command: prefer non-interactive commands; one command per call; check exit codes.',
      '- All paths are relative to the workspace root; you cannot access files outside it.',
    ].join('\n'),
  );
  if (input.projectInstructions?.trim()) {
    parts.push(`## Project instructions (AIRIEL.md)\n${input.projectInstructions.trim()}`);
  }
  return parts.join('\n\n');
}
