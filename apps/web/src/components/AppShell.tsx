import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { TabBar } from "./TabBar";
import { DesktopSidebar } from "./DesktopSidebar";
import { IconPlus, IconSearch } from "./Icon";
import { Logo } from "./Logo";

/**
 * Wraps the tab-bar screens (Home/Feed, Ao Vivo, Ranking, Meu Perfil...)
 * with the shared chrome. Two layouts share this component: the mobile
 * header+bottom-nav (< lg) and the desktop sidebar rail (>= lg) added when
 * "Desktop · Feed"/"Desktop · Ranking" frames were added to the design.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-text">
      <DesktopSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-5 py-3 lg:hidden">
          <Link to="/" className="flex items-center gap-2">
            <Logo size={30} rounded={9} />
            <span className="font-brand text-[23px] font-black tracking-[-0.03em]">Evobo</span>
          </Link>
          <div className="flex items-center gap-4 text-text-secondary">
            <Link to="/busca" aria-label="Buscar">
              <IconSearch />
            </Link>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>

        {/* Floating compose button — mobile only; the desktop sidebar has
            its own "Nova tip" button. Fixed to the viewport but re-centered
            to the app's own max-w column so it lands in the right place. */}
        <div className="pointer-events-none fixed inset-x-0 bottom-[88px] z-10 flex justify-center lg:hidden">
          <div className="relative w-full max-w-[430px]">
            <Link
              to="/nova-tip"
              className="pointer-events-auto absolute right-[18px] flex h-13 items-center gap-2 rounded-full bg-accent pl-[17px] pr-5 text-[15px] font-bold text-[#08090A] shadow-[0_12px_28px_rgba(43,224,138,0.42)]"
            >
              <IconPlus size={20} />
              Nova tip
            </Link>
          </div>
        </div>

        <TabBar />
      </div>
    </div>
  );
}
