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

  return { summarize, title, motivo, brl };
});
