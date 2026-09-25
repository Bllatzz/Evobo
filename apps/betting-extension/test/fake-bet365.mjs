// Bilhete Bet365 FALSO pra testar bet365/slip.js, run.js e login.js sem o
// site real. Mesmas classes do HTML real colado pelo usuário em 2026-09-24
// (.bss-StandardBetslip, .bss-NormalBetItem…, .bsf-StakeBox…,
// .bsf-PlaceBetButton…, .bss-ControlBar_BetslipTypesButton, modal de login
// com classes slm2-*). Não é a Bet365: valida a lógica da extensão.
//
// Digitação: nos testes não há CDP; bet365/slip.js dispara um evento
// "fake-type" no campo e este bilhete aplica o valor (a Bet365 real só
// aceita teclado de verdade).
export async function installFakeBet365(page, { cards, mode = "Simples e Múltiplas", loggedIn = true, loginModal = false, receipt = false, balanceHidden = false }) {
  await page.setContent('<body style="margin:0"><div id="root"></div></body>');
  await page.evaluate(
    ({ cards, mode, loggedIn, loginModal, receipt, balanceHidden }) => {
      // c.boost: { eligible, boostedOdd } — bloco "Ganhos Aumentados de 25%" / "Aumentar Agora".
      const st = { mode, options: false, stakes: {}, multi: "", modal: loginModal, loggedIn, boosted: {} };
      const num = (v) => (v ? Number(String(v).replace(",", ".")) || 0 : 0);
      const brl = (n) => "R$" + n.toFixed(2).replace(".", ",");
      const total = () => Object.values(st.stakes).reduce((s, v) => s + num(v), 0) + num(st.multi);
      const returns = () =>
        Object.entries(st.stakes).reduce((s, [i, v]) => s + num(v) * cards[i].odd, 0) + num(st.multi) * cards.reduce((p, c) => p * c.odd, 1);
      function render() {
        const t = total();
        document.getElementById("root").innerHTML = `
          ${st.modal ? `<div class="slm2-11"><div class="slm2-a"><div class=""><div class="slm2-64 slm2-b">
            <input type="text" placeholder="Usuário ou endereço de e-mail" class="slm2-8" value="usuario@exemplo.com"><button class="slm2-56"></button></div>
            <div class="slm2-1b"><input type="password" placeholder="Senha" class="slm2-c2" value=""></div></div>
            <button class="slm2-f9" id="login-btn"><span class="slm2-de">Login</span></button>
            <div class="slm2-04"><button class="slm2-50">Registre-se</button></div></div></div>` : ""}
          <div class="bss-StandardBetslip">
            <div class="bss-StandardHeader"><div class="bss-DefaultContent"><div class="bss-DefaultContent_TitleWrapper">
              <div class="bs-EditButton bss-DefaultContent_TitleEdit" id="edit" ${st.options ? 'style="display:none"' : ""}>Mostrar Opções</div></div>
              ${st.loggedIn ? `<div class="bs-Balance" ${balanceHidden ? 'style="display:none"' : ""}><div class="bs-Balance_Label">Saldo</div><div class="bs-Balance_Value">R$202,67</div></div>` : ""}
            </div></div>
            ${st.options ? `<div class="bss-ControlBar"><div class="bss-ControlBar_TypesWrapper"><div class="bss-ControlBar_BetslipTypesButton" id="types">${st.mode}</div></div>
              ${st.dropdown ? `<div class="dropdown"><div class="opt">Criar Aposta</div><div class="opt" id="opt-sm">Simples e Múltiplas</div></div>` : ""}</div>` : ""}
            ${cards
              .map(
                (c, i) => `<div class="bs-BetComponent bss-NormalBetItem"><div class="bss-NormalBetItem_Details">
                  <h5 class="bss-NormalBetItem_Title">${c.selection}</h5>
                  <div class="bss-NormalBetItem_OddsContainer"><span class="bsc-OddsDropdownLabel"><span>${(st.boosted[i] ? c.boost.boostedOdd : c.odd).toFixed(2)}</span></span></div>
                  <div class="bss-NormalBetItem_Market">${c.market}</div>
                  <div class="bss-NormalBetItem_FixtureDescription">${c.fixture}</div></div>
                  ${st.mode === "Simples e Múltiplas" ? `<div class="bss-StakeBox"><div class="bss-StakeBox_StakeInputContainer" data-i="${i}" style="height:20px">
                    <div class="bss-StakeBox_StakeValue ${st.stakes[i] ? "" : "bss-StakeBox_StakeValue-empty"}">${st.stakes[i] || "Aposta"}</div></div></div>` : ""}
                  ${c.boost && !st.boosted[i] ? `<div class="bss-NormalBetItem_ReactContainer"><div class="bol-6c8150"><div class="bol-2c9682"><div class="bol-496957"><div class="bol-663185">Ganhos Aumentados de 25%</div>
                    <div class="bol-c33e07">${c.boost.eligible ? "Aumente seus ganhos" : "Adicione mais 2 seleções"}</div></div>
                    <button class="bol-491eed" data-boost="${i}">Aumentar Agora</button></div></div></div>` : ""}
                </div>`,
              )
              .join("")}
            <div class="bss-Footer"><div class="bsf-StakeBox"><div contenteditable="true" class="bsf-StakeBox_StakeValue bsf-StakeBox_StakeValue-input ${st.multi ? "" : "bsf-StakeBox_StakeValue-empty"}" style="height:20px">${st.multi}</div></div>
              <div class="bsf-BetButtonsWrapper"><div class="bsf-PlaceBetButton ${t > 0 ? "" : "bsf-PlaceBetButton_Disabled"}"><div class="bsf-PlaceBetButton_Wrapper">
                <div class="bsf-PlaceBetButton_TopRow"><div class="bsf-PlaceBetButton_Text">Fazer aposta</div><div class="bsf-PlaceBetButton_StakeAmount">${brl(t)}</div></div>
                <div class="bsf-PlaceBetButton_BottomRow"><div class="bsf-PlaceBetButton_ToReturnLabel">Retornos Potenciais</div><div class="bsf-PlaceBetButton_ReturnValue">${brl(returns())}</div></div>
              </div></div><div class="bsf-AcceptButton Hidden"><div class="bsf-AcceptButton_Text">Fazer aposta</div></div></div></div>
          </div>`;
      }
      window.__placeClicks = 0;
      document.addEventListener("click", (e) => {
        const el = e.target;
        if (el.closest("[data-boost]")) {
          const i = Number(el.closest("[data-boost]").dataset.boost);
          if (cards[i].boost.eligible) { st.boosted[i] = true; render(); }
        } else if (el.closest("#edit")) { st.options = true; render(); }
        else if (el.closest("#types")) { st.dropdown = true; render(); }
        else if (el.closest("#opt-sm")) { st.mode = "Simples e Múltiplas"; st.dropdown = false; render(); }
        else if (el.closest("#login-btn")) { st.modal = false; st.loggedIn = true; render(); }
        else if (el.closest(".bsf-PlaceBetButton") && !el.closest(".bsf-PlaceBetButton_Disabled")) {
          window.__placeClicks++;
          if (receipt) document.getElementById("root").innerHTML = '<div class="bss-ReceiptContent">Aposta Feita Ref. BK123XYZ</div>';
        }
      });
      document.addEventListener("fake-type", (e) => {
        const el = e.target;
        if (el.classList.contains("bsf-StakeBox_StakeValue-input")) st.multi = e.detail;
        else if (el.dataset.i !== undefined) st.stakes[el.dataset.i] = e.detail;
        render();
      });
      render();
    },
    { cards, mode, loggedIn, loginModal, receipt, balanceHidden },
  );
}
