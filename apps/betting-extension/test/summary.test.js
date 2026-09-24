const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize, title } = require("../summary.js");

// status tem que ser um dos AUTO_BET_RUN_STATUSES (@evobo/shared-types) — a API recusa outro.
const STATUSES = ["apostou", "conferiu", "pulou", "abortou", "verificar", "erro"];

const stakeLeg = { action: "stake", stakeReais: 10, realOdd: 2, tipOdd: 2 };
const skipLeg = { action: "skip", reason: "odd_abaixo", realOdd: 1.8, tipOdd: 2 };

test("status de cada desfecho", () => {
  const cases = [
    [null, "erro"],
    [{ abort: "login_falhou (aba: x)" }, "abortou"],
    [{ dryRun: true, singles: { legs: [stakeLeg] } }, "conferiu"],
    [{ dryRun: true, singles: { legs: [skipLeg] } }, "pulou"],
    [{ dryRun: false, singles: { legs: [stakeLeg] }, aposta: { clicked: true, confirmed: true, betId: "B1" } }, "apostou"],
    [{ dryRun: false, singles: { legs: [stakeLeg] }, aposta: { clicked: true, confirmed: false } }, "verificar"],
    [{ dryRun: false, singles: { legs: [stakeLeg] }, aposta: { clicked: false, reason: "total_do_botao_diferente" } }, "pulou"],
    [{ dryRun: false, multiplaPura: true, multiple: { action: "stake", pernas: 4, stakeReais: 5, realOdd: 8.61, tipOdd: 8.61 }, aposta: { clicked: true, confirmed: true } }, "apostou"],
  ];
  for (const [r, want] of cases) {
    const s = summarize(r, null);
    assert.equal(s.status, want, JSON.stringify(r));
    assert.ok(STATUSES.includes(s.status));
    assert.ok(s.texto.length > 0);
  }
});

test("texto traduz o motivo e mostra login/tempos", () => {
  const s = summarize({ dryRun: true, login: { logouAntes: true }, singles: { legs: [skipLeg] } }, { mensagemAteAbaS: 3, esperouOcrS: 0, abaAteFimS: 6 });
  assert.match(s.texto, /logou antes/);
  assert.match(s.texto, /odd menor que a da tip/);
  assert.match(s.texto, /aba aberta 3s/);
});

test("título: jogo — seleção, senão o link", () => {
  assert.equal(title({ legs: [{ match: "A x B", selection: "Over 2.5" }] }), "A x B — Over 2.5");
  assert.equal(title({ betUrl: "https://x", legs: [{ match: null }] }), "https://x");
});

const { meta } = require("../summary.js");

test("meta: colunas do histórico (grupo, odds, stake, motivo curto)", () => {
  const task = { groupName: "VIP Gols", legs: [{ odd: 2 }] };
  assert.deepEqual(meta(task, { dryRun: false, singles: { legs: [stakeLeg] }, aposta: { clicked: true, confirmed: true } }), {
    groupName: "VIP Gols", tipOdd: 2, realOdd: 2, stakeReais: 10, reason: null,
  });
  assert.equal(meta(task, { dryRun: true, singles: { legs: [skipLeg] } }).reason, "odd caiu");
  assert.equal(meta(task, { abort: "login_falhou (aba: aba_do_tipo_de_login_nao_encontrada)" }).reason, "sem login");
  assert.equal(meta(task, { abort: "contagem_diferente (tip tem 1, bilhete tem 4)" }).reason, "bilhete diferente");
  assert.equal(meta(task, { singles: { legs: [stakeLeg] }, aposta: { clicked: false, reason: "total_do_botao_diferente" } }).reason, "valor não conferiu");
  const m = meta(task, { multiplaPura: true, multiple: { action: "stake", tipOdd: 8.61, realOdd: 8.7, stakeReais: 5 } });
  assert.deepEqual([m.tipOdd, m.realOdd, m.stakeReais], [8.61, 8.7, 5]);
});
