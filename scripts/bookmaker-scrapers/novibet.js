// Script pra rodar no CONSOLE do DevTools (F12 -> aba "Console"), logado
// normalmente na Novibet, na tela de histórico de apostas
// ("Minha Conta" -> "Histórico de Apostas" / bet-history).
//
// Antes de rodar: escolha o período no seletor do topo (ex.: "30 dias", ou
// um intervalo de datas customizado) — o script só lê o que já carregou na
// tela, e clica sozinho em "Mostrar mais" até não sobrar mais nada pra
// carregar naquele período.
//
// Nunca faz login nem guarda senha nenhuma — só lê o que já está na tela.
// No fim, abre uma caixa na própria página com o JSON já selecionado — só
// apertar Ctrl+C (ou Cmd+C) e colar na tela "Importar apostas" do Evobo.
//
// Baseado nas classes CSS reais da página (app-bet-history-item,
// betHistorySingle_*, betHistoryItem_* p/ combinadas "Accumulator",
// betHistoryBetbuilder_* p/ "Criador de Aposta" — confirmadas via "Copiar
// outerHTML" de cards reais). Se a Novibet redesenhar a tela, essas classes
// podem mudar e o script vai precisar de ajuste — nesse caso, copia o
// outerHTML de um card de novo e manda pro Evobo.
//
// Combinadas (Accumulator) só trazem o jogo de cada perna quando o card já
// está expandido (clique em "N Seleções") — se não estiver expandido, o
// script ainda coleta odd/stake/resultado/seleções, só que sem o nome dos
// times (game fica null e o import cai no casamento por texto, menos
// preciso). "Criador de Aposta" (betbuilder) é sempre um jogo só, esse
// sempre vem certo.

(async function scrapeNovibet() {
  function classStatus(rootEl) {
    if (!rootEl) return "aberta";
    const cl = rootEl.classList;
    if (cl.contains("won")) return "ganha";
    if (cl.contains("lost")) return "perdido";
    if (cl.contains("void") || cl.contains("cancelled") || cl.contains("canceled") || cl.contains("cancelado")) return "cancelado";
    if (cl.contains("cashout")) return "cashout";
    return "aberta";
  }

  function brlToNumber(text) {
    const cleaned = (text || "").replace(/[^\d,.-]/g, "");
    // tira ponto de milhar (ponto seguido de exatamente 3 dígitos), só depois troca a vírgula decimal por ponto
    return Number(cleaned.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));
  }

  // Extrai seleção+jogo de UM single-card (usado tanto pra aposta simples
  // quanto pra cada perna de uma combinada expandida).
  function parseLeg(el) {
    const caption = el.querySelector(".betHistorySingle_predictionCaption")?.textContent?.trim() || "";
    const description = (el.querySelector(".betHistorySingle_description")?.textContent || "").replace(/🚀/g, "").trim();
    const selection = [caption, description].filter(Boolean).join(" - ");
    const matchText = el.querySelector(".betEventDetails_competitorsCaptionContainer")?.textContent?.replace(/\s+/g, " ").trim();
    return { selection, game: matchText || null };
  }

  function parseItem(itemEl) {
    const betIdText = [...itemEl.querySelectorAll("[data-nov]")]
      .map((e) => e.textContent.trim())
      .find((t) => t.startsWith("#"));
    const betNumber = betIdText ? betIdText.replace("#", "") : null;

    const dateText = itemEl.querySelector(".betsItemHeaderInfo_dateTime")?.textContent?.trim() ?? "";
    const dm = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})/);

    const singleCard = itemEl.querySelector("app-bet-history-item-single-card");
    const multipleCard = itemEl.querySelector("app-bet-history-item-multiple-card");
    const betbuilderCard = itemEl.querySelector("app-bet-history-item-betbuilder-card");
    const cardEl = singleCard || multipleCard || betbuilderCard;

    if (!cardEl || !betNumber || !dm) {
      console.warn("[novibet] item sem número/data/card reconhecível, pulando:", itemEl.textContent.trim().slice(0, 150));
      return null;
    }

    const oddText = cardEl.querySelector("sb-bets-price .price_text")?.textContent?.trim();
    const stakeText = cardEl.querySelector('[class*="_stakeValue"]')?.textContent?.trim();

    let status, selection, game;

    if (singleCard) {
      status = classStatus(cardEl.querySelector(".betHistorySingle_selection"));
      ({ selection, game } = parseLeg(cardEl));
    } else if (multipleCard) {
      status = classStatus(cardEl.querySelector(".betHistoryItem_selection"));
      const expandedLegs = [...cardEl.querySelectorAll(".betHistoryItem_marketsFull app-bet-history-item-single-card")];
      if (expandedLegs.length > 0) {
        const legs = expandedLegs.map(parseLeg);
        selection = legs.map((l) => l.selection).join(" | ");
        game = legs.map((l) => l.game).filter(Boolean).join(" - ") || null;
      } else {
        const captions = [...cardEl.querySelectorAll(".betItemSummary_predictionCaption")]
          .map((s) => s.textContent.trim())
          .filter(Boolean);
        selection = captions.join(" | ");
        game = null;
      }
    } else {
      // Criador de Aposta (betbuilder) — um jogo só, várias seleções nele.
      status = classStatus(cardEl.querySelector(".betHistoryBetbuilder_selection"));
      const captions = [...cardEl.querySelectorAll(".betItemSummary_predictionCaption")]
        .map((s) => s.textContent.trim())
        .filter(Boolean);
      selection = captions.join(" | ");
      const matchText = cardEl.querySelector(".betEventDetails_competitorsCaptionContainer")?.textContent?.replace(/\s+/g, " ").trim();
      game = matchText || null;
    }

    if (!oddText || !stakeText) {
      console.warn("[novibet] item sem odd/valor, pulando:", itemEl.textContent.trim().slice(0, 150));
      return null;
    }

    const [, dd, mm, yyyy, hh, min, ss] = dm;
    const pad = (n) => String(n).padStart(2, "0");

    return {
      betNumber,
      status,
      placedAt: `${yyyy}-${pad(mm)}-${pad(dd)}T${pad(hh)}:${pad(min)}:${pad(ss)}-03:00`,
      selection: selection || "",
      game,
      odd: Number(oddText.replace(",", ".")),
      stakeReais: brlToNumber(stakeText),
    };
  }

  function collectVisible(seen) {
    for (const itemEl of document.querySelectorAll("app-bet-history-item")) {
      const bet = parseItem(itemEl);
      if (bet) seen.set(bet.betNumber, bet);
    }
  }

  function findLoadMoreButton() {
    return [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Mostrar mais"));
  }

  const seen = new Map();
  collectVisible(seen);

  // "Mostrar mais" só acrescenta itens na mesma lista (sem paginação de
  // verdade) — clica até o botão sumir ou a contagem parar de crescer.
  for (let i = 0; i < 100; i++) {
    const btn = findLoadMoreButton();
    if (!btn) break;
    const before = seen.size;
    btn.click();
    await new Promise((r) => setTimeout(r, 900));
    collectVisible(seen);
    if (seen.size === before && !findLoadMoreButton()) break;
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

  console.log(`[novibet] ${bets.length} aposta(s) coletada(s).`);
  console.table(bets);
  return bets;
})();
