import { useEffect, useState } from "react";
import { NavLink, Link } from "react-router-dom";
import { fetchGames } from "../lib/tips";
import { useAuth } from "../stores/auth";
import { Avatar } from "./Avatar";
import { AccountMenu } from "./AccountMenu";
import { Logo } from "./Logo";
import {
  IconHome,
  IconLive,
  IconRobot,
  IconRanking,
  IconCalendar,
  IconSearch,
  IconPlus,
  IconTrendingUp,
} from "./Icon";

const navItems = [
  { to: "/", label: "Feed", Icon: IconHome, end: true, screen: "feed" },
  { to: "/ao-vivo", label: "Ao Vivo", Icon: IconLive, end: false, screen: "ao_vivo" },
  { to: "/robo", label: "Robô", Icon: IconRobot, end: false, screen: "robo_apostas" },
  { to: "/ev", label: "EV+", Icon: IconTrendingUp, end: false, screen: "ev_plus" },
  { to: "/ranking", label: "Ranking", Icon: IconRanking, end: false, screen: "ranking" },
  { to: "/jogos", label: "Jogos", Icon: IconCalendar, end: false, screen: "jogos" },
  { to: "/busca", label: "Buscar", Icon: IconSearch, end: false, screen: "busca" },
] as const;

/**
 * Desktop nav rail — only shown at the `lg` breakpoint (see AppShell). Mirrors
 * the "Desktop · Feed"/"Desktop · Ranking" frames added to the design later
 * than the rest of the mobile screens (BANCA App.dc.html), which introduced
 * this sidebar + right-rail layout that doesn't exist on mobile.
 */
export function DesktopSidebar() {
  const { me, canAccess } = useAuth();
  const [liveCount, setLiveCount] = useState<number | null>(null);

  useEffect(() => {
    const load = () => fetchGames({ status: "live" }).then((g) => setLiveCount(g.length));
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="hidden h-full w-64 flex-none flex-col overflow-y-auto border-r border-border p-4 pb-[18px] lg:flex">
      <NavLink to="/" className="flex items-center gap-2.5 px-2 pb-6">
        <Logo size={36} rounded={11} />
        <span className="font-brand text-[24px] font-black tracking-[-0.03em]">Evobo</span>
      </NavLink>

      <nav className="flex flex-col gap-0.5">
        {navItems.filter(({ screen }) => canAccess(screen)).map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3.5 rounded-[13px] px-3.5 py-2.5 text-[15px] ${
                isActive ? "bg-accent-soft font-semibold text-accent" : "font-medium text-text-secondary"
              }`
            }
          >
            <Icon size={21} />
            {label}
            {to === "/ao-vivo" && liveCount !== null && liveCount > 0 && (
              <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-live">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />
                {liveCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <NavLink
        to="/nova-tip"
        className="mx-1 mt-4 flex h-[50px] items-center justify-center gap-2.5 rounded-[15px] bg-accent text-[15px] font-bold text-[#08090A] shadow-[0_12px_26px_rgba(43,224,138,0.35)]"
      >
        <IconPlus size={18} />
        Nova tip
      </NavLink>

      {me && (
        <div className="mt-auto flex items-center gap-2.5 rounded-[14px] border border-border bg-surface p-2.5">
          <Link to="/perfil" className="flex min-w-0 flex-1 items-center gap-2.5">
            <Avatar name={me.displayName} seed={me.id} src={me.avatarUrl} size={38} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold">{me.displayName}</div>
              <div className="truncate font-mono text-[11px] text-text-tertiary">@{me.username}</div>
            </div>
          </Link>
          <AccountMenu placement="top" />
        </div>
      )}
    </div>
  );
}
