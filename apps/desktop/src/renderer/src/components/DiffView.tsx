/** Colourised unified diff. Monaco side-by-side view replaces this in Phase 2. */
export function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n');
  return (
    <pre className="m-0 max-h-80 overflow-auto rounded-md border border-[var(--border)] bg-[var(--panel-2)] p-2 text-[12px] leading-5">
      {lines.map((l, i) => {
        const cls = l.startsWith('+') && !l.startsWith('+++') ? 'diff-add' : l.startsWith('-') && !l.startsWith('---') ? 'diff-del' : l.startsWith('@@') ? 'diff-hunk' : '';
        return (
          <div key={i} className={cls}>
            {l || ' '}
          </div>
        );
      })}
    </pre>
  );
}
