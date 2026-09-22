const test = require("node:test");
const assert = require("node:assert/strict");
const { planSingles, planMultiple } = require("../betano/plan.js");

const card = (selection, teams, odd, id) => ({ selection, market: "", teams, odd, stakeInputId: id });
const CORINTHIANS = card("Corinthians (F)", ["Corinthians", "Bahia"], 1.28, "s1");
const CRICIUMA = card("Mais de 0.5", ["Criciúma", "Operário-PR"], 1.27, "s2");

const baseTask = () => ({
  unitValueReais: 10,
  maxStakeReais: 50,
  legs: [
    { id: "a", match: "Corinthians x Bahia", selection: "Corinthians (F)", odd: 1.28, unit: 1 },
    { id: "b", match: "Criciúma x Operário-PR", selection: "Mais de 0.5 Criciúma - Total de Gols", odd: 1.27, unit: 1.5 },
  ],
  multiple: { odd: 1.62, unit: 2 },
});

test("odd igual à da tip: aposta, sem takeOdd", () => {
  const p = planSingles(baseTask(), { cards: [CORINTHIANS, CRICIUMA] });
  assert.equal(p.abort, null);
  assert.deepEqual(p.legs.map((l) => [l.action, l.stakeReais, l.takeOdd]), [["stake", 10, null], ["stake", 15, null]]);
  assert.equal(p.expectedTotalReais, 25);
});

test("odd maior que a da tip: aposta e devolve takeOdd com a odd real", () => {
  const c = { ...CORINTHIANS, odd: 1.32 };
  const p = planSingles(baseTask(), { cards: [c, CRICIUMA] });
  assert.equal(p.legs[0].action, "stake");
  assert.equal(p.legs[0].takeOdd, 1.32);
  assert.equal(p.legs[1].takeOdd, null);
});

test("odd menor numa perna: pula só ela e segue com as certas", () => {
  const c = { ...CORINTHIANS, odd: 1.25 };
  const p = planSingles(baseTask(), { cards: [c, CRICIUMA] });
  assert.deepEqual(p.legs.map((l) => [l.action, l.reason]), [["skip", "odd_abaixo"], ["stake", null]]);
  assert.equal(p.expectedTotalReais, 15);
});

test("odd muito acima da tip: aposta mesmo assim (nunca ignora por odd maior)", () => {
  const c = { ...CORINTHIANS, odd: 2.65 };
  const p = planSingles(baseTask(), { cards: [c, CRICIUMA] });
  assert.equal(p.legs[0].action, "stake");
  assert.equal(p.legs[0].takeOdd, 2.65);
});

test("cartões em ordem diferente da tip ainda casam pelo jogo/seleção", () => {
  const p = planSingles(baseTask(), { cards: [CRICIUMA, CORINTHIANS] });
  assert.deepEqual(p.legs.map((l) => l.cardIndex), [1, 0]);
});

test("direção errada (Menos vs Mais) não casa", () => {
  const menos = card("Menos de 0.5", ["Criciúma", "Operário-PR"], 1.27, "s2");
  const p = planSingles(baseTask(), { cards: [CORINTHIANS, menos] });
  assert.equal(p.legs[1].reason, "sem_cartao_correspondente");
});

test("número da linha diferente (8.5 vs 9.5) não casa", () => {
  const t = baseTask();
  t.legs = [{ id: "x", match: "Barracas x Independiente", selection: "Chutes no gol Menos de 8.5", odd: 1.65, unit: 1 }];
  const outra = card("Menos de 9.5", ["Barracas Central", "Independiente Rivadavia Mendoza"], 1.65, "s1");
  assert.equal(planSingles(t, { cards: [outra] }).legs[0].reason, "sem_cartao_correspondente");
  const certa = card("Menos de 8.5", ["Barracas Central", "Independiente Rivadavia Mendoza"], 1.65, "s1");
  assert.equal(planSingles(t, { cards: [certa] }).legs[0].action, "stake");
});

test("vírgula decimal na tip casa com ponto no bilhete", () => {
  const t = baseTask();
  t.legs = [{ id: "x", match: "Barracas x Independiente", selection: "Menos de 8,5 chutes no gol", odd: 1.65, unit: 1 }];
  const c = card("Menos de 8.5", ["Barracas Central", "Independiente Rivadavia Mendoza"], 1.65, "s1");
  assert.equal(planSingles(t, { cards: [c] }).legs[0].action, "stake");
});

test("contagem de seleções diferente da tip: aborta tudo", () => {
  const p = planSingles(baseTask(), { cards: [CORINTHIANS, CRICIUMA, card("Mais de 1.5", ["A", "B"], 2, "s3")] });
  assert.match(p.abort, /^contagem_diferente/);
  assert.equal(p.legs.length, 0);
});

test("limite da casa reduz a stake; teto de segurança recusa", () => {
  const t = baseTask();
  t.limitReais = 12;
  const p = planSingles(t, { cards: [CORINTHIANS, CRICIUMA] });
  assert.deepEqual(p.legs.map((l) => [l.stakeReais, l.limitApplied]), [[10, false], [12, true]]);
  const t2 = baseTask();
  t2.maxStakeReais = 12;
  const p2 = planSingles(t2, { cards: [CORINTHIANS, CRICIUMA] });
  assert.deepEqual(p2.legs.map((l) => [l.action, l.reason]), [["stake", null], ["skip", "acima_do_teto"]]);
});

test("sem teto de stake ou sem valor da unidade: aborta", () => {
  const a = baseTask();
  delete a.maxStakeReais;
  assert.equal(planSingles(a, { cards: [CORINTHIANS, CRICIUMA] }).abort, "sem_teto_de_stake");
  const b = baseTask();
  b.unitValueReais = 0;
  assert.equal(planSingles(b, { cards: [CORINTHIANS, CRICIUMA] }).abort, "sem_valor_da_unidade");
});

test("unidade da tip ausente: pula a perna", () => {
  const t = baseTask();
  t.legs[0].unit = null;
  const p = planSingles(t, { cards: [CORINTHIANS, CRICIUMA] });
  assert.equal(p.legs[0].reason, "sem_unidade");
});

test("múltipla: odd total abaixo da tip não aposta; igual/maior aposta", () => {
  const acc = (odd) => ({ accumulator: { label: "Dupla = 1", odd, stakeInputId: "m1" } });
  assert.deepEqual(planMultiple(baseTask(), acc(1.6)), { tipOdd: 1.62, realOdd: 1.6, action: "skip", reason: "odd_abaixo" });
  const ok = planMultiple(baseTask(), acc(1.62));
  assert.equal(ok.action, "stake");
  assert.equal(ok.stakeReais, 20);
  assert.equal(ok.takeOdd, null);
  assert.equal(planMultiple(baseTask(), acc(1.66)).takeOdd, 1.66);
});

test("múltipla: sem linha de múltipla na aba, ou tip sem múltipla", () => {
  assert.equal(planMultiple(baseTask(), { accumulator: null }).reason, "sem_multipla_na_aba");
  const t = baseTask();
  delete t.multiple;
  assert.equal(planMultiple(t, { accumulator: null }), null);
});

test("teste manual (sem texto, 1 perna, 1 seleção): usa a seleção do bilhete", () => {
  const task = { unitValueReais: 20, maxStakeReais: 50, legs: [{ id: "m", match: null, selection: null, odd: 2.12, unit: 1.5 }] };
  const abaixo = planSingles(task, { cards: [{ ...CORINTHIANS, odd: 2.05 }] });
  assert.deepEqual([abaixo.legs[0].action, abaixo.legs[0].reason], ["skip", "odd_abaixo"]);
  const ok = planSingles(task, { cards: [{ ...CORINTHIANS, odd: 2.12 }] });
  assert.deepEqual([ok.legs[0].action, ok.legs[0].stakeReais], ["stake", 30]);
});
