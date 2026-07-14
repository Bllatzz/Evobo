import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { translateAuthError } from "../../lib/authErrors";
import { IconGoogle, IconEye, IconEyeOff } from "../../components/Icon";
import { AuthBrandPanel } from "../../components/AuthBrandPanel";
import { Logo } from "../../components/Logo";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      setError(translateAuthError(error));
      return;
    }
    navigate("/", { replace: true });
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  return (
    <div className="flex min-h-dvh bg-bg text-text">
      <AuthBrandPanel />

      <div className="relative flex flex-1 flex-col px-7 lg:items-center lg:justify-center lg:px-16">
        <div
          className="pointer-events-none absolute left-1/2 top-[-120px] h-[420px] w-[420px] -translate-x-1/2 rounded-full lg:hidden"
          style={{
            background: "radial-gradient(circle, rgba(43,224,138,.16), transparent 65%)",
          }}
        />

        <div className="relative z-10 flex flex-col items-center gap-4 pt-16 pb-9 lg:hidden">
          <Logo size={64} rounded={19} className="shadow-[0_12px_34px_rgba(43,224,138,.45)]" />
          <div className="text-center">
            <div className="font-brand text-[30px] font-black leading-none tracking-[-0.03em]">Evobo</div>
            <div className="mt-1.5 text-[13px] text-text-secondary">Sinais do robô, ao vivo.</div>
          </div>
        </div>

        <div className="hidden lg:mb-7 lg:block">
          <div className="text-[28px] font-extrabold tracking-[-0.02em]">Entrar</div>
          <div className="mt-1.5 text-[14px] text-text-secondary">Bem-vindo de volta. Acesse sua conta.</div>
        </div>

        <form onSubmit={handleSubmit} className="relative z-10 flex flex-1 flex-col lg:w-full lg:max-w-[400px] lg:flex-none">
        <label className="mb-3.5 block">
          <span className="mb-2 block font-mono text-[11px] tracking-[0.04em] text-text-secondary">
            E-MAIL
          </span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-[54px] w-full rounded-[15px] border border-border-strong bg-surface-input px-4 text-[15px] text-text outline-none focus:border-accent"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-2 block font-mono text-[11px] tracking-[0.04em] text-text-secondary">
            SENHA
          </span>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-[54px] w-full rounded-[15px] border border-border-strong bg-surface-input px-4 pr-12 text-[17px] tracking-[3px] text-text outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-text-secondary"
            >
              {showPassword ? <IconEyeOff size={19} /> : <IconEye size={19} />}
            </button>
          </div>
          <div className="mt-2 text-right">
            <Link to="/forgot-password" className="text-[11px] text-accent">
              Esqueci a senha
            </Link>
          </div>
        </label>

        {error && <p className="mb-3 text-sm text-live">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mb-5 flex h-[54px] items-center justify-center gap-2 rounded-[15px] bg-gradient-to-br from-[#46F0A6] to-[#16B978] text-[16px] font-bold text-[#052318] shadow-[0_12px_30px_rgba(43,224,138,.35)] disabled:opacity-60"
        >
          {submitting ? "Entrando…" : "Entrar"}
        </button>

        <div className="mb-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="font-mono text-[11px] text-text-tertiary">ou continue com</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          className="mb-auto flex h-[52px] items-center justify-center gap-2.5 rounded-[14px] border border-border-strong bg-surface-input text-[15px] font-semibold"
        >
          <IconGoogle size={18} />
          Continuar com Google
        </button>

        <p className="pb-6 pt-6 text-center text-[14px] text-text-secondary">
          Não tem conta?{" "}
          <Link to="/register" className="font-semibold text-accent">
            Criar conta
          </Link>
        </p>
      </form>
      </div>
    </div>
  );
}
