export function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      aria-pressed={on}
      className={`flex h-[27px] w-[46px] flex-none items-center rounded-full px-[3px] transition-colors ${
        on ? "justify-end bg-accent" : "justify-start bg-surface-alt"
      }`}
    >
      <span className={`h-[21px] w-[21px] rounded-full ${on ? "bg-[#08090A]" : "bg-text-quaternary"}`} />
    </button>
  );
}
