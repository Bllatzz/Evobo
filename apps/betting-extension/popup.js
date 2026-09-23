const $ = (id) => document.getElementById(id);
const DEFAULT_CONFIG = { apiUrl: "https://evobo-api.fly.dev", extensionKey: "", maxStakeReais: 50, unitValueReais: 20, enabled: false, placeReal: false };
const parseNum = (v) => Number(String(v).trim().replace(",", "."));
const brl = (n) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function loadConfig() {
  const { config } = await chrome.storage.local.get("config");
  return { ...DEFAULT_CONFIG, ...(config ?? {}) };
}

const MOTIVOS = {
  odd_abaixo: "odd menor que a da tip",
  odd_ilegivel: "não consegui ler a odd",
  sem_cartao_correspondente: "seleção não encontrada no bilhete",
  cartao_ambiguo: "seleção ambígua no bilhete",
  acima_do_teto: "stake acima do teto",
  sem_unidade: "tip sem unidade",
};

// Linha extra quando o modo "Apostar de verdade" tentou clicar.
function linhaAposta(a) {
  if (!a) return "";
  if (a.confirmed) return `\n💰 APOSTOU — comprovante ${a.betId ?? "sem ID"}`;
  if (a.clicked) return `\n⚠ Clicou em APOSTE JÁ mas o comprovante não apareceu — VERIFICAR MANUALMENTE na Betano${a.mensagens?.length ? ` (${a.mensagens.join(" | ")})` : ""}`;
  return `\n✘ Não clicou: ${a.reason}${a.erro ? ` (${a.erro})` : ""}`;
}

function resumo(entry) {
  if (entry.tipo !== "dry_run") {
    const classe = entry.tipo === "resultado_enviado" ? "ok" : entry.tipo === "erro_resultado" ? "skip" : "neutro";
    return { classe, texto: `${entry.tipo}: ${entry.motivo ?? entry.erro ?? entry.status ?? ""}` };
  }
  const r = entry.relatorio;
  if (!r) return { classe: "skip", texto: "sem resposta da aba" };
  if (r.abort) return { classe: "skip", texto: `✘ Abortou: ${r.abort}` };
  const out = resumoPlano(r);
  return { classe: r.aposta && !r.aposta.confirmed ? "skip" : out.classe, texto: out.texto + linhaAposta(r.aposta) };
}

function resumoPlano(r) {
  const naoApostou = r.dryRun ? " — stake preenchida, não apostou" : "";
  if (r.multiplaPura) {
    const m = r.multiple;
    return m?.action === "stake"
      ? {
          classe: "ok",
          texto: `✔ Múltipla de ${m.pernas}: R$ ${brl(m.stakeReais)} @ ${m.realOdd} (tip ${m.tipOdd})${naoApostou}${m.totalConfere === false ? "\n⚠ o total do botão da Betano NÃO confere com a stake" : ""}`,
        }
      : { classe: "skip", texto: `✘ Múltipla ignorada: ${MOTIVOS[m?.reason] ?? m?.reason} (tip ${m?.tipOdd}, Betano ${m?.realOdd ?? "?"})` };
  }
  const legs = r.singles?.legs ?? [];
  return {
    classe: legs.some((l) => l.action === "stake") ? "ok" : "skip",
    texto: legs
      .map((l) =>
        l.action === "stake"
          ? `✔ R$ ${brl(l.stakeReais)} @ ${l.realOdd} (tip ${l.tipOdd})${naoApostou}${r.singles.totalConfere === false ? "\n⚠ o total do botão da Betano NÃO confere com a stake" : ""}`
          : `✘ Aposta ignorada: ${MOTIVOS[l.reason] ?? l.reason} (tip ${l.tipOdd}, Betano ${l.realOdd ?? "?"})`,
      )
      .join("\n"),
  };
}

async function renderLog() {
  const { log = [] } = await chrome.storage.local.get("log");
  const box = $("log");
  box.textContent = log.length ? "" : "Nada ainda.";
  for (const e of log) {
    const div = document.createElement("div");
    div.className = "entrada";
    const { classe, texto } = resumo(e);
    const quando = new Date(e.at).toLocaleTimeString("pt-BR");
    const titulo = !e.tip
      ? ""
      : e.tip.legs[0].match
        ? `${e.tip.legs.map((l) => l.match).join(" + ")} — ${e.tip.legs.map((l) => l.selection).join(" + ")}`
        : e.tip.betUrl;
    div.innerHTML = `<div class="titulo"></div><div class="${classe}" style="white-space:pre-wrap"></div><details><summary>detalhes</summary><pre></pre></details>`;
    div.querySelector(".titulo").textContent = `${quando} ${titulo}`;
    div.querySelector(`.${classe}`).textContent = texto;
    div.querySelector("pre").textContent = JSON.stringify(e, null, 2);
    box.appendChild(div);
  }
}

async function renderStatus() {
  const c = await loadConfig();
  $("status").textContent = !c.extensionKey ? "⚠ Falta a chave da extensão (só pro automático)" : c.enabled ? "🟢 Ligado — olhando tips novas a cada 4s" : "⚪ Desligado";
  $("placeReal").checked = c.placeReal === true;
  $("modo").innerHTML = c.placeReal
    ? `💰 <b>APOSTANDO DE VERDADE</b> nas tips da fila (teto R$ ${brl(c.maxStakeReais)} por aposta). "Testar um link" continua só conferindo.`
    : `Dry-run: abre o link, confere a odd e preenche a stake — <b>nunca aposta</b>.`;
}

// Ligar pede confirmação; desligar é imediato.
$("placeReal").addEventListener("change", async (e) => {
  const c = await loadConfig();
  if (e.target.checked && !confirm(`Apostar de verdade na Betano?\n\nA extensão vai clicar em "APOSTE JÁ" sozinha nas tips novas da fila, até R$ ${brl(c.maxStakeReais)} por aposta.`)) {
    e.target.checked = false;
    return;
  }
  await chrome.storage.local.set({ config: { ...c, placeReal: e.target.checked } });
});

(async () => {
  const c = await loadConfig();
  $("apiUrl").value = c.apiUrl;
  $("token").value = c.extensionKey ?? "";
  $("maxStake").value = c.maxStakeReais;
  $("unitValue").value = c.unitValueReais;
  await renderStatus();
  await renderLog();
})();

chrome.storage.onChanged.addListener(() => {
  renderStatus();
  renderLog();
});

$("salvar").addEventListener("click", async () => {
  const c = await loadConfig();
  await chrome.storage.local.set({
    config: {
      ...c,
      apiUrl: $("apiUrl").value.trim().replace(/\/+$/, ""),
      extensionKey: $("token").value.trim(),
      maxStakeReais: Number($("maxStake").value) || DEFAULT_CONFIG.maxStakeReais,
      unitValueReais: parseNum($("unitValue").value) || DEFAULT_CONFIG.unitValueReais,
    },
  });
});

$("testarLink").addEventListener("click", async () => {
  const betUrl = $("link").value.trim();
  const odd = parseNum($("odd").value);
  const unit = parseNum($("unit").value);
  if (!/^https:\/\/([^/]+\.)?betano\.bet\.br\//.test(betUrl)) {
    $("statusTeste").textContent = "⚠ Cole um link da betano.bet.br";
    return;
  }
  if (!(odd > 1) || !(unit > 0)) {
    $("statusTeste").textContent = "⚠ Preencha a odd e as unidades da tip";
    return;
  }
  $("statusTeste").textContent = "Abrindo o link… o resultado aparece no Histórico (reabra este popup).";
  try {
    const res = await chrome.runtime.sendMessage({ acao: "testar_link", betUrl, odd, unit });
    if (res?.skipped === "ja_rodando") $("statusTeste").textContent = "⚠ Já tem um teste rodando, espera ele terminar.";
  } catch {
    $("statusTeste").textContent = "⚠ A extensão não respondeu. Recarregue ela em chrome://extensions (botão ↻) e tente de novo.";
  }
});

$("ligar").addEventListener("click", () => chrome.runtime.sendMessage({ acao: "ligar" }));
$("desligar").addEventListener("click", () => chrome.runtime.sendMessage({ acao: "desligar" }));

$("testar").addEventListener("click", async () => {
  const horas = Math.min(24, Math.max(1, Number($("horas").value) || 3));
  $("status").textContent = "Processando…";
  const res = await chrome.runtime.sendMessage({
    acao: "processar_desde",
    since: new Date(Date.now() - horas * 3600_000).toISOString(),
  });
  $("status").textContent = `Resultado: ${JSON.stringify(res)}`;
});

// Modo manual (fase 1): a tip colada como JSON, rodando na aba ativa.
const EXEMPLO = {
  tipId: "teste-1",
  unitValueReais: 10,
  maxStakeReais: 50,
  limitReais: null,
  legs: [{ id: "a", match: "Corinthians x Bahia", selection: "Corinthians (F)", odd: 1.28, unit: 1 }],
};
$("task").value = JSON.stringify(EXEMPLO, null, 2);

$("rodar").addEventListener("click", async () => {
  const saida = $("saida");
  let task;
  try {
    task = JSON.parse($("task").value);
  } catch (e) {
    saida.textContent = `JSON inválido: ${e.message}`;
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:\/\/([^/]+\.)?betano\.bet\.br\//.test(tab.url)) {
    saida.textContent = "Abra a aba da Betano (betano.bet.br) e tente de novo.";
    return;
  }
  saida.textContent = "Rodando…";
  try {
    const rel = await chrome.tabs.sendMessage(tab.id, { acao: "rodar_dry_run", task });
    saida.textContent = JSON.stringify(rel, null, 2);
  } catch {
    saida.textContent = "A aba não respondeu. Recarregue a página da Betano (F5) depois de instalar/atualizar a extensão.";
  }
});
