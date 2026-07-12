import { useNavigate } from "react-router-dom";
import { IconChevronLeft, IconSparkle } from "../../components/Icon";

export function AiAnalysisPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <div className="flex items-center gap-3 px-5 pb-1 pt-14 lg:px-8 lg:pt-6">
        <button onClick={() => navigate(-1)} className="lg:hidden" aria-label="Voltar">
          <IconChevronLeft size={22} />
        </button>
        <div className="flex items-center gap-2">
          <IconSparkle size={20} className="text-verified" />
          <span className="text-[20px] font-bold tracking-[-0.02em]">Análise IA</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <IconSparkle size={30} className="text-verified" />
        <p className="max-w-xs text-sm text-text-secondary">
          Em breve — ainda não temos um modelo estatístico real para essa análise, então essa tela
          não mostra números inventados.
        </p>
      </div>
    </div>
  );
}
