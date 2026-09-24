// EXT_DIR: roda contra outra cópia da extensão (ex.: a ofuscada do build).
const EXT = process.env.EXT_DIR ?? require("node:path").join(__dirname, "..");
const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize, title } = require(`${EXT}/summary.js`);

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

test("texto curto, no formato do histórico", () => {
  // Exemplos do usuário (2026-09-24).
  assert.equal(summarize({ dryRun: false, login: { jaEstavaLogado: true }, singles: { legs: [skipLeg] } }).texto, "🔐 Já estava logado\n❌ Ignorada: odd abaixo do enviado");
  assert.equal(
    summarize({ dryRun: false, login: { jaEstavaLogado: true }, singles: { legs: [{ action: "skip", reason: "sem_cartao_correspondente" }] } }).texto,
    "🔐 Já estava logado\n❌ Ignorada: odd não encontrada no bilhete",
  );
  assert.equal(
    summarize({ dryRun: false, login: { logouAntes: true }, singles: { legs: [stakeLeg] }, aposta: { clicked: true, confirmed: true, betId: "21163180418" } }).texto,
    "🔐 Estava deslogado — logou antes\n✔ R$ 10,00 @ 2 (tip 2)\n💰 Apostou — comprovante ID: 21163180418",
  );
  assert.equal(summarize({ abort: "login_falhou (aba: aba_do_tipo_de_login_nao_encontrada)" }).texto, "🔐 Não conseguiu logar");
  assert.equal(summarize({ abort: "contagem_diferente (tip tem 1, bilhete tem 4)" }).texto, "❌ Parou: bilhete diferente da tip");
  // Nada de tempos no texto.
  const t = summarize({ dryRun: true, login: { jaEstavaLogado: true }, singles: { legs: [stakeLeg] } }).texto;
  assert.equal(t, "🔐 Já estava logado\n✔ R$ 10,00 @ 2 (tip 2)\n👀 Só conferiu — não apostou");
  assert.doesNotMatch(t, /⏱/);
});

test("título: jogo — seleção, senão o link", () => {
  assert.equal(title({ legs: [{ match: "A x B", selection: "Over 2.5" }] }), "A x B — Over 2.5");
  assert.equal(title({ betUrl: "https://x", legs: [{ match: null }] }), "https://x");
});

const { meta } = require(`${EXT}/summary.js`);

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

test("mostra quando ligou a CA Turbinada", () => {
  const t = summarize({ dryRun: true, login: { jaEstavaLogado: true }, turbinada: { vistas: 1, ligou: 1 }, singles: { legs: [stakeLeg] } }).texto;
  assert.equal(t, "🔐 Já estava logado\n⚡ Ligou a CA Turbinada\n✔ R$ 10,00 @ 2 (tip 2)\n👀 Só conferiu — não apostou");
});

test("avisa quando não conseguiu ligar a turbinada", () => {
  const t = summarize({ dryRun: true, login: { jaEstavaLogado: true }, turbinada: { vistas: 1, ligou: 0, falhou: 1, detalhes: [{ bloqueado: true }] }, singles: { legs: [stakeLeg] } }).texto;
  assert.match(t, /⚠️ Não conseguiu ligar a CA Turbinada \(bloqueada pela Betano\)/);
});
