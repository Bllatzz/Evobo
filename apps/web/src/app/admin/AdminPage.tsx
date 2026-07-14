import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchAdminOverview, type AdminOverview } from "../../lib/admin";
import { IconChevronLeft, IconCheck, IconShield, IconSparkle } from "../../components/Icon";

const navCards = [
  {
    to: "/admin/roles",
    Icon: IconShield,
    label: "Gestão de Roles",
    description: "Papéis, permissões por tela e atribuição de usuários",
  },
  {
    to: "/admin/screens",
    Icon: IconSparkle,
    label: "Telas & Permissões",
    description: "Controle o que usuários comuns veem no app",
  },
  {
    to: "/admin/payments",
    Icon: IconCheck,
    label: "Aprovação de Pagamentos",
    description: "Revisar comprovantes de Pix e aprovar assinaturas VIP",
  },
] as const;

export function AdminPage() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<AdminOverview | null>(null);

  useEffect(() => {
    fetchAdminOverview().then(setOverview);
  }, []);

  return (
    <div className="min-h-dvh bg-bg text-text lg:flex lg:min-h-full lg:flex-col">
      {/* ---------- Desktop ---------- */}
      <div className="hidden lg:flex lg:h-[70px] lg:flex-none lg:items-center lg:border-b lg:border-border lg:px-8">
        <span className="text-[20px] font-bold tracking-[-0.02em]">Painel Admin</span>
        <span className="ml-3 font-mono text-[12px] text-text-tertiary">Controle da plataforma</span>
      </div>

      <div className="hidden lg:block lg:flex-1 lg:px-8 lg:py-6">
        <div className="mb-6 flex gap-4">
          <div className="flex-1 rounded-2xl border border-border bg-surface p-5">
            <div className="font-mono text-[26px] font-bold">{overview?.tipstersCount ?? "—"}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.05em] text-text-tertiary">
              Tipsters
            </div>
          </div>
          <div className="flex-1 rounded-2xl border border-border bg-surface p-5">
            <div className="font-mono text-[26px] font-bold">{overview?.usersCount ?? "—"}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.05em] text-text-tertiary">
              Usuários
            </div>
          </div>
        </div>

        <div className="mb-3 font-mono text-[11px] tracking-[0.1em] text-text-tertiary">GESTÃO</div>
        <div className="grid grid-cols-3 gap-4">
          {navCards.map(({ to, Icon, label, description }) => (
            <Link
              key={to}
              to={to}
              className="flex flex-col gap-3.5 rounded-2xl border border-border bg-surface p-5"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
                <Icon size={18} />
              </div>
              <div>
                <div className="text-[14.5px] font-semibold">{label}</div>
                <div className="mt-0.5 text-[12px] text-text-tertiary">{description}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ---------- Mobile ---------- */}
      <div className="pb-8 lg:hidden">
      <div className="flex items-center gap-3.5 border-b border-border px-4 pb-3.5 pt-14">
        <button onClick={() => navigate(-1)} aria-label="Voltar">
          <IconChevronLeft size={22} />
        </button>
        <div>
          <div className="text-[16px] font-bold">Painel Admin</div>
          <div className="text-[11.5px] text-text-secondary">Controle da plataforma</div>
        </div>
      </div>

      <div className="flex gap-2.5 p-4">
        <div className="flex-1 rounded-2xl border border-border bg-surface p-3.5">
          <div className="font-mono text-[19px] font-bold">{overview?.tipstersCount ?? "—"}</div>
          <div className="mt-0.5 text-[10.5px] uppercase text-text-tertiary">Tipsters</div>
        </div>
        <div className="flex-1 rounded-2xl border border-border bg-surface p-3.5">
          <div className="font-mono text-[19px] font-bold">{overview?.usersCount ?? "—"}</div>
          <div className="mt-0.5 text-[10.5px] uppercase text-text-tertiary">Usuários</div>
        </div>
      </div>

      <div className="px-4 pb-2 font-mono text-[11px] tracking-[0.1em] text-text-tertiary">
        GESTÃO
      </div>
      <div className="flex flex-col gap-2.5 px-4">
        {navCards.map(({ to, Icon, label, description }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3.5 rounded-2xl border border-border bg-surface p-4"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
              <Icon size={18} />
            </div>
            <div className="flex-1">
              <div className="text-[14.5px] font-semibold">{label}</div>
              <div className="text-[12px] text-text-tertiary">{description}</div>
            </div>
            <span className="text-text-tertiary">›</span>
          </Link>
        ))}
      </div>
      </div>
    </div>
  );
}
