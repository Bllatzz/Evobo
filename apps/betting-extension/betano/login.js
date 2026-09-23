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
// Os campos dentro do iframe ainda não tiveram o HTML visto — são achados de
// forma genérica (input de senha + o input de texto junto dele).
(function (root) {
  if (root.BetanoLogin) return;
  const S = root.BetanoSlip;
  const Q = (sel, el = document) => el.querySelector(sel);
  const QA = (sel, el = document) => [...el.querySelectorAll(sel)];
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

  const loginFrame = () => QA('#iframe-modal iframe, iframe.myaccount-iframe, iframe[src*="/myaccount/login"]').find(visible) ?? null;

  const frameDoc = (frame) => {
    try {
      return frame?.contentDocument ?? null;
    } catch {
      return null; // outra origem: não dá pra ler
    }
  };

  // Onde está o formulário: dentro do iframe do modal (o normal) ou, se um
  // dia a Betano mudar, na própria página.
  function formScope() {
    const frame = loginFrame();
    const doc = frameDoc(frame);
    if (doc && QA('input[type="password"]', doc).some(visible)) return { doc, frame };
    if (QA('input[type="password"]').some(visible)) return { doc: document, frame: null };
    return null;
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
  const isDangerous = (el) => PERIGOSO.test(norm(`${text(el)} ${el.getAttribute("aria-label") ?? ""} ${el.className ?? ""}`)) || /^[x×✕]?$/.test(norm(text(el)));

  const headerLoginButton = () => QA('[data-qa="login-button"]').find(visible) ?? null;

  // Página carregou o cabeçalho? (logo da Betano) — antes disso não dá pra
  // dizer se está logado ou não.
  async function status() {
    const ready = await S.waitFor(() => Q('[data-qa="brand-logo"]'), 15000);
    // Sem o logo: diz o que a página mostrou (ex.: a tela "Access to this
    // page is restricted" que a Betano deu pro Playwright em 2026-09-21).
    if (!ready) return { pronto: false, url: location.href, titulo: document.title, texto: text(document.body).slice(0, 300) };
    // O botão ENTRAR pode demorar um pouco mais que o logo pra renderizar.
    const btn = await S.waitFor(() => headerLoginButton(), 1500);
    return { pronto: true, logado: !btn };
  }

  function loginButtonPoint() {
    const btn = headerLoginButton();
    return btn ? point(btn, null) : null;
  }

  // Espera o modal com o formulário (o iframe carrega depois do clique).
  const waitForm = () => S.waitFor(() => formScope(), 15000, 250);

  const TAB_TEXT = {
    cpf: (t) => t === "cpf",
    email: (t) => t === "e-mail" || t === "email",
    usuario: (t) => t.startsWith("nome de usu"),
  };

  // Aba do tipo de login ("Nome de usuário" / "E-mail" / "CPF"). Clicar na
  // que já está marcada não muda nada, então sempre devolve o ponto dela.
  async function tabPoint(tipo) {
    const scope = await waitForm();
    if (!scope) return { ok: false, motivo: "formulario_de_login_nao_apareceu", textos: dialogTexts() };
    const match = TAB_TEXT[tipo];
    if (!match) return { ok: false, motivo: "tipo_de_login_desconhecido" };
    const clickable = QA("button, [role='tab'], label, a", scope.doc).find((el) => visible(el) && match(norm(text(el))) && !isDangerous(el));
    // Sem elemento clicável com o texto exato: o texto pode estar num <span>
    // solto — usa o clicável mais próximo dele.
    const leaf =
      clickable ??
      QA("span, div, p", scope.doc)
        .filter((el) => el.children.length === 0 && visible(el) && match(norm(text(el))))
        .map((el) => el.closest("button, [role='tab'], label, a") ?? el)[0];
    if (!leaf || isDangerous(leaf)) return { ok: false, motivo: "aba_do_tipo_de_login_nao_encontrada", tipo };
    return { ok: true, ponto: point(leaf, scope.frame), alvo: describe(leaf) };
  }

  function userInput(doc, pwd) {
    const box = pwd.closest("form, [role='dialog'], dialog, [class*='modal'], [class*='Modal']") ?? doc.body;
    const sel = 'input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])';
    return QA(sel, box).find(visible) ?? QA(sel, doc).find(visible) ?? null;
  }

  // Só pelo texto. Antes havia um "senão, o primeiro button type=submit" —
  // mas todo <button> sem type conta como submit, e isso podia pegar o X de
  // fechar o modal (o login real de 2026-09-23 abriu o modal e o fechou).
  // Sem o botão, o background aperta Enter no campo de senha.
  function submitButton(doc) {
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
    if (!scope) return { ok: false, motivo: "formulario_de_login_nao_apareceu", textos: dialogTexts() };
    const pwd = passwordIn(scope.doc);
    const user = userInput(scope.doc, pwd);
    if (!user) return { ok: false, motivo: "campo_de_usuario_nao_encontrado", textos: dialogTexts() };
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
