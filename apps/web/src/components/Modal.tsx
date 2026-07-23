import { useEffect, type MouseEvent, type ReactNode } from "react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  widthClassName?: string;
};

/** Generic centered overlay — this app has no other modal yet, so this is the one pattern to reuse (see EvFilterModal/SavedFiltersModal). */
export function Modal({ open, onClose, children, widthClassName = "max-w-md" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function onBackdropClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onBackdropClick}
    >
      <div
        className={`flex max-h-[90vh] w-full ${widthClassName} flex-col overflow-y-auto rounded-2xl border border-border bg-surface-alt shadow-[0_24px_60px_rgba(0,0,0,.45)]`}
      >
        {children}
      </div>
    </div>
  );
}
