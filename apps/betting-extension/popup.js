// Popup: só o "Testar um link" e a conexão (chave). Ligar/desligar, modo,
// teto, valor da unidade e histórico ficam no Evobo (Admin → Aposta
// automática) — aqui só mostra o estado que o Evobo mandou.
const $ = (id) => document.getElementById(id);
const DEFAULT_CONFIG = { apiUrl: "https://evobo-api.fly.dev", extensionKey: "" };
const parseNum = (v) => Number(String(v).trim().replace(",", "."));
const { brl } = EvoboSummary;

async function loadConfig() {
  const { config } = await chrome.storage.local.get("config");
  return { ...DEFAULT_CONFIG, ...(config ?? {}) };
}

function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `há ${s}s` : `há ${Math.round(s / 60)} min`;
}

const ERROS = {
  sem_chave: ["Falta a chave da extensão", "Cole a chave em “Conexão com o Evobo” abaixo."],
  chave_invalida: ["Chave inválida", "Gere uma nova no Evobo e cole abaixo."],
};

async function renderStatus() {
  const c = await loadConfig();
  const { estado } = await chrome.storage.local.get("estado");
  const dot = $("dot");
  dot.className = "dot";
  let titulo;
  let sub;
  if (!c.extensionKey) [titulo, sub] = ERROS.sem_chave;
  else if (!estado) [titulo, sub] = ["Conectando ao Evobo…", ""];
  else if (estado.erro) {
    [titulo, sub] = ERROS[estado.erro] ?? ["Sem resposta do Evobo", `${estado.erro} · ${ago(estado.at)}`];
    dot.classList.add("bad");
  } else if (!estado.settings?.enabled) {
    titulo = "Desligada no Evobo";
    sub = `Nenhuma tip é aberta · atualizado ${ago(estado.at)}`;
  } else {
    const s = estado.settings;
    titulo = s.placeReal ? "Ligada · apostando de verdade" : "Ligada · só conferindo";
    sub = `Teto ${s.maxStakeReais ? `R$ ${brl(s.maxStakeReais)}` : "—"} · unidade ${s.unitValueReais ? `R$ ${brl(s.unitValueReais)}` : "não definida"} · ${ago(estado.at)}`;
    dot.classList.add(s.placeReal ? "real" : "on");
  }
  $("statusTitulo").textContent = titulo;
  $("statusSub").textContent = sub;
  // Sem chave: já abre a seção de conexão.
  if (!c.extensionKey) $("conexao").open = true;
}

// Último "Testar um link" (as tips da fila aparecem no histórico do Evobo).
async function renderResult() {
  const { log = [] } = await chrome.storage.local.get("log");
  const e = log.find((x) => x.tip?.key?.startsWith("manual:"));
  $("resultado").hidden = !e;
  if (!e) return;
  $("resBadge").className = `badge ${e.status}`;
  $("resBadge").textContent = String(e.status ?? "").toUpperCase();
  $("resQuando").textContent = new Date(e.at).toLocaleTimeString("pt-BR");
  $("resTexto").textContent = e.texto ?? "";
  $("resDetalhes").textContent = JSON.stringify({ relatorio: e.relatorio, tempos: e.tempos }, null, 2);
}

(async () => {
  const c = await loadConfig();
  $("apiUrl").value = c.apiUrl;
  $("token").value = c.extensionKey ?? "";
  await renderStatus();
  await renderResult();
})();

chrome.storage.onChanged.addListener(() => {
  renderStatus();
  renderResult();
});
// "há Xs" andando com o popup aberto.
setInterval(renderStatus, 5000);

$("salvar").addEventListener("click", async () => {
  const c = await loadConfig();
  await chrome.storage.local.set({
    config: { ...c, apiUrl: $("apiUrl").value.trim().replace(/\/+$/, "") || DEFAULT_CONFIG.apiUrl, extensionKey: $("token").value.trim() },
  });
  await chrome.storage.local.remove("estado");
  $("statusConexao").textContent = "Salvo. Conectando…";
  chrome.runtime.sendMessage({ acao: "atualizar" }).catch(() => {});
});

$("testarLink").addEventListener("click", async () => {
  const msg = $("statusTeste");
  msg.className = "msg";
  const betUrl = $("link").value.trim();
  const odd = parseNum($("odd").value);
  const unit = parseNum($("unit").value);
  const erro = (t) => {
    msg.className = "msg err";
    msg.textContent = t;
  };
  if (!/^https:\/\/([^/]+\.)?betano\.bet\.br\//.test(betUrl)) return erro("Cole um link da betano.bet.br");
  if (!(odd > 1) || !(unit > 0)) return erro("Preencha a odd e as unidades da tip");
  $("testarLink").disabled = true;
  msg.textContent = "Abrindo o link… o resultado aparece aqui.";
  try {
    const res = await chrome.runtime.sendMessage({ acao: "testar_link", betUrl, odd, unit });
    if (res?.skipped === "ja_rodando") erro("Já tem uma tip rodando — espera ela terminar.");
    else if (res?.erro) erro(res.erro);
  } catch {
    erro("A extensão não respondeu. Recarregue ela em chrome://extensions (↻).");
  } finally {
    $("testarLink").disabled = false;
  }
});
