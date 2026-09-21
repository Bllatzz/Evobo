// Script pra rodar no CONSOLE do DevTools (F12 -> aba "Console"), logado
// normalmente na Bet365, na tela "Minhas Apostas" -> "Liquidadas" (ou a
// lista que quiser importar). Escolha o período no filtro da própria tela
// antes de rodar — o script só lê o que essa lista mostrar.
//
// O card recolhido da Bet365 só mostra stake, tipo, seleção e resultado —
// NÃO mostra a odd nem o jogo. Por isso o script clica sozinho em cada
// aposta pra expandir (não precisa clicar em nada você mesmo), lê a odd e
// os times de dentro do card aberto e passa pra próxima. Também rola a
// lista até o fim / clica em "mostrar mais" antes, caso a lista carregue
// aos poucos.
//
// Nunca faz login nem guarda senha nenhuma — só lê e expande o que já está
// na tela. No fim, abre uma caixa na própria página com o JSON já
// selecionado — só apertar Ctrl+C (ou Cmd+C) e colar na tela "Importar
// apostas" do Evobo.
//
// Baseado nas classes CSS reais da página (lista [data-testid="MyBets-list"],
// card [data-bet-id], rmb-f0/rmb-c/rmb-95/rmb-89/rmb-b0 no cabeçalho,
// ruc-cbc440/ruc-0b0e2f/ruc-32f149/ruc-b161b7/ruc-d948a8 dentro do card
// aberto — confirmadas via HTML real da tela). Se a Bet365 redesenhar a
// tela, essas classes (hasheadas) podem mudar e o script vai precisar de
// ajuste — nesse caso, expande uma aposta na mão, copia o outerHTML do card
// e manda pro Evobo.
//
// DATA: o card da Bet365 não traz data/hora de quando a aposta foi feita.
// O script procura uma data (dd/mm/aaaa) dentro do card e, não achando,
// manda placedAt = null — o import então ignora a janela de horário e casa
// só por odd + jogo/texto (não precisa rodar um dia por vez nem digitar
// data nenhuma).
//
// ODD: aposta simples usa a odd que aparece dentro do card; combinada
// (Duplas/Triplas/N Múltiplas) usa o produto das odds de cada perna.
// "Criar Aposta" só usa a odd quando o card aberto traz uma só (ou o
// retorno ÷ stake se ganhou) — se não der pra determinar, pula a aposta
// com um aviso no console em vez de chutar.

(async function scrapeBet365() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, "0");
  const round2 = (n) => Math.round(n * 100) / 100;

  function brlToNumber(text) {
    const cleaned = (text || "").replace(/[^\d,.-]/g, "");
    // tira ponto de milhar (ponto seguido de exatamente 3 dígitos), só depois troca a vírgula decimal por ponto
    return Number(cleaned.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));
  }

  function statusFromText(text) {
    const t = (text || "").trim().toLowerCase();
    if (t === "ganhou") return "ganha";
    if (t === "perdida" || t === "perdido") return "perdido";
    if (t.includes("encerrada") || t.includes("cash")) return "cashout";
    if (/anulad|cancelad|reembols|devolvid/.test(t)) return "cancelado";
    return "aberta";
  }

  // O rótulo de resultado do cabeçalho ("Ganhou"/"Perdida"/...) SOME nas
  // apostas ganhas quando o card abre (o "Ganhou" passa pra um <span> solto
  // fora do cabeçalho) — por isso status e retorno são lidos ANTES de
  // clicar, com data-is-won como reserva pra card que já veio aberto.
  function readStatus(card) {
    const label = card.querySelector(".rmb-89")?.textContent;
    if (label) return statusFromText(label);
    if (card.getAttribute("data-is-won") === "true") return "ganha";
    return "aberta";
  }

  function readReturn(card) {
    const t = card.querySelector(".rmb-b0")?.textContent || card.querySelector(".ruc-360ae6 .ruc-93ecde")?.textContent;
    return t ? brlToNumber(t) : null;
  }

  const cards = () => [...document.querySelectorAll('[data-testid="MyBets-list"] [data-bet-id]')];
  const cardById = (id) => document.querySelector(`[data-testid="MyBets-list"] [data-bet-id="${id}"]`);
  const headerOf = (card) => card.querySelector('[role="button"][aria-expanded]');
  const legsOf = (card) => [...card.querySelectorAll("[data-participant-id]")];

  function findLoadMoreButton() {
    return [...document.querySelectorAll("button")].find((b) => /mostrar mais|carregar mais|ver mais/i.test(b.textContent));
  }

  // Carrega a lista inteira: clica em "mostrar mais" se existir, senão rola
  // o último card pra vista (lista com carregamento por rolagem) — pára
  // quando a contagem não cresce em 2 tentativas seguidas.
  let stable = 0;
  let lastCount = -1;
  for (let i = 0; i < 80 && stable < 2; i++) {
    const btn = findLoadMoreButton();
    if (btn) btn.click();
    else cards().at(-1)?.scrollIntoView({ block: "end" });
    await sleep(800);
    const n = cards().length;
    stable = n === lastCount ? stable + 1 : 0;
    lastCount = n;
  }

  function placedAtFor(card) {
    const m = card.textContent.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,-]+(\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    const [, dd, mm, yyyy, hh, min] = m;
    return `${yyyy}-${pad(mm)}-${pad(dd)}T${hh ? `${pad(hh)}:${min}` : "12:00"}:00-03:00`;
  }

  function textOf(el, sel) {
    return el.querySelector(sel)?.textContent?.replace(/\s+/g, " ").trim() || "";
  }

  // Uma perna (seleção) do card aberto.
  function parseLeg(el) {
    const name = textOf(el, ".ruc-0b0e2f");
    const market = textOf(el, ".ruc-b161b7");
    const selection = market && !name.includes(market) ? `${name} - ${market}` : name;

    const oddText = textOf(el, ".ruc-32f149");
    const odd = oddText ? Number(oddText.replace(",", ".")) : NaN;

    // Times: bloco de placar (2 linhas) ou, nas apostas ao vivo, o painel
    // do jogo em andamento.
    let teams = [...el.querySelectorAll(".ruc-d948a8")].map((t) => t.textContent.trim()).filter(Boolean);
    if (teams.length < 2) teams = [...el.querySelectorAll(".mbf-a5")].map((t) => t.textContent.trim()).filter(Boolean);
    const game = teams.length >= 2 ? `${teams[0]} x ${teams[1]}` : null;

    return { selection, odd, game };
  }

  // Clica no cabeçalho e espera as pernas aparecerem (o corpo do card
  // carrega por rede, não vem pronto).
  async function expand(id) {
    let card = cardById(id);
    if (!card) return null;
    if (legsOf(card).length === 0) {
      const header = headerOf(card);
      if (header && header.getAttribute("aria-expanded") !== "true") header.click();
      for (let t = 0; t < 20; t++) {
        await sleep(200);
        card = cardById(id);
        if (card && legsOf(card).length > 0) break;
      }
    }
    return cardById(id);
  }

  function parseCard(card, pre) {
    const betNumber = card.getAttribute("data-bet-id");
    const head = card.querySelector(".rmb-f4") || card;
    const stakeText = textOf(head, ".rmb-f0");
    const kind = textOf(head, ".rmb-c");
    const headerSelection = textOf(head, ".rmb-95");
    const status = pre?.status ?? readStatus(card);
    const returnReais = pre?.returnReais ?? readReturn(card);

    const stakeReais = brlToNumber(stakeText);
    const legs = legsOf(card).map(parseLeg);
    const isBuilder = /criar aposta/i.test(kind);

    if (!betNumber || !Number.isFinite(stakeReais) || stakeReais <= 0) {
      console.warn("[bet365] card sem id/stake, pulando:", card.textContent.trim().slice(0, 150));
      return null;
    }

    const legOdds = legs.map((l) => l.odd).filter(Number.isFinite);
    let odd = null;
    if (legs.length > 0 && legOdds.length === legs.length) {
      if (legs.length === 1) odd = legOdds[0];
      else if (!isBuilder) odd = round2(legOdds.reduce((a, b) => a * b, 1));
    }
    // Sem odd lida do card aberto (ou "Criar Aposta" com várias pernas, que
    // tem uma odd combinada só) — ganhou dá pra tirar do retorno ÷ stake.
    if (odd === null && status === "ganha" && returnReais) odd = round2(returnReais / stakeReais);
    if (odd === null || !(odd > 0)) {
      console.warn(`[bet365] ${betNumber} (${kind}) sem odd (card não expandiu ou "Criar Aposta" perdida), pulando:`, headerSelection);
      return null;
    }
    if (status === "ganha" && returnReais && Math.abs(returnReais / stakeReais - odd) > odd * 0.02) {
      console.warn(`[bet365] ${betNumber}: retorno÷stake (${round2(returnReais / stakeReais)}) difere da odd lida (${odd}) — turbinada/bônus?`);
    }

    let selection;
    let game;
    if (isBuilder) {
      // Criar Aposta: o título do card já é o jogo; as pernas são as seleções.
      selection = legs.map((l) => l.selection).filter(Boolean).join(" | ") || headerSelection;
      game = headerSelection || legs.find((l) => l.game)?.game || null;
    } else if (legs.length > 0) {
      selection = legs.map((l) => l.selection).filter(Boolean).join(" | ") || headerSelection;
      game = [...new Set(legs.map((l) => l.game).filter(Boolean))].join(" - ") || null;
    } else {
      selection = headerSelection;
      game = null;
    }

    return {
      betNumber,
      status,
      placedAt: placedAtFor(card),
      selection,
      game,
      odd,
      stakeReais,
    };
  }

  const ids = cards().map((c) => c.getAttribute("data-bet-id"));
  const seen = new Map();
  let skipped = 0;
  for (const id of ids) {
    const before = cardById(id);
    const pre = before ? { status: readStatus(before), returnReais: readReturn(before) } : null;
    const card = await expand(id);
    const bet = card ? parseCard(card, pre) : null;
    if (bet) seen.set(bet.betNumber, bet);
    else skipped++;
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
  label.textContent =
    `${bets.length} aposta(s) coletada(s)` +
    (skipped ? `, ${skipped} pulada(s) (ver avisos no Console)` : "") +
    " — já selecionado, aperte Ctrl+C (ou Cmd+C) e cole no Evobo.";
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

  console.log(`[bet365] ${bets.length} aposta(s) coletada(s), ${skipped} pulada(s).`);
  console.table(bets);
  return bets;
})();
