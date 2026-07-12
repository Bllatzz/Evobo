import { useNavigate } from "react-router-dom";
import { IconChevronLeft, IconTrendingUp } from "../../components/Icon";

export function EvPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <div className="flex items-center gap-3 px-5 pb-1 pt-14 lg:px-8 lg:pt-6">
        <button onClick={() => navigate(-1)} className="lg:hidden" aria-label="Voltar">
          <IconChevronLeft size={22} />
        </button>
        <div>
          <div className="flex items-center gap-2 text-[24px] font-bold tracking-[-0.02em]">
            EV<span className="text-accent">+</span>
          </div>
          <div className="font-mono text-[11px] text-text-tertiary">Valor esperado positivo · IA</div>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <IconTrendingUp size={30} className="text-accent" />
        <p className="max-w-xs text-sm text-text-secondary">Em breve.</p>
      </div>
    </div>
  );
}
