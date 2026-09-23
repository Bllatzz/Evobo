// Login da Betano FALSO: cabeçalho com ENTRAR/REGISTRAR (data-qa reais de
// 2026-09-23) e o formulário dentro de um iframe /myaccount/login, como no
// modal real. Valida que login.js acha as peças DENTRO do iframe e que as
// coordenadas devolvidas (as que o CDP clica) caem no elemento certo.
// Não é a Betano: o HTML de dentro do iframe real ainda não foi visto.
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "betano");
const ORIGIN = "https://fake.betano.test";

const PAGE = `<body style="margin:0">
  <nav><figure data-qa="brand-logo">Betano</figure>
    <button data-qa="register-button">REGISTRAR</button><button data-qa="login-button">ENTRAR</button></nav>
  <div id="host"></div>
  <script>
    document.querySelector('[data-qa="login-button"]').addEventListener("click", () => {
      document.getElementById("host").innerHTML =
        '<div id="iframe-modal" style="position:absolute;left:120px;top:60px"><div class="modal-dialog">' +
        '<iframe src="/myaccount/login" class="myaccount-iframe" frameborder="0" style="width:500px;height:400px;border:0"></iframe></div></div>';
    });
    // "Login" funciona: o iframe chama isto e a página vira logada.
    window.fakeLoggedIn = () => {
      document.getElementById("host").innerHTML = "";
      document.querySelector('[data-qa="login-button"]').remove();
      document.querySelector('[data-qa="register-button"]').remove();
      document.querySelector("nav").insertAdjacentHTML("beforeend", '<span data-qa="header-balance">R$ 100,00</span>');
    };
  </script></body>`;

// Mesma estrutura do formulário real (form[data-qa="login"] + abas em
// ul[data-qa="login-methods"]), mas sem os data-qa das abas/botão — força o
// caminho "pelo texto" do login.js.
const LOGIN_FORM = `<body style="margin:0"><form data-qa="login">
  <p>Login ID</p>
  <ul data-qa="login-methods"><li><button type="button" id="t-user">Nome de usuário</button></li><li><button type="button" id="t-mail">E-mail</button></li><li><button type="button" id="t-cpf"><span>CPF</span></button></li></ul>
  <input id="user" type="text" placeholder="ex. 29684956312">
  <p>Senha</p><input id="pwd" type="password" placeholder="Entre com a sua senha">
  <button id="go" type="button">INICIAR SESSÃO</button></form>
  <script>document.getElementById("go").onclick = () => parent.fakeLoggedIn();</script></body>`;

let browser;
test.before(async () => {
  browser = await chromium.launch();
});
test.after(async () => {
  await browser.close();
});

async function setup() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.route(`${ORIGIN}/**`, (r) =>
    r.fulfill({ contentType: "text/html; charset=utf-8", body: r.request().url().includes("/myaccount/login") ? LOGIN_FORM : PAGE }),
  );
  await page.goto(`${ORIGIN}/`);
  for (const f of ["plan.js", "slip.js", "login.js"]) await page.addScriptTag({ path: join(root, f) });
  return page;
}

// Qual elemento está no ponto (x, y) da janela de cima, descendo pro iframe
// quando cair nele — é o que o clique do CDP atingiria.
const idAt = (page, p) =>
  page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (el?.tagName !== "IFRAME") return el?.id || el?.getAttribute("data-qa") || el?.tagName;
    const r = el.getBoundingClientRect();
    const inner = el.contentDocument.elementFromPoint(x - r.left, y - r.top);
    return inner?.id || inner?.parentElement?.id || inner?.tagName;
  }, p);

// data-qa do botão/elemento mais próximo no ponto (descendo pro iframe).
const qaAt = (page, p) =>
  page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const r = el.getBoundingClientRect();
    const inner = el.tagName === "IFRAME" ? el.contentDocument.elementFromPoint(x - r.left, y - r.top) : el;
    return inner?.closest("[data-qa]")?.getAttribute("data-qa") ?? null;
  }, p);

test("login: deslogado → acha ENTRAR, aba, campos e INICIAR SESSÃO dentro do iframe", async () => {
  const page = await setup();
  const antes = await page.evaluate(() => window.BetanoLogin.status());
  assert.deepEqual([antes.pronto, antes.logado], [true, false]);

  const entrar = await page.evaluate(() => window.BetanoLogin.loginButtonPoint());
  assert.equal(await idAt(page, entrar), "login-button");
  await page.mouse.click(entrar.x, entrar.y);

  for (const [tipo, id] of [["cpf", "t-cpf"], ["email", "t-mail"], ["usuario", "t-user"]]) {
    const aba = await page.evaluate((t) => window.BetanoLogin.tabPoint(t), tipo);
    assert.equal(aba.ok, true, JSON.stringify(aba));
    assert.equal(await idAt(page, aba.ponto), id);
  }

  const campos = await page.evaluate(() => window.BetanoLogin.fields());
  assert.equal(campos.ok, true, JSON.stringify(campos));
  // Cada ponto é pedido na hora do clique (targetPoint), como o background faz.
  for (const [alvo, id] of [["usuario", "user"], ["senha", "pwd"], ["enviar", "go"]]) {
    const p = await page.evaluate((a) => window.BetanoLogin.targetPoint(a), alvo);
    assert.equal(p.ok, true, JSON.stringify(p));
    assert.equal(await idAt(page, p.ponto), id);
  }

  const enviar = await page.evaluate(() => window.BetanoLogin.submitPoint());
  assert.match(enviar.alvo, /INICIAR SESSÃO/);
  await page.mouse.click(enviar.ponto.x, enviar.ponto.y);

  assert.deepEqual(await page.evaluate(() => window.BetanoLogin.waitLoggedIn()), { ok: true });
  const depois = await page.evaluate(() => window.BetanoLogin.status());
  assert.deepEqual([depois.pronto, depois.logado], [true, true]);
  assert.match(depois.sinal, /header-balance/);
  await page.close();
});

// O login real de 2026-09-23 abriu o modal e o fechou: nunca pode escolher o
// X / "Precisa de ajuda?" / login social como aba ou como "INICIAR SESSÃO".
test("login: sem botão com o texto certo, NÃO pega o X nem outro botão do modal", async () => {
  const page = await setup();
  const entrar = await page.evaluate(() => window.BetanoLogin.loginButtonPoint());
  await page.mouse.click(entrar.x, entrar.y);
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.getElementById("go"));
  const p = await page.evaluate(() => {
    const doc = document.querySelector("iframe").contentDocument;
    const go = doc.getElementById("go");
    go.textContent = "Continuar"; // texto que não é o do botão de login
    // botões perigosos ANTES do de login, como no modal real
    go.insertAdjacentHTML("beforebegin", '<button aria-label="Fechar">×</button><button>Precisa de ajuda?</button><button>Login via Google</button>');
    return window.BetanoLogin.targetPoint("enviar");
  });
  assert.deepEqual([p.ok, p.ponto], [true, null]); // sem botão → o background aperta Enter
  await page.close();
});

test("login: formulário que não abre dá motivo claro", async () => {
  const page = await setup();
  const semForm = await page.evaluate(async () => {
    window.BetanoSlip.waitFor = async (fn) => fn() || null; // sem esperar 15s no teste
    return window.BetanoLogin.fields();
  });
  assert.equal(semForm.motivo, "formulario_de_login_nao_apareceu");
  await page.close();
});

// 2026-09-23: o bilhete apareceu antes do cabeçalho, ENTRAR não veio a tempo
// e a extensão tratou como "logado" e foi pra aposta. Sem ENTRAR e sem sinal
// de logado, o status tem que dizer "não sei" (logado: null).
test("status: sem ENTRAR e sem sinal de logado → logado null (nunca 'logado')", async () => {
  const page = await setup();
  const st = await page.evaluate(async () => {
    document.querySelector('[data-qa="login-button"]').remove();
    document.querySelector('[data-qa="register-button"]').remove();
    const real = window.BetanoSlip.waitFor;
    window.BetanoSlip.waitFor = (fn, _t, step) => real(fn, 300, step); // sem esperar 20s no teste
    return window.BetanoLogin.status();
  });
  assert.equal(st.pronto, true);
  assert.equal(st.logado, null);
  assert.ok(Array.isArray(st.dataQa.cabecalho));
  await page.close();
});

// A lista de data-qa da Betano real não tinha nada do cabeçalho: ele deve
// ficar num shadow root. ENTRAR/saldo dentro de shadow DOM têm que ser vistos.
test("status: cabeçalho dentro de shadow DOM — vê ENTRAR e o saldo", async () => {
  const page = await setup();
  const res = await page.evaluate(async () => {
    const nav = document.querySelector("nav");
    const host = document.createElement("betano-header");
    nav.replaceWith(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<nav><button data-qa="login-button">ENTRAR</button></nav>';
    const deslogado = await window.BetanoLogin.status();
    shadow.innerHTML = '<nav><span data-qa="header-balance">R$ 50,00</span></nav>';
    const logado = await window.BetanoLogin.status();
    return { deslogado, logado };
  });
  assert.deepEqual([res.deslogado.pronto, res.deslogado.logado], [true, false]);
  assert.deepEqual([res.logado.pronto, res.logado.logado], [true, true]);
  await page.close();
});

// Formulário REAL (test/fixtures/betano-login-form.html) + um campo de senha
// "isca" na página de fora — o login real de 2026-09-23 falhou em 3s com
// aba_do_tipo_de_login_nao_encontrada, com o modal aberto.
test("login com o HTML real do formulário: ignora senha fora do modal e usa os data-qa reais", async () => {
  const form = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "betano-login-form.html"), "utf8");
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.route(`${ORIGIN}/**`, (r) =>
    r.fulfill({
      contentType: "text/html; charset=utf-8",
      body: r.request().url().includes("/myaccount/login")
        ? `<body style="margin:0">${form}</body>`
        : `<body style="margin:0"><form><input type="password" style="width:2px;height:2px"></form>
           <div id="iframe-modal" style="position:absolute;left:200px;top:40px"><iframe class="myaccount-iframe" src="/myaccount/login" style="width:600px;height:620px;border:0"></iframe></div></body>`,
    }),
  );
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.querySelector('[data-qa="login"]'));
  for (const f of ["plan.js", "slip.js", "login.js"]) await page.addScriptTag({ path: join(root, f) });

  const aba = await page.evaluate(() => window.BetanoLogin.tabPoint("cpf"));
  assert.equal(aba.ok, true, JSON.stringify(aba));
  assert.match(aba.alvo, /data-qa=taxid/);
  assert.equal(await qaAt(page, aba.ponto), "taxid"); // o clique cai no botão CPF, dentro do iframe

  const campos = await page.evaluate(() => window.BetanoLogin.fields());
  assert.equal(campos.ok, true, JSON.stringify(campos));
  const u = await page.evaluate(() => window.BetanoLogin.targetPoint("usuario"));
  assert.equal(await idAt(page, u.ponto), "taxid");
  const pw = await page.evaluate(() => window.BetanoLogin.targetPoint("senha"));
  assert.equal(await idAt(page, pw.ponto), "password");
  const go = await page.evaluate(() => window.BetanoLogin.targetPoint("enviar"));
  assert.match(go.alvo, /data-qa=submit/);
  assert.equal(go.desabilitado, true); // vazio: o background aperta Enter em vez de clicar
  await page.close();
});
