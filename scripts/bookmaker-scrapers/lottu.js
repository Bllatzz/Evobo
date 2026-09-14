// Script pra rodar no CONSOLE do DevTools (F12 -> aba "Console"), logado
// normalmente na Lottu, na tela "Minhas Apostas" (histórico de apostas
// encerradas/em aberto).
//
// O ACORDEÃO de cada aposta só carrega o nome do jogo/mercado depois de
// expandido — o script clica sozinho em cada uma antes de ler (não precisa
// clicar em nada você mesmo). Se a tela tiver botão de "carregar mais" /
// paginação, o script também clica nisso antes de expandir.
//
// Nunca faz login nem guarda senha nenhuma — só lê e expande o que já está
// na tela. No fim, abre uma caixa na própria página com o JSON já
// selecionado — só apertar Ctrl+C (ou Cmd+C) e colar na tela "Importar
// apostas" do Evobo.
//
// Baseado nas classes CSS reais da página (user_bets__code, bet-item__status-*,
// my-bets__multiplier-value, user_bets__bet_value_content, bet-item__event-name,
// bet-item__custom-bet-title — confirmadas via HTML real da tela "Minhas
// Apostas"). Se a Lottu redesenhar a tela, essas classes podem mudar e o
// script vai precisar de ajuste — nesse caso, expande uma aposta na mão,
// copia o outerHTML do card e manda pro Evobo.
//
// "placedAt" usa a data/hora do JOGO (não existe hora exata de quando você
// apostou na tela) — o casamento do import tolera até 12h de diferença,
// então isso funciona bem na prática.

(async function scrapeLottu() {
  const STATUS_MAP = {
    open: "aberta",
    lost: "perdido",
    won: "ganha",
    void: "cancelado",
    cancel: "cancelado",
    cancelled: "cancelado",
    cashout: "cashout",
  };

  function brlToNumber(text) {
    const cleaned = (text || "").replace(/[^\d,.-]/g, "");
    return Number(cleaned.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));
  }

  function findEntries() {
    return [...document.querySelectorAll(".gradient-border.container-bets")];
  }

  async function expandAll() {
    for (const root of findEntries()) {
      const header = root.querySelector("mat-expansion-panel-header");
      if (!header) continue;
      if (header.getAttribute("aria-expanded") !== "true") {
        header.click();
        await new Promise((r) => setTimeout(r, 350));
      }
    }
  }

  function findLoadMoreButton() {
    return [...document.querySelectorAll("button")].find((b) => /mostrar mais|carregar mais|ver mais/i.test(b.textContent));
  }

  // Clica em "mostrar mais"/paginação até não sobrar mais nada pra carregar.
  for (let i = 0; i < 50; i++) {
    const btn = findLoadMoreButton();
    if (!btn) break;
    btn.click();
    await new Promise((r) => setTimeout(r, 900));
  }

  // Duas passadas: a primeira expande tudo, a segunda pega qualquer coisa
  // que só apareceu depois do primeiro lote de expansões terminar.
  await expandAll();
  await expandAll();

  function labeledValue(root, label) {
    const containers = root.querySelectorAll(".user_bets__bet_value_content, .user_bets__bonus-content");
    for (const c of containers) {
      const labelEl = c.querySelector("span");
      if (labelEl && labelEl.textContent.trim() === label) {
        const valueEl = c.querySelector(".user_bets__bet_value, .user_bets__bonus-value");
        return valueEl ? valueEl.textContent.trim() : null;
      }
    }
    return null;
  }

  function parseEntry(root) {
    const betNumber = root.querySelector(".user_bets__code")?.textContent.trim();

    const statusDot = root.querySelector('[class*="bet-item__status-"]');
    const statusClass = statusDot ? [...statusDot.classList].find((c) => c.startsWith("bet-item__status-")) : null;
    const statusKey = statusClass ? statusClass.replace("bet-item__status-", "") : null;
    const status = STATUS_MAP[statusKey] || "aberta";

    const oddText = root.querySelector(".my-bets__multiplier-value app-odd-value span")?.textContent.trim();
    const stakeText = labeledValue(root, "Aposta");

    const game = root.querySelector(".bet-item__event-name")?.textContent.trim() || null;
    const titleRaw = root.querySelector(".bet-item__custom-bet-title span")?.textContent.trim() || "";
    const selection = titleRaw
      .replace(/^Resposta:\s*/i, "")
      .replace(/\s*\([\d.,]+\)\s*$/, "")
      .trim();

    const infoSpans = [...root.querySelectorAll(".bet-item__info-content span")];
    const dateText = infoSpans.map((s) => s.textContent.trim()).find((t) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(t));
    const dm = dateText ? dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{2}):(\d{2})/) : null;

    if (!betNumber || !oddText || !stakeText || !dm) {
      console.warn("[lottu] aposta sem os campos esperados (talvez não tenha expandido), pulando:", root.textContent.trim().slice(0, 150));
      return null;
    }

    const [, dd, mm, yyyy, hh, min] = dm;
    const pad = (n) => String(n).padStart(2, "0");

    return {
      betNumber,
      status,
      placedAt: `${yyyy}-${pad(mm)}-${pad(dd)}T${pad(hh)}:${pad(min)}:00-03:00`,
      selection,
      game,
      odd: Number(oddText.replace(",", ".")),
      stakeReais: brlToNumber(stakeText),
    };
  }

  const seen = new Map();
  for (const root of findEntries()) {
    const bet = parseEntry(root);
    if (bet) seen.set(bet.betNumber, bet);
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

  console.log(`[lottu] ${bets.length} aposta(s) coletada(s).`);
  console.table(bets);
  return bets;
})();
