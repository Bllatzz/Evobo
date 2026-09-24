// Popup: só ligar/desligar e o "Testar um link". Modo, teto, valor da
// unidade, logins e histórico ficam no Evobo (/auto-betting). A conexão
// (chave) só aparece quando falta ou é inválida, ou pelo "trocar chave".
const $ = (id) => document.getElementById(id);
const DEFAULT_CONFIG = { extensionKey: "" };
const parseNum = (v) => Number(String(v).trim().replace(",", "."));

async function loadConfig() {
  const { config } = await chrome.storage.local.get("config");
  return { ...DEFAULT_CONFIG, ...(config ?? {}) };
}

function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `há ${s}s` : `há ${Math.round(s / 60)} min`;
}

const ERROS = {
  sem_chave: ["Falta a chave da extensão", "Gere no Evobo e cole abaixo."],
  chave_invalida: ["Chave inválida", "Gere uma nova no Evobo e cole abaixo."],
};

let mostrarConexao = false;

async function renderStatus() {
  const c = await loadConfig();
  const { estado } = await chrome.storage.local.get("estado");
  const dot = $("dot");
  dot.className = "dot";
  const conectado = !!c.extensionKey && !!estado && !estado.erro;
  $("toggle").hidden = !conectado;
  $("toggle").setAttribute("aria-pressed", String(!!estado?.settings?.enabled));
  $("conexao").hidden = !(mostrarConexao || !c.extensionKey || ["sem_chave", "chave_invalida"].includes(estado?.erro));
  let titulo;
  let sub;
  if (!c.extensionKey) [titulo, sub] = ERROS.sem_chave;
  else if (!estado) [titulo, sub] = ["Conectando ao Evobo…", ""];
  else if (estado.erro) {
    [titulo, sub] = ERROS[estado.erro] ?? ["Sem resposta do Evobo", `${estado.erro} · ${ago(estado.at)}`];
    dot.classList.add("bad");
  } else if (!estado.settings?.enabled) {
    titulo = "Desligada";
    sub = "Nenhuma tip é aberta";
  } else {
    const s = estado.settings;
    titulo = "Ligada";
    sub = s.placeReal ? "Apostando de verdade" : "Só conferindo (não aposta)";
    dot.classList.add(s.placeReal ? "real" : "on");
  }
  $("statusTitulo").textContent = titulo;
  $("statusSub").textContent = sub;
}

$("toggle").addEventListener("click", async () => {
  const btn = $("toggle");
  const ligar = btn.getAttribute("aria-pressed") !== "true";
  btn.disabled = true;
  $("statusErro").textContent = "";
  try {
    const res = await chrome.runtime.sendMessage({ acao: ligar ? "ligar" : "desligar" });
    if (res?.erro) $("statusErro").textContent = res.erro;
  } catch {
    $("statusErro").textContent = "A extensão não respondeu. Recarregue em chrome://extensions (↻).";
  } finally {
    btn.disabled = false;
    renderStatus();
  }
});

// Versão nova publicada no Evobo (gerada a cada deploy do site por
// apps/web/scripts/build-extension.mjs) → aviso pra baixar de novo.
const newer = (a, b) => {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
};
fetch("https://evobo.vercel.app/downloads/evobo-extensao.json", { cache: "no-store" })
  .then((r) => (r.ok ? r.json() : null))
  .then((latest) => {
    const mine = chrome.runtime.getManifest?.().version;
    if (!latest?.version || !mine || !newer(latest.version, mine)) return;
    $("atualizacao").textContent = `⬆ Versão ${latest.version} disponível (você tem a ${mine}) — baixar no Evobo`;
    $("atualizacao").hidden = false;
  })
  .catch(() => {});

$("trocarChave").addEventListener("click", () => {
  mostrarConexao = !mostrarConexao;
  renderStatus();
});

(async () => {
  const c = await loadConfig();
  $("token").value = c.extensionKey ?? "";
  await renderStatus();
})();

chrome.storage.onChanged.addListener(() => {
  renderStatus();
});
// "há Xs" andando com o popup aberto.
setInterval(renderStatus, 5000);

$("salvar").addEventListener("click", async () => {
  // Só a chave — o endereço do Evobo é fixo no background.
  await chrome.storage.local.set({ config: { extensionKey: $("token").value.trim() } });
  await chrome.storage.local.remove("estado");
  $("statusConexao").textContent = "Salvo. Conectando…";
  mostrarConexao = false;
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
  if (!/^https:\/\/([^/]+\.)?(betano|bet365)\.bet\.br\//.test(betUrl)) return erro("Cole um link da Betano ou da Bet365");
  if (!(odd > 1) || !(unit > 0)) return erro("Preencha a odd e as unidades da tip");
  $("testarLink").disabled = true;
  msg.textContent = "Abrindo o link… o resultado aparece no histórico do Evobo.";
  try {
    const res = await chrome.runtime.sendMessage({ acao: "testar_link", betUrl, odd, unit, boost: $("aumento").checked });
    if (res?.skipped === "ja_rodando") erro("Já tem uma tip rodando — espera ela terminar.");
    else if (res?.erro) erro(res.erro);
  } catch {
    erro("A extensão não respondeu. Recarregue ela em chrome://extensions (↻).");
  } finally {
    $("testarLink").disabled = false;
  }
});
