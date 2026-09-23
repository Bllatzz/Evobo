// Fase 2 (dry-run): consulta a fila do Evobo, abre cada tip nova da Betano
// numa aba, confere a odd e preenche a stake — e PARA. Nenhum código aqui ou
// no content script clica em "APOSTE JÁ".
//
// Estado em chrome.storage.local:
//   config  { apiUrl, extensionKey, maxStakeReais, unitValueReais, enabled }
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

async function openAndRun(task, unitValueReais, config) {
  // Sem esperar o load completo: o content script entra em document_idle e
  // runInTab já tenta de novo a cada 1s até o bilhete aparecer.
  const tab = await chrome.tabs.create({ url: task.betUrl, active: true });
  const runnerTask = toRunnerTask(task, unitValueReais, config);
  const report = await runInTab(tab.id, runnerTask);
  await pushLog({ tipo: "dry_run", tip: task, relatorio: report });
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
async function trustedClick(tabId, x, y) {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    for (const type of ["mousePressed", "mouseReleased"]) {
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    }
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
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
      delete waiting[task.key];
      await set("done", done);

      // "Testar agora" reprocessa tips já feitas de propósito — nunca pode
      // apostar de verdade, senão apostaria de novo numa aba nova (a marca
      // anti-clique-duplo é por aba).
      await openAndRun(task, unitValueReais, manualSince ? { ...config, placeReal: false } : config);
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
