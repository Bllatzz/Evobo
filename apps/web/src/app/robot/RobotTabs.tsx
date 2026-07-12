import { Link } from "react-router-dom";

const TABS = [
  { to: "/robo", key: "tips", label: "Tips" },
  { to: "/robo/historico", key: "historico", label: "Histórico" },
] as const;

/** Segmented tab switcher shared by RobotPage ("Tips") and MarketsPage
 * ("Histórico") — both routes are AppShell-wrapped siblings, so this needs
 * to look identical on both to read as one screen with two tabs, not two
 * different pages. */
export function RobotTabs({ active }: { active: "tips" | "historico" }) {
  return (
    <div className="flex gap-1.5 rounded-[12px] bg-surface-alt p-1">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          to={tab.to}
          className={`flex-1 rounded-[9px] px-3.5 py-1.5 text-center text-[13px] font-semibold lg:flex-none lg:px-5 ${
            active === tab.key ? "bg-accent text-[#08090A]" : "text-text-secondary"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
