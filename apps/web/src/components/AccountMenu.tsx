import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../stores/auth";
import { useTheme } from "../stores/theme";
import { IconDotsVertical, IconPencil, IconSun, IconMoon, IconLogout } from "./Icon";

/** Account dropdown — reached from the "⋮" next to the profile card (desktop
 * sidebar) and the mobile profile header. Holds the app's only entry points
 * for editing the profile, toggling light/dark, and signing out. */
export function AccountMenu({ placement = "bottom" }: { placement?: "top" | "bottom" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    navigate("/entrar", { replace: true });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Mais opções"
        aria-expanded={open}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-alt hover:text-text"
      >
        <IconDotsVertical size={18} />
      </button>

      {open && (
        <div
          className={`absolute right-0 z-20 w-56 rounded-[15px] border border-border-strong bg-surface-alt p-1.5 shadow-[0_16px_40px_rgba(0,0,0,.35)] ${
            placement === "top" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          <a
            href="/perfil/editar"
            onClick={(e) => {
              e.preventDefault();
              setOpen(false);
              navigate("/perfil/editar");
            }}
            className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13.5px] font-medium text-text hover:bg-surface-chip"
          >
            <IconPencil size={16} />
            Editar perfil
          </a>

          <button
            type="button"
            onClick={() => {
              toggleTheme();
            }}
            className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[13.5px] font-medium text-text hover:bg-surface-chip"
          >
            {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
            {theme === "dark" ? "Modo claro" : "Modo escuro"}
          </button>

          <div className="my-1 h-px bg-border" />

          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[13.5px] font-medium text-live hover:bg-live-soft"
          >
            <IconLogout size={16} />
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
