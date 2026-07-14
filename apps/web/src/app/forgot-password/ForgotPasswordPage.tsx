import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { translateAuthError } from "../../lib/authErrors";
import { AuthBrandPanel } from "../../components/AuthBrandPanel";
import { IconChevronLeft } from "../../components/Icon";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (error) {
      setError(translateAuthError(error));
      return;
    }
    setSent(true);
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

        <div className="relative z-10 flex items-center gap-3 pt-4 lg:hidden">
          <Link to="/login" className="text-2xl leading-none text-text" aria-label="Voltar">
            ‹
          </Link>
        </div>

        <div className="relative z-10 flex flex-1 flex-col lg:w-full lg:max-w-[400px] lg:flex-none">
          <div className="hidden lg:mb-2 lg:flex lg:items-center">
            <Link
              to="/login"
              className="flex items-center gap-1 text-[13px] text-text-secondary hover:text-text"
            >
              <IconChevronLeft size={16} />
              Voltar para entrar
            </Link>
          </div>

          <div className="mb-7 pt-16 lg:pt-0">
            <div className="text-[28px] font-extrabold tracking-[-0.02em]">Esqueci a senha</div>
            <div className="mt-1.5 text-[14px] text-text-secondary">
              Informe seu e-mail e enviaremos um link para redefinir sua senha.
            </div>
          </div>

          {sent ? (
            <p className="rounded-[15px] border border-accent-border bg-accent-soft px-4 py-4 text-[14px] text-text">
              Se existir uma conta com esse e-mail, enviamos um link de redefinição. Confira sua
              caixa de entrada.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col">
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

              {error && <p className="mb-3 text-sm text-live">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="flex h-[54px] items-center justify-center gap-2 rounded-[15px] bg-gradient-to-br from-[#46F0A6] to-[#16B978] text-[16px] font-bold text-[#052318] shadow-[0_12px_30px_rgba(43,224,138,.35)] disabled:opacity-60"
              >
                {submitting ? "Enviando…" : "Enviar link"}
              </button>
            </form>
          )}

          <p className="pb-6 pt-6 text-center text-[14px] text-text-secondary">
            Lembrou a senha?{" "}
            <Link to="/login" className="font-semibold text-accent">
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
