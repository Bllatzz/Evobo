// Bilhete Betano FALSO pra testar o adaptador e o orquestrador sem tocar no
// site real. Reproduz só o que a extensão usa — mesmos `data-qa` do HTML real
// (2026-09-21): abas Simples/Múltiplas, um input por cartão na aba Simples,
// linha `accumulator` na aba Múltiplas, botão que soma as stakes. Não é a
// Betano: valida a lógica da extensão, não o site.
export async function installFakeBetslip(page, { cards, accOdd, decimal = ".", receipt = false, debounceMs = 0 }) {
  await page.setContent('<body><div id="root"></div></body>');
  await page.evaluate(
    ({ cards, accOdd, decimal, receipt, debounceMs }) => {
      const st = { tab: 1, singles: {}, acc: "" };
      const num = (v) => {
        if (v === "" || v == null) return 0;
        // decimal "," = a "Betano" não entende ponto (simula o separador errado → vira 0)
        if (decimal === "," && String(v).includes(".")) return 0;
        const n = Number(String(v).replace(",", "."));
        return Number.isFinite(n) ? n : 0;
      };
      const brl = (n) => "R$" + n.toFixed(2).replace(".", ",");
      const cardHtml = (c, i, withStake) => `
        <div data-qa="bet-activity-card">
          <div data-qa="leg-info-header"><a data-qa="selection-label">${c.selection}</a>
            ${c.oddOriginal ? `<span data-qa="bet-odds" class="odds-ticker odds-ticker-enhanced">${c.oddOriginal}</span><span data-qa="bet-odds" class="odds-ticker odds-ticker-solid">${c.odd}</span>` : `<span data-qa="bet-odds">${c.odd}</span>`}</div>
          <div data-qa="leg-info-main"><a data-qa="market-label">${c.market ?? ""}</a>
            <div class="participants">${c.teams.map((t) => `<span class="participants__participant-name">${t}</span>`).join("")}</div></div>
          ${withStake ? `<div class="stake-area"><input id="stakeInput_1:SGL:${i}" type="text" inputmode="decimal" data-qa="stake-area" value="${st.singles[i] ?? ""}"></div>` : ""}
        </div>`;
      const total = () => (st.tab === 1 ? Object.values(st.singles).reduce((s, v) => s + num(v), 0) : num(st.acc));
      function render() {
        const t = total();
        document.getElementById("root").innerHTML = `
          <div data-qa="floating-betslip-header"></div>
          <section data-qa="bet-slip">
            <form data-qa="betslip-tabs">
              <input type="radio" name="tab" value="1" ${st.tab === 1 ? "checked" : ""}><label data-qa="tab-1" for="">Simples</label>
              <input type="radio" name="tab" value="2" ${st.tab === 2 ? "checked" : ""} ${cards.length < 2 ? "disabled" : ""}><label data-qa="tab-2">Múltiplas</label>
              <input type="radio" name="tab" value="3" disabled><label data-qa="tab-3">Sistema</label>
            </form>
            <div data-qa="selections-list">${cards.map((c, i) => cardHtml(c, i, st.tab === 1)).join("")}</div>
            ${st.tab === 2 ? `<div data-qa="accumulator"><div>Dupla = 1</div><span data-qa="bet-odds">${accOdd}</span>
              <input id="stakeInput_2:DBL:x" type="text" data-qa="stake-area-multiple" value="${st.acc}"></div>` : ""}
            <footer><button data-qa="${t > 0 ? "place-bet-button" : "place-bet-button-disabled"}" ${t > 0 ? "" : "disabled"}>
              <span>APOSTE JÁ</span>${t > 0 ? `<span> &nbsp;${brl(t)}&nbsp; </span><span>Ganhos Potenciais ${brl(t * 1.6)}</span>` : ""}</button></footer>
          </section>`;
        // Cliques nos rótulos das abas (o rótulo real alterna o radio pelo `for`).
        for (const n of [1, 2]) {
          document.querySelector(`[data-qa="tab-${n}"]`).onclick = () => {
            st.tab = n;
            render();
          };
        }
        document.querySelectorAll("input[data-qa^='stake-area']").forEach((inp) => {
          inp.addEventListener("input", () => {
            // debounceMs: imita o que se viu na Betano real (2026-09-23, 3
            // simples): a stake só é gravada um tempo depois de digitar, com
            // UM temporizador pro bilhete todo, e aí o bilhete é redesenhado
            // a partir do que foi gravado. Preencher os campos um atrás do
            // outro sem esperar grava só o último — o resto some.
            if (debounceMs) {
              clearTimeout(st.timer);
              st.timer = setTimeout(() => {
                if (inp.dataset.qa === "stake-area-multiple") st.acc = inp.value;
                else st.singles[inp.id.split(":").pop()] = inp.value;
                render();
              }, debounceMs);
              return;
            }
            if (inp.dataset.qa === "stake-area-multiple") st.acc = inp.value;
            else st.singles[inp.id.split(":").pop()] = inp.value;
            const btnHost = document.querySelector("footer");
            const t2 = total();
            btnHost.innerHTML = `<button data-qa="${t2 > 0 ? "place-bet-button" : "place-bet-button-disabled"}" ${t2 > 0 ? "" : "disabled"}>
              <span>APOSTE JÁ</span>${t2 > 0 ? `<span> &nbsp;${brl(t2)}&nbsp; </span><span>Ganhos Potenciais ${brl(t2 * 1.6)}</span>` : ""}</button>`;
          });
        });
      }
      window.__placeClicks = 0;
      document.addEventListener("click", (e) => {
        if (!e.target.closest('[data-qa="place-bet-button"]')) return;
        window.__placeClicks++;
        // receipt: a "Betano" troca o bilhete pelo comprovante (mesmos data-qa do real).
        if (receipt) {
          document.getElementById("root").innerHTML = `
            <div data-qa="bet-receipt"><span data-qa="receipt-header-text">A sua aposta foi realizada com sucesso</span>
              <div data-qa="receipt-item"><span data-qa="bet-label-title">Múltipla</span><span data-qa="bet-label-amount">${brl(total())}</span>
                <span data-qa="bet-odds">${accOdd}</span><span data-qa="unique-bet-identification-number">BET123</span></div></div>`;
        }
      });
      render();
    },
    { cards, accOdd, decimal, receipt, debounceMs },
  );
}
