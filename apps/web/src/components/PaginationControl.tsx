import { IconChevronLeft, IconChevronRight } from "./Icon";

export function PaginationControl({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-center gap-3 font-mono text-[12px] text-text-tertiary">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Página anterior"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border-strong disabled:opacity-30"
      >
        <IconChevronLeft size={15} />
      </button>
      <span>
        Página {page} de {totalPages}
      </span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Próxima página"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border-strong disabled:opacity-30"
      >
        <IconChevronRight size={15} />
      </button>
    </div>
  );
}
