/**
 * Stand-in for screens not yet built out pixel-for-pixel. Each app/<screen>
 * route renders this until its turn comes up in the implementation order —
 * swapping it for the real design happens screen by screen, not here.
 */
export function ScreenPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-bg px-6 text-center text-text">
      <span className="font-mono text-xs uppercase tracking-[0.12em] text-text-tertiary">
        Em construção
      </span>
      <h1 className="text-2xl font-bold">{label}</h1>
    </div>
  );
}
