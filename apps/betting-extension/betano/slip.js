// Adaptador do DOM da Betano: lê o bilhete e preenche stakes. Só seletores
// `data-qa` (estáveis, ao contrário das classes hasheadas da Bet365), todos
// confirmados no HTML real do bilhete em 2026-09-21. Se a Betano renomear um
// `data-qa`, este é o único arquivo que muda.
//
// O clique em "APOSTE JÁ" só acontece por run.js (placeBet), com o modo
// "apostar de verdade" ligado e as travas de lá.
(function (root) {
  const Q = (sel, el = document) => el.querySelector(sel);
  const QA = (sel, el = document) => [...el.querySelectorAll(sel)];
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const parseOdd = (t) => {
    const n = parseFloat(String(t).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  // "R$20,00" → 20 · "R$1.234,50" → 1234.5 · "R$20" → 20 · "R$1.250" → 1250
  const parseBRL = (t) => {
    const m = String(t).match(/R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
    if (!m) return null;
    const thousands = /^\d{1,3}(?:\.\d{3})+/.test(m[1]);
    const s = m[1].includes(",") || thousands ? m[1].replace(/\./g, "").replace(",", ".") : m[1];
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };

  // Odd que vale pra aposta. Com "Super Turbinada" a Betano mostra DUAS
  // `bet-odds` lado a lado (HTML real de 2026-09-23): a original com
  // `odds-ticker-enhanced` (2.02) e a turbinada com `odds-ticker-solid`
  // (2.42 = 2.02 + 20%) — a tip é passada com a turbinada. Pegar a primeira
  // lia 2.02 e barrava a aposta por "odd menor". Com mais de uma, usa a
  // `-solid`; sem ela, a maior (a turbinada é sempre maior que a original).
  function readOdd(scope) {
    const els = QA('[data-qa="bet-odds"]', scope);
    if (els.length <= 1) return parseOdd(text(els[0]));
    const solid = els.find((el) => el.classList.contains("odds-ticker-solid"));
    if (solid) return parseOdd(text(solid));
    const odds = els.map((el) => parseOdd(text(el))).filter((n) => n !== null);
    return odds.length ? Math.max(...odds) : null;
  }

  async function waitFor(fn, timeout = 5000, step = 100) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return fn() || null;
  }

  const TAB_NAMES = { 1: "simples", 2: "multiplas", 3: "sistema" };

  function readPlaceButton(slip) {
    const btn = Q('[data-qa="place-bet-button"], [data-qa="place-bet-button-disabled"]', slip);
    if (!btn) return null;
    const t = text(btn);
    return {
      text: t,
      disabled: btn.disabled || btn.getAttribute("data-qa") === "place-bet-button-disabled",
      // O texto é "APOSTE JÁ R$20,00 Ganhos Potenciais R$32,51": o que vale é o 1º valor.
      totalReais: parseBRL(t.replace(/Ganhos Potenciais.*$/i, "")),
    };
  }

  function readSnapshot() {
    const slip = Q('[data-qa="bet-slip"]');
    if (!slip) return null;
    const checked = Q('[data-qa="betslip-tabs"] input[type="radio"]:checked', slip);
    const cards = QA('[data-qa="selections-list"] [data-qa="bet-activity-card"]', slip).map((card) => ({
      selection: text(Q('[data-qa="selection-label"]', card)),
      market: text(Q('[data-qa="market-label"]', card)),
      teams: QA(".participants__participant-name", card).map(text),
      odd: readOdd(card),
      stakeInputId: Q('input[data-qa="stake-area"]', card)?.id ?? null,
    }));
    const acc = Q('[data-qa="accumulator"]', slip);
    const accInput = acc ? Q('input[data-qa="stake-area-multiple"]', acc) : null;
    return {
      tab: checked ? (TAB_NAMES[checked.value] ?? null) : null,
      cards,
      accumulator: acc
        ? { label: text(acc.firstElementChild), odd: readOdd(acc), stakeInputId: accInput?.id ?? null }
        : null,
      placeButton: readPlaceButton(slip),
    };
  }

  // Clique "de gente": o cabeçalho flutuante do bilhete é arrastável e
  // separa arrastar de clicar pelos eventos de ponteiro — um .click() sozinho
  // não abre ele (visto na Betano real em 2026-09-22).
  function clickLikeUser(el) {
    const r = el.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    const ptr = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };
    el.dispatchEvent(new PointerEvent("pointerover", ptr));
    el.dispatchEvent(new MouseEvent("mouseover", base));
    el.dispatchEvent(new PointerEvent("pointerdown", { ...ptr, buttons: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
    el.focus?.();
    el.dispatchEvent(new PointerEvent("pointerup", ptr));
    el.dispatchEvent(new MouseEvent("mouseup", base));
    el.dispatchEvent(new MouseEvent("click", base));
  }

  // Na extensão, pede ao background um clique confiável (CDP) — o único que
  // a Betano aceita. Fora dela (testes com o bilhete falso), cai no clique
  // sintético.
  async function trustedClick(el, alvo) {
    const canAskBackground = typeof chrome !== "undefined" && chrome.runtime?.sendMessage;
    if (!canAskBackground) {
      clickLikeUser(el);
      return { ok: true, sintetico: true };
    }
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    return chrome.runtime
      .sendMessage({ acao: "clique_confiavel", alvo, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
      .catch((e) => ({ ok: false, erro: String(e?.message ?? e) }));
  }

  async function clickHeader(header) {
    const res = await trustedClick(header, "cabecalho_bilhete");
    slipOpenDebug.cliqueConfiavel = res;
    if (!res?.ok) clickLikeUser(header);
  }

  // Comprovante que substitui o bilhete depois da aposta (HTML real colado
  // pelo usuário em 2026-09-21).
  function readReceipt() {
    const receipt = Q('[data-qa="bet-receipt"]');
    if (!receipt) return null;
    const items = QA('[data-qa="receipt-item"]', receipt).map((it) => ({
      titulo: text(Q('[data-qa="bet-label-title"]', it)),
      valorReais: parseBRL(text(Q('[data-qa="bet-label-amount"]', it))),
      odd: readOdd(it),
      betId: text(Q('[data-qa="unique-bet-identification-number"]', it)) || null,
    }));
    return {
      cabecalho: text(Q('[data-qa="receipt-header-text"]', receipt)),
      items,
      betIds: QA('[data-qa="unique-bet-identification-number"]', receipt).map(text).filter(Boolean),
    };
  }

  // Textos de erro/aviso visíveis no bilhete — seletores de erro da Betano
  // ainda não conhecidos, então pega qualquer data-qa com "error"/"warning".
  function readSlipMessages() {
    return QA('[data-qa*="error"], [data-qa*="warning"], [data-qa*="alert"], [role="alert"]')
      .map(text)
      .filter(Boolean)
      .slice(0, 10);
  }

  // Bilhete recolhido: só o cabeçalho flutuante aparece; clicar nele abre.
  // Devolve o que viu, pro relatório dizer onde travou.
  const slipOpenDebug = { headerFound: false, clicks: 0, cliqueConfiavel: null };
  async function ensureSlipOpen() {
    for (let i = 0; i < 3; i++) {
      if (Q('[data-qa="bet-slip"]')) return true;
      const header = await waitFor(() => Q('[data-qa="floating-betslip-header"]'), 3000);
      slipOpenDebug.headerFound = !!header;
      if (!header) return false;
      await clickHeader(header);
      slipOpenDebug.clicks++;
      if (await waitFor(() => Q('[data-qa="bet-slip"]'), 2500)) return true;
    }
    return !!Q('[data-qa="bet-slip"]');
  }

  async function selectTab(n) {
    const radio = () => Q(`[data-qa="betslip-tabs"] input[type="radio"][value="${n}"]`);
    const r = radio();
    if (!r || r.disabled) return false;
    if (r.checked) return true;
    const label = Q(`[data-qa="tab-${n}"]`);
    if (!label) return false;
    label.click();
    return !!(await waitFor(() => radio()?.checked, 3000));
  }

  // "CA Turbinada" do Criar Aposta (bet builder): um toggle no bilhete
  // (HTML real, 2026-09-24): section.bet-builder-booster-toggle-wrapper >
  // div.toggle-switch[data-qa^="bet-builder-boost-toggle"] > input[checkbox]
  // + label. Às vezes vem DESLIGADO — aí a odd do bilhete é a sem aumento e
  // a tip ("1u com o aumento") é passada com a turbinada, então a extensão
  // pulava por "odd caiu". Ligar não custa nada (a Betano só paga o aumento
  // se a aposta cumprir as regras), então liga sempre, ANTES de ler as odds.
  // Devolve o que fez, pro relatório.
  async function ensureBoostOn() {
    const toggles = () => QA('[data-qa^="bet-builder-boost-toggle"]').filter((t) => t.querySelector('input[type="checkbox"]'));
    const res = { vistas: toggles().length, jaLigadas: 0, ligou: 0, falhou: 0, detalhes: [] };
    for (let i = 0; i < res.vistas; i++) {
      const sw = () => toggles()[i] ?? null;
      const box = () => sw()?.querySelector('input[type="checkbox"]') ?? null;
      if (!box()) continue;
      if (box().checked) {
        res.jaLigadas++;
        continue;
      }
      const det = {
        dataQa: sw().getAttribute("data-qa"),
        bloqueado: !!box().disabled || box().getAttribute("aria-disabled") === "true" || /disabled/i.test(sw().className ?? ""),
        tentativas: [],
        ligouCom: null,
      };
      res.detalhes.push(det);
      // O <label> real não tem `for` nem envolve o checkbox (HTML de
      // 2026-09-24) — clicar só nele não ligou (vistas 1, falhou 1). Tenta,
      // em ordem, até o checkbox ficar marcado: rótulo, o próprio checkbox,
      // o toggle inteiro e, por fim, o click() nativo do checkbox. O Vue
      // pode redesenhar o toggle a cada clique — sempre busca de novo.
      const tries = [
        ["rotulo", () => sw()?.querySelector("label")],
        ["checkbox", () => box()],
        ["toggle", () => sw()],
      ];
      for (const [name, el] of tries) {
        const target = el();
        if (!target) continue;
        const r = target.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) {
          det.tentativas.push(`${name}:invisível`);
          continue;
        }
        const click = await trustedClick(target, "turbinada");
        if (!click?.ok) clickLikeUser(target);
        det.tentativas.push(name);
        if (await waitFor(() => box()?.checked, 1500)) {
          det.ligouCom = name;
          break;
        }
      }
      if (!det.ligouCom && box() && !box().checked) {
        box().click(); // ativa o checkbox e dispara change, como um clique
        det.tentativas.push("click_nativo");
        if (await waitFor(() => box()?.checked, 1500)) det.ligouCom = "click_nativo";
      }
      if (det.ligouCom) res.ligou++;
      else res.falhou++;
    }
    // A odd turbinada aparece um instante depois do toggle.
    if (res.ligou) await sleep(800);
    return res;
  }

  // Vue escuta `input`; setar .value direto não avisa o framework, então usa o
  // setter nativo e dispara os eventos (mesmo truque da extensão do robotip).
  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // decimal: "." ou "," — a Betano não diz qual aceita; o chamador confere o
  // total do botão e troca se não bater.
  function formatStake(reais, decimal) {
    if (Number.isInteger(reais)) return String(reais);
    return reais.toFixed(2).replace(".", decimal);
  }

  function setStake(inputId, reais, decimal = ".") {
    const input = document.getElementById(inputId);
    if (!input) return { ok: false, reason: "input_nao_encontrado" };
    const value = reais === null ? "" : formatStake(reais, decimal);
    setInputValue(input, value);
    return { ok: true, value };
  }

  root.BetanoSlip = {
    readSnapshot,
    ensureSlipOpen,
    selectTab,
    ensureBoostOn,
    setStake,
    waitFor,
    slipOpenDebug,
    trustedClick,
    readReceipt,
    readSlipMessages,
    sleep,
    parseBRL,
    parseOdd,
  };
})(typeof self !== "undefined" ? self : this);
