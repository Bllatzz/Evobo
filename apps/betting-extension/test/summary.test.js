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
