// Login automático na Betano — só LOCALIZA as coisas na página (botão ENTRAR,
// aba do tipo de login, campos, botão de enviar) e devolve coordenadas. Quem
// clica e DIGITA é o background, via CDP (cliques/teclado confiáveis): a
// senha nunca passa por este script nem pelo JS da página.
//
// HTML real (colado pelo usuário em 2026-09-23):
//  - deslogado, o cabeçalho tem button[data-qa="register-button"] (REGISTRAR)
//    e button[data-qa="login-button"] (ENTRAR);
//  - ENTRAR abre #iframe-modal com <iframe class="myaccount-iframe"
//    src="/myaccount/login"> (mesmo site, então dá pra ler o DOM dele daqui);
//  - dentro: abas "Nome de usuário" / "E-mail" / "CPF" (CPF vem marcada),
//    campo Login ID, campo Senha e o botão "INICIAR SESSÃO".
// HTML de dentro do iframe (também real, 2026-09-23, em
// test/fixtures/betano-login-form.html): form[data-qa="login"], abas
// ul[data-qa="login-methods"] > button[data-qa="username"|"email"|"taxid"],
// Login ID input[data-qa="input"] (id muda com a aba), senha #password,
// button[data-qa="submit"] "INICIAR SESSÃO" (começa disabled), X =
// data-qa="exit-modal". O cabeçalho da página fica em shadow DOM.
(function (root) {
  if (root.BetanoLogin) return;
  const S = root.BetanoSlip;
  const Q = (sel, el = document) => el.querySelector(sel);
  const QA = (sel, el = document) => [...el.querySelectorAll(sel)];

  // Busca que entra em shadow DOM aberto. Em 2026-09-23 a lista de data-qa
  // da página (querySelectorAll normal) não tinha NADA do cabeçalho — nem
  // brand-logo, nem ENTRAR — embora o HTML copiado do DevTools tivesse: o
  // cabeçalho provavelmente fica dentro de um shadow root, que a busca
  // normal não enxerga.
  function deepQA(sel, rootNode = document) {
    const out = [...rootNode.querySelectorAll(sel)];
    for (const el of rootNode.querySelectorAll("*")) {
      if (el.shadowRoot) out.push(...deepQA(sel, el.shadowRoot));
    }
    return out;
  }
  const shadowHosts = () => deepQA("*").filter((el) => el.shadowRoot).map((el) => el.tagName.toLowerCase());
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const norm = (s) =>
    String(s ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();

  // getComputedStyle da janela DONA do elemento (o do iframe é outra janela).
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const st = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };

  const loginFrame = () => deepQA('#iframe-modal iframe, iframe.myaccount-iframe, iframe[src*="/myaccount/login"]').find(visible) ?? null;

  const frameDoc = (frame) => {
    try {
      return frame?.contentDocument ?? null;
    } catch {
      return null; // outra origem: não dá pra ler
    }
  };

  // Onde está o formulário: dentro do iframe do modal (o normal) ou, se um
  // dia a Betano mudar, na própria página.
  // Só aceita um documento que tenha o formulário de login REAL da Betano
  // (form[data-qa="login"] / ul[data-qa="login-methods"], HTML de
  // 2026-09-23) com o campo de senha visível. Antes bastava "tem um campo de
  // senha visível", e a extensão procurou as abas no documento errado
  // (aba_do_tipo_de_login_nao_encontrada em 3s, com o modal aberto) —
  // provavelmente um campo de senha escondido pra gerenciador de senhas.
  const LOGIN_FORM = 'form[data-qa="login"], [data-qa="login-methods"]';
  const isLoginDoc = (doc) => !!doc && !!Q(LOGIN_FORM, doc) && QA('input[type="password"]', doc).some(visible);
  function formScope() {
    const frame = loginFrame();
    const doc = frameDoc(frame);
    if (isLoginDoc(doc)) return { doc, frame };
    if (isLoginDoc(document)) return { doc: document, frame: null };
    return null;
  }

  // Onde procurou e o que tinha lá — pro histórico quando algo não é achado.
  function scopeDebug(scope) {
    const frame = loginFrame();
    return {
      onde: scope ? (scope.frame ? "iframe do modal" : "página") : "nenhum",
      iframeAchado: !!frame,
      iframeLegivel: !!frameDoc(frame),
      iframeUrl: (() => {
        try {
          return frameDoc(frame)?.location.href ?? null;
        } catch {
          return null;
        }
      })(),
      botoes: scope
        ? QA("button", scope.doc)
            .slice(0, 15)
            .map((b) => `${b.getAttribute("data-qa") ?? "?"}:"${text(b).slice(0, 20)}"${visible(b) ? "" : " (invisível)"}`)
        : [],
    };
  }

  // Coordenadas na janela de cima (é nelas que o CDP clica): posição dentro
  // do iframe + posição do iframe na página.
  // Rola só o necessário ("nearest"): rolar pra centralizar um campo mexia
  // na posição dos outros. Por isso o background também pede cada ponto logo
  // antes de clicar nele (login_ponto), nunca vários de uma vez.
  function point(el, frame) {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = el.getBoundingClientRect();
    const f = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: Math.round(f.left + r.left + r.width / 2), y: Math.round(f.top + r.top + r.height / 2) };
  }

  // Descrição do elemento pro histórico ("em que ele clicou?") — tag, id,
  // data-qa e texto. Nunca o valor de um campo.
  function describe(el) {
    const qa = el.getAttribute("data-qa");
    const label = el.tagName === "INPUT" ? el.getAttribute("placeholder") || el.type : text(el) || el.getAttribute("aria-label") || "";
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${qa ? `[data-qa=${qa}]` : ""} "${String(label).slice(0, 40)}"`;
  }

  // Nunca clicar em fechar/ajuda/cadastro achando que é outra coisa.
  const PERIGOSO = /fechar|close|cancel|ajuda|cadastr|registr|esqueceu|facebook|google|yahoo|linkedin|×|✕/;
  const DANGEROUS_QA = /exit-modal|help-chat|forgot-password|facebook|google|yahoo|linkedin|socials/i;
  const isDangerous = (el) => DANGEROUS_QA.test(el.getAttribute?.("data-qa") ?? "") || PERIGOSO.test(norm(`${text(el)} ${el.getAttribute("aria-label") ?? ""} ${el.className ?? ""}`)) || /^[x×✕]?$/.test(norm(text(el)));

  const headerLoginButton = () => deepQA('[data-qa="login-button"]').find(visible) ?? null;

  // Marcadores do cabeçalho LOGADO. O HTML do cabeçalho logado ainda não foi
  // visto — são palpites por nome (saldo, conta, usuário, depositar); o
  // histórico mostra qual casou (`sinal`) ou, se nenhum, a lista de data-qa.
  const LOGGED_IN = [
    '[data-qa*="balance" i]',
    '[data-qa*="account-menu" i]',
    '[data-qa*="my-account" i]',
    '[data-qa*="user-menu" i]',
    '[data-qa*="avatar" i]',
    '[data-qa*="deposit" i]',
    '[data-qa*="logout" i]',
  ];
  function loggedInMarker() {
    for (const sel of LOGGED_IN) {
      const el = deepQA(sel).find(visible);
      if (el) return `${sel} → ${el.getAttribute("data-qa")}`;
    }
    return null;
  }

  // Diagnóstico: data-qa da página (inclusive dentro de shadow DOM), com os
  // que parecem de cabeçalho/conta primeiro, e quais elementos têm shadow root.
  const HEADER_HINT = /login|register|logo|balance|account|user|deposit|logout|header|nav|menu|avatar|wallet|saldo|profile/i;
  const pageDataQa = () => {
    const all = [...new Set(deepQA("[data-qa]").map((el) => el.getAttribute("data-qa")))];
    return { cabecalho: all.filter((q) => HEADER_HINT.test(q)).slice(0, 60), outros: all.filter((q) => !HEADER_HINT.test(q)).slice(0, 20), total: all.length, shadowHosts: [...new Set(shadowHosts())].slice(0, 20) };
  };

  // Página carregou o cabeçalho? (logo da Betano) — antes disso não dá pra
  // dizer se está logado ou não.
  async function status() {
    // Qualquer sinal de que a Betano montou a página. Só o logo não bastou:
    // em 2026-09-23 a página abriu normal (título certo, /bookingcode/ →
    // "/") e o data-qa="brand-logo" não apareceu em 15s.
    const READY = ['[data-qa="brand-logo"]', '[data-qa="login-button"]', '[data-qa="register-button"]', '[data-qa="bet-slip"]', '[data-qa="floating-betslip-header"]', '[data-qa="nav-menu"]'];
    // Os sinais de logado também contam: logado não tem ENTRAR/REGISTRAR.
    const ready = await S.waitFor(() => READY.some((sel) => deepQA(sel).length > 0) || !!loggedInMarker(), 15000, 250);
    // Sem nenhum: diz o que a página tinha (ex.: a tela "Access to this page
    // is restricted" que a Betano deu pro Playwright em 2026-09-21).
    if (!ready) {
      return { pronto: false, url: location.href, titulo: document.title, dataQa: pageDataQa(), textoVisivel: (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 300) };
    }
    // Logado ou não só com um sinal POSITIVO: ENTRAR visível = deslogado;
    // algo que só existe logado (saldo, conta, depositar) = logado. "Não
    // achei ENTRAR" NÃO é logado — em 2026-09-23 o bilhete apareceu antes do
    // cabeçalho, ENTRAR não veio em 3s e a extensão foi direto pra aposta
    // deslogada. Sem nenhum dos dois, quem chama aborta.
    const estado = await S.waitFor(() => (headerLoginButton() ? "deslogado" : loggedInMarker() ? "logado" : null), 20000, 250);
    if (!estado) return { pronto: true, logado: null, dataQa: pageDataQa() };
    return { pronto: true, logado: estado === "logado", sinal: estado === "logado" ? loggedInMarker() : "botão ENTRAR" };
  }

  function loginButtonPoint() {
    const btn = headerLoginButton();
    return btn ? point(btn, null) : null;
  }

  // Espera o modal com o formulário (o iframe carrega depois do clique).
  const waitForm = () => S.waitFor(() => formScope(), 15000, 250);

  // data-qa reais das abas (ul[data-qa="login-methods"], 2026-09-23).
  const TAB_QA = { cpf: "taxid", email: "email", usuario: "username" };
  const TAB_TEXT = {
    cpf: (t) => t === "cpf",
    email: (t) => t === "e-mail" || t === "email",
    usuario: (t) => t.startsWith("nome de usu"),
  };

  // Aba do tipo de login ("Nome de usuário" / "E-mail" / "CPF"). Clicar na
  // que já está marcada não muda nada, então sempre devolve o ponto dela.
  // Acha a aba num documento de login (null se ainda não estiver lá).
  function findTab(doc, tipo) {
    const match = TAB_TEXT[tipo];
    // 1º pelo data-qa real; senão pelo texto (se a Betano renomear).
    const byQa = Q(`[data-qa="login-methods"] [data-qa="${TAB_QA[tipo]}"]`, doc);
    if (byQa && visible(byQa)) return byQa;
    const clickable = QA("button, [role='tab'], label, a", doc).find((el) => visible(el) && match(norm(text(el))) && !isDangerous(el));
    if (clickable) return clickable;
    // O texto pode estar num <span> solto — usa o clicável mais próximo dele.
    const leaf = QA("span, div, p", doc)
      .filter((el) => el.children.length === 0 && visible(el) && match(norm(text(el))))
      .map((el) => el.closest("button, [role='tab'], label, a") ?? el)[0];
    return leaf && !isDangerous(leaf) ? leaf : null;
  }

  // Aba do tipo de login ("Nome de usuário" / "E-mail" / "CPF"). Clicar na
  // que já está marcada não muda nada, então sempre devolve o ponto dela.
  // Procura de novo por até 8s: no login real de 2026-09-23 a falha veio em
  // 3s com o modal aberto — provavelmente olhou uma vez só, antes do
  // formulário terminar de montar.
  async function tabPoint(tipo) {
    if (!TAB_TEXT[tipo]) return { ok: false, motivo: "tipo_de_login_desconhecido" };
    const scope = await waitForm();
    if (!scope) return { ok: false, motivo: "formulario_de_login_nao_apareceu", textos: dialogTexts(), ...scopeDebug(null) };
    let last = scope;
    const found = await S.waitFor(() => {
      last = formScope() ?? last; // o iframe pode ter sido trocado
      const el = findTab(last.doc, tipo);
      return el ? { el, frame: last.frame } : null;
    }, 8000, 250);
    if (!found) return { ok: false, motivo: "aba_do_tipo_de_login_nao_encontrada", tipo, ...scopeDebug(last) };
    return { ok: true, ponto: point(found.el, found.frame), alvo: describe(found.el) };
  }

  function userInput(doc, pwd) {
    // Real: o campo do Login ID é o input[data-qa="input"] que não é senha,
    // dentro do form[data-qa="login"] (o id muda com a aba: taxid/email/…).
    const real = QA('form[data-qa="login"] input[data-qa="input"]:not([type="password"])', doc).find(visible);
    if (real) return real;
    const box = pwd.closest("form, [role='dialog'], dialog, [class*='modal'], [class*='Modal']") ?? doc.body;
    const sel = 'input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])';
    return QA(sel, box).find(visible) ?? QA(sel, doc).find(visible) ?? null;
  }

  // Só pelo texto. Antes havia um "senão, o primeiro button type=submit" —
  // mas todo <button> sem type conta como submit, e isso podia pegar o X de
  // fechar o modal (o login real de 2026-09-23 abriu o modal e o fechou).
  // Sem o botão, o background aperta Enter no campo de senha.
  function submitButton(doc) {
    const real = Q('form[data-qa="login"] button[data-qa="submit"]', doc);
    if (real && visible(real)) return real;
    return (
      QA("button, input[type='submit'], [role='button']", doc)
        .filter((b) => visible(b) && !isDangerous(b) && b.getAttribute("data-qa") !== "login-button")
        .find((b) => /^(iniciar sessao|entrar|acessar)$/.test(norm(text(b) || b.value))) ?? null
    );
  }

  const passwordIn = (doc) => QA('input[type="password"]', doc).find(visible) ?? null;

  // Confere que os campos existem e limpa o que o autocompletar do Chrome já
  // tiver posto — o background digita por cima com teclado de verdade. As
  // posições são pedidas uma a uma depois (login_ponto).
  async function fields() {
    const scope = await waitForm();
    if (!scope) return { ok: false, motivo: "formulario_de_login_nao_apareceu", textos: dialogTexts(), ...scopeDebug(null) };
    const pwd = passwordIn(scope.doc);
    const user = userInput(scope.doc, pwd);
    if (!user) return { ok: false, motivo: "campo_de_usuario_nao_encontrado", textos: dialogTexts(), ...scopeDebug(scope) };
    const win = scope.doc.defaultView ?? window;
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set;
    for (const input of [user, pwd]) {
      setter.call(input, "");
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
    }
    return { ok: true, usuario: describe(user), senha: describe(pwd) };
  }

  // Ponto de UM alvo ("usuario" | "senha" | "enviar"), calculado agora.
  function targetPoint(alvo) {
    const scope = formScope();
    if (!scope) return { ok: false, motivo: "formulario_sumiu", textos: dialogTexts() };
    const pwd = passwordIn(scope.doc);
    const el = alvo === "senha" ? pwd : alvo === "usuario" ? userInput(scope.doc, pwd) : alvo === "enviar" ? submitButton(scope.doc) : null;
    if (!el) return alvo === "enviar" ? { ok: true, ponto: null, alvo: null } : { ok: false, motivo: `${alvo}_nao_encontrado` };
    return { ok: true, ponto: point(el, scope.frame), alvo: describe(el), desabilitado: !!el.disabled };
  }

  // Compat com o teste: ponto do "INICIAR SESSÃO".
  const submitPoint = async () => targetPoint("enviar");

  // Textos visíveis de diálogos/erros (na página e no iframe) — pro
  // relatório dizer por que o login não passou (senha errada, captcha,
  // código por SMS…). Nunca inclui valores de campos.
  function dialogTexts() {
    const docs = [document, frameDoc(loginFrame())].filter(Boolean);
    return docs
      .flatMap((doc) => QA("[role='dialog'], dialog[open], [data-qa*='error'], [class*='error'], [role='alert']", doc))
      .filter(visible)
      .map(text)
      .filter(Boolean)
      .map((t) => t.slice(0, 300))
      .slice(0, 5);
  }

  async function waitLoggedIn() {
    const ok = await S.waitFor(() => !headerLoginButton() && !loginFrame(), 25000, 250);
    return ok ? { ok: true } : { ok: false, motivo: "login_nao_confirmado", textos: dialogTexts() };
  }

  root.BetanoLogin = { status, loginButtonPoint, tabPoint, fields, targetPoint, submitPoint, waitLoggedIn };

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, send) => {
      const handlers = {
        login_status: status,
        login_botao: async () => loginButtonPoint(),
        login_aba: () => tabPoint(msg.tipo),
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
