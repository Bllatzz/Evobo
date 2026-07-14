import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { translateAuthError } from "../../lib/authErrors";
import { passwordStrength, MIN_SCORE_TO_SUBMIT } from "../../lib/passwordStrength";
import { AuthBrandPanel } from "../../components/AuthBrandPanel";
import { IconEye, IconEyeOff } from "../../components/Icon";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

  // The recovery link redirects here with a token in the URL hash; supabase-js
  // parses it and fires PASSWORD_RECOVERY once the session is ready.
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });

    // Only trust an already-resolved session as "ready" when the URL itself
    // is a recovery link (supabase-js may finish processing it before this
    // listener subscribes). An unrelated session already sitting in this
    // browser — shared device, forgotten logout — must never substitute for
    // that check: otherwise handleSubmit below would silently change the
    // CURRENTLY LOGGED IN account's password instead of validating the
    // e-mail's token.
    if (window.location.hash.includes("type=recovery")) {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) setReady(true);
      });
    }

    // No PASSWORD_RECOVERY event and no recovery hash within a few seconds
    // means the link is invalid/expired/already used — without this the
    // screen would show "Verificando…" forever instead of telling the user.
    const timeout = setTimeout(() => setLinkError(true), 6000);

    return () => {
      subscription.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (strength.score < MIN_SCORE_TO_SUBMIT) return;
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      setError(translateAuthError(error));
      return;
    }
    setDone(true);
    setTimeout(() => navigate("/", { replace: true }), 1500);
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

        <div className="relative z-10 flex flex-1 flex-col justify-center lg:w-full lg:max-w-[400px] lg:flex-none">
          <div className="mb-7">
            <div className="text-[28px] font-extrabold tracking-[-0.02em]">Redefinir senha</div>
            <div className="mt-1.5 text-[14px] text-text-secondary">
              Escolha uma nova senha para sua conta.
            </div>
          </div>

          {!ready ? (
            linkError ? (
              <p className="text-[14px] text-live">
                Link de redefinição inválido ou expirado. Solicite um novo pela tela de login.
              </p>
            ) : (
              <p className="text-[14px] text-text-secondary">Verificando o link de redefinição…</p>
            )
          ) : done ? (
            <p className="rounded-[15px] border border-accent-border bg-accent-soft px-4 py-4 text-[14px] text-text">
              Senha redefinida com sucesso. Redirecionando…
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col">
              <label className="mb-4 block">
                <span className="mb-2 block font-mono text-[11px] tracking-[0.04em] text-text-secondary">
                  NOVA SENHA
                </span>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete="new-password"
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
                    {strength.score < MIN_SCORE_TO_SUBMIT &&
                      " — precisa ser ao menos boa para continuar"}
                  </div>
                )}
              </label>

              {error && <p className="mb-3 text-sm text-live">{error}</p>}

              <button
                type="submit"
                disabled={submitting || strength.score < MIN_SCORE_TO_SUBMIT}
                className="flex h-[54px] items-center justify-center gap-2 rounded-[15px] bg-gradient-to-br from-[#46F0A6] to-[#16B978] text-[16px] font-bold text-[#052318] shadow-[0_12px_30px_rgba(43,224,138,.35)] disabled:opacity-60"
              >
                {submitting ? "Salvando…" : "Salvar nova senha"}
              </button>
            </form>
          )}

          <p className="pb-6 pt-6 text-center text-[14px] text-text-secondary">
            <Link to="/login" className="font-semibold text-accent">
              Voltar para entrar
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
