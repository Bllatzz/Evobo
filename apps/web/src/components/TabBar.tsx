import { NavLink } from "react-router-dom";
import { IconHome, IconLive, IconRanking, IconProfile, IconRobot } from "./Icon";

/**
 * Bottom tab bar — matches the current BANCA App.dc.html: Home (feed), Ao
 * Vivo, a raised Robô de Apostas badge, Ranking, Perfil. The center slot
 * used to be a plain "+" for Nova Tip, but the design moved that to its own
 * floating pill button (see AppShell) and put Robô in the tab bar instead.
 */
const items = [
  { to: "/", label: "Home", Icon: IconHome },
  { to: "/live", label: "Ao Vivo", Icon: IconLive },
] as const;

const trailingItems = [
  { to: "/ranking", label: "Ranking", Icon: IconRanking },
  { to: "/profile", label: "Perfil", Icon: IconProfile },
] as const;

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex flex-1 flex-col items-center gap-1 pt-3 text-[10.5px] font-medium ${
    isActive ? "text-accent" : "text-text-tertiary"
  }`;

export function TabBar() {
  return (
    <nav className="sticky bottom-0 flex items-start justify-between border-t border-border bg-bg/90 px-6 pt-3 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden">
      {items.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} end className={linkClass}>
          <Icon />
          {label}
        </NavLink>
      ))}
      <div className="flex flex-1 flex-col items-center gap-1 text-[10.5px] font-medium text-accent">
        <NavLink
          to="/robot"
          className="-mt-2.5 flex h-[46px] w-[46px] items-center justify-center rounded-[15px] bg-accent text-bg shadow-[0_10px_22px_rgba(43,224,138,0.4)]"
          aria-label="Robô de Apostas"
        >
          <IconRobot size={22} />
        </NavLink>
        Robô
      </div>
      {trailingItems.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} className={linkClass}>
          <Icon />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
