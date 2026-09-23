// Consulta a fila do Evobo, abre cada tip nova da Betano numa aba, confere a
// odd e preenche a stake. Por padrão PARA aí (dry-run); só com a chave
// "Apostar de verdade" (config.placeReal) o content script clica em
// "APOSTE JÁ" — ver placeBet em betano/run.js.
//
// Estado em chrome.storage.local:
//   config  { apiUrl, extensionKey, maxStakeReais, unitValueReais, enabled, placeReal }
//   since   ISO — só tips recebidas depois disso entram (definido ao ligar)
//   done    { [taskKey]: true } — tips já processadas (ou desistidas)
//   waiting { [taskKey]: firstSeenMs } — tips esperando a OCR preencher odd/unidade
//   log     últimos relatórios, mais novo primeiro

const POLL_ALARM = "evobo-poll";
const POLL_MINUTES = 0.5; // mínimo do chrome.alarms — só a reserva do laço rápido
// Laço rápido enquanto ligado: o alarme sozinho só acordava a cada 30s, o
// que somava até 30s entre a tip chegar no Evobo e a aba da Betano abrir.
// Cada volta chama chrome.storage, o que mantém o service worker vivo; se o
// Chrome derrubar ele mesmo assim, o alarme de 30s religa o laço.
const FAST_POLL_MS = 4000;
const MAX_LOG = 30;
const WAIT_FOR_OCR_MS = 10 * 60 * 1000;
const SLIP_DEADLINE_MS = 45000; // tempo máximo pra página da Betano montar o bilhete
const SLIP_RETRY_MS = 1000;

const DEFAULT_CONFIG = { apiUrl: "https://evobo-api.fly.dev", extensionKey: "", maxStakeReais: 50, unitValueReais: 20, enabled: false, placeReal: false };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (k, fallback) => (await chrome.storage.local.get(k))[k] ?? fallback;
const set = (k, v) => chrome.storage.local.set({ [k]: v });

async function getConfig() {
  return { ...DEFAULT_CONFIG, ...(await get("config", {})) };
}

async function pushLog(entry) {
  const log = await get("log", []);
  log.unshift({ at: new Date().toISOString(), ...entry });
  await set("log", log.slice(0, MAX_LOG));
}

function toRunnerTask(task, unitValueReais, config) {
  return {
    tipId: task.key,
    // Aposta de verdade só com a chave ligada no popup E uma tip da fila do
    // Evobo — o "Testar um link" (key manual:…) é sempre dry-run.
    placeReal: config.placeReal === true && !task.key.startsWith("manual:"),
    unitValueReais,
    maxStakeReais: config.maxStakeReais,
    limitReais: task.limitReais,
    // Texto original da mensagem: numa múltipla pura é o único lugar com
    // todos os jogos (a tip gravada só guarda o 1º) — ver planPureMultiple.
    rawMessage: task.rawMessage ?? null,
    legs: task.legs.map((l) => ({ id: l.tipId, match: l.match, selection: l.selection, odd: l.odd, unit: l.unit })),
  };
}

// O link de booking code monta o bilhete depois do load — tenta de novo
// enquanto o bilhete não aparece ou ainda não tem as seleções da tip.
async function runInTab(tabId, runnerTask) {
  let last = null;
  const deadline = Date.now() + SLIP_DEADLINE_MS;
  let first = true;
  while (Date.now() < deadline) {
    await sleep(first ? 300 : SLIP_RETRY_MS);
    first = false;
    try {
      last = await chrome.tabs.sendMessage(tabId, { acao: "rodar_dry_run", task: runnerTask });
    } catch (e) {
      last = { ok: false, abort: "aba_nao_respondeu", erro: String(e?.message ?? e) };
      continue;
    }
    // Bilhete vazio ou com MENOS seleções que a tip = ainda montando.
    const count = /^contagem_diferente \(tip tem (\d+), bilhete tem (\d+)\)/.exec(last?.abort ?? "");
    const slipNotReady = last?.abort === "bilhete_nao_encontrado" || (count && Number(count[2]) < Number(count[1]));
    if (!slipNotReady) return last;
  }
  return last;
}

async function openAndRun(task, unitValueReais, config, esperouOcrMs = 0) {
  // Quanto tempo se passou da mensagem no Telegram até a aba abrir (e
  // quanto disso foi esperando a OCR preencher odd/unidade) — pra saber
  // onde está a demora em vez de chutar.
  const abriuEm = Date.now();
  const tempos = {
    mensagemAteAbaS: Math.round((abriuEm - new Date(task.receivedAt).getTime()) / 1000),
    esperouOcrS: Math.round(esperouOcrMs / 1000),
  };
  // Sem esperar o load completo: o content script entra em document_idle e
  // runInTab já tenta de novo a cada 1s até o bilhete aparecer.
  const tab = await chrome.tabs.create({ url: task.betUrl, active: true });

  // Espera a página da Betano carregar ANTES de conectar o depurador:
  // conectando junto com a abertura da aba (2026-09-23) a página nunca
  // mostrou o cabeçalho — "pagina_nao_carregou" em 16s.
  let status;
  try {
    status = await askTab(tab.id, { acao: "login_status" }, 25000);
  } catch (e) {
    status = { pronto: false, erro: String(e?.message ?? e) };
  }
  if (!status?.pronto) {
    tempos.abaAteFimS = Math.round((Date.now() - abriuEm) / 1000);
    await pushLog({ tipo: "dry_run", tip: task, relatorio: { ok: false, abort: "pagina_nao_carregou", pagina: status }, tempos });
    return null;
  }

  // Sem a conexão (ex.: DevTools aberto na aba) os cliques ainda tentam,
  // conectando um por um — o relatório mostra se falharem.
  const held = await holdDebugger(tab.id).then(
    () => true,
    () => false,
  );
  try {
    return await runOpenedTab(tab, task, unitValueReais, config, abriuEm, tempos, held, status);
  } finally {
    if (held) await releaseDebugger(tab.id);
  }
}

async function runOpenedTab(tab, task, unitValueReais, config, abriuEm, tempos, held, status) {
  tempos.depuradorFixo = held;
  const runnerTask = toRunnerTask(task, unitValueReais, config);

  // Deslogado = não dá pra apostar: loga primeiro. Depois do login a
  // Betano pode redesenhar a página, então abre o link da tip de novo pra
  // montar o bilhete do zero.
  let login;
  try {
    login = await ensureLoggedIn(tab.id, config, status);
  } catch (e) {
    login = { ok: false, motivo: "erro", erro: String(e?.message ?? e) };
  }
  if (!login.ok) {
    tempos.abaAteFimS = Math.round((Date.now() - abriuEm) / 1000);
    await pushLog({ tipo: "dry_run", tip: task, relatorio: { ok: false, abort: `login_falhou (${login.falhouEm ? `${login.falhouEm}: ` : ""}${login.motivo ?? "?"})`, login }, tempos });
    return null;
  }
  if (login.logou) {
    await chrome.tabs.update(tab.id, { url: task.betUrl });
    await sleep(1500);
  }

  const report = await runInTab(tab.id, runnerTask);
  if (report && login.logou) report.login = { logouAntes: true, passos: login.passos };
  tempos.abaAteFimS = Math.round((Date.now() - abriuEm) / 1000);
  await pushLog({ tipo: "dry_run", tip: task, relatorio: report, tempos });
  if (runnerTask.placeReal && report?.aposta?.confirmed) await reportResult(task, report, config);
  return report;
}

// Aposta confirmada pelo comprovante → grava o "peguei" com a odd real e a
// API reage 👍 na mensagem do Telegram (POST /betting-queue/result). Sem
// comprovante nada é enviado: fica no histórico como "verificar manualmente".
async function reportResult(task, report, config) {
  const legs = report.multiplaPura
    ? [{ tipId: task.legs[0].tipId, placed: true, realOdd: report.multiple.realOdd, stakeReais: report.multiple.stakeReais }]
    : report.singles.legs.map((l) => ({
        tipId: l.legId,
        placed: l.action === "stake",
        realOdd: l.action === "stake" ? l.realOdd : null,
        stakeReais: l.action === "stake" ? l.stakeReais : null,
      }));
  try {
    const res = await fetch(`${config.apiUrl}/betting-queue/result`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-extension-key": config.extensionKey },
      body: JSON.stringify({ key: task.key, legs, betId: report.aposta.betId ?? null }),
    });
    const body = await res.json().catch(() => null);
    await pushLog({ tipo: res.ok ? "resultado_enviado" : "erro_resultado", status: res.status, motivo: body?.reaction ?? body?.error ?? null });
  } catch (e) {
    await pushLog({ tipo: "erro_resultado", erro: String(e?.message ?? e) });
  }
}

// Clique "confiável" (isTrusted) via protocolo do DevTools: a Betano ignora
// cliques sintéticos de script no cabeçalho do bilhete (testado 2026-09-22).
// Conecta só pelo tempo do clique — enquanto conectado o Chrome mostra a
// faixa "Evobo Betano está depurando este navegador". Falha se o DevTools
// estiver aberto nessa aba (só um depurador por vez).
//
// Conectar faz o Chrome mostrar a faixa de depuração no topo, que EMPURRA a
// página pra baixo (e desconectar a puxa de volta). Conectando a cada clique,
// o ponto medido antes do clique já estava fora do lugar quando o clique
// acontecia — no login real de 2026-09-23 o modal abriu e depois fechou sem
// logar. Por isso openAndRun deixa a aba conectada do começo ao fim
// (holdDebugger) e os cliques reusam essa conexão.
const heldTabs = new Set();

chrome.debugger.onDetach.addListener((source) => heldTabs.delete(source.tabId));

async function holdDebugger(tabId) {
  await chrome.debugger.attach({ tabId }, "1.3");
  heldTabs.add(tabId);
  await sleep(600); // a faixa aparece e a página se reajusta antes de qualquer medida
}

async function releaseDebugger(tabId) {
  heldTabs.delete(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => {});
}

async function withDebugger(tabId, fn) {
  const target = { tabId };
  if (heldTabs.has(tabId)) return fn(target);
  await chrome.debugger.attach(target, "1.3");
  try {
    return await fn(target);
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function cdpClick(target, x, y) {
  await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  for (const type of ["mousePressed", "mouseReleased"]) {
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
}

const trustedClick = (tabId, x, y) => withDebugger(tabId, (t) => cdpClick(t, x, y));

// Clica no campo e digita com o teclado do Chrome (Input.insertText) — o
// texto nunca passa pelo content script nem pelo JS da página.
const trustedType = (tabId, { x, y }, value) =>
  withDebugger(tabId, async (t) => {
    await cdpClick(t, x, y);
    await sleep(150);
    await chrome.debugger.sendCommand(t, "Input.insertText", { text: value });
  });

const pressEnter = (tabId) =>
  withDebugger(tabId, async (t) => {
    for (const type of ["keyDown", "keyUp"]) {
      await chrome.debugger.sendCommand(t, "Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    }
  });

// Pergunta ao content script, tentando de novo enquanto ele ainda não
// carregou na aba (a página acabou de abrir).
async function askTab(tabId, msg, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < end) {
    try {
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      lastErr = e;
      await sleep(500);
    }
  }
  throw lastErr ?? new Error("aba_nao_respondeu");
}

// Tipo de login pela cara do usuário salvo no Evobo (aba do formulário).
function loginKind(username) {
  if (username.includes("@")) return "email";
  if (/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(username.trim())) return "cpf";
  return "usuario";
}

// Loga na Betano se a aba estiver deslogada (botão ENTRAR no cabeçalho).
// Usuário e senha vêm do Evobo (salvos criptografados no perfil → "Aposta
// automática") e só existem nesta função, em memória.
async function ensureLoggedIn(tabId, config, st) {
  if (st.logado) return { ok: true, jaLogado: true };

  const res = await fetch(`${config.apiUrl}/auto-betting/extension/credentials/betano`, {
    headers: { "x-extension-key": config.extensionKey },
  });
  if (!res.ok) return { ok: false, motivo: res.status === 404 ? "login_da_betano_nao_salvo_no_evobo" : `erro_credencial_${res.status}` };
  let cred = await res.json();
  // Cada passo vai pro histórico com o elemento em que clicou — se o modal
  // fechar ou o login não passar, dá pra ver onde (login real de 2026-09-23
  // abriu o modal e o fechou sem logar, sem dizer em que passo).
  const passos = [];
  const falhou = (r, passo) => ({ ok: false, ...r, falhouEm: passo, passos });
  // Pede o ponto do alvo AGORA (nunca guardado de antes) e o usa na hora.
  const ponto = async (alvo) => askTab(tabId, { acao: "login_ponto", alvo });
  try {
    const botao = await askTab(tabId, { acao: "login_botao" });
    if (!botao) return falhou({ motivo: "botao_entrar_nao_encontrado" }, "entrar");
    await trustedClick(tabId, botao.x, botao.y);
    passos.push({ passo: "entrar", ponto: botao });

    const tipo = loginKind(cred.username);
    const aba = await askTab(tabId, { acao: "login_aba", tipo }, 20000);
    if (!aba?.ok) return falhou(aba, "aba");
    await trustedClick(tabId, aba.ponto.x, aba.ponto.y);
    passos.push({ passo: `aba_${tipo}`, alvo: aba.alvo, ponto: aba.ponto });
    await sleep(400); // a aba troca o campo de Login ID

    const campos = await askTab(tabId, { acao: "login_campos" });
    if (!campos?.ok) return falhou(campos, "campos");

    const u = await ponto("usuario");
    if (!u?.ok) return falhou(u, "usuario");
    await trustedType(tabId, u.ponto, cred.username);
    passos.push({ passo: "usuario", alvo: u.alvo, ponto: u.ponto });

    const s = await ponto("senha");
    if (!s?.ok) return falhou(s, "senha");
    await trustedType(tabId, s.ponto, cred.password);
    passos.push({ passo: "senha", alvo: s.alvo, ponto: s.ponto });
  } finally {
    cred = null; // não guardar a senha além do necessário
  }
  await sleep(300);
  const enviar = await ponto("enviar");
  if (!enviar?.ok) return falhou(enviar, "enviar");
  if (enviar.ponto && !enviar.desabilitado) {
    await trustedClick(tabId, enviar.ponto.x, enviar.ponto.y);
    passos.push({ passo: "enviar", alvo: enviar.alvo, ponto: enviar.ponto });
  } else {
    await pressEnter(tabId); // o foco ficou no campo de senha
    passos.push({ passo: "enter", alvo: enviar.alvo ?? "sem botão INICIAR SESSÃO", desabilitado: !!enviar.desabilitado });
  }

  const fim = await askTab(tabId, { acao: "login_aguardar" }, 30000);
  return fim?.ok ? { ok: true, logou: true, passos } : falhou(fim, "aguardar");
}

let running = false;

async function poll({ manualSince } = {}) {
  if (running) return { skipped: "ja_rodando" };
  running = true;
  try {
    const config = await getConfig();
    if (!config.extensionKey) return { skipped: "sem_chave" };
    if (!config.enabled && !manualSince) return { skipped: "desligado" };

    const since = manualSince ?? (await get("since", new Date().toISOString()));
    const res = await fetch(`${config.apiUrl}/betting-queue/betano?since=${encodeURIComponent(since)}`, {
      headers: { "x-extension-key": config.extensionKey },
    });
    if (!res.ok) {
      await pushLog({ tipo: "erro_api", status: res.status });
      return { erro: res.status };
    }
    const { unitValueReais, tasks } = await res.json();

    const done = await get("done", {});
    const waiting = await get("waiting", {});
    let processed = 0;

    for (const task of tasks) {
      // "Testar agora" reprocessa de propósito — é pra repetir o teste.
      if (done[task.key] && !manualSince) continue;

      // A OCR pode ainda não ter preenchido odd/unidade — espera um pouco.
      if (task.legs.some((l) => l.odd === null || l.unit === null)) {
        waiting[task.key] ??= Date.now();
        if (Date.now() - waiting[task.key] < WAIT_FOR_OCR_MS) continue;
        done[task.key] = true;
        await pushLog({ tipo: "desistiu", motivo: "tip_sem_odd_ou_unidade", tip: task });
        continue;
      }
      if (!unitValueReais) {
        await pushLog({ tipo: "desistiu", motivo: "sem_valor_da_unidade_no_evobo", tip: task });
        done[task.key] = true;
        continue;
      }

      done[task.key] = true; // marca antes: nunca abrir a mesma tip duas vezes
      const esperouOcrMs = waiting[task.key] ? Date.now() - waiting[task.key] : 0;
      delete waiting[task.key];
      await set("done", done);

      // "Testar agora" reprocessa tips já feitas de propósito — nunca pode
      // apostar de verdade, senão apostaria de novo numa aba nova (a marca
      // anti-clique-duplo é por aba).
      await openAndRun(task, unitValueReais, manualSince ? { ...config, placeReal: false } : config, esperouOcrMs);
      processed++;
    }

    await set("done", done);
    await set("waiting", waiting);
    return { tarefas: tasks.length, processadas: processed };
  } catch (e) {
    await pushLog({ tipo: "erro", erro: String(e?.message ?? e) });
    return { erro: String(e?.message ?? e) };
  } finally {
    running = false;
  }
}

let fastLoopOn = false;
async function fastLoop() {
  if (fastLoopOn) return;
  fastLoopOn = true;
  try {
    while ((await getConfig()).enabled) {
      await poll();
      await sleep(FAST_POLL_MS);
    }
  } finally {
    fastLoopOn = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_MINUTES });
  fastLoop();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_MINUTES });
  fastLoop();
});
chrome.alarms.onAlarm.addListener((a) => a.name === POLL_ALARM && fastLoop());

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  // Pedido do content script (só pro cabeçalho do bilhete — ver slip.js).
  if (msg?.acao === "clique_confiavel") {
    const tabId = sender.tab?.id;
    if (!tabId || !/^https:\/\/([^/]+\.)?betano\.bet\.br\//.test(sender.tab.url ?? "")) {
      send({ ok: false, erro: "aba_invalida" });
      return;
    }
    trustedClick(tabId, msg.x, msg.y).then(
      () => send({ ok: true }),
      (e) => send({ ok: false, erro: String(e?.message ?? e) }),
    );
    return true;
  }
  if (msg?.acao === "ligar") {
    // Ligar = só tips que chegarem daqui pra frente.
    (async () => {
      await set("config", { ...(await getConfig()), enabled: true });
      await set("since", new Date().toISOString());
      send({ ok: true });
      fastLoop();
    })();
    return true;
  }
  if (msg?.acao === "desligar") {
    getConfig().then((c) => set("config", { ...c, enabled: false })).then(() => send({ ok: true }));
    return true;
  }
  // Teste local sem a API: o link vem colado e odd/unidade digitadas da mensagem.
  if (msg?.acao === "testar_link") {
    (async () => {
      if (running) return send({ skipped: "ja_rodando" });
      running = true;
      try {
        const config = await getConfig();
        const task = {
          key: `manual:${Date.now()}`,
          groupName: "teste manual",
          receivedAt: new Date().toISOString(),
          betUrl: msg.betUrl,
          limitReais: null,
          legs: [{ tipId: "manual", match: null, selection: null, odd: msg.odd, unit: msg.unit }],
        };
        send({ ok: true });
        await openAndRun(task, config.unitValueReais, config);
      } finally {
        running = false;
      }
    })();
    return true;
  }
  if (msg?.acao === "processar_desde") {
    poll({ manualSince: msg.since }).then(send);
    return true;
  }
});
