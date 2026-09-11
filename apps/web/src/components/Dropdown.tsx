import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "./Icon";

export type DropdownOption = { value: string; label: string };

/** A themed stand-in for a native <select> — the browser's own dropdown
 * panel can't be restyled (always renders with OS chrome, light background
 * regardless of the page's dark theme), so this renders the open list
 * itself instead. */
export function Dropdown({
  value,
  options,
  placeholder,
  onChange,
  buttonClassName = "rounded-full bg-surface-chip px-3.5 py-1.5 text-[12px] font-semibold text-text-secondary",
  className = "",
}: {
  value: string;
  options: DropdownOption[];
  placeholder: string;
  onChange: (value: string) => void;
  buttonClassName?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-1.5 ${buttonClassName}`}
      >
        <span className="min-w-0 flex-1 truncate text-left">{selected?.label ?? placeholder}</span>
        <IconChevronDown size={14} className={`flex-none transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1.5 max-h-64 w-max min-w-full overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={`block w-full whitespace-nowrap rounded-lg px-3 py-2 text-left text-[13px] ${
              value === "" ? "bg-accent-soft text-accent" : "text-text-secondary hover:bg-surface-alt"
            }`}
          >
            {placeholder}
          </button>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`block w-full whitespace-nowrap rounded-lg px-3 py-2 text-left text-[13px] ${
                value === o.value ? "bg-accent-soft text-accent" : "text-text-secondary hover:bg-surface-alt"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
