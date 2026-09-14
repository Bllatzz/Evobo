// Script pra rodar no CONSOLE do DevTools (F12 -> aba "Console"), logado
// normalmente na Esportes da Sorte, na tela:
//   https://esportesdasorte.bet.br/ptb/dashboard/account-activity/bet-history
// Antes de rodar: clique "Últimos 7 Dias" e depois na aba "Todos".
//
// Nunca faz login nem guarda senha nenhuma — só lê o que já está na tela.
// No fim, abre uma caixa na própria página com o JSON já selecionado — só
// apertar Ctrl+C (ou Cmd+C) e colar na tela "Importar apostas" do Evobo.
//
// Baseado nas classes CSS reais da página (bet-info-container, bet-id,
// bet-date, selection, played-odd, match-market, total-stake-value —
// confirmadas via "Inspecionar elemento" num card real). Se a Esportes da
// Sorte redesenhar a tela, essas classes podem mudar e o script vai
// precisar de ajuste — nesse caso, inspeciona um card de novo e manda o
// HTML.

(async function scrapeEsportesDaSorte() {
  const STATUS_MAP = { ABERTA: "aberta", GANHA: "ganha", PERDIDO: "perdido", CASHOUT: "cashout", CANCELADO: "cancelado" };
  const STATUSES = Object.keys(STATUS_MAP);

  function findCardElements() {
    return [...document.querySelectorAll(".bet-info-container")];
  }

  function parseCard(el) {
    const statusText = el.querySelector(".bet-state span")?.textContent?.trim().toUpperCase();
    const statusKey = STATUSES.find((s) => s === statusText);

    const betIdText = el.querySelector(".bet-id")?.textContent ?? "";
    const betNumberMatch = betIdText.match(/(\d+)/);

    const dateText = el.querySelector(".bet-date")?.textContent?.trim() ?? "";
    const dateMatch = dateText.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/);

    const stakeText = el.querySelector(".total-stake-value")?.textContent ?? "";
    const stakeMatch = stakeText.match(/([\d.,]+)/);

    const oddText = el.querySelector(".played-odd")?.textContent?.trim();

    if (!statusKey || !betNumberMatch || !dateMatch || !stakeMatch || !oddText) {
      console.warn("[esportesdasorte] card sem os campos esperados, pulando:", el.textContent.trim().slice(0, 150));
      return null;
    }

    // Uma seleção só na maioria das apostas — combinadas às vezes trazem
    // mais de um bloco ".selection"/".match-market", junta todos.
    const selection = [...el.querySelectorAll(".selection")]
      .map((s) => s.textContent.replace(/\(Era\s*[\d.,]+\)/i, "").trim())
      .filter(Boolean)
      .join("\n");
    const game = [...el.querySelectorAll(".match-market")].map((s) => s.textContent.trim()).filter(Boolean).join(" - ") || null;

    const [, dd, mm, yyyy, hh, min] = dateMatch;
    return {
      betNumber: betNumberMatch[1],
      status: STATUS_MAP[statusKey],
      placedAt: `${yyyy}-${mm}-${dd}T${hh}:${min}:00-03:00`,
      selection,
      game,
      // Essa casa usa formato americano (ponto decimal, "R$ 35.00"), não o
      // brasileiro (vírgula decimal) — só tira vírgula de milhar, se tiver.
      odd: Number(oddText.replace(/,/g, "")),
      stakeReais: Number(stakeMatch[1].replace(/,/g, "")),
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
  // paginação — espera o conteúdo atualizar antes de coletar de novo.
  for (let page = 2; page <= 50; page++) {
    const btn = findPageButton(page);
    if (!btn) break;
    btn.click();
    await new Promise((r) => setTimeout(r, 900));
    collectVisible(seen);
  }

  const bets = [...seen.values()];
  const json = JSON.stringify(bets);

  document.getElementById("__evobo_import_box")?.remove();
  const box = document.createElement("div");
  box.id = "__evobo_import_box";
  box.style.cssText =
    "position:fixed;inset:5%;z-index:999999;background:#111;color:#fff;padding:16px;border-radius:10px;" +
    "box-shadow:0 0 30px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:10px;font-family:sans-serif;";
  const label = document.createElement("div");
  label.style.cssText = "font-size:14px;";
  label.textContent = `${bets.length} aposta(s) coletada(s) — já selecionado, aperte Ctrl+C (ou Cmd+C) e cole no Evobo.`;
  const textarea = document.createElement("textarea");
  textarea.value = json;
  textarea.style.cssText = "flex:1;width:100%;font-family:monospace;font-size:12px;padding:8px;";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Fechar";
  closeBtn.style.cssText = "align-self:flex-end;padding:6px 14px;cursor:pointer;";
  closeBtn.onclick = () => box.remove();
  box.append(label, textarea, closeBtn);
  document.body.appendChild(box);
  textarea.focus();
  textarea.select();

  console.log(`[esportesdasorte] ${bets.length} aposta(s) coletada(s).`);
  console.table(bets);
  return bets;
})();
