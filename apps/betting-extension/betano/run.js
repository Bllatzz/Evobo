// Orquestra uma tip: abre o bilhete, decide com o plano e preenche as stakes.
// Em dry-run (padrão) PARA aí. Só com `task.placeReal === true` (chave
// "Apostar de verdade" no popup) clica em "APOSTE JÁ" — ver placeBet.
(function (root) {
  if (root.BetanoRun) return; // content script pode ser injetado mais de uma vez
  const { planSingles, planMultiple, planPureMultiple } = root.BetanoPlan;
  const S = root.BetanoSlip;

  const cents = (n) => Math.round(Number(n) * 100);

  // Preenche as stakes e espera o botão refletir o total esperado. Se a
  // Betano não aceitar o separador decimal usado, tenta a vírgula.
  async function fillAndVerify(fills, expectedTotal) {
    let decimal = ".";
    for (const attempt of [".", ","]) {
      decimal = attempt;
      for (const f of fills) f.result = S.setStake(f.inputId, f.reais, attempt);
      const ok = await S.waitFor(() => {
        const b = S.readSnapshot()?.placeButton;
        return b && b.totalReais !== null && cents(b.totalReais) === cents(expectedTotal);
      }, 1500);
      if (ok) return { totalConfere: true, decimal };
      if (!fills.some((f) => f.reais !== null && !Number.isInteger(f.reais))) break; // separador não importa
    }
    return { totalConfere: false, decimal };
  }

  // Clique real em "APOSTE JÁ", uma vez só por tip. Travas, na ordem:
  //  1. marca em sessionStorage por tip — se a aba recarregar ou o background
  //     repetir o pedido, nunca clica de novo (sobrevive a F5 na mesma aba);
  //  2. relê o bilhete e refaz o plano: se alguma odd caiu abaixo da tip ou a
  //     stake mudou desde o preenchimento, não clica;
  //  3. o botão tem que estar habilitado e mostrar exatamente o total esperado
  //     (pega aposta grátis/prêmio selecionado e stake digitada errada);
  //  4. depois do clique espera o comprovante; sem comprovante = "verificar
  //     manualmente", e NUNCA tenta de novo.
  async function placeBet(task, expectedTotal, replan) {
    const mark = `evobo-aposta:${task.tipId}`;
    try {
      if (sessionStorage.getItem(mark)) return { clicked: false, reason: "ja_clicado_antes" };
    } catch {
      return { clicked: false, reason: "sem_sessionStorage" };
    }
    const snap = S.readSnapshot();
    const changed = snap ? replan(snap) : "bilhete_sumiu";
    if (changed) return { clicked: false, reason: changed };
    const b = snap.placeButton;
    const btn = document.querySelector('[data-qa="place-bet-button"]');
    if (!btn || !b || b.disabled) return { clicked: false, reason: "botao_desabilitado" };
    if (b.totalReais === null || cents(b.totalReais) !== cents(expectedTotal)) {
      return { clicked: false, reason: "total_do_botao_diferente", botao: b };
    }
    try {
      sessionStorage.setItem(mark, new Date().toISOString());
    } catch {
      return { clicked: false, reason: "sem_sessionStorage" };
    }
    const click = await S.trustedClick(btn, "aposte_ja");
    // Clique confiável que falhou (ex.: DevTools aberto na aba): não houve
    // clique, mas a marca fica — melhor perder a tip que apostar duas vezes.
    if (!click?.ok) return { clicked: false, reason: "clique_falhou", erro: click?.erro ?? null };
    const receipt = await S.waitFor(() => S.readReceipt(), 20000, 200);
    if (!receipt) return { clicked: true, confirmed: false, mensagens: S.readSlipMessages() };
    return { clicked: true, confirmed: true, receipt, betId: receipt.betIds[0] ?? null };
  }

  async function runTask(task) {
    const real = task?.placeReal === true;
    const report = {
      dryRun: !real,
      nadaFoiApostado: true,
      tipId: task?.tipId ?? null,
      startedAt: new Date().toISOString(),
      ok: false,
      abort: null,
      singles: null,
      multiple: null,
    };

    if (!(await S.ensureSlipOpen())) {
      return { ...report, abort: "bilhete_nao_encontrado", debug: { ...S.slipOpenDebug, url: location.href } };
    }
    if (!(await S.selectTab(1))) return { ...report, abort: "aba_simples_indisponivel" };

    const snapS = S.readSnapshot();

    // Tip que é uma múltipla só (1 tip, N seleções no bilhete): nada na aba
    // Simples, stake única na aba Múltiplas.
    const pure = planPureMultiple(task, snapS);
    if (pure) {
      report.multiplaPura = true;
      if (pure.abort) return { ...report, abort: pure.abort };
      for (const c of snapS.cards) if (c.stakeInputId) S.setStake(c.stakeInputId, null);
      if (!(await S.selectTab(2))) return { ...report, abort: "aba_multiplas_indisponivel" };
      const snapM = S.readSnapshot();
      const plan = planMultiple({ ...task, multiple: pure.multiple }, snapM);
      report.multiple = { ...plan, legId: pure.multiple.id, pernas: pure.legs };
      if (plan.action === "stake") {
        const v = await fillAndVerify([{ inputId: snapM.accumulator.stakeInputId, reais: plan.stakeReais }], plan.stakeReais);
        report.multiple.totalConfere = v.totalConfere;
        report.multiple.decimalUsado = v.decimal;
        report.multiple.botao = S.readSnapshot()?.placeButton ?? null;
        if (real && v.totalConfere) {
          report.aposta = await placeBet(task, plan.stakeReais, (snap) => {
            const again = planMultiple({ ...task, multiple: pure.multiple }, snap);
            if (again.action !== "stake") return `mudou_antes_de_apostar (${again.reason})`;
            if (cents(again.stakeReais) !== cents(plan.stakeReais)) return "stake_mudou";
            report.multiple.realOdd = again.realOdd;
            report.multiple.takeOdd = again.takeOdd;
            return null;
          });
          if (report.aposta.clicked) report.nadaFoiApostado = false;
        }
      }
      report.ok = true;
      return report;
    }

    const singles = planSingles(task, snapS);
    report.singles = singles;
    if (singles.abort) return { ...report, abort: singles.abort };

    // Zera o que sobrou de antes e preenche só as pernas aprovadas.
    const fills = snapS.cards
      .filter((c) => c.stakeInputId)
      .map((c) => ({ inputId: c.stakeInputId, reais: null }));
    for (const leg of singles.legs) {
      if (leg.action === "stake") fills[leg.cardIndex].reais = leg.stakeReais;
    }
    for (const f of fills) S.setStake(f.inputId, null);
    if (singles.expectedTotalReais > 0) {
      const v = await fillAndVerify(fills, singles.expectedTotalReais);
      singles.totalConfere = v.totalConfere;
      singles.decimalUsado = v.decimal;
      singles.botao = S.readSnapshot()?.placeButton ?? null;
      // Combo simples + múltipla precisaria apostar as simples, reabrir o
      // bilhete e ir pra aba Múltiplas — ainda não feito: aí fica em dry-run.
      if (real && !task.multiple && v.totalConfere) {
        report.aposta = await placeBet(task, singles.expectedTotalReais, (snap) => {
          const again = planSingles(task, snap);
          if (again.abort) return `mudou_antes_de_apostar (${again.abort})`;
          for (const [k, leg] of singles.legs.entries()) {
            const now = again.legs[k];
            if (leg.action !== now.action) return `mudou_antes_de_apostar (${now.reason ?? "perna_nova"})`;
            if (leg.action === "stake" && cents(leg.stakeReais) !== cents(now.stakeReais)) return "stake_mudou";
          }
          for (const [k, now] of again.legs.entries()) Object.assign(singles.legs[k], { realOdd: now.realOdd, takeOdd: now.takeOdd });
          return null;
        });
        if (report.aposta.clicked) report.nadaFoiApostado = false;
      }
    }

    // Múltipla: aba própria, decidida pela odd total dela.
    if (task.multiple) {
      if (!(await S.selectTab(2))) {
        report.multiple = { action: "skip", reason: "aba_multiplas_indisponivel" };
      } else {
        const snapM = S.readSnapshot();
        const plan = planMultiple(task, snapM);
        report.multiple = plan;
        if (plan.action === "stake") {
          const v = await fillAndVerify([{ inputId: snapM.accumulator.stakeInputId, reais: plan.stakeReais }], plan.stakeReais);
          plan.totalConfere = v.totalConfere;
          plan.decimalUsado = v.decimal;
          plan.botao = S.readSnapshot()?.placeButton ?? null;
        }
      }
    }

    report.ok = true;
    return report;
  }

  root.BetanoRun = { runTask };

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, send) => {
      if (msg?.acao !== "rodar_dry_run") return;
      runTask(msg.task).then(send, (e) => send({ ok: false, abort: "erro", erro: String(e?.message ?? e) }));
      return true; // resposta assíncrona
    });
  }
})(typeof self !== "undefined" ? self : this);
