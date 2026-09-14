// Script pra rodar no CONSOLE do DevTools (F12 -> aba "Console"), logado
// normalmente na Betano, na tela "Histórico de Apostas".
//
// A lista da Betano é um scroller VIRTUAL (só o que está visível fica no
// DOM, o resto é reciclado) — o script rola a lista sozinho, coletando aos
// poucos, até não sobrar mais nada pra carregar. Não precisa rolar você
// mesmo nem clicar em nada.
//
// A Betano tem DUAS abas ("Em aberto" / "Liquidada") — o script só lê a
// aba que estiver selecionada no momento. Se quiser as duas, roda uma vez
// em cada aba e cola os dois JSONs (ou cola separado, o import aceita
// várias rodadas sem duplicar).
//
// Nunca faz login nem guarda senha nenhuma — só lê e rola o que já está na
// tela. No fim, abre uma caixa na própria página com o JSON já
// selecionado — só apertar Ctrl+C (ou Cmd+C) e colar na tela "Importar
// apostas" do Evobo.
//
// Baseado nas classes CSS reais da página (bethistory-type, bethistory-stake,
// bethistory-title, bethistory-result-tag, bethistory-id, bethistory-content
// — confirmadas via HTML real da tela "Histórico de Apostas"). Se a Betano
// redesenhar a tela, essas classes podem mudar e o script vai precisar de
// ajuste — nesse caso, copia o outerHTML de um card e manda pro Evobo.
//
// IMPORTANTE sobre combinadas (Dupla/Tripla): a Betano não mostra a odd
// total da combinada em lugar nenhum da tela — só a odd de cada jogo
// separado. O script multiplica as odds de cada perna pra chegar na odd
// total (matemática padrão de aposta combinada). Isso pode ficar um pouco
// errado se a aposta teve "Cashout"/pagamento antecipado parcial — esses
// casos ficam melhor conferidos na mão.

(async function scrapeBetano() {
  const STATUS_MAP = [
    [/perdid|perdeu/i, "perdido"],
    [/ganh/i, "ganha"],
    [/cancel|anulad/i, "cancelado"],
    [/cashout|cash out|reembols/i, "cashout"],
  ];

  function statusFromText(text) {
    if (!text) return "aberta";
    for (const [re, val] of STATUS_MAP) if (re.test(text)) return val;
    return "aberta";
  }

  function brlToNumber(text) {
    const cleaned = (text || "").replace(/[^\d,.-]/g, "");
    return Number(cleaned.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));
  }

  function findCardRoots() {
    return [...document.querySelectorAll(".vue-recycle-scroller__item-view")];
  }

  function parseLeg(leg) {
    const labelSpan = leg.querySelector("div.tw-font-bold span");
    let selectionLabel = labelSpan ? labelSpan.textContent.trim() : "";

    const oddSpans = [...leg.querySelectorAll(".tw-grow.tw-text-right span")].filter(
      (s) => s.getAttribute("data-qa") !== "bet-odds-before-enhancement" && /\d/.test(s.textContent),
    );
    const oddText = oddSpans.length ? oddSpans[oddSpans.length - 1].textContent.trim() : null;

    const descDivs = [...leg.querySelectorAll("div.tw-text-xs.tw-text-sem-color-text-gray-soft")].filter(
      (d) => d.getAttribute("data-qa") !== "player-substitution" && d.textContent.trim(),
    );
    const marketDesc = descDivs.length ? descDivs[0].textContent.trim() : "";

    const gameDiv = leg.querySelector('div[class*="tw-max-w-[210px]"]');
    const game = gameDiv ? gameDiv.textContent.trim() : null;

    const odd = oddText ? Number(oddText.replace(",", ".")) : null;
    return { selectionLabel, marketDesc, game, odd };
  }

  function parseCard(root) {
    const headerSection = root.querySelector('section[class*="tw-rounded-t-s"]');
    if (!headerSection) return null;

    const typeText = headerSection.querySelector('[data-qa="bethistory-type"]')?.textContent.trim() || "";
    const stakeText = headerSection.querySelector('[data-qa="bethistory-stake"]')?.textContent.trim();
    const titleText = headerSection.querySelector('[data-qa="bethistory-title"]')?.textContent.trim() || "";
    const statusText = headerSection.querySelector('[data-qa="bethistory-result-tag"] span')?.textContent.trim();
    const status = statusFromText(statusText);

    const idSpan = root.querySelector('[data-qa="bethistory-id"]');
    const betNumberMatch = idSpan ? idSpan.textContent.match(/(\d+)/) : null;
    const idContainer = idSpan?.closest(".tw-flex.tw-justify-between.tw-p-xs");
    const dateText = idContainer
      ? [...idContainer.children].map((el) => el.textContent.trim()).find((t) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(t))
      : null;
    const dm = dateText ? dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{2}):(\d{2})/) : null;

    const content = root.querySelector('[data-qa="bethistory-content"]');
    const legDivs = content
      ? [...content.querySelectorAll(':scope > div[class*="tw-w-full"][class*="tw-justify-between"]')]
      : [];
    const legs = legDivs.map(parseLeg).filter((l) => l.odd !== null);

    if (!betNumberMatch || !stakeText || !dm || legs.length === 0) {
      console.warn("[betano] aposta sem os campos esperados, pulando:", root.textContent.trim().slice(0, 150));
      return null;
    }

    let selection;
    if (legs.length === 1 && legs[0].selectionLabel === "Criar Aposta" && titleText) {
      selection = titleText;
    } else {
      selection = legs.map((l) => [l.selectionLabel, l.marketDesc].filter(Boolean).join(" - ")).join(" | ");
    }
    const game = legs.map((l) => l.game).filter(Boolean).join(" - ") || null;
    const odd = Math.round(legs.reduce((acc, l) => acc * l.odd, 1) * 100) / 100;

    // Bônus/turbinada ("Criar Aposta Turbinada +50%", "+25%", "+10%" etc.)
    // paga por fora da odd, em cima do lucro — a porcentagem varia e não
    // dá pra prever, então lê sempre o valor real em R$ mostrado na linha
    // (ex.: "+R$25,63"), nunca calcula a partir do texto da porcentagem.
    // Só existe quando ganha; em aposta perdida essa linha nem aparece.
    let bonusReais = 0;
    const footerSection = root.querySelector('section[class*="tw-rounded-b-s"]');
    if (footerSection) {
      for (const row of footerSection.querySelectorAll('div[class*="tw-text-sem-color-fg-denim-emphasis"]')) {
        const amountSpan = [...row.querySelectorAll("span")].reverse().find((s) => /R\$/.test(s.textContent));
        if (amountSpan) bonusReais += brlToNumber(amountSpan.textContent);
      }
    }

    const [, dd, mm, yyyy, hh, min] = dm;
    const pad = (n) => String(n).padStart(2, "0");

    return {
      betNumber: betNumberMatch[1],
      status,
      placedAt: `${yyyy}-${pad(mm)}-${pad(dd)}T${pad(hh)}:${pad(min)}:00-03:00`,
      selection,
      game,
      odd,
      stakeReais: brlToNumber(stakeText),
      ...(bonusReais > 0 ? { bonusReais: Math.round(bonusReais * 100) / 100 } : {}),
    };
  }

  function collectVisible(seen) {
    for (const root of findCardRoots()) {
      const bet = parseCard(root);
      if (bet) seen.set(bet.betNumber, bet);
    }
  }

  const scroller = document.querySelector(".vue-recycle-scroller") || document.querySelector("#bet-history");
  const seen = new Map();
  collectVisible(seen);

  if (scroller) {
    let lastTop = -1;
    for (let i = 0; i < 300; i++) {
      const before = scroller.scrollTop;
      scroller.scrollTop = before + scroller.clientHeight * 0.8;
      await new Promise((r) => setTimeout(r, 500));
      collectVisible(seen);
      if (scroller.scrollTop === before || scroller.scrollTop === lastTop) break;
      lastTop = scroller.scrollTop;
    }
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

  console.log(`[betano] ${bets.length} aposta(s) coletada(s).`);
  console.table(bets);
  return bets;
})();
