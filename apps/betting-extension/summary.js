// Resumo de uma execução (o que a extensão fez com uma tip) em texto e
// status — o mesmo texto vai pro histórico do Evobo (POST
// /auto-betting/extension/runs) e pro popup ("último teste"). Carrega no
// service worker (importScripts), no popup (<script>) e no Node (testes).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EvoboSummary = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const brl = (n) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Texto que aparece no histórico do Evobo e no popup — curto, uma linha
  // por coisa (pedido do usuário, 2026-09-24):
  //   🔐 Estava deslogado — logou antes
  //   ✔ R$ 10,00 @ 4.2 (tip 4.14)
  //   💰 Apostou — comprovante ID: 21163180418
  // ou "❌ Ignorada: odd abaixo do enviado". Nada de tempos nem relatório.
  // O relatório completo continua indo junto (report), só não é mostrado.
  const MOTIVOS = {
    odd_abaixo: "odd abaixo do enviado",
    odd_ilegivel: "odd não encontrada no bilhete",
    sem_cartao_correspondente: "odd não encontrada no bilhete",
    cartao_ambiguo: "seleção ambígua no bilhete",
    acima_do_teto: "stake acima do teto",
    sem_unidade: "tip sem unidade",
    tip_sem_odd: "tip sem odd",
    sem_valor_da_unidade: "valor da unidade não definido no Evobo",
    tip_sem_odd_ou_unidade: "tip sem odd ou unidade",
    nao_sei_se_esta_logado: "não deu pra saber se a Betano está logada",
    pagina_nao_carregou: "a Betano não carregou",
    login_falhou: "não conseguiu logar na Betano",
    bilhete_nao_encontrado: "bilhete não abriu",
    aba_nao_respondeu: "a aba da Betano não respondeu",
    aba_simples_indisponivel: "bilhete não abriu",
    aba_multiplas_indisponivel: "aba Múltiplas indisponível",
    contagem_diferente: "bilhete diferente da tip",
    selecao_fora_da_tip: "bilhete diferente da tip",
    sem_multipla_na_aba: "múltipla não encontrada no bilhete",
    total_do_botao_diferente: "valor do bilhete não conferiu",
    mudou_antes_de_apostar: "odd mudou antes de apostar",
    stake_mudou: "valor mudou antes de apostar",
    botao_desabilitado: "botão de apostar desabilitado",
    clique_falhou: "o clique em apostar falhou",
    ja_clicado_antes: "já tinha sido apostada",
    bilhete_sumiu: "bilhete sumiu",
    cartao_sem_campo_de_stake: "seleção suspensa/bloqueada na Betano",
    simples_nao_foram_todas: "nem todas as simples foram apostadas",
    simples_sem_comprovante: "as simples não foram confirmadas",
    combo_sem_multipla_identificada: "não deu pra separar a múltipla das simples",
  };
  const codeOf = (m) => String(m ?? "").split(/[ (]/)[0];
  const motivo = (m) => MOTIVOS[codeOf(m)] ?? codeOf(m).replace(/_/g, " ");

  function linhaLogin(r) {
    if (codeOf(r.abort) === "login_falhou") return "🔐 Não conseguiu logar";
    if (r.login?.logouAntes) return "🔐 Estava deslogado — logou antes";
    if (r.login?.jaEstavaLogado) return "🔐 Já estava logado";
    return "";
  }

  function linhaAposta(a) {
    if (a.confirmed) return `💰 Apostou — comprovante ID: ${a.betId ?? "sem ID"}`;
    if (a.clicked) return "⚠️ Clicou em apostar mas o comprovante não apareceu — confira na Betano";
    return `❌ Não apostou: ${motivo(a.reason)}`;
  }

  // status: apostou | conferiu | pulou | abortou | verificar | erro
  // (os mesmos de AUTO_BET_RUN_STATUSES em @evobo/shared-types).
  function summarize(relatorio) {
    const r = relatorio;
    if (!r) return { status: "erro", texto: "❌ Erro: a aba da Betano não respondeu" };
    const linhas = [linhaLogin(r)];
    if (r.abort) {
      if (codeOf(r.abort) !== "login_falhou") linhas.push(`❌ Parou: ${motivo(r.abort)}`);
      return { status: "abortou", texto: linhas.filter(Boolean).join("\n") };
    }

    // Pernas ignoradas (odd abaixo, não achada…) — uma linha cada.
    const legs = r.multiplaPura ? [r.multiple].filter(Boolean) : (r.singles?.legs ?? []);
    // Turbinada que a extensão teve de ligar (ver ensureBoostOn em slip.js).
    if ((r.turbinada?.ligou ?? 0) + (r.turbinadaMultipla?.ligou ?? 0) > 0) linhas.push("⚡ Ligou a CA Turbinada");
    if ((r.turbinada?.falhou ?? 0) + (r.turbinadaMultipla?.falhou ?? 0) > 0) {
      const bloqueada = [...(r.turbinada?.detalhes ?? []), ...(r.turbinadaMultipla?.detalhes ?? [])].some((d) => d.bloqueado);
      linhas.push(`⚠️ Não conseguiu ligar a CA Turbinada${bloqueada ? " (bloqueada pela Betano)" : ""}`);
    }
    const pernas = r.multiplaPura ? " (múltipla)" : "";
    for (const l of legs) {
      linhas.push(
        l.action === "stake"
          ? `✔ R$ ${brl(l.stakeReais)} @ ${l.realOdd} (tip ${l.tipOdd})${pernas}`
          : `❌ Ignorada: ${motivo(l.reason)}`,
      );
    }
    // Múltipla de uma tip "simples + múltipla" (a pura já está em `legs`).
    const combo = !r.multiplaPura && r.multiple ? r.multiple : null;
    if (combo) {
      linhas.push(
        combo.action === "stake"
          ? `✔ Múltipla R$ ${brl(combo.stakeReais)} @ ${combo.realOdd} (tip ${combo.tipOdd})`
          : combo.action === "depois"
            ? ""
            : `❌ Múltipla ignorada: ${motivo(combo.reason)}`,
      );
    }
    const temStake = legs.some((l) => l.action === "stake");
    const naoConfere = (r.multiplaPura ? r.multiple?.totalConfere : r.singles?.totalConfere) === false;

    let status;
    if (r.aposta) {
      linhas.push(linhaAposta(r.aposta));
      if (r.apostaMultipla) linhas.push(linhaAposta(r.apostaMultipla).replace(/^(💰 Apostou|⚠️ Clicou em apostar|❌ Não apostou)/, "$1 a múltipla"));
      const apostas = [r.aposta, r.apostaMultipla].filter(Boolean);
      status = apostas.some((a) => a.clicked && !a.confirmed) ? "verificar" : r.aposta.confirmed ? "apostou" : r.aposta.clicked ? "verificar" : "pulou";
    } else if (!temStake) {
      status = "pulou";
    } else if (naoConfere) {
      linhas.push(`❌ Não apostou: ${MOTIVOS.total_do_botao_diferente}`);
      status = "pulou";
    } else if (r.dryRun) {
      linhas.push("👀 Só conferiu — não apostou");
      status = "conferiu";
    } else {
      status = "pulou";
    }
    return { status, texto: linhas.filter(Boolean).join("\n") };
  }

  // Título da tip pro histórico: "Jogo — seleção" ou o link.
  function title(task) {
    const legs = task?.legs ?? [];
    if (legs[0]?.match) return `${legs.map((l) => l.match).join(" + ")} — ${legs.map((l) => l.selection).join(" + ")}`.slice(0, 300);
    return task?.betUrl ?? null;
  }

  // Motivo curto pra coluna "Resultado" do histórico ("Pulado · odd caiu").
  const CURTO = {
    odd_abaixo: "odd caiu",
    mudou_antes_de_apostar: "odd mudou",
    acima_do_teto: "acima do teto",
    login_falhou: "sem login",
    nao_sei_se_esta_logado: "login incerto",
    pagina_nao_carregou: "casa não abriu",
    bilhete_nao_encontrado: "bilhete não abriu",
    aba_nao_respondeu: "aba não respondeu",
    tip_sem_odd_ou_unidade: "sem odd/unidade",
    sem_valor_da_unidade: "sem valor da unidade",
    sem_unidade: "sem unidade",
    contagem_diferente: "bilhete diferente",
    selecao_fora_da_tip: "bilhete diferente",
    sem_cartao_correspondente: "seleção não achada",
    cartao_ambiguo: "seleção ambígua",
    total_do_botao_diferente: "valor não conferiu",
    botao_desabilitado: "botão desabilitado",
    clique_falhou: "clique falhou",
    ja_clicado_antes: "já apostada",
    odd_ilegivel: "odd ilegível",
    tip_sem_odd: "tip sem odd",
  };
  const curto = (code) => (code ? (CURTO[String(code).split(/[ (]/)[0]] ?? String(code).split(/[ (]/)[0].replace(/_/g, " ")) : null);
  const numOrNull = (n) => (typeof n === "number" && Number.isFinite(n) ? n : null);

  // Colunas do histórico: grupo, odd da tip → odd pega, stake e motivo curto.
  function meta(task, relatorio) {
    const r = relatorio ?? {};
    let tipOdd = null;
    let realOdd = null;
    let stakeReais = null;
    let reason = null;
    if (r.multiplaPura && r.multiple) {
      tipOdd = numOrNull(r.multiple.tipOdd);
      realOdd = numOrNull(r.multiple.realOdd);
      stakeReais = r.multiple.action === "stake" ? numOrNull(r.multiple.stakeReais) : null;
      if (r.multiple.action !== "stake") reason = curto(r.multiple.reason);
    } else if (r.singles?.legs?.length) {
      const legs = r.singles.legs;
      const first = legs.find((l) => l.action === "stake") ?? legs[0];
      tipOdd = numOrNull(first.tipOdd);
      realOdd = numOrNull(first.realOdd);
      const staked = legs.filter((l) => l.action === "stake");
      stakeReais = staked.length ? staked.reduce((s, l) => s + (l.stakeReais ?? 0), 0) : null;
      if (stakeReais !== null && r.multiple?.action === "stake" && numOrNull(r.multiple.stakeReais) !== null) stakeReais += r.multiple.stakeReais;
      if (!staked.length) reason = curto(legs[0].reason);
    } else {
      tipOdd = numOrNull(task?.legs?.[0]?.odd);
    }
    if (r.abort) reason = curto(r.abort);
    else if (r.aposta && !r.aposta.clicked) reason = curto(r.aposta.reason);
    else if (r.singles?.totalConfere === false || r.multiple?.totalConfere === false) reason = reason ?? "valor não conferiu";
    return { groupName: task?.groupName ?? null, tipOdd, realOdd, stakeReais, reason };
  }

  return { summarize, title, meta, motivo, brl };
});
