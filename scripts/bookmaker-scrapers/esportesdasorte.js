// Script pra rodar no CONSOLE do DevTools (F12 -> aba "Console"), logado
// normalmente na Esportes da Sorte, na tela:
//   https://esportesdasorte.bet.br/ptb/dashboard/account-activity/bet-history
// Antes de rodar: clique "Últimos 7 Dias" e depois na aba "Todos".
//
// Nunca faz login nem guarda senha nenhuma — só lê o que já está na tela.
// No fim, copia um JSON pra área de transferência (usando `copy()`, um
// helper que só existe dentro do console do Chrome/Edge) — é só colar na
// tela "Importar apostas" do Evobo.
//
// Baseado só em texto visível (nunca em nome de classe CSS, que qualquer
// atualização do site pode trocar) — se a Esportes da Sorte mudar o layout,
// ou se algum card vier com um formato inesperado, esse script provavelmente
// vai precisar de ajuste. Rode e, se der pouco ou nenhum resultado, mande
// o erro do console (ou o HTML de um card via botão direito -> Inspecionar
// -> Copiar -> Copiar elemento) que a gente ajusta junto.

(async function scrapeEsportesDaSorte() {
  const STATUS_MAP = { ABERTA: "aberta", GANHA: "ganha", PERDIDO: "perdido", CASHOUT: "cashout", CANCELADO: "cancelado" };
  const STATUSES = Object.keys(STATUS_MAP);
  const IGNORED_LINES = new Set(["SIMPLES", "MÚLTIPLA", "COMBINADA", "Ver mais detalhes", ...STATUSES]);

  function findCardElements() {
    // Acha cada nó de texto "Número da aposta:" e sobe até o ancestral que
    // TAMBÉM contém "Aposta Total:" — isso é o card inteiro de uma aposta,
    // sem depender de classe CSS nenhuma.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const candidates = new Set();
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.includes("Número da aposta:")) {
        let el = node.parentElement;
        while (el && !el.innerText.includes("Aposta Total:")) el = el.parentElement;
        if (el) candidates.add(el);
      }
    }
    // Ancestrais mais externos também batem (contêm o mesmo texto duas
    // vezes) — fica só com o card mais interno de cada grupo.
    return [...candidates].filter((el) => ![...candidates].some((other) => other !== el && el.contains(other)));
  }

  function parseCard(el) {
    const text = el.innerText;
    const statusKey = STATUSES.find((s) => text.includes(s));
    const betNumberMatch = text.match(/Número da aposta:\s*(\d+)/);
    const dateMatch = text.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/);
    const stakeMatch = text.match(/Aposta Total:\s*R\$\s*([\d.,]+)/);
    if (!statusKey || !betNumberMatch || !dateMatch || !stakeMatch) {
      console.warn("[esportesdasorte] card sem os campos esperados, pulando:", text.slice(0, 120));
      return null;
    }

    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter(
        (l) =>
          !IGNORED_LINES.has(l) &&
          !l.startsWith("Número da aposta") &&
          !l.startsWith("Aposta Total") &&
          !l.startsWith("Ganhos potenciais") &&
          !l.startsWith("Valor Pago") &&
          !/^\d{2}-\d{2}-\d{4}/.test(l),
      );

    // 1ª linha de conteúdo = seleção (com "(Era X.XX)" e a odd real coladas
    // no fim); 2ª linha = jogo(s) — confirmado nos prints reais.
    const selectionLine = lines[0] ?? "";
    const gameLine = lines[1] ?? null;

    const oddMatch = selectionLine.match(/([\d]+[.,]\d+)\s*$/);
    if (!oddMatch) {
      console.warn("[esportesdasorte] não achei a odd no fim da linha de seleção:", selectionLine);
      return null;
    }
    const selection = selectionLine
      .replace(/\(Era\s*[\d.,]+\)/i, "")
      .replace(/[\d]+[.,]\d+\s*$/, "")
      .trim();

    const [, dd, mm, yyyy, hh, min] = dateMatch;
    return {
      betNumber: betNumberMatch[1],
      status: STATUS_MAP[statusKey],
      placedAt: `${yyyy}-${mm}-${dd}T${hh}:${min}:00-03:00`,
      selection,
      game: gameLine,
      odd: Number(oddMatch[1].replace(",", ".")),
      stakeReais: Number(stakeMatch[1].replace(/\./g, "").replace(",", ".")),
    };
  }

  function collectVisible(seen) {
    for (const el of findCardElements()) {
      const bet = parseCard(el);
      if (bet) seen.set(bet.betNumber, bet);
    }
  }

  function findPageButton(n) {
    return [...document.querySelectorAll("button, a")].find((b) => b.textContent.trim() === String(n));
  }

  const seen = new Map();
  collectVisible(seen);

  // Pagina clicando 2, 3, 4... até o número não existir mais nos botões de
  // paginação — pra depois de mudar de página, espera um pouco o conteúdo
  // atualizar antes de coletar de novo.
  for (let page = 2; page <= 50; page++) {
    const btn = findPageButton(page);
    if (!btn) break;
    btn.click();
    await new Promise((r) => setTimeout(r, 900));
    collectVisible(seen);
  }

  const bets = [...seen.values()];
  console.log(`[esportesdasorte] ${bets.length} aposta(s) coletada(s).`);
  console.table(bets);

  const json = JSON.stringify(bets);
  try {
    copy(json); // helper do console do Chrome/Edge — não existe fora do DevTools
    console.log("JSON copiado pra área de transferência — é só colar na tela 'Importar apostas' do Evobo.");
  } catch {
    console.log("Não consegui copiar sozinho — copie o JSON abaixo manualmente:");
    console.log(json);
  }
  return bets;
})();
