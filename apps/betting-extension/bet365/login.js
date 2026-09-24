// Login automático na Bet365 — mesmo contrato de mensagens do betano/login.js
// (login_status, login_botao, login_aba, login_campos, login_ponto,
// login_aguardar), então o background (ensureLoggedIn) serve pras duas
// casas. Só LOCALIZA e devolve coordenadas; quem clica e digita é o
// background, via CDP — a senha nunca passa por aqui.
//
// HTML real (2026-09-24): ao abrir um link de tip deslogado, o modal de
// login já abre sozinho — input[type=text] "Usuário ou endereço de e-mail"
// (pode vir preenchido), input[type=password] "Senha" e o botão "Login".
// As classes são embaralhadas (slm2-…), então tudo é achado por
// tipo/placeholder/texto. Logado: o bilhete mostra "Saldo" (.bs-Balance).
(function (root) {
  if (root.Bet365Login) return;
  const S = root.Bet365Slip;
  const QA = (sel, el = document) => [...el.querySelectorAll(sel)];
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const norm = (s) =>
    String(s ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };

  function point(el) {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }
  const describe = (el) => `${el.tagName.toLowerCase()} "${(el.tagName === "INPUT" ? el.getAttribute("placeholder") || el.type : text(el)).slice(0, 40)}"`;

  const passwordInput = () => QA('input[type="password"]').find(visible) ?? null;
  // Campo do usuário: o input de texto do mesmo bloco da senha.
  function userInput() {
    const pwd = passwordInput();
    const scope = pwd?.closest("form, div[class]")?.parentElement?.parentElement ?? document;
    const cands = QA('input[type="text"], input[type="email"], input:not([type])', scope).filter(visible);
    return cands.find((i) => /usu[aá]rio|e-?mail/i.test(i.getAttribute("placeholder") ?? "")) ?? cands[0] ?? null;
  }
  // Botão "Login" do formulário (nunca "Registre-se" / "Esqueceu…").
  function submitButton() {
    return QA("button, [role='button']").filter(visible).find((b) => norm(text(b)) === "login") ?? null;
  }
  // Botão "Login" do cabeçalho, quando o modal não abriu sozinho.
  function headerLogin() {
    if (passwordInput()) return null;
    return QA("button, div, span, a").filter((el) => visible(el) && el.children.length <= 1).find((el) => norm(text(el)) === "login") ?? null;
  }
  const balance = () => QA(".bs-Balance_Value, [class*='Balance_Value'], [class*='hm-Balance']").find((el) => visible(el) && /\d/.test(text(el))) ?? null;

  // Pronto quando aparece o bilhete, o modal de login ou o botão Login.
  async function status() {
    const ready = await S.waitFor(() => document.querySelector(".bss-StandardBetslip") || passwordInput() || headerLogin() || balance(), 15000, 250);
    if (!ready) return { pronto: false, url: location.href, titulo: document.title, textoVisivel: (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 300) };
    // Sinal POSITIVO dos dois lados (mesma regra da Betano): modal/botão
    // Login = deslogado; saldo = logado. Nenhum dos dois = não sei.
    const estado = await S.waitFor(() => (passwordInput() || headerLogin() ? "deslogado" : balance() ? "logado" : null), 20000, 250);
    if (!estado) return { pronto: true, logado: null };
    return { pronto: true, logado: estado === "logado", sinal: estado === "logado" ? `saldo ${text(balance())}` : passwordInput() ? "modal de login" : "botão Login" };
  }

  // Modal já aberto = nada a clicar (o background pula esse passo).
  function loginButtonPoint() {
    if (passwordInput()) return { jaAberto: true };
    const b = headerLogin();
    return b ? point(b) : null;
  }

  async function fields() {
    const pwd = await S.waitFor(() => passwordInput(), 10000, 250);
    if (!pwd) return { ok: false, motivo: "formulario_de_login_nao_apareceu" };
    const user = userInput();
    if (!user) return { ok: false, motivo: "campo_de_usuario_nao_encontrado" };
    // O background digita com Ctrl+A por cima (o usuário pode vir preenchido).
    return { ok: true, usuario: describe(user), senha: describe(pwd) };
  }

  function targetPoint(alvo) {
    const el = alvo === "usuario" ? userInput() : alvo === "senha" ? passwordInput() : alvo === "enviar" ? submitButton() : null;
    if (!el) return alvo === "enviar" ? { ok: true, ponto: null, alvo: null } : { ok: false, motivo: `${alvo}_nao_encontrado` };
    return { ok: true, ponto: point(el), alvo: describe(el), desabilitado: !!el.disabled };
  }

  async function waitLoggedIn() {
    const ok = await S.waitFor(() => !passwordInput() && !headerLogin(), 25000, 250);
    const erro = QA("[class*='rror'], [role='alert']").filter(visible).map(text).filter(Boolean).slice(0, 3);
    return ok ? { ok: true } : { ok: false, motivo: "login_nao_confirmado", textos: erro };
  }

  root.Bet365Login = { status, loginButtonPoint, fields, targetPoint, waitLoggedIn };

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, send) => {
      const handlers = {
        login_status: status,
        login_botao: async () => loginButtonPoint(),
        // Bet365 não tem abas de tipo de login.
        login_aba: async () => ({ ok: true, ponto: null, alvo: "sem abas na Bet365" }),
        login_campos: fields,
        login_ponto: async () => targetPoint(msg.alvo),
        login_aguardar: waitLoggedIn,
      };
      const h = handlers[msg?.acao];
      if (!h) return;
      Promise.resolve(h()).then(send, (e) => send({ ok: false, motivo: "erro", erro: String(e?.message ?? e) }));
      return true;
    });
  }
})(typeof self !== "undefined" ? self : this);
