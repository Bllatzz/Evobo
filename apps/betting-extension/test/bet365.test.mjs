import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installFakeBet365 } from "./fake-bet365.mjs";

// EXT_DIR: roda contra outra cópia da extensão (ex.: a ofuscada do build).
const ext = process.env.EXT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..");

// As duas seleções do HTML real (Padovan NFL, 2026-09-24).
const CARDS = [
  { selection: "Mark Redman", market: "Marcador de Touchdown - A Qualquer Momento", fixture: "ATL Falcons @ GB Packers", odd: 16 },
  { selection: "Jahan Dotson", market: "Marcador de Touchdown - A Qualquer Momento", fixture: "ATL Falcons @ GB Packers", odd: 8 },
];

let browser;
test.before(async () => {
  browser = await chromium.launch();
});
test.after(async () => {
  await browser.close();
});

async function setup(fake) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.route("https://fake.bet365.test/**", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: "<body></body>" }));
  await page.goto("https://fake.bet365.test/");
  await installFakeBet365(page, fake);
  for (const f of ["betano/plan.js", "bet365/slip.js", "bet365/login.js", "bet365/run.js"]) await page.addScriptTag({ path: join(ext, f) });
  return page;
}
const run = (page, task) => page.evaluate((t) => window.Bet365Run.runTask(t), task);

test("bet365: lê as seleções do bilhete (título, mercado, times, odd)", async () => {
  const page = await setup({ cards: CARDS });
  const snap = await page.evaluate(() => window.Bet365Slip.readSnapshot());
  assert.deepEqual(snap.cards[0], {
    selection: "Mark Redman",
    market: "Marcador de Touchdown - A Qualquer Momento",
    teams: ["ATL Falcons", "GB Packers"],
    odd: 16,
    stakeInputId: "simples:0",
  });
  assert.equal(snap.accumulator.odd, 128);
  await page.close();
});

test("bet365: 'Criar Aposta' → Mostrar Opções → Simples e Múltiplas", async () => {
  const page = await setup({ cards: CARDS, mode: "Criar Aposta" });
  const r = await page.evaluate(() => window.Bet365Slip.ensureSinglesMode());
  assert.equal(r.erro, undefined, JSON.stringify(r));
  assert.equal(r.depois, "Simples e Múltiplas");
  assert.deepEqual(r.passos, ["mostrar_opcoes", "tipo_de_bilhete", "simples_e_multiplas"]);
  await page.close();
});

test("bet365: duas simples — preenche cada campo, total confere, não aposta", async () => {
  const page = await setup({ cards: CARDS, mode: "Criar Aposta" });
  const r = await run(page, {
    tipId: "g:1",
    unitValueReais: 20,
    maxStakeReais: 50,
    legs: [
      { id: "a", match: "ATL Falcons x GB Packers", selection: "Mark Redman marcar touchdown", odd: 16, unit: 0.5 },
      { id: "b", match: "ATL Falcons x GB Packers", selection: "Jahan Dotson marcar touchdown", odd: 8, unit: 1 },
    ],
  });
  assert.equal(r.abort, null, JSON.stringify(r));
  assert.deepEqual(r.singles.legs.map((l) => [l.action, l.stakeReais]), [["stake", 10], ["stake", 20]]);
  assert.equal(r.singles.totalConfere, true, JSON.stringify(r.singles.campos));
  assert.equal(r.singles.botao.totalReais, 30);
  assert.equal(await page.evaluate(() => window.__placeClicks), 0);
  await page.close();
});

test("bet365: múltipla pura — stake no rodapé, odd real pelo retorno", async () => {
  const page = await setup({ cards: CARDS });
  const r = await run(page, {
    tipId: "g:2",
    unitValueReais: 20,
    maxStakeReais: 50,
    rawMessage: "Múltipla de 2\nMark Redman + Jahan Dotson touchdown\n0,5u @ 120",
    legs: [{ id: "x", match: "ATL Falcons x GB Packers", selection: "Mark Redman + Jahan Dotson", odd: 120, unit: 0.5 }],
  });
  assert.equal(r.abort, null, JSON.stringify(r));
  assert.equal(r.multiplaPura, true);
  assert.deepEqual([r.multiple.action, r.multiple.stakeReais, r.multiple.realOdd, r.multiple.totalConfere], ["stake", 10, 128, true]);
  assert.equal(r.multiple.takeOdd, 128);
  assert.equal(await page.evaluate(() => window.__placeClicks), 0);
  await page.close();
});

test("bet365: odd abaixo da tip numa simples — só a outra é preenchida", async () => {
  const page = await setup({ cards: CARDS });
  const r = await run(page, {
    tipId: "g:3",
    unitValueReais: 20,
    maxStakeReais: 50,
    legs: [
      { id: "a", match: "ATL Falcons x GB Packers", selection: "Mark Redman", odd: 17, unit: 0.5 },
      { id: "b", match: "ATL Falcons x GB Packers", selection: "Jahan Dotson", odd: 8, unit: 1 },
    ],
  });
  assert.deepEqual(r.singles.legs.map((l) => [l.action, l.reason]), [["skip", "odd_abaixo"], ["stake", null]]);
  assert.equal(r.singles.botao.totalReais, 20);
  await page.close();
});

test("bet365: placeReal clica em Fazer aposta uma vez e lê o comprovante", async () => {
  const page = await setup({ cards: CARDS, receipt: true });
  const task = {
    tipId: "g:4",
    placeReal: true,
    unitValueReais: 20,
    maxStakeReais: 50,
    legs: [
      { id: "a", match: "ATL Falcons x GB Packers", selection: "Mark Redman", odd: 16, unit: 0.5 },
      { id: "b", match: "ATL Falcons x GB Packers", selection: "Jahan Dotson", odd: 8, unit: 1 },
    ],
  };
  const r = await run(page, task);
  assert.deepEqual([r.aposta.clicked, r.aposta.confirmed, r.aposta.betId], [true, true, "BK123XYZ"]);
  assert.equal(await page.evaluate(() => window.__placeClicks), 1);
  await page.close();
});

test("bet365 login: modal aberto = deslogado; acha usuário, senha e Login (não Registre-se)", async () => {
  const page = await setup({ cards: CARDS, loggedIn: false, loginModal: true });
  const st = await page.evaluate(() => window.Bet365Login.status());
  assert.deepEqual([st.pronto, st.logado, st.sinal], [true, false, "modal de login"]);
  assert.deepEqual(await page.evaluate(() => window.Bet365Login.loginButtonPoint()), { jaAberto: true });
  const f = await page.evaluate(() => window.Bet365Login.fields());
  assert.equal(f.ok, true, JSON.stringify(f));
  const at = (p) =>
    page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el?.getAttribute("placeholder") ?? el?.closest("button")?.textContent.trim() ?? el?.tagName;
    }, p);
  assert.equal(await at((await page.evaluate(() => window.Bet365Login.targetPoint("usuario"))).ponto), "Usuário ou endereço de e-mail");
  assert.equal(await at((await page.evaluate(() => window.Bet365Login.targetPoint("senha"))).ponto), "Senha");
  assert.equal(await at((await page.evaluate(() => window.Bet365Login.targetPoint("enviar"))).ponto), "Login");
  await page.close();
});

test("bet365 login: saldo no bilhete = logado", async () => {
  const page = await setup({ cards: CARDS, loggedIn: true });
  const st = await page.evaluate(() => window.Bet365Login.status());
  assert.deepEqual([st.pronto, st.logado], [true, true]);
  assert.match(st.sinal, /saldo R\$202,67/);
  await page.close();
});
