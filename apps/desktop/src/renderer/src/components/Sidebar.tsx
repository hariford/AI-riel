import type { ConversationSummary, UserProfile } from '@airiel/protocol';

interface Props {
  user: UserProfile | null;
  workspace: string | null;
  conversations: ConversationSummary[];
  activeId: string | null;
  onPickWorkspace: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onSignOut: () => void;
}

export function Sidebar({ user, workspace, conversations, activeId, onPickWorkspace, onNew, onOpen, onSignOut }: Props) {
  const folderName = workspace ? workspace.split(/[\\/]/).filter(Boolean).pop() : null;
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]">
      <div className="flex items-center gap-2 px-4 py-3 text-lg font-semibold">
        <span>✨</span> AI'riel
      </div>
      <div className="px-3">
        <button onClick={onPickWorkspace} title={workspace ?? 'Open a folder'} className="w-full truncate rounded-lg border border-[var(--border)] px-3 py-2 text-left text-sm hover:bg-[var(--panel-2)]">
          📁 {folderName ?? 'Open folder…'}
        </button>
        <button onClick={onNew} disabled={!workspace} className="mt-2 w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-black hover:bg-[var(--accent-2)] disabled:opacity-40">
          + New chat
        </button>
      </div>
      <div className="mt-3 flex-1 overflow-y-auto px-2">
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => onOpen(c.id)}
            className={`mb-0.5 w-full truncate rounded-md px-3 py-1.5 text-left text-sm ${c.id === activeId ? 'bg-[var(--panel-2)]' : 'hover:bg-[var(--panel-2)]/60'}`}
            title={c.workspaceRoot}
          >
            {c.title}
          </button>
        ))}
      </div>
      <div className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
        {user ? (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate" title={user.email}>
              {user.name}
            </span>
            <button onClick={onSignOut} className="hover:text-[var(--text)]">
              Sign out
            </button>
          </div>
        ) : (
          <span>Not signed in</span>
        )}
      </div>
    </aside>
  );
}
