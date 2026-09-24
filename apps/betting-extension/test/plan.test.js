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

// Múltipla pura — mensagem real que abortou em 2026-09-23 (CALL #1171).
const { planPureMultiple, legsInMessage } = require("../betano/plan.js");
const RAW_1171 = `⚽ MÚLTIPLA de 4 jogos

1️⃣ Oud-Heverlee Leuven x Roma
 • Menos de 3.5 total de cartões
2️⃣ Servette FC Chenois x Lyon
 • Menos de 2.5 total de cartões
3️⃣ Barcelona F x Paris FC F
 • Menos de 2.5 total de cartões
4️⃣ Chelsea LFC x Áustria Viena
 • Menos de 2.5 total de cartões

💰 0,5u @ 8,61
🔗 Betano`;
const CARDS_1171 = [
  card("Menos de 3.5", ["OH Leuven", "Roma"], 1.8, "m1"),
  card("Menos de 2.5", ["Servette Chenois", "Lyon"], 1.55, "m2"),
  card("Menos de 2.5", ["Barcelona", "Paris FC"], 1.75, "m3"),
  card("Menos de 2.5", ["Chelsea", "Austria Viena"], 1.76, "m4"),
];
const task1171 = () => ({
  unitValueReais: 10,
  maxStakeReais: 50,
  rawMessage: RAW_1171,
  legs: [{ id: "x", match: "Oud-Heverlee Leuven x Roma", selection: "Menos de 3.5 total de cartões Menos de 2.5 total de cartões Menos de 2.5 total de cartões Menos de 2.5 total de cartões", odd: 8.61, unit: 0.5 }],
});

test("legsInMessage: lê 'MÚLTIPLA de N' e ignora 'N jogos' fora da linha da múltipla", () => {
  assert.equal(legsInMessage(RAW_1171), 4);
  assert.equal(legsInMessage("🎯 Múltipla de 2\n 💰 0,5u @ 8,56"), 2);
  assert.equal(legsInMessage("Over 2.5 — time marcou nos últimos 5 jogos"), null);
});

test("múltipla pura: 1 tip + 4 seleções vira aposta na aba Múltiplas com a odd/unidade da tip", () => {
  const p = planPureMultiple(task1171(), { cards: CARDS_1171 });
  assert.equal(p.abort, null);
  assert.equal(p.legs, 4);
  assert.deepEqual(p.multiple, { id: "x", odd: 8.61, unit: 0.5 });
  const m = planMultiple({ ...task1171(), multiple: p.multiple }, { accumulator: { odd: 8.61, stakeInputId: "acc" } });
  assert.deepEqual([m.action, m.stakeReais, m.takeOdd], ["stake", 5, null]);
});

test("múltipla pura: bilhete ainda montando (2 de 4) aborta com contagem", () => {
  const p = planPureMultiple(task1171(), { cards: CARDS_1171.slice(0, 2) });
  assert.equal(p.abort, "contagem_diferente (tip tem 4, bilhete tem 2)");
});

test("múltipla pura: seleção que não está na tip aborta", () => {
  const cards = [...CARDS_1171.slice(0, 3), card("Mais de 8.5", ["Flamengo", "Vasco"], 1.9, "m9")];
  const p = planPureMultiple(task1171(), { cards });
  assert.match(p.abort, /^selecao_fora_da_tip/);
});

test("múltipla pura: odd total menor que a da tip não aposta", () => {
  const p = planPureMultiple(task1171(), { cards: CARDS_1171 });
  const m = planMultiple({ ...task1171(), multiple: p.multiple }, { accumulator: { odd: 8.4, stakeInputId: "acc" } });
  assert.deepEqual([m.action, m.reason], ["skip", "odd_abaixo"]);
});

test("tip simples (1 perna, 1 seleção, sem 'múltipla' no texto) não entra no modo múltipla", () => {
  const t = { unitValueReais: 10, maxStakeReais: 50, rawMessage: "Corinthians (F) @1.28 1u", legs: [baseTask().legs[0]] };
  assert.equal(planPureMultiple(t, { cards: [CORINTHIANS] }), null);
});

test("tip com +N / -N casa com 'Mais de' / 'Menos de' do bilhete", () => {
  const { matchLegsToCards } = require("../betano/plan.js");
  const leg = { match: "Holanda x Alemanha", selection: "+0.5 HT +2.5 Gols -4.5 Cards" };
  const over = card("Mais de 0.5", ["Holanda", "Alemanha"], 1.5, "x1");
  assert.equal(matchLegsToCards([leg], [over])[0].cardIndex, 0);
  const under = card("Menos de 4.5", ["Holanda", "Alemanha"], 1.5, "x2");
  assert.equal(matchLegsToCards([leg], [under])[0].cardIndex, 0);
  // Direção trocada continua não batendo.
  const wrong = card("Menos de 0.5", ["Holanda", "Alemanha"], 1.5, "x3");
  const legOnlyOver = { match: "Holanda x Alemanha", selection: "+0.5 HT" };
  assert.equal(matchLegsToCards([legOnlyOver], [wrong])[0].cardIndex, null);
});
