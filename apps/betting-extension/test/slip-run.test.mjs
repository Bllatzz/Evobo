import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installFakeBetslip } from "./fake-betslip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "betano");
const CARDS = [
  { selection: "Corinthians (F)", market: "Resultado Final", teams: ["Corinthians", "Bahia"], odd: 1.28 },
  { selection: "Mais de 0.5", market: "Criciúma - Total de Gols", teams: ["Criciúma", "Operário-PR"], odd: 1.27 },
];
const TASK = () => ({
  tipId: "t1",
  unitValueReais: 10,
  maxStakeReais: 50,
  legs: [
    { id: "a", match: "Corinthians x Bahia", selection: "Corinthians (F)", odd: 1.28, unit: 1 },
    { id: "b", match: "Criciúma x Operário-PR", selection: "Mais de 0.5 Criciúma - Total de Gols", odd: 1.27, unit: 2 },
  ],
  multiple: { odd: 1.62, unit: 2 },
});

let browser;
test.before(async () => {
  browser = await chromium.launch();
});
test.after(async () => {
  await browser.close();
});

async function setup(fake) {
  const page = await browser.newPage();
  // Origem de verdade (servida localmente pelo Playwright, sem rede): em
  // about:blank o sessionStorage lança erro e o placeBet se recusa a clicar.
  await page.route("https://fake.betano.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.goto("https://fake.betano.test/");
  await installFakeBetslip(page, fake);
  for (const f of ["plan.js", "slip.js", "run.js"]) await page.addScriptTag({ path: join(root, f) });
  return page;
}
const run = (page, task) => page.evaluate((t) => window.BetanoRun.runTask(t), task);

test("lê o snapshot das duas abas", async () => {
  const page = await setup({ cards: CARDS, accOdd: 1.62 });
  const s = await page.evaluate(() => window.BetanoSlip.readSnapshot());
  assert.equal(s.tab, "simples");
  assert.equal(s.cards.length, 2);
  assert.deepEqual(s.cards[0], { selection: "Corinthians (F)", market: "Resultado Final", teams: ["Corinthians", "Bahia"], odd: 1.28, stakeInputId: "stakeInput_1:SGL:0" });
  assert.equal(s.placeButton.disabled, true);
  await page.evaluate(() => window.BetanoSlip.selectTab(2));
  const m = await page.evaluate(() => window.BetanoSlip.readSnapshot());
  assert.equal(m.tab, "multiplas");
  assert.equal(m.accumulator.odd, 1.62);
});

test("parseBRL", async () => {
  const page = await setup({ cards: CARDS, accOdd: 1.62 });
  const out = await page.evaluate(() => ["R$20,00", "R$1.234,50", "R$20", "APOSTE JÁ R$32,51", "sem valor"].map((t) => window.BetanoSlip.parseBRL(t)));
  assert.deepEqual(out, [20, 1234.5, 20, 32.51, null]);
});

test("dry-run feliz: preenche as duas simples e a múltipla, e nunca clica em apostar", async () => {
  const page = await setup({ cards: CARDS, accOdd: 1.62 });
  const r = await run(page, TASK());
  assert.equal(r.ok, true);
  assert.equal(r.nadaFoiApostado, true);
  assert.deepEqual(r.singles.legs.map((l) => [l.action, l.stakeReais]), [["stake", 10], ["stake", 20]]);
  assert.equal(r.singles.totalConfere, true);
  assert.equal(r.singles.botao.totalReais, 30);
  assert.equal(r.multiple.action, "stake");
  assert.equal(r.multiple.totalConfere, true);
  assert.equal(r.multiple.botao.totalReais, 20);
  assert.equal(await page.evaluate(() => window.__placeClicks), 0);
});

test("odd menor numa perna: só a outra é preenchida; múltipla abaixo da tip é pulada", async () => {
  const cards = [{ ...CARDS[0], odd: 1.25 }, CARDS[1]];
  const page = await setup({ cards, accOdd: 1.59 });
  const r = await run(page, TASK());
  assert.deepEqual(r.singles.legs.map((l) => [l.action, l.reason]), [["skip", "odd_abaixo"], ["stake", null]]);
  assert.equal(r.singles.botao.totalReais, 20);
  assert.equal(r.multiple.action, "skip");
  assert.equal(r.multiple.reason, "odd_abaixo");
  assert.equal(await page.evaluate(() => window.__placeClicks), 0);
});

test("odd maior: aposta e reporta takeOdd", async () => {
  const cards = [{ ...CARDS[0], odd: 1.31 }, CARDS[1]];
  const page = await setup({ cards, accOdd: 1.66 });
  const r = await run(page, TASK());
  assert.equal(r.singles.legs[0].takeOdd, 1.31);
  assert.equal(r.multiple.takeOdd, 1.66);
});

test("bilhete com seleção a mais aborta sem preencher nada", async () => {
  const cards = [...CARDS, { selection: "Mais de 1.5", market: "X", teams: ["Outro", "Time"], odd: 2 }];
  const page = await setup({ cards, accOdd: 1.62 });
  const r = await run(page, TASK());
  assert.match(r.abort, /^contagem_diferente/);
  const vals = await page.evaluate(() => [...document.querySelectorAll("input[data-qa='stake-area']")].map((i) => i.value));
  assert.deepEqual(vals, ["", "", ""]);
});

test("stake com centavos: usa a vírgula quando a Betano não entende o ponto", async () => {
  const page = await setup({ cards: CARDS, accOdd: 1.62, decimal: "," });
  const task = TASK();
  task.legs[0].unit = 1.25; // R$12,50
  const r = await run(page, task);
  assert.equal(r.singles.decimalUsado, ",");
  assert.equal(r.singles.totalConfere, true);
  assert.equal(r.singles.botao.totalReais, 32.5);
});

test("múltipla pura: preenche só a aba Múltiplas e não clica em apostar", async () => {
  const cards = [
    { selection: "Menos de 3.5", market: "Total de Cartões", teams: ["OH Leuven", "Roma"], odd: 1.8 },
    { selection: "Menos de 2.5", market: "Total de Cartões", teams: ["Servette Chenois", "Lyon"], odd: 1.55 },
    { selection: "Menos de 2.5", market: "Total de Cartões", teams: ["Barcelona", "Paris FC"], odd: 1.75 },
    { selection: "Menos de 2.5", market: "Total de Cartões", teams: ["Chelsea", "Austria Viena"], odd: 1.76 },
  ];
  const page = await setup({ cards, accOdd: 8.7 });
  const r = await run(page, {
    tipId: "t1171",
    unitValueReais: 10,
    maxStakeReais: 50,
    rawMessage:
      "⚽ MÚLTIPLA de 4 jogos\n1️⃣ Oud-Heverlee Leuven x Roma\n • Menos de 3.5 total de cartões\n2️⃣ Servette FC Chenois x Lyon\n • Menos de 2.5 total de cartões\n3️⃣ Barcelona F x Paris FC F\n • Menos de 2.5 total de cartões\n4️⃣ Chelsea LFC x Áustria Viena\n • Menos de 2.5 total de cartões\n💰 0,5u @ 8,61",
    legs: [{ id: "x", match: "Oud-Heverlee Leuven x Roma", selection: "Menos de 3.5 total de cartões", odd: 8.61, unit: 0.5 }],
  });
  assert.equal(r.abort, null);
  assert.equal(r.multiplaPura, true);
  assert.equal(r.singles, null);
  assert.deepEqual([r.multiple.action, r.multiple.stakeReais, r.multiple.takeOdd, r.multiple.totalConfere], ["stake", 5, 8.7, true]);
  assert.equal(await page.evaluate(() => window.__placeClicks), 0);
  await page.close();
});

// Apostar de verdade (placeReal) — sempre no bilhete FALSO.
const MULTI_CARDS = [
  { selection: "Menos de 3.5", market: "Total de Cartões", teams: ["OH Leuven", "Roma"], odd: 1.8 },
  { selection: "Menos de 2.5", market: "Total de Cartões", teams: ["Servette Chenois", "Lyon"], odd: 1.55 },
];
const MULTI_TASK = (extra = {}) => ({
  tipId: "grp:1171",
  unitValueReais: 10,
  maxStakeReais: 50,
  rawMessage: "⚽ MÚLTIPLA de 2 jogos\n1️⃣ Oud-Heverlee Leuven x Roma\n • Menos de 3.5 total de cartões\n2️⃣ Servette FC Chenois x Lyon\n • Menos de 2.5 total de cartões\n💰 0,5u @ 2,79",
  legs: [{ id: "x", match: "Oud-Heverlee Leuven x Roma", selection: "Menos de 3.5 total de cartões", odd: 2.79, unit: 0.5 }],
  ...extra,
});

test("placeReal: clica uma vez, lê o comprovante e não clica de novo na mesma aba", async () => {
  const page = await setup({ cards: MULTI_CARDS, accOdd: 2.79, receipt: true });
  const r = await run(page, MULTI_TASK({ placeReal: true }));
  assert.equal(r.dryRun, false);
  assert.equal(r.nadaFoiApostado, false);
  assert.deepEqual([r.aposta.clicked, r.aposta.confirmed, r.aposta.betId], [true, true, "BET123"]);
  assert.equal(await page.evaluate(() => window.__placeClicks), 1);

  // Mesmo pedido de novo (ex.: background repetiu): a marca impede o 2º clique.
  await installFakeBetslip(page, { cards: MULTI_CARDS, accOdd: 2.79, receipt: true });
  const r2 = await run(page, MULTI_TASK({ placeReal: true }));
  assert.equal(r2.aposta.clicked, false);
  assert.equal(r2.aposta.reason, "ja_clicado_antes");
  assert.equal(await page.evaluate(() => window.__placeClicks), 0);
  await page.close();
});

test("placeReal: sem comprovante vira 'verificar manualmente' (clicou, não confirmado)", async () => {
  const page = await setup({ cards: MULTI_CARDS, accOdd: 2.79, receipt: false });
  const r = await run(page, MULTI_TASK({ placeReal: true, tipId: "grp:sem-recibo" }));
  assert.deepEqual([r.aposta.clicked, r.aposta.confirmed], [true, false]);
  assert.equal(await page.evaluate(() => window.__placeClicks), 1);
  await page.close();
});

test("placeReal: odd total abaixo da tip não clica", async () => {
  const page = await setup({ cards: MULTI_CARDS, accOdd: 2.5, receipt: true });
  const r = await run(page, MULTI_TASK({ placeReal: true, tipId: "grp:odd-baixa" }));
  assert.equal(r.multiple.action, "skip");
  assert.equal(r.aposta, undefined);
  assert.equal(await page.evaluate(() => window.__placeClicks), 0);
  await page.close();
});

test("placeReal: simples com odd maior apostam e devolvem a odd real", async () => {
  const page = await setup({ cards: [{ ...CARDS[0], odd: 1.3 }, CARDS[1]], accOdd: 1.62, receipt: true });
  const { multiple, ...task } = TASK();
  const r = await run(page, { ...task, tipId: "grp:simples", placeReal: true });
  assert.equal(r.aposta.confirmed, true);
  assert.deepEqual(r.singles.legs.map((l) => [l.action, l.realOdd, l.takeOdd]), [["stake", 1.3, 1.3], ["stake", 1.27, null]]);
  assert.equal(await page.evaluate(() => window.__placeClicks), 1);
  await page.close();
});

test("sem placeReal continua dry-run: nunca clica", async () => {
  const page = await setup({ cards: MULTI_CARDS, accOdd: 2.79, receipt: true });
  const r = await run(page, MULTI_TASK({ tipId: "grp:dry" }));
  assert.equal(r.dryRun, true);
  assert.equal(r.aposta, undefined);
  assert.equal(await page.evaluate(() => window.__placeClicks), 0);
  await page.close();
});

// Bug real de 2026-09-23: 3 simples, só uma stake ficou no bilhete.
test("simples: Betano que grava a stake com atraso não perde os campos anteriores", async () => {
  const cards = [
    { selection: "Natasha Andonova 3+", market: "Chutes", teams: ["Servette FC Chenois", "Lyon"], odd: 21 },
    { selection: "Natasha Andonova 2+", market: "Chutes", teams: ["Servette FC Chenois", "Lyon"], odd: 9.5 },
    { selection: "Natasha Andonova 1+", market: "Chutes", teams: ["Servette FC Chenois", "Lyon"], odd: 2.6 },
  ];
  const page = await setup({ cards, accOdd: 518.7, debounceMs: 120 });
  const r = await run(page, {
    tipId: "grp:andonova",
    unitValueReais: 10,
    maxStakeReais: 50,
    legs: [
      { id: "a", match: "Servette FC Chenois x Lyon", selection: "Natasha Andonova 3+ chutes", odd: 21, unit: 0.5 },
      { id: "b", match: "Servette FC Chenois x Lyon", selection: "Natasha Andonova 2+ chutes", odd: 9.5, unit: 1 },
      { id: "c", match: "Servette FC Chenois x Lyon", selection: "Natasha Andonova 1+ chutes", odd: 2.6, unit: 2 },
    ],
  });
  assert.equal(r.abort, null);
  assert.deepEqual(r.singles.legs.map((l) => l.stakeReais), [5, 10, 20]);
  assert.equal(r.singles.totalConfere, true, JSON.stringify(r.singles.campos));
  assert.equal(r.singles.botao.totalReais, 35);
  await page.close();
});

// Bug real de 2026-09-23: "20% Super Turbinada" — o cartão mostra a odd
// original (2.02, odds-ticker-enhanced) E a turbinada (2.42, odds-ticker-solid).
test("super turbinada: lê a odd turbinada, não a original, e aposta", async () => {
  const cards = [{ selection: "Barcelona (F)", market: "Resultado do 1° Tempo", teams: ["Barcelona (F)", "Paris FC (F)"], odd: 2.42, oddOriginal: 2.02 }];
  const page = await setup({ cards, accOdd: 2.42 });
  const snap = await page.evaluate(() => window.BetanoSlip.readSnapshot());
  assert.equal(snap.cards[0].odd, 2.42);
  const r = await run(page, {
    tipId: "grp:bonmati",
    unitValueReais: 10,
    maxStakeReais: 50,
    legs: [{ id: "a", match: "Barcelona (F) x Paris FC (F)", selection: "Barcelona vencer o primeiro tempo + 4 gols na partida + Aitana Bonmati 2 sot.", odd: 2.42, unit: 1 }],
  });
  assert.deepEqual(r.singles.legs.map((l) => [l.action, l.realOdd, l.reason]), [["stake", 2.42, null]]);
  await page.close();
});
