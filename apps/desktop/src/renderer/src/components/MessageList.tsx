import { useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TranscriptItem } from '../hooks/useAgent';
import { ToolCallCard } from './ToolCallCard';

export function MessageList({ items }: { items: TranscriptItem[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [items]);

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center text-[var(--muted)]">
        <div className="mb-2 text-4xl">✨</div>
        <div className="text-lg text-[var(--text)]">What are we building today?</div>
        <div className="mt-1 max-w-md text-sm">
          Ask about the code, request a change, or paste an error. Hold the mic button to dictate.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 px-6 py-4">
      {items.map((it) => {
        switch (it.kind) {
          case 'user':
            return (
              <div key={it.id} className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--accent)]/15 px-4 py-2">
                {it.text}
              </div>
            );
          case 'assistant':
            return (
              <div key={it.id} className="prose max-w-none">
                <Markdown remarkPlugins={[remarkGfm]}>{it.text}</Markdown>
                {it.streaming && <span className="inline-block h-4 w-2 animate-pulse bg-[var(--accent)] align-middle" />}
              </div>
            );
          case 'tool':
            return <ToolCallCard key={it.id} call={it.call} result={it.result} />;
          case 'error':
            return (
              <div key={it.id} className="rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-[var(--danger)]">
                {it.text}
              </div>
            );
        }
      })}
      <div ref={endRef} />
    </div>
  );
}
