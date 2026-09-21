import { useCallback, useEffect, useState } from 'react';
import type { ConversationSummary, PermissionMode, UserProfile } from '@airiel/protocol';
import { Composer } from './components/Composer';
import { MessageList } from './components/MessageList';
import { PermissionDialog } from './components/PermissionDialog';
import { Sidebar } from './components/Sidebar';
import { useAgent } from './hooks/useAgent';
import { fromMessages } from './lib/transcript';

export function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<PermissionMode>('ask');
  const { state, send, cancel, respond, reset } = useAgent(activeId);

  const refreshConversations = useCallback(async () => setConversations(await window.airiel.conversations.list()), []);

  useEffect(() => {
    void (async () => {
      setUser(await window.airiel.auth.getUser());
      setAuthChecked(true);
      setWorkspace(await window.airiel.workspace.get());
      await refreshConversations();
    })();
  }, [refreshConversations]);

  // Refresh the sidebar when a turn finishes (title/updatedAt change).
  useEffect(() => {
    if (!state.running) void refreshConversations();
  }, [state.running, refreshConversations]);

  const signIn = async () => setUser(await window.airiel.auth.signIn());
  const signOut = async () => {
    await window.airiel.auth.signOut();
    setUser(null);
  };

  const pickWorkspace = async () => {
    const root = await window.airiel.workspace.pick();
    if (root) {
      setWorkspace(root);
      await newChat();
    }
  };

  const newChat = async () => {
    const id = await window.airiel.conversations.create();
    setActiveId(id);
    reset([]);
  };

  const openChat = async (id: string) => {
    const conv = await window.airiel.conversations.load(id);
    setActiveId(id);
    reset(conv ? fromMessages(conv.messages) : []);
  };

  const changeMode = async (m: PermissionMode) => {
    setMode(m);
    await window.airiel.agent.setPermissionMode(m);
  };

  if (authChecked && !user) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="text-5xl">✨</div>
        <h1 className="text-2xl font-semibold">Welcome to AI'riel</h1>
        <p className="max-w-sm text-center text-[var(--muted)]">Your company AI coding assistant. Sign in with your work account to continue.</p>
        <button onClick={signIn} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 font-medium text-black hover:bg-[var(--accent-2)]">
          Sign in with Microsoft
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar
        user={user}
        workspace={workspace}
        conversations={conversations}
        activeId={activeId}
        onPickWorkspace={pickWorkspace}
        onNew={newChat}
        onOpen={openChat}
        onSignOut={signOut}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-2 text-sm text-[var(--muted)]">
          <span className="truncate">{workspace ?? 'No folder open'}</span>
          {state.items.some((i) => i.kind === 'tool' && /edit_file|write_file/.test(i.call.name)) && !state.running && (
            <button
              className="rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--panel-2)]"
              onClick={async () => {
                const restored = await window.airiel.agent.undoLastTurn();
                alert(restored.length ? `Restored ${restored.length} file(s).` : 'Nothing to undo.');
              }}
            >
              Undo last turn
            </button>
          )}
        </header>
        <div className="flex-1 overflow-y-auto">
          <MessageList items={state.items} />
        </div>
        <Composer disabled={!workspace || !activeId} running={state.running} mode={mode} onModeChange={changeMode} onSend={send} onCancel={cancel} />
      </main>
      {state.pending && <PermissionDialog request={state.pending} onDecide={(d) => void respond(state.pending!.requestId, d)} />}
    </div>
  );
}
