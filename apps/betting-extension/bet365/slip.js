// Adaptador do DOM da Bet365: lê o bilhete e preenche stakes. Devolve o
// MESMO formato do BetanoSlip.readSnapshot ({ cards, accumulator,
// placeButton }), então as regras de decisão (betano/plan.js — odd abaixo,
// teto, casar a tip com o bilhete) servem pras duas casas.
//
// HTML real colado pelo usuário em 2026-09-24:
//  - bilhete: .bss-StandardBetslip; cada seleção .bss-NormalBetItem com
//    título .bss-NormalBetItem_Title ("Mark Redman"), mercado
//    .bss-NormalBetItem_Market, jogo .bss-NormalBetItem_FixtureDescription
//    ("ATL Falcons @ GB Packers"), odd em .bss-NormalBetItem_OddsContainer,
//    e a stake da simples em .bss-StakeBox_StakeInputContainer;
//  - a stake do rodapé (.bsf-StakeBox_StakeValue-input, contenteditable) é
//    a da múltipla; botão .bsf-PlaceBetButton ("Fazer aposta R$0,00",
//    _Disabled quando vazio) e .bsf-AcceptButton (odd mudou);
//  - modo do bilhete em .bss-ControlBar_BetslipTypesButton ("Criar Aposta"
//    ou "Simples e Múltiplas"), atrás de "Mostrar Opções" (.bs-EditButton).
// Os campos de stake só aceitam digitação "de verdade" (CDP insertText) —
// já era assim na extensão antiga do robotip.
(function (root) {
  if (root.Bet365Slip) return;
  const Q = (sel, el = document) => el.querySelector(sel);
  const QA = (sel, el = document) => [...el.querySelectorAll(sel)];
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) =>
    String(s ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();

  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && !el.closest(".Hidden");
  };

  const parseOdd = (t) => {
    const n = parseFloat(String(t).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  // "R$20,00" → 20 · "R$1.234,50" → 1234.5 · "20,00R$" → 20
  const parseBRL = (t) => {
    const m = String(t).match(/([\d.]+,\d{2}|\d+(?:[.,]\d{1,2})?)/);
    if (!m) return null;
    const s = m[1].includes(",") ? m[1].replace(/\./g, "").replace(",", ".") : m[1];
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };

  async function waitFor(fn, timeout = 5000, step = 100) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return fn() || null;
  }

  const slip = () => QA(".bss-StandardBetslip").find(visible) ?? null;
  const items = () => QA(".bss-NormalBetItem", slip() ?? document).filter(visible);

  // "ATL Falcons @ GB Packers" / "Portugal v País de Gales" / "A x B"
  const teamsOf = (fixture) =>
    String(fixture)
      .split(/\s+(?:@|v|vs|x)\s+/i)
      .map((t) => t.trim())
      .filter(Boolean);

  function readPlaceButton() {
    const accept = QA(".bsf-AcceptButton").find(visible);
    const place = QA(".bsf-PlaceBetButton").find(visible);
    if (!place && !accept) return null;
    const el = accept ?? place;
    const t = text(el);
    return {
      text: t,
      accept: !!accept,
      disabled: !accept && /_Disabled/.test(place.className),
      totalReais: parseBRL(text(Q(".bsf-PlaceBetButton_StakeAmount", place ?? el)) || t),
      retornoReais: parseBRL(text(Q(".bsf-PlaceBetButton_ReturnValue", place ?? el))),
    };
  }

  // Id "de mentira" pra cada campo de stake (a Bet365 não dá id): o índice
  // da seleção, ou "multipla" pro rodapé. setStake resolve de volta.
  function readSnapshot() {
    const s = slip();
    if (!s) return null;
    const cards = items().map((item, i) => ({
      selection: text(Q(".bss-NormalBetItem_Title", item)),
      market: text(Q(".bss-NormalBetItem_Market", item)),
      teams: teamsOf(text(Q(".bss-NormalBetItem_FixtureDescription", item))),
      odd: parseOdd(text(Q(".bss-NormalBetItem_OddsContainer", item))),
      stakeInputId: Q(".bss-StakeBox_StakeInputContainer", item) ? `simples:${i}` : null,
    }));
    const footer = QA(".bsf-StakeBox_StakeValue-input").find(visible);
    // Odd da múltipla = produto das odds (é como a Bet365 calcula); depois
    // de preencher, confere pelo "Retornos Potenciais" / stake.
    const product = cards.length >= 2 && cards.every((c) => c.odd) ? Math.round(cards.reduce((p, c) => p * c.odd, 1) * 100) / 100 : null;
    return {
      tab: modeText(),
      cards,
      accumulator: footer && cards.length >= 2 ? { label: "Múltipla", odd: product, stakeInputId: "multipla" } : null,
      placeButton: readPlaceButton(),
    };
  }

  const modeButton = () => QA(".bss-ControlBar_BetslipTypesButton").find(visible) ?? null;
  const modeText = () => text(modeButton()) || null;

  function stakeTarget(inputId) {
    if (inputId === "multipla") return QA(".bsf-StakeBox_StakeValue-input").find(visible) ?? null;
    const m = /^simples:(\d+)$/.exec(inputId ?? "");
    if (!m) return null;
    const item = items()[Number(m[1])];
    return item ? (Q(".bss-StakeBox_StakeInputContainer", item) ?? Q(".bss-StakeBox", item)) : null;
  }

  // Valor que o campo mostra agora (vazio = "").
  function stakeValue(inputId) {
    const el = stakeTarget(inputId);
    if (!el) return null;
    if (inputId === "multipla") return el.classList.contains("bsf-StakeBox_StakeValue-empty") ? "" : text(el);
    const shown = Q(".bss-StakeBox_StakeValue", el);
    return shown?.classList.contains("bss-StakeBox_StakeValue-empty") ? "" : text(shown);
  }

  // Na extensão, clique/digitação confiáveis (CDP) via background — os
  // campos da Bet365 ignoram eventos sintéticos. Fora dela (testes com
  // bilhete falso), cai no clique sintético.
  const canAskBackground = () => typeof chrome !== "undefined" && !!chrome.runtime?.sendMessage;

  function centerOf(el) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }

  function clickLikeUser(el) {
    const r = el.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    const ptr = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...ptr, buttons: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", ptr));
    el.dispatchEvent(new MouseEvent("mouseup", base));
    el.dispatchEvent(new MouseEvent("click", base));
  }

  async function trustedClick(el, alvo) {
    if (!canAskBackground()) {
      clickLikeUser(el);
      return { ok: true, sintetico: true };
    }
    const p = centerOf(el);
    return chrome.runtime.sendMessage({ acao: "clique_confiavel", alvo, ...p }).catch((e) => ({ ok: false, erro: String(e?.message ?? e) }));
  }

  // Digita substituindo o que houver (Ctrl+A + insertText no background).
  async function trustedType(el, value) {
    if (!canAskBackground()) {
      // Bilhete falso dos testes: um input/contenteditable comum.
      el.dispatchEvent(new CustomEvent("fake-type", { detail: value, bubbles: true }));
      return { ok: true, sintetico: true };
    }
    const p = centerOf(el);
    return chrome.runtime.sendMessage({ acao: "digitar_confiavel", texto: value, ...p }).catch((e) => ({ ok: false, erro: String(e?.message ?? e) }));
  }

  // "20,00" — vírgula decimal, como a Bet365 BR mostra (extensão antiga).
  const formatStake = (reais) => reais.toFixed(2).replace(".", ",");

  async function setStake(inputId, reais) {
    const el = stakeTarget(inputId);
    if (!el) return { ok: false, reason: "campo_nao_encontrado" };
    const value = reais === null ? "" : formatStake(reais);
    const r = await trustedType(el, value);
    return { ok: !!r?.ok, value, erro: r?.erro ?? null };
  }

  // Bilhete recolhido: clicar no cabeçalho expande.
  async function ensureSlipOpen() {
    const ready = () => slip() && items().length > 0;
    if (await waitFor(ready, 8000, 250)) return true;
    const header = QA(".bss-DefaultContent_TitleWrapper, .bss-StandardHeader").find(visible);
    if (!header) return false;
    await trustedClick(header, "cabecalho_bilhete");
    return !!(await waitFor(ready, 4000, 250));
  }

  // "Criar Aposta" (seleções do mesmo jogo) → "Simples e Múltiplas":
  // "Mostrar Opções" abre a barra, o botão do tipo abre a lista e aí o item
  // "Simples e Múltiplas" (pedido do usuário, 2026-09-24).
  async function ensureSinglesMode() {
    const res = { antes: modeText(), depois: null, passos: [] };
    if (norm(res.antes) === "simples e multiplas") {
      res.depois = res.antes;
      return res;
    }
    if (!modeButton()) {
      const edit = QA(".bs-EditButton").find(visible);
      if (edit) {
        await trustedClick(edit, "mostrar_opcoes");
        res.passos.push("mostrar_opcoes");
        await waitFor(() => modeButton(), 3000);
      }
    }
    const btn = modeButton();
    if (!btn) return { ...res, erro: "botao_do_tipo_nao_encontrado" };
    if (norm(text(btn)) !== "simples e multiplas") {
      await trustedClick(btn, "tipo_de_bilhete");
      res.passos.push("tipo_de_bilhete");
      // O item da lista: qualquer elemento visível com o texto exato, que
      // não seja o próprio botão.
      const option = await waitFor(
        () =>
          QA("div, span, li, a, button")
            .filter((el) => el !== btn && !btn.contains(el) && el.children.length === 0 && visible(el))
            .find((el) => norm(text(el)) === "simples e multiplas"),
        3000,
      );
      if (!option) return { ...res, erro: "opcao_simples_e_multiplas_nao_encontrada" };
      await trustedClick(option, "simples_e_multiplas");
      res.passos.push("simples_e_multiplas");
    }
    await waitFor(() => norm(modeText()) === "simples e multiplas", 3000);
    res.depois = modeText();
    if (norm(res.depois) !== "simples e multiplas") res.erro = "nao_trocou_pra_simples_e_multiplas";
    return res;
  }

  // Com simples no bilhete, as outras múltiplas ficam recolhidas atrás deste
  // botão (pedido do usuário) — expande pra deixar os campos à vista.
  async function expandOtherMultiples() {
    const btn = QA(".bss-OtherMultiplesButton, .bss-MultipleHeader_OtherMultiples").find(visible);
    if (!btn) return false;
    await trustedClick(btn, "outras_multiplas");
    await sleep(500);
    return true;
  }

  // "Ganhos Aumentados de 25%" — bloco da Bet365 em cada seleção
  // (classes bol-*, HTML de 2026-09-24) com o botão "Aumentar Agora". O
  // usuário pediu pra aplicar a aumentada (2026-09-25), como a CA
  // Turbinada da Betano: clica em todo "Aumentar Agora" visível ANTES de
  // ler as odds. Enquanto a oferta pede mais seleções ("Adicione mais 2
  // seleções") o botão não vale — conta como indisponível.
  async function ensureBoostOn() {
    const buttons = () => QA("button").filter((b) => visible(b) && /^aumentar agora$/.test(norm(text(b))));
    const res = { vistas: buttons().length, ligou: 0, falhou: 0, detalhes: [] };
    for (let i = 0; i < res.vistas; i++) {
      const btn = buttons()[0]; // o clicado some da lista
      if (!btn) break;
      const bloco = btn.closest("[class*='bol-']")?.parentElement?.closest("[class*='bol-']") ?? btn.parentElement;
      const oferta = text(bloco).slice(0, 80);
      const bloqueado = btn.disabled || /adicione mais/i.test(oferta);
      if (bloqueado) {
        res.falhou++;
        res.detalhes.push({ oferta, bloqueado: true });
        continue;
      }
      const antes = buttons().length;
      const click = await trustedClick(btn, "aumentar_agora");
      if (!click?.ok) clickLikeUser(btn);
      const foi = await waitFor(() => buttons().length < antes, 3000, 200);
      if (foi) res.ligou++;
      else res.falhou++;
      res.detalhes.push({ oferta, bloqueado: false, ligou: !!foi });
    }
    if (res.ligou) await sleep(800); // a odd aumentada aparece logo depois
    return res;
  }

  function readReceipt() {
    const r = QA('[class*="bss-ReceiptContent"], [class*="ReceiptContent"], [class*="BetReceipt"]').find(visible);
    if (!r) return null;
    const t = text(r);
    if (!/aposta feita/i.test(t)) return null;
    const ref = /Ref\.?\s*([A-Z0-9]+)/i.exec(t);
    return { cabecalho: "Aposta Feita", items: [], betIds: ref ? [ref[1]] : [] };
  }

  function readSlipMessages() {
    return QA(".bs-MessageContainer, [class*='ErrorMessage'], [class*='Warning']")
      .filter(visible)
      .map(text)
      .filter(Boolean)
      .slice(0, 10);
  }

  root.Bet365Slip = {
    readSnapshot,
    ensureSlipOpen,
    ensureSinglesMode,
    expandOtherMultiples,
    ensureBoostOn,
    setStake,
    stakeValue,
    waitFor,
    trustedClick,
    readReceipt,
    readSlipMessages,
    sleep,
    parseBRL,
    parseOdd,
    teamsOf,
  };
})(typeof self !== "undefined" ? self : this);
