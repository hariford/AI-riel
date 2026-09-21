import { ToolRegistry } from '@airiel/agent-core';
import { runCommandTool, type CommandToolOptions } from './command-tool.js';
import { SnapshotStore, editFileTool, writeFileTool } from './edit-tools.js';
import { globTool, listDirectoryTool, readFileTool } from './fs-tools.js';
import { gitDiffTool, gitStatusTool } from './git-tools.js';
import { grepTool } from './grep-tool.js';
import { Workspace } from './workspace.js';

export * from './command-tool.js';
export * from './edit-tools.js';
export * from './fs-tools.js';
export * from './git-tools.js';
export * from './grep-tool.js';
export * from './workspace.js';

export interface DefaultToolsOptions {
  command?: CommandToolOptions;
  snapshots?: SnapshotStore;
}

/** The standard AI'riel tool set for a workspace. */
export function createDefaultTools(
  workspace: Workspace,
  opts: DefaultToolsOptions = {},
): { registry: ToolRegistry; snapshots: SnapshotStore } {
  const snapshots = opts.snapshots ?? new SnapshotStore();
  const registry = new ToolRegistry()
    .register(listDirectoryTool(workspace))
    .register(readFileTool(workspace))
    .register(globTool(workspace))
    .register(grepTool(workspace))
    .register(editFileTool(workspace, snapshots))
    .register(writeFileTool(workspace, snapshots))
    .register(runCommandTool(workspace, opts.command))
    .register(gitStatusTool(workspace))
    .register(gitDiffTool(workspace));
  return { registry, snapshots };
}
