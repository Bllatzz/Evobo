// Decisão pura (sem DOM): dada a tip e o que o bilhete da Betano mostra agora,
// diz o que apostar, o que pular e por quê. Carrega como content script
// (root.BetanoPlan) e como módulo Node (testes) — mesmo arquivo.
//
// Regras do usuário (2026-09-21):
//  - odd real MENOR que a da tip → não aposta (sem exceção "até X mantém").
//  - odd real MAIOR → aposta, e devolve `takeOdd` pra gravar no take pessoal
//    (o registro oficial/admin continua com a odd da tip).
//  - tip com várias individuais: a perna com odd menor é ignorada, as certas
//    seguem. A múltipla é decidida à parte pela odd TOTAL dela.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BetanoPlan = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const cents = (n) => Math.round(Number(n) * 100);
  const round2 = (n) => Math.round(n * 100) / 100;
  const isNum = (n) => typeof n === "number" && Number.isFinite(n);

  function normalize(s) {
    return String(s ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/(\d),(\d)/g, "$1.$2")
      .replace(/[^a-z0-9.\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  const words = (s) => normalize(s).split(" ").filter((w) => w.length >= 3 && !/^\d/.test(w));
  const numbers = (s) => normalize(s).match(/\d+(?:\.\d+)?/g) ?? [];

  // 0 = não é esse cartão; maior = mais parecido. Exige time do jogo, os
  // números da seleção ("8.5") e a direção (mais/menos) batendo com a tip.
  function cardScore(leg, card) {
    const hay = normalize(`${leg.match ?? ""} ${leg.selection ?? ""}`);
    const hayWords = new Set(hay.split(" "));
    if (!card.teams.some((t) => words(t).some((w) => hay.includes(w)))) return 0;
    const nums = numbers(card.selection);
    if (nums.some((n) => !hayWords.has(n))) return 0;
    const dir = /\b(mais|menos)\b/.exec(normalize(card.selection));
    if (dir && !hayWords.has(dir[1])) return 0;
    const wordHits = words(card.selection).filter((w) => hay.includes(w)).length;
    return 1 + nums.length + wordHits;
  }

  function matchLegsToCards(legs, cards) {
    // Teste manual pelo popup (só link + odd + unidade, sem texto): com uma
    // perna e uma seleção no bilhete não há o que casar.
    if (legs.length === 1 && cards.length === 1 && !legs[0].match && !legs[0].selection) {
      return [{ cardIndex: 0, reason: null }];
    }
    const used = new Set();
    return legs.map((leg) => {
      const scored = cards
        .map((card, i) => ({ i, s: used.has(i) ? 0 : cardScore(leg, card) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s);
      if (!scored.length) return { cardIndex: null, reason: "sem_cartao_correspondente" };
      if (scored.length > 1 && scored[0].s === scored[1].s) return { cardIndex: null, reason: "cartao_ambiguo" };
      used.add(scored[0].i);
      return { cardIndex: scored[0].i, reason: null };
    });
  }

  // Odd acima da tip NUNCA é motivo pra não apostar (regra do usuário,
  // 2026-09-22) — só a odd abaixo barra.
  function decideOdd(tipOdd, realOdd) {
    if (!isNum(tipOdd)) return { ok: false, reason: "tip_sem_odd" };
    if (!isNum(realOdd)) return { ok: false, reason: "odd_ilegivel" };
    if (cents(realOdd) < cents(tipOdd)) return { ok: false, reason: "odd_abaixo" };
    return { ok: true, takeOdd: cents(realOdd) > cents(tipOdd) ? realOdd : null };
  }

  function stakeFor(unit, task) {
    if (!isNum(unit) || unit <= 0) return { ok: false, reason: "sem_unidade" };
    let stake = round2(unit * task.unitValueReais);
    let limitApplied = false;
    // Limite de aposta da casa (tip.limit): a stake cai pro limite, como o
    // Evobo já faz no take pessoal. O teto de segurança abaixo é outra coisa.
    if (isNum(task.limitReais) && task.limitReais > 0 && stake > task.limitReais) {
      stake = task.limitReais;
      limitApplied = true;
    }
    if (stake > task.maxStakeReais) return { ok: false, reason: "acima_do_teto" };
    return { ok: true, stake, limitApplied };
  }

  function checkTask(task) {
    if (!task || !Array.isArray(task.legs) || task.legs.length === 0) return "tip_sem_pernas";
    if (!isNum(task.unitValueReais) || task.unitValueReais <= 0) return "sem_valor_da_unidade";
    if (!isNum(task.maxStakeReais) || task.maxStakeReais <= 0) return "sem_teto_de_stake";
    return null;
  }

  // Aba Simples: uma decisão por perna, cada uma independente das outras.
  function planSingles(task, snapshot) {
    const bad = checkTask(task);
    if (bad) return { abort: bad, legs: [], expectedTotalReais: 0 };
    // Bilhete com sobra de outra aposta (ou faltando perna) não é o da tip.
    if (snapshot.cards.length !== task.legs.length) {
      return {
        abort: `contagem_diferente (tip tem ${task.legs.length}, bilhete tem ${snapshot.cards.length})`,
        legs: [],
        expectedTotalReais: 0,
      };
    }
    const matches = matchLegsToCards(task.legs, snapshot.cards);
    const legs = task.legs.map((leg, k) => {
      const base = { legId: leg.id ?? k, cardIndex: matches[k].cardIndex, tipOdd: leg.odd, realOdd: null };
      if (matches[k].cardIndex === null) return { ...base, action: "skip", reason: matches[k].reason };
      const realOdd = snapshot.cards[matches[k].cardIndex].odd;
      const odd = decideOdd(leg.odd, realOdd);
      if (!odd.ok) return { ...base, realOdd, action: "skip", reason: odd.reason };
      const stake = stakeFor(leg.unit, task);
      if (!stake.ok) return { ...base, realOdd, action: "skip", reason: stake.reason };
      return {
        ...base,
        realOdd,
        action: "stake",
        reason: null,
        stakeReais: stake.stake,
        limitApplied: stake.limitApplied,
        takeOdd: odd.takeOdd,
      };
    });
    const expectedTotalReais = round2(legs.reduce((s, l) => s + (l.action === "stake" ? l.stakeReais : 0), 0));
    return { abort: null, legs, expectedTotalReais };
  }

  // Aba Múltiplas: decide pela odd TOTAL da múltipla, não pelas pernas.
  function planMultiple(task, snapshot) {
    if (!task.multiple) return null;
    const bad = checkTask(task);
    if (bad) return { action: "skip", reason: bad };
    const acc = snapshot.accumulator;
    if (!acc || !acc.stakeInputId) return { action: "skip", reason: "sem_multipla_na_aba" };
    const odd = decideOdd(task.multiple.odd, acc.odd);
    const base = { tipOdd: task.multiple.odd, realOdd: acc.odd };
    if (!odd.ok) return { ...base, action: "skip", reason: odd.reason };
    const stake = stakeFor(task.multiple.unit, task);
    if (!stake.ok) return { ...base, action: "skip", reason: stake.reason };
    return {
      ...base,
      action: "stake",
      reason: null,
      stakeReais: stake.stake,
      limitApplied: stake.limitApplied,
      takeOdd: odd.takeOdd,
    };
  }

  return { planSingles, planMultiple, matchLegsToCards, decideOdd, stakeFor, normalize };
});
