/** Shared quick-pick chips for token limits (context / output / compaction threshold). */
const K = 1024;
export const chipTokens = (n: number) => (n >= 1000 ? 1_000_000 : n * K);
export const chipLabel = (n: number) => (n >= 1000 ? '1M' : `${n}K`);
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

export function LimitChips({ value, chips, onPick }: { value?: number; chips: number[]; onPick: (next?: number) => void }) {
  return (
    <div className="limit-chips">
      {chips.map((n) => {
        const tokens = chipTokens(n);
        const active = value === tokens;
        return <button type="button" key={n} className={`limit-chip ${active ? 'is-active' : ''}`} onClick={() => onPick(active ? undefined : tokens)}>{chipLabel(n)}</button>;
      })}
    </div>
  );
}
