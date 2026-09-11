import { NavLink } from "react-router-dom";
import { useAuth } from "../stores/auth";
import { IconHome, IconLive, IconRanking, IconProfile, IconRobot, IconTrendingUp, IconTelegram } from "./Icon";

/**
 * Bottom tab bar — matches the current BANCA App.dc.html: Home (feed), Ao
 * Vivo, Robô, EV+, Ranking, VIP (Telegram), Perfil. Robô used to be a
 * permanently-raised green badge regardless of route; per feedback it's now
 * a plain tab like the rest — only the active one gets the accent
 * treatment. VIP only shows for users with the telegram_banca screen, same
 * gating as every other conditional tab here.
 */
const items = [
  { to: "/", label: "Home", Icon: IconHome, end: true, screen: null },
  { to: "/live", label: "Ao Vivo", Icon: IconLive, end: false, screen: null },
  { to: "/robot", label: "Robô", Icon: IconRobot, end: false, screen: "robo_apostas" },
  { to: "/ev", label: "EV+", Icon: IconTrendingUp, end: false, screen: "ev_plus" },
  { to: "/ranking", label: "Ranking", Icon: IconRanking, end: false, screen: "ranking" },
  { to: "/telegram-tips", label: "VIP", Icon: IconTelegram, end: false, screen: "telegram_banca" },
  { to: "/profile", label: "Perfil", Icon: IconProfile, end: false, screen: "meu_perfil" },
] as const;

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex flex-1 flex-col items-center gap-1 pt-3 text-[10.5px] font-medium ${
    isActive ? "text-accent" : "text-text-tertiary"
  }`;

export function TabBar() {
  const { canAccess } = useAuth();

  return (
    <nav className="sticky bottom-0 flex items-start justify-between border-t border-border bg-bg/90 px-6 pt-3 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden">
      {items
        .filter(({ screen }) => screen === null || canAccess(screen))
        .map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={linkClass}>
            <Icon />
            {label}
          </NavLink>
        ))}
    </nav>
  );
}
