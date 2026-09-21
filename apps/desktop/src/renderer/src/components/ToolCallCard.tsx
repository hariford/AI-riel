import { useState } from 'react';
import type { ToolCall, ToolResult } from '@airiel/protocol';
import { DiffView } from './DiffView';

const ICONS: Record<string, string> = {
  read_file: '📄', list_directory: '📁', glob: '🔎', grep: '🔍', edit_file: '✏️', write_file: '📝', run_command: '⌨️', git_status: '🌿', git_diff: '🌿',
};

function summary(call: ToolCall): string {
  try {
    const a = JSON.parse(call.arguments) as Record<string, unknown>;
    return String(a['path'] ?? a['pattern'] ?? a['command'] ?? '');
  } catch {
    return '';
  }
}

export function ToolCallCard({ call, result }: { call: ToolCall; result?: ToolResult | undefined }) {
  const [open, setOpen] = useState(false);
  const ui = result?.ui as { kind?: string; diff?: string } | undefined;
  const status = !result ? '…' : result.ok ? '✓' : '✕';
  const statusColor = !result ? 'text-[var(--muted)]' : result.ok ? 'text-[var(--ok)]' : 'text-[var(--danger)]';
  return (
    <div className="my-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] text-[13px]">
      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--panel-2)]" onClick={() => setOpen((o) => !o)}>
        <span>{ICONS[call.name] ?? '🔧'}</span>
        <span className="font-medium">{call.name}</span>
        <span className="truncate text-[var(--muted)]">{summary(call)}</span>
        <span className={`ml-auto ${statusColor}`}>{status}</span>
      </button>
      {open && result && (
        <div className="border-t border-[var(--border)] p-2">
          {ui?.kind === 'diff' && ui.diff ? (
            <DiffView diff={ui.diff} />
          ) : (
            <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap text-[12px]">{result.content}</pre>
          )}
        </div>
      )}
    </div>
  );
}
