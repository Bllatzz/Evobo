// Orquestra uma tip na Bet365: abre o bilhete, passa pra "Simples e
// Múltiplas", decide com o plano (betano/plan.js, o mesmo da Betano) e
// preenche as stakes. Relatório no mesmo formato do BetanoRun, então o
// background, o resumo e o histórico do Evobo servem igual.
//
// Diferente da Betano: no modo "Simples e Múltiplas" as simples (um campo
// por seleção) e a múltipla (campo do rodapé) ficam no MESMO bilhete, e um
// "Fazer aposta" só aposta tudo junto.
//
// Clique em "Fazer aposta" só com task.placeReal === true — e o background
// ainda não manda placeReal pra Bet365 (BET365_REAL_ENABLED) até o fluxo
// ser validado no site real.
(function (root) {
  if (root.Bet365Run) return;
  const { planSingles, planMultiple, planPureMultiple } = root.BetanoPlan;
  const S = root.Bet365Slip;

  const cents = (n) => Math.round(Number(n) * 100);
  const round2 = (n) => Math.round(n * 100) / 100;

  // Um campo por vez, com pausa (mesma lição da Betano: preencher em rajada
  // perdia valores) e conferência do que ficou.
  async function fillAll(fills) {
    const campos = [];
    for (const f of fills) {
      const r = await S.setStake(f.inputId, f.reais);
      await S.sleep(400);
      campos.push({ inputId: f.inputId, esperado: r.value, valor: S.stakeValue(f.inputId), ok: r.ok, erro: r.erro });
    }
    return campos;
  }

  async function waitTotal(expected) {
    const ok = await S.waitFor(() => {
      const b = S.readSnapshot()?.placeButton;
      return b && b.totalReais !== null && cents(b.totalReais) === cents(expected);
    }, 3000, 200);
    return !!ok;
  }

  // Clique real em "Fazer aposta" (ou "aceitar mudança + fazer aposta"),
  // uma vez só por tip — mesmas travas do placeBet da Betano.
  async function placeBet(task, expectedTotal) {
    const mark = `evobo-aposta:${task.tipId}`;
    try {
      if (sessionStorage.getItem(mark)) return { clicked: false, reason: "ja_clicado_antes" };
    } catch {
      return { clicked: false, reason: "sem_sessionStorage" };
    }
    const b = S.readSnapshot()?.placeButton;
    if (!b || b.disabled) return { clicked: false, reason: "botao_desabilitado" };
    if (b.totalReais === null || cents(b.totalReais) !== cents(expectedTotal)) return { clicked: false, reason: "total_do_botao_diferente", botao: b };
    const btn = [...document.querySelectorAll(".bsf-AcceptButton, .bsf-PlaceBetButton")].find((el) => el.offsetParent && !el.closest(".Hidden") && !/_Disabled/.test(el.className));
    if (!btn) return { clicked: false, reason: "botao_desabilitado" };
    try {
      sessionStorage.setItem(mark, new Date().toISOString());
    } catch {
      return { clicked: false, reason: "sem_sessionStorage" };
    }
    const click = await S.trustedClick(btn, "fazer_aposta");
    if (!click?.ok) return { clicked: false, reason: "clique_falhou", erro: click?.erro ?? null };
    const receipt = await S.waitFor(() => S.readReceipt(), 20000, 250);
    if (!receipt) return { clicked: true, confirmed: false, mensagens: S.readSlipMessages() };
    return { clicked: true, confirmed: true, receipt, betId: receipt.betIds[0] ?? null };
  }

  async function runTask(task) {
    const real = task?.placeReal === true;
    const report = { casa: "bet365", dryRun: !real, nadaFoiApostado: true, tipId: task?.tipId ?? null, startedAt: new Date().toISOString(), ok: false, abort: null, singles: null, multiple: null };

    if (!(await S.ensureSlipOpen())) return { ...report, abort: "bilhete_nao_encontrado", debug: { url: location.href } };

    // Seleções do mesmo jogo vêm em "Criar Aposta" — passa pra "Simples e
    // Múltiplas" (pedido do usuário, 2026-09-24).
    report.modo = await S.ensureSinglesMode();
    if (report.modo.erro) return { ...report, abort: `modo_do_bilhete (${report.modo.erro})` };
    if (S.readSnapshot()?.cards.length >= 2) report.expandiuMultiplas = await S.expandOtherMultiples();

    const snap = S.readSnapshot();
    const fills = [];
    let expectedTotal = 0;

    const pure = planPureMultiple(task, snap);
    if (pure) {
      report.multiplaPura = true;
      if (pure.abort) return { ...report, abort: pure.abort };
      const plan = planMultiple({ ...task, multiple: pure.multiple }, snap);
      report.multiple = { ...plan, legId: pure.multiple.id, pernas: pure.legs };
      if (plan.action === "stake") {
        fills.push({ inputId: "multipla", reais: plan.stakeReais });
        expectedTotal = plan.stakeReais;
      }
    } else {
      const singles = planSingles(task, snap);
      report.singles = singles;
      if (singles.abort) return { ...report, abort: singles.abort };
      for (const leg of singles.legs) if (leg.action === "stake") fills.push({ inputId: snap.cards[leg.cardIndex].stakeInputId, reais: leg.stakeReais });
      expectedTotal = singles.expectedTotalReais;
      if (task.multiple) {
        const plan = planMultiple(task, snap);
        report.multiple = plan;
        if (plan.action === "stake") {
          fills.push({ inputId: "multipla", reais: plan.stakeReais });
          expectedTotal = round2(expectedTotal + plan.stakeReais);
        }
      }
    }

    if (fills.length) {
      const campos = await fillAll(fills);
      const confere = await waitTotal(expectedTotal);
      const botao = S.readSnapshot()?.placeButton ?? null;
      const target = report.multiplaPura ? report.multiple : report.singles;
      Object.assign(target, { totalConfere: confere, campos, botao });
      if (report.multiplaPura && confere && botao?.retornoReais) {
        // Odd real da múltipla pelo que a Bet365 calculou.
        const realOdd = round2(botao.retornoReais / report.multiple.stakeReais);
        report.multiple.realOdd = realOdd;
        if (cents(realOdd) < cents(report.multiple.tipOdd)) {
          Object.assign(report.multiple, { action: "skip", reason: "odd_abaixo" });
          report.ok = true;
          return report;
        }
        report.multiple.takeOdd = cents(realOdd) > cents(report.multiple.tipOdd) ? realOdd : null;
      }
      if (real && confere) {
        report.aposta = await placeBet(task, expectedTotal);
        if (report.aposta.clicked) report.nadaFoiApostado = false;
      }
    }

    report.ok = true;
    return report;
  }

  root.Bet365Run = { runTask };

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, send) => {
      if (msg?.acao !== "rodar_dry_run") return;
      runTask(msg.task).then(send, (e) => send({ ok: false, abort: "erro", erro: String(e?.message ?? e) }));
      return true;
    });
  }
})(typeof self !== "undefined" ? self : this);
