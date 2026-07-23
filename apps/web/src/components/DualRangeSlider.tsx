type DualRangeSliderProps = {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  formatValue?: (v: number) => string;
};

// Two overlapping native range inputs — the classic dual-thumb hack: each
// input's own track is transparent and pointer-events: none, only its thumb
// (via the ::-webkit/-moz-range-thumb pseudo-element) accepts clicks, so
// they don't fight each other for drag events.
const THUMB_INPUT_CLASSES =
  "pointer-events-none absolute inset-0 h-1.5 w-full appearance-none bg-transparent " +
  "[&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent [&::-moz-range-track]:border-none " +
  "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 " +
  "[&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full " +
  "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-bg [&::-webkit-slider-thumb]:bg-accent " +
  "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer " +
  "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-bg [&::-moz-range-thumb]:bg-accent";

export function DualRangeSlider({ min, max, step = 1, value, onChange, formatValue }: DualRangeSliderProps) {
  const [lo, hi] = value;
  const fmt = formatValue ?? ((v: number) => String(v));
  const span = max - min || 1;
  const pctLo = ((lo - min) / span) * 100;
  const pctHi = ((hi - min) / span) * 100;

  return (
    <div>
      <div className="mb-2.5 flex gap-2.5">
        <label className="flex-1">
          <span className="mb-1 block text-[11px] text-text-secondary">Min</span>
          <input
            type="number"
            value={lo}
            step={step}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n)) onChange([Math.min(n, hi), hi]);
            }}
            className="w-full rounded-lg border border-border-strong bg-surface-alt px-2.5 py-1.5 font-mono text-[13px] text-text outline-none"
          />
        </label>
        <label className="flex-1">
          <span className="mb-1 block text-[11px] text-text-secondary">Max</span>
          <input
            type="number"
            value={hi}
            step={step}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n)) onChange([lo, Math.max(n, lo)]);
            }}
            className="w-full rounded-lg border border-border-strong bg-surface-alt px-2.5 py-1.5 font-mono text-[13px] text-text outline-none"
          />
        </label>
      </div>

      <div className="relative h-1.5 rounded-full bg-surface-chip">
        <div
          className="absolute h-1.5 rounded-full bg-accent"
          style={{ left: `${pctLo}%`, right: `${100 - pctHi}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={lo}
          onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
          className={THUMB_INPUT_CLASSES}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={hi}
          onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
          className={THUMB_INPUT_CLASSES}
        />
      </div>

      <div className="relative mt-2 h-4">
        <span
          className="absolute -translate-x-1/2 rounded-md bg-accent px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#08090A]"
          style={{ left: `${pctLo}%` }}
        >
          {fmt(lo)}
        </span>
        <span
          className="absolute -translate-x-1/2 rounded-md bg-accent px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#08090A]"
          style={{ left: `${pctHi}%` }}
        >
          {fmt(hi)}
        </span>
      </div>
    </div>
  );
}
