// Resumo de uma execução (o que a extensão fez com uma tip) em texto e
// status — o mesmo texto vai pro histórico do Evobo (POST
// /auto-betting/extension/runs) e pro popup ("último teste"). Carrega no
// service worker (importScripts), no popup (<script>) e no Node (testes).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EvoboSummary = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const brl = (n) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const MOTIVOS = {
    odd_abaixo: "odd menor que a da tip",
    odd_ilegivel: "não consegui ler a odd",
    sem_cartao_correspondente: "seleção não encontrada no bilhete",
    cartao_ambiguo: "seleção ambígua no bilhete",
    acima_do_teto: "stake acima do teto",
    sem_unidade: "tip sem unidade",
    sem_valor_da_unidade: "valor da unidade não definido no Evobo",
    tip_sem_odd_ou_unidade: "a tip ficou sem odd/unidade (a leitura da foto não completou)",
    nao_sei_se_esta_logado: "não deu pra saber se a Betano está logada",
    pagina_nao_carregou: "a página da Betano não carregou",
  };
  const motivo = (m) => MOTIVOS[m] ?? m;

  function linhaLogin(l) {
    if (!l) return "";
    if (l.logouAntes) return "🔐 Estava deslogado — logou antes\n";
    if (l.jaEstavaLogado) return "🔐 Já estava logado\n";
    return "";
  }

  function linhaAposta(a) {
    if (!a) return "";
    if (a.confirmed) return `\n💰 Apostou — comprovante ${a.betId ?? "sem ID"}`;
    if (a.clicked) return `\n⚠ Clicou em APOSTE JÁ mas o comprovante não apareceu — verificar na Betano${a.mensagens?.length ? ` (${a.mensagens.join(" | ")})` : ""}`;
    return `\n✘ Não clicou: ${motivo(a.reason)}${a.erro ? ` (${a.erro})` : ""}`;
  }

  function linhaTempos(t) {
    if (!t) return "";
    const ocr = t.esperouOcrS > 0 ? `, ${t.esperouOcrS}s esperando a foto` : "";
    return `\n⏱ aba aberta ${t.mensagemAteAbaS}s depois da mensagem${ocr}; resolvido em ${t.abaAteFimS ?? "?"}s`;
  }

  function linhasPlano(r) {
    const naoApostou = r.dryRun ? " — stake preenchida, não apostou" : "";
    const naoConfere = "\n⚠ o total do botão da Betano NÃO confere com a stake";
    if (r.multiplaPura) {
      const m = r.multiple;
      return m?.action === "stake"
        ? { temStake: true, texto: `✔ Múltipla de ${m.pernas}: R$ ${brl(m.stakeReais)} @ ${m.realOdd} (tip ${m.tipOdd})${naoApostou}${m.totalConfere === false ? naoConfere : ""}` }
        : { temStake: false, texto: `✘ Múltipla ignorada: ${motivo(m?.reason)} (tip ${m?.tipOdd}, Betano ${m?.realOdd ?? "?"})` };
    }
    const legs = r.singles?.legs ?? [];
    return {
      temStake: legs.some((l) => l.action === "stake"),
      texto: legs
        .map((l) =>
          l.action === "stake"
            ? `✔ R$ ${brl(l.stakeReais)} @ ${l.realOdd} (tip ${l.tipOdd})${naoApostou}${r.singles.totalConfere === false ? naoConfere : ""}`
            : `✘ Ignorada: ${motivo(l.reason)} (tip ${l.tipOdd}, Betano ${l.realOdd ?? "?"})`,
        )
        .join("\n"),
    };
  }

  // status: apostou | conferiu | pulou | abortou | verificar | erro
  // (os mesmos de AUTO_BET_RUN_STATUSES em @evobo/shared-types).
  function summarize(relatorio, tempos) {
    const r = relatorio;
    if (!r) return { status: "erro", texto: "a aba da Betano não respondeu" };
    if (r.abort) {
      const [code, ...rest] = String(r.abort).split(" ");
      return { status: "abortou", texto: `✘ Parou: ${motivo(code)}${rest.length ? ` ${rest.join(" ")}` : ""}` };
    }
    const plano = linhasPlano(r);
    const texto = linhaLogin(r.login) + plano.texto + linhaAposta(r.aposta) + linhaTempos(tempos);
    if (r.aposta?.confirmed) return { status: "apostou", texto };
    if (r.aposta?.clicked) return { status: "verificar", texto };
    if (r.aposta) return { status: "pulou", texto };
    if (!plano.temStake) return { status: "pulou", texto };
    return { status: r.dryRun ? "conferiu" : "pulou", texto };
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
