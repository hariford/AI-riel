import { useCallback, useState } from 'react';
import type { PermissionMode } from '@airiel/protocol';
import { VoiceButton } from './VoiceButton';

interface Props {
  disabled: boolean;
  running: boolean;
  mode: PermissionMode;
  onModeChange: (m: PermissionMode) => void;
  onSend: (text: string) => void;
  onCancel: () => void;
}

export function Composer({ disabled, running, mode, onModeChange, onSend, onCancel }: Props) {
  const [text, setText] = useState('');
  const [partial, setPartial] = useState('');

  const submit = useCallback(() => {
    const t = text.trim();
    if (!t || running || disabled) return;
    onSend(t);
    setText('');
  }, [text, running, disabled, onSend]);

  return (
    <div className="border-t border-[var(--border)] bg-[var(--panel)] px-4 py-3">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2 focus-within:border-[var(--accent)]">
          <textarea
            className="max-h-48 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-[var(--muted)]"
            placeholder={disabled ? 'Open a folder to start' : 'Ask AI\'riel… (Enter to send, Shift+Enter for newline)'}
            value={partial ? `${text}${text && !text.endsWith(' ') ? ' ' : ''}${partial}` : text}
            disabled={disabled}
            rows={1}
            onChange={(e) => {
              setPartial('');
              setText(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <VoiceButton
            disabled={disabled}
            onPartial={setPartial}
            onFinal={(t) => {
              setPartial('');
              setText((prev) => (prev ? `${prev.trimEnd()} ${t}` : t));
            }}
          />
          {running ? (
            <button className="rounded-lg border border-[var(--danger)]/50 px-3 py-2 text-[var(--danger)] hover:bg-[var(--danger)]/10" onClick={onCancel}>
              Stop
            </button>
          ) : (
            <button className="rounded-lg bg-[var(--accent)] px-3 py-2 font-medium text-black hover:bg-[var(--accent-2)] disabled:opacity-40" onClick={submit} disabled={disabled || !text.trim()}>
              Send
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs text-[var(--muted)]">
          <span>Permissions:</span>
          {(['ask', 'auto-edit', 'plan'] as PermissionMode[]).map((m) => (
            <button key={m} onClick={() => onModeChange(m)} className={`rounded px-2 py-0.5 ${mode === m ? 'bg-[var(--panel-2)] text-[var(--text)]' : 'hover:text-[var(--text)]'}`}>
              {m === 'ask' ? 'Ask' : m === 'auto-edit' ? 'Auto-accept edits' : 'Plan only'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
