import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { translateAuthError } from "../../lib/authErrors";
import { passwordStrength, MIN_SCORE_TO_SUBMIT } from "../../lib/passwordStrength";
import { AuthBrandPanel } from "../../components/AuthBrandPanel";
import { Logo } from "../../components/Logo";
import { IconEye, IconEyeOff } from "../../components/Icon";

export function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!agreed || strength.score < MIN_SCORE_TO_SUBMIT) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setError(null);
    setSubmitting(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: trimmedName } },
    });

    setSubmitting(false);
    if (error) {
      setError(translateAuthError(error));
      return;
    }
    // If e-mail confirmation is required, signUp succeeds but returns no
    // session — navigating to "/" would just bounce back to /login via
    // RouteGuard with no explanation of what happened.
    if (!data.session) {
      setError("Cadastro criado! Confirme seu e-mail para poder entrar.");
      return;
    }
    navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-dvh bg-bg text-text">
      <AuthBrandPanel />

      <div className="relative flex flex-1 flex-col px-7 lg:items-center lg:justify-center lg:px-16">
        <div
          className="pointer-events-none absolute left-1/2 top-[-120px] h-[420px] w-[420px] -translate-x-1/2 rounded-full lg:hidden"
          style={{
            background: "radial-gradient(circle, rgba(43,224,138,.14), transparent 65%)",
          }}
        />

        <div className="relative z-10 flex items-center gap-3 pt-4 lg:hidden">
          <Link to="/login" className="text-2xl leading-none text-text" aria-label="Voltar">
            ‹
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="relative z-10 flex flex-1 flex-col lg:w-full lg:max-w-[400px] lg:flex-none">
        <div className="mb-6.5 flex items-center gap-2.5 pt-3.5 lg:hidden">
          <Logo size={44} rounded={13} className="shadow-[0_8px_22px_rgba(43,224,138,.4)]" />
          <div>
            <div className="text-[22px] font-extrabold leading-tight tracking-[-0.03em]">
              Criar conta
            </div>
            <div className="mt-0.5 text-xs text-text-secondary">
              Comece a receber sinais do robô
            </div>
          </div>
        </div>

        <div className="hidden lg:mb-7 lg:block">
          <div className="text-[28px] font-extrabold tracking-[-0.02em]">Criar conta</div>
          <div className="mt-1.5 text-[14px] text-text-secondary">Comece a receber sinais do robô.</div>
        </div>

        <label className="mb-3.5 block">
          <span className="mb-2 block font-mono text-[11px] tracking-[0.04em] text-text-secondary">
            NOME
          </span>
          <input
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-[52px] w-full rounded-[15px] border border-border-strong bg-surface-input px-4 text-[15px] text-text outline-none focus:border-accent"
          />
        </label>

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
            className="h-[52px] w-full rounded-[15px] border border-border-strong bg-surface-input px-4 text-[15px] text-text outline-none focus:border-accent"
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-2 block font-mono text-[11px] tracking-[0.04em] text-text-secondary">
            SENHA
          </span>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-[52px] w-full rounded-[15px] border border-border-strong bg-surface-input px-4 pr-12 text-[17px] tracking-[3px] text-text outline-none focus:border-accent"
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
          <div className="mt-2.5 flex gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full ${password.length > 0 && i <= strength.score ? "bg-accent" : "bg-surface-chip"}`}
              />
            ))}
          </div>
          {password.length > 0 && (
            <div className={`mt-1.5 font-mono text-[11px] ${strength.className}`}>
              Força: {strength.label}
              {strength.score < MIN_SCORE_TO_SUBMIT && " — precisa ser ao menos boa para continuar"}
            </div>
          )}
        </label>

        <label className="mb-5 flex items-start gap-2.5">
          <input
            type="checkbox"
            required
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-[22px] w-[22px] flex-none accent-accent"
          />
          <span className="text-xs leading-relaxed text-text-secondary">
            Concordo com os <span className="text-text">Termos de Uso</span> e a{" "}
            <span className="text-text">Política de Privacidade</span>. Confirmo que tenho 18+
            anos.
          </span>
        </label>

        {error && <p className="mb-3 text-sm text-live">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !agreed || strength.score < MIN_SCORE_TO_SUBMIT}
          className="mb-auto flex h-[54px] items-center justify-center gap-2 rounded-[15px] bg-gradient-to-br from-[#46F0A6] to-[#16B978] text-[16px] font-bold text-[#052318] shadow-[0_12px_30px_rgba(43,224,138,.35)] disabled:opacity-60"
        >
          {submitting ? "Criando…" : "Criar conta"}
        </button>

        <p className="pb-6 pt-6 text-center text-[14px] text-text-secondary">
          Já tem conta?{" "}
          <Link to="/login" className="font-semibold text-accent">
            Entrar
          </Link>
        </p>
      </form>
      </div>
    </div>
  );
}
