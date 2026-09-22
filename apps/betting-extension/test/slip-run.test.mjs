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
