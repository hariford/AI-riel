import type { PermissionDecision, PermissionRequest } from '@airiel/protocol';
import { DiffView } from './DiffView';

export function PermissionDialog({ request, onDecide }: { request: PermissionRequest; onDecide: (d: PermissionDecision) => void }) {
  const isDiff = request.kind === 'edit' && request.preview?.startsWith('---');
  const label = request.kind === 'edit' ? 'wants to change a file' : request.kind === 'command' ? 'wants to run a command' : 'needs permission';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="w-full max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl">
        <div className="mb-1 text-xs uppercase tracking-wide text-[var(--muted)]">AI'riel {label}</div>
        <h2 className="mb-3 text-lg font-semibold">{request.title}</h2>
        {request.preview &&
          (isDiff ? (
            <DiffView diff={request.preview} />
          ) : (
            <pre className="m-0 max-h-60 overflow-auto rounded-md border border-[var(--border)] bg-[var(--panel-2)] p-3">{request.preview}</pre>
          ))}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button className="rounded-md border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--panel-2)]" onClick={() => onDecide('deny')}>
            Reject
          </button>
          <button className="rounded-md border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--panel-2)]" onClick={() => onDecide('allow-session')}>
            Allow for this session
          </button>
          <button className="rounded-md bg-[var(--accent)] px-3 py-1.5 font-medium text-black hover:bg-[var(--accent-2)]" onClick={() => onDecide('allow')} autoFocus>
            {request.kind === 'edit' ? 'Accept' : 'Run once'}
          </button>
        </div>
      </div>
    </div>
  );
}
