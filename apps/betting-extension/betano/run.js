// Orquestra um dry-run: abre o bilhete, decide com o plano, preenche as stakes
// e PARA — nunca clica em "APOSTE JÁ". Devolve um relatório do que faria e o
// que a Betano mostrou (texto do botão, total), que é o dado que falta pra
// fase 2 (ex.: se o total do botão da aba Simples soma as stakes).
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

  async function runTask(task) {
    const report = {
      dryRun: true, // fase 1: sempre. task.dryRun=false é ignorado.
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
