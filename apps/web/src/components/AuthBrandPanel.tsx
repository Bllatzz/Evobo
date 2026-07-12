import { Logo } from "./Logo";

/** Left branding panel on the desktop Login/Registro split-screen layout. */
export function AuthBrandPanel() {
  return (
    <div className="relative hidden w-[560px] flex-none flex-col justify-between overflow-hidden border-r border-border bg-[radial-gradient(120%_90%_at_20%_0%,#0F1A14,#08090A)] px-12 py-[52px] lg:flex">
      <div
        className="pointer-events-none absolute -left-20 -top-[140px] h-[460px] w-[460px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(43,224,138,.18), transparent 65%)" }}
      />
      <div className="relative flex items-center gap-3">
        <Logo size={44} rounded={13} className="shadow-[0_10px_26px_rgba(43,224,138,.4)]" />
        <span className="font-brand text-[28px] font-black tracking-[-0.03em]">Evobo</span>
      </div>
      <div className="relative">
        <div className="mb-4.5 text-[40px] font-extrabold leading-[1.08] tracking-[-0.03em]">
          Sinais do robô,
          <br />
          <span className="text-accent">ao vivo.</span>
        </div>
        <p className="max-w-[400px] text-[16px] leading-relaxed text-text-secondary">
          Acompanhe as tips do robô em tempo real, análise por IA e o ranking dos melhores
          tipsters — tudo em um só lugar.
        </p>
      </div>
      <div className="relative font-mono text-[12px] text-text-quaternary">
        © 2026 Evobo · Aposte com responsabilidade · 18+
      </div>
    </div>
  );
}
