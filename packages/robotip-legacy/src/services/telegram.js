'use strict';

// O env já é carregado pelo processo do evobo-api (`-r dotenv/config` /
// startup do host) — não recarrega aqui como o robotip-analyzer original
// fazia, pra não arriscar sobrescrever variáveis já resolvidas pelo host.

const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage, Raw } = require('telegram/events');

// Emoji usado pra marcar, via reação na mensagem do alerta no Telegram, se a
// entrada foi tomada ou não. Green/red continuam vindo do reply do tipster
// (parseResult) ou de ajuste manual — a reação só controla `entered`.
const REACAO_ENTREI    = '👍';
const REACAO_NAO_ENTREI = '👎';
const input = require('input');
const pool = require('../db/pool');
const fs = require('fs');
const path = require('path');

const { parseAlert, parseResult, entryAlternatives } = require('./parser');
const { broadcast } = require('../routes/alerts');
const { extractGameId, fetchStatsFeed } = require('./statsFeed');
const CORNER_BASELINE_BOTS = require('../config/cornerBaselineBots');

const ENV_PATH = path.join(__dirname, '../../.env');

/**
 * Atualiza o valor de ROBOTIP_TELEGRAM_SESSION no arquivo .env local sem
 * sobrescrever as demais variáveis. Só útil em dev — no Fly o filesystem é
 * efêmero, então um login interativo em produção exige atualizar o secret
 * manualmente depois.
 */
function saveSessionToEnv(sessionString) {
  let envContent = fs.readFileSync(ENV_PATH, 'utf8');
  if (envContent.includes('ROBOTIP_TELEGRAM_SESSION=')) {
    envContent = envContent.replace(
      /ROBOTIP_TELEGRAM_SESSION=.*/,
      `ROBOTIP_TELEGRAM_SESSION=${sessionString}`
    );
  } else {
    envContent += `\nROBOTIP_TELEGRAM_SESSION=${sessionString}`;
  }
  fs.writeFileSync(ENV_PATH, envContent, 'utf8');
  console.log('Session salva no .env com sucesso.');
}

/**
 * Bots em CORNER_BASELINE_BOTS não mandam o total de escanteios na mensagem
 * do alerta — sem isso o cornerAutoChecker nunca teria um baseline pra
 * comparar com o total final. Captura esse baseline ao vivo via StatsFeed
 * assim que o alerta chega (muta `parsed` in-place).
 */
async function fillCornerBaseline(parsed) {
  if (!CORNER_BASELINE_BOTS.includes(parsed.bot_name)) return;
  if (parsed.corners_home != null && parsed.corners_away != null) return;
  if (!parsed.robotip_url) return;

  const gameId = extractGameId(parsed.robotip_url);
  if (!gameId) return;

  try {
    const stats = await fetchStatsFeed(gameId, { ended: false });
    if (!stats) return;
    const home = Number(stats.corners_home);
    const away = Number(stats.corners_away);
    if (!Number.isFinite(home) || !Number.isFinite(away)) return;
    parsed.corners_home = home;
    parsed.corners_away = away;
  } catch (err) {
    console.warn(
      `[CORNER-BASELINE] Falha ao capturar baseline de escanteios para ${parsed.home_team} x ${parsed.away_team}:`,
      err.message
    );
  }
}

/**
 * Insere um alerta parseado no banco de dados.
 */
/**
 * O robotip.com.br às vezes dispara o MESMO alerta duas vezes em menos de 1s
 * (mesmo bot, mesmo jogo, texto quase idêntico — só o rodapé de casas de
 * aposta muda). Isso cria duas linhas pendentes pro mesmo evento, mas o
 * resultado só chega numa mensagem — updateAlertResult() sempre fecha a mais
 * recente (ORDER BY received_at DESC LIMIT 1), e a outra fica pending pra
 * sempre. Visto em produção: "Sevilla x Atletico Madrid" (FT - Under 2.5
 * Cartões V3.0, telegram_message_id 83432/83433, 0.3s de diferença) — 26 dos
 * 74 alertas desse bot ficaram assim.
 *
 * Guarda de 30s (bem maior que a folga entre duplicatas reais e bem menor
 * que o intervalo entre dois disparos legítimos do mesmo bot no mesmo jogo,
 * que só aconteceria minutos depois com as estatísticas mudadas) — se já
 * existe um alerta do mesmo bot+jogo nesse intervalo, ignora o novo em vez
 * de inserir uma duplicata.
 */
const DUPLICATE_ALERT_WINDOW_SECONDS = 30;

async function findRecentDuplicateAlert({ bot_name, home_team, away_team, robotip_url }) {
  const { rows } = await pool.query(
    `SELECT id FROM alerts
     WHERE bot_name = $1 AND home_team = $2 AND away_team = $3
       AND ($4::text IS NULL OR robotip_url = $4)
       AND received_at >= NOW() - ($5 || ' seconds')::interval
     ORDER BY received_at DESC LIMIT 1`,
    [bot_name, home_team, away_team, robotip_url, DUPLICATE_ALERT_WINDOW_SECONDS]
  );
  return rows[0] ?? null;
}

async function saveAlert(parsed, rawMessage, telegramMessageId) {
  const {
    bot_name, odds, bet_odds, home_team, away_team, robotip_url, bet365_url, game_minute,
    home_odds, draw_odds, away_odds, competition, score_home, score_away,
    last_goal_minute, last_goal_minute_away,
    corners_home, corners_away, last_corner_minute, last_corner_minute_home, last_corner_minute_away,
    goals_over_odds, stake_pct,
    dangerous_home, dangerous_away, dangerous_per_min_5, dangerous_per_min_total,
    yellow_home, yellow_away, last_yellow_minute_home, last_yellow_minute_away,
    red_home, red_away,
    shots_side_home, shots_side_away, last_shot_side_minute_home, last_shot_side_minute_away,
    shots_target_home, shots_target_away, last_shot_target_minute_home, last_shot_target_minute_away,
    possession_home, possession_away, pi1, pi2,
  } = parsed;

  const duplicate = await findRecentDuplicateAlert({ bot_name, home_team, away_team, robotip_url });
  if (duplicate) {
    console.log(`[DUP] Alerta ignorado (duplicata do #${duplicate.id}): ${home_team} x ${away_team} - ${bot_name}`);
    return null;
  }

  const { rows } = await pool.query(
    `INSERT INTO alerts (
      bot_name, odds, bet_odds, home_team, away_team, robotip_url, bet365_url, game_minute,
      home_odds, draw_odds, away_odds, competition, score_home, score_away,
      last_goal_minute, last_goal_minute_away,
      corners_home, corners_away, last_corner_minute, last_corner_minute_home, last_corner_minute_away,
      goals_over_odds, stake_pct,
      dangerous_home, dangerous_away, dangerous_per_min_5, dangerous_per_min_total,
      yellow_home, yellow_away, last_yellow_minute_home, last_yellow_minute_away,
      red_home, red_away,
      shots_side_home, shots_side_away, last_shot_side_minute_home, last_shot_side_minute_away,
      shots_target_home, shots_target_away, last_shot_target_minute_home, last_shot_target_minute_away,
      possession_home, possession_away, pi1, pi2, raw_message, telegram_message_id
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
      $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,
      $36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47
    ) RETURNING *`,
    [
      bot_name, odds, bet_odds, home_team, away_team, robotip_url, bet365_url, game_minute,
      home_odds, draw_odds, away_odds, competition, score_home, score_away,
      last_goal_minute, last_goal_minute_away,
      corners_home, corners_away, last_corner_minute, last_corner_minute_home, last_corner_minute_away,
      goals_over_odds, stake_pct,
      dangerous_home, dangerous_away, dangerous_per_min_5, dangerous_per_min_total,
      yellow_home, yellow_away, last_yellow_minute_home, last_yellow_minute_away,
      red_home, red_away,
      shots_side_home, shots_side_away, last_shot_side_minute_home, last_shot_side_minute_away,
      shots_target_home, shots_target_away, last_shot_target_minute_home, last_shot_target_minute_away,
      possession_home, possession_away, pi1, pi2, rawMessage, telegramMessageId,
    ]
  );
  broadcast('new-alert', rows[0]);
  return rows[0];
}

/**
 * Atualiza `entered` (peguei / não peguei a entrada) a partir de uma reação
 * do usuário na mensagem do alerta no Telegram. Não mexe em `result` —
 * green/red/reembolso continuam vindo do reply do tipster ou de ajuste manual.
 */
async function updateAlertEntered(telegramMessageId, entered) {
  const { rows } = await pool.query(
    `UPDATE alerts SET entered = $1 WHERE telegram_message_id = $2 RETURNING *`,
    [entered, telegramMessageId]
  );
  const alert = rows[0];
  if (alert) broadcast('alert-updated', alert);
  return alert;
}

/**
 * Atualiza o resultado (green/red) do alerta pendente correspondente.
 * Quando `entry` está disponível, usa-o para distinguir entre múltiplos
 * alertas do mesmo jogo com entradas diferentes (ex: over +0.5 vs over +1.0).
 */
async function updateAlertResult({ home_team, away_team, result, entry }) {
  const patterns = entry
    ? entryAlternatives(entry).map((e) => `%${e}%`)
    : null;

  const res = await pool.query(
    `UPDATE alerts SET result = $1
     WHERE id = (
       SELECT id FROM alerts
       WHERE LOWER(home_team) = LOWER($2)
         AND LOWER(away_team) = LOWER($3)
         AND result = 'pending'
         AND ($4::text[] IS NULL OR raw_message ILIKE ANY($4::text[]))
       ORDER BY received_at DESC
       LIMIT 1
     )
     RETURNING *`,
    [result, home_team, away_team, patterns]
  );
  const alert = res.rows[0];
  if (!alert) return null;

  await syncGestaoBanca(alert, result);

  return alert;
}

/**
 * Reflete o resultado (green/red/reembolso) de um alerta na gestão de banca.
 * Compartilhado entre o fluxo normal (reply do tipster) e a conferência
 * automática de escanteios (cornerAutoChecker).
 */
async function syncGestaoBanca(alert, result) {
  if (!['green', 'red', 'reembolso'].includes(result)) return;

  await pool.query(
    `INSERT INTO gestao_banca (alert_id, bot_name, home_team, away_team, competition, result, bet_odds, stake_pct, received_at)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::numeric,$8::numeric,$9::numeric),$10,$11)
     ON CONFLICT (alert_id) DO UPDATE SET result = EXCLUDED.result`,
    [
      alert.id, alert.bot_name, alert.home_team, alert.away_team, alert.competition,
      result,
      alert.bet_odds, alert.goals_over_odds, alert.odds,
      alert.stake_pct ?? 1,
      alert.received_at,
    ]
  );
}

/**
 * CATCHUP (acima) só reprocessa ALERTAS perdidos, nunca RESULTADOS — um gap
 * que ficou visível na migração: o listener passou por período(s) "vivo mas
 * surdo" (ver watchdog em startTelegramListener) em que mensagens de
 * resultado chegaram no canal e nunca foram aplicadas, mesmo com o alerta
 * original já salvo. Varre as últimas BACKFILL_LOOKBACK_DAYS de histórico
 * do canal, roda cada mensagem por parseResult() (mesma lógica já em
 * produção) e aplica em qualquer alerta que ainda esteja pending — no-op
 * pras que já foram resolvidas por reply normal ou já não têm mais alerta
 * pending correspondente.
 *
 * Throttle de 30min entre execuções (lastBackfillRunAt, escopo de módulo —
 * sobrevive a reconexões dentro do mesmo processo) pra não martelar a API
 * do Telegram se o listener cair e reconectar em loop.
 */
const BACKFILL_LOOKBACK_DAYS = 7;
const BACKFILL_MIN_INTERVAL_MS = 30 * 60_000;
let lastBackfillRunAt = 0;

async function backfillMissedResults(client, botSource) {
  if (!botSource) return;
  if (Date.now() - lastBackfillRunAt < BACKFILL_MIN_INTERVAL_MS) return;
  lastBackfillRunAt = Date.now();

  const cutoffUnix = Math.floor(Date.now() / 1000) - BACKFILL_LOOKBACK_DAYS * 86400;
  console.log(`[BACKFILL] Varrendo últimos ${BACKFILL_LOOKBACK_DAYS} dias do canal atrás de resultado perdido...`);

  let offsetId = 0;
  let scanned = 0;
  let resultMessages = 0;
  let applied = 0;

  try {
    while (true) {
      const batch = await client.getMessages(botSource, {
        limit: 100,
        ...(offsetId ? { offsetId } : {}),
      });
      if (!batch || batch.length === 0) break;

      let hitCutoff = false;
      for (const m of batch) {
        if (m.date < cutoffUnix) { hitCutoff = true; break; }
        scanned++;
        if (!m.message) continue;

        const parsedResult = parseResult(m.message);
        if (!parsedResult) continue;
        resultMessages++;

        const updated = await updateAlertResult(parsedResult);
        if (updated) {
          applied++;
          console.log(
            `[BACKFILL] Resultado recuperado: ${updated.home_team} x ${updated.away_team} → ${parsedResult.result.toUpperCase()} (msg ${m.id})`
          );
        }
      }
      if (hitCutoff) break;

      offsetId = batch[batch.length - 1].id;
    }
  } catch (err) {
    console.error('[BACKFILL] Erro ao varrer histórico:', err.message);
  }

  console.log(`[BACKFILL] Concluído: ${scanned} mensagens varridas, ${resultMessages} eram resultado, ${applied} aplicados a alertas ainda pendentes.`);
}

/**
 * Verifica se o bot tem auto_bet ativo e, se sim, envia o alerta bruto
 * para o betting-userbot processar e executar a aposta.
 * Nunca lança exceção para o chamador — todos os erros são logados aqui.
 */
async function dispararAutoAposta(botName, rawMessage) {
  if (!botName) return;

  try {
    const { rows } = await pool.query(
      `SELECT auto_bet FROM bot_configs WHERE bot_name = $1`,
      [botName]
    );

    const autoBet = rows.length > 0 && rows[0].auto_bet === true;
    if (!autoBet) return;

    const bridgeUrl    = process.env.ROBOTIP_BETTING_BRIDGE_URL || 'http://localhost:3002';
    const bridgeSecret = process.env.ROBOTIP_BRIDGE_SECRET || '';
    const endpoint     = `${bridgeUrl}/apostar-from-alert`;

    console.log(`[AUTO-APOSTA] Bot "${botName}" tem auto_bet ativo — enviando para ${endpoint}`);

    const headers = { 'Content-Type': 'application/json' };
    if (bridgeSecret) headers['X-Bridge-Secret'] = bridgeSecret;

    const response = await fetch(endpoint, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ raw_message: rawMessage, bot_name: botName }),
    });

    const json = await response.json().catch(() => ({}));

    if (response.ok) {
      console.log(`[AUTO-APOSTA] Aposta enfileirada com sucesso:`, json.payload || json);
    } else {
      console.warn(`[AUTO-APOSTA] Resposta de erro do betting-userbot (${response.status}):`, json.erro || json);
    }
  } catch (err) {
    console.error(`[AUTO-APOSTA] Falha ao chamar betting-userbot:`, err.message);
  }
}

/**
 * Inicia o listener do Telegram via GramJS (MTProto user account).
 * - Se ROBOTIP_TELEGRAM_SESSION estiver vazio, faz login interativo.
 * - Escuta novas mensagens do ROBOTIP_TELEGRAM_BOT_SOURCE e salva alertas no banco.
 */
async function startTelegramListener() {
  const apiId   = parseInt(process.env.ROBOTIP_TELEGRAM_API_ID, 10);
  const apiHash = process.env.ROBOTIP_TELEGRAM_API_HASH;
  const botSource = process.env.ROBOTIP_TELEGRAM_BOT_SOURCE;

  if (!apiId || !apiHash) {
    throw new Error('ROBOTIP_TELEGRAM_API_ID e ROBOTIP_TELEGRAM_API_HASH são obrigatórios');
  }

  const sessionString = process.env.ROBOTIP_TELEGRAM_SESSION || '';
  const session = new StringSession(sessionString);

  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    retryDelay: 2000,
    autoReconnect: false,
  });

  if (!sessionString) {
    console.log('Nenhuma session encontrada — iniciando login interativo...');
    await client.start({
      phoneNumber:  async () => await input.text('Número de telefone (+55...): '),
      password:     async () => await input.text('Senha 2FA (deixe vazio se não tiver): '),
      phoneCode:    async () => await input.text('Código recebido no Telegram: '),
      onError:      (err) => console.error('Erro no login:', err),
    });

    const newSession = client.session.save();
    saveSessionToEnv(newSession);
    console.log('Login realizado com sucesso. Session salva.');
  } else {
    try {
      await client.connect();
    } catch (err) {
      await client.disconnect().catch(() => {});
      throw err;
    }
    console.log('Conectado ao Telegram com session existente.');
  }

  // Um client novo (sessão migrada pra outro processo/máquina) começa com o
  // cache de entidades vazio — sem isso, getEntity/getMessages por ID cru
  // falha com "Could not find the input entity" (visto no CATCHUP logo
  // abaixo). Carrega os diálogos uma vez pra popular esse cache antes de
  // qualquer resolução por ID.
  try {
    await client.getDialogs({ limit: 100 });
  } catch (err) {
    console.warn('Falha ao pré-carregar diálogos:', err.message);
  }

  console.log(`Escutando mensagens de: ${botSource || '(todos os chats)'}`);

  // Sinal de vida real do listener — ver o watchdog no fim desta função.
  // Começa em Date.now() (não 0) pra não disparar reconexão falsa logo no
  // boot, antes do 1º update chegar.
  let lastUpdateAt = Date.now();

  // Recupera alertas perdidos durante downtime (últimas 2h)
  if (botSource) {
    try {
      // Resolve entity primeiro — sessão nova pode não ter o cache ainda
      await client.getEntity(botSource).catch(() => null);
      const twoHoursAgo = Math.floor(Date.now() / 1000) - 2 * 3600;
      const history = await client.getMessages(botSource, { limit: 50 });
      const missed = history.filter(m => m.date >= twoHoursAgo && m.message);
      if (missed.length > 0) {
        console.log(`[CATCHUP] Processando ${missed.length} mensagens das últimas 2h...`);
        for (const m of missed.reverse()) {
          const raw = m.message;
          const parsed = parseAlert(raw);
          if (!parsed) continue;

          const { rows } = await pool.query(
            `SELECT id FROM alerts WHERE raw_message = $1 LIMIT 1`, [raw]
          );
          if (rows.length > 0) continue;

          await fillCornerBaseline(parsed);
          await saveAlert(parsed, raw, m.id).catch(err =>
            console.error('[CATCHUP] Erro ao salvar alerta:', err.message)
          );
          console.log(`[CATCHUP] Alerta recuperado: ${parsed.home_team} x ${parsed.away_team}`);
        }
      }
    } catch (err) {
      console.warn('[CATCHUP] Falha ao buscar histórico:', err.message);
    }
  }

  await backfillMissedResults(client, botSource);

  async function processMessage(rawText, messageId) {
    if (!rawText) return;
    console.log('--- RAW ---\n' + JSON.stringify(rawText) + '\n---');

    const parsedResult = parseResult(rawText);
    if (parsedResult) {
      const updated = await updateAlertResult(parsedResult);
      if (updated) {
        console.log(`Resultado atualizado: ${updated.home_team} x ${updated.away_team} → ${parsedResult.result.toUpperCase()}`);
      } else {
        console.log(`Resultado recebido mas nenhum alerta pendente encontrado: ${parsedResult.home_team} x ${parsedResult.away_team}`);
      }
      return;
    }

    const parsed = parseAlert(rawText);
    if (!parsed) {
      console.log('[IGNORADO] Mensagem não reconhecida como alerta nem resultado.');
      return;
    }

    await fillCornerBaseline(parsed);
    const saved = await saveAlert(parsed, rawText, messageId);
    if (!saved) {
      // saveAlert já logou o [DUP] — mesmo bot_name + mesmo jogo dentro da
      // janela de duplicata (push e poll podem entregar a mesma mensagem
      // duas vezes). Sem este corte, a auto-aposta abaixo disparava de
      // novo, dobrando uma aposta real.
      return;
    }
    console.log(`Alerta salvo: ${parsed.home_team} x ${parsed.away_team} - minuto ${parsed.game_minute}`);

    dispararAutoAposta(parsed.bot_name, rawText).catch((err) => {
      console.error(`[AUTO-APOSTA] Erro inesperado ao disparar auto-aposta:`, err);
    });
  }

  // GramJS não faz catch-up de updates e o Telegram pode atrasar o push por
  // minutos sem derrubar a conexão (o watchdog abaixo só vê silêncio total).
  // Por isso, além do push, buscamos ativamente as últimas mensagens a cada
  // 15s. `claimedIds` garante que cada mensagem é processada uma única vez —
  // importante pra resultado, que NÃO é idempotente (cada chamada de
  // updateAlertResult fecha mais um alerta pendente do mesmo jogo).
  const claimedIds = new Set();
  const claim = (id) => {
    if (claimedIds.has(id)) return false;
    claimedIds.add(id);
    if (claimedIds.size > 2000) claimedIds.delete(claimedIds.values().next().value);
    return true;
  };
  let baselineId = 0;
  if (botSource) {
    try {
      const latest = await client.getMessages(botSource, { limit: 1 });
      baselineId = latest[0]?.id ?? 0;
    } catch (err) {
      console.warn('[POLL] Falha ao ler baseline:', err.message);
    }
  }

  client.addEventHandler(async (event) => {
    try {
      // Conta como "sinal de vida" mesmo pra update que a gente ignora
      // (mensagem de outro chat, sem texto, etc.) — o watchdog abaixo
      // precisa saber que o socket ainda está de fato recebendo coisa do
      // Telegram, não só que ele reconheceu um alerta ou resultado.
      lastUpdateAt = Date.now();

      const message = event.message;
      if (!message || !message.message) return;

      // Filtrar pelo remetente se ROBOTIP_TELEGRAM_BOT_SOURCE estiver configurado
      if (botSource) {
        const sender = await message.getSender();
        const senderUsername = sender && (sender.username || sender.phone || String(sender.id));
        if (senderUsername !== botSource && String(sender && sender.id) !== botSource) {
          return;
        }
      }

      if (!claim(message.id)) return;
      console.log(`[LAG] msg ${message.id} via push, atraso ${Math.round(Date.now() / 1000 - message.date)}s`);
      await processMessage(message.message, message.id);
    } catch (err) {
      console.error('Erro ao processar mensagem do Telegram:', err);
    }
  }, new NewMessage({}));

  const pollTimer = botSource
    ? setInterval(async () => {
        try {
          const batch = await client.getMessages(botSource, { limit: 20 });
          const missed = batch
            .filter((m) => m.message && m.id > baselineId && claim(m.id))
            .sort((a, b) => a.id - b.id);
          for (const m of missed) {
            console.log(`[POLL] msg ${m.id} recuperada, push não entregou (atraso ${Math.round(Date.now() / 1000 - m.date)}s)`);
            await processMessage(m.message, m.id).catch((err) =>
              console.error('[POLL] Erro ao processar mensagem:', err.message)
            );
          }
        } catch (err) {
          console.warn('[POLL] Falha ao buscar mensagens:', err.message);
        }
      }, 15_000)
    : null;

  // Reações do usuário (👍/👎) na mensagem do alerta marcam se a entrada foi
  // tomada ou não. `results[].chosenOrder` identifica reações feitas pela
  // própria conta (a única que pode reagir num chat privado com o bot).
  client.addEventHandler(async (update) => {
    try {
      lastUpdateAt = Date.now();

      const results = update.reactions && update.reactions.results;
      if (!results) return;

      const myEmojis = results
        .filter((r) => r.chosenOrder !== undefined)
        .map((r) => r.reaction && r.reaction.emoticon)
        .filter(Boolean);

      let entered = null;
      if (myEmojis.includes(REACAO_ENTREI)) entered = true;
      else if (myEmojis.includes(REACAO_NAO_ENTREI)) entered = false;

      const alert = await updateAlertEntered(update.msgId, entered);
      if (alert) {
        console.log(`[REACAO] Alerta ${alert.id} (${alert.home_team} x ${alert.away_team}) → entered=${entered}`);
      }
    } catch (err) {
      console.error('Erro ao processar reação do Telegram:', err);
    }
  }, new Raw({ types: [Api.UpdateMessageReactions] }));

  // Guarda contra desconexão silenciosa: com autoReconnect:false (necessário
  // pra evitar o loop de AUTH_KEY_DUPLICATED do GramJS reconectando sozinho
  // com a sessão duplicada — ver commit ae017b3), uma queda de conexão comum
  // não lança erro nenhum aqui, e o loop de reconexão do index.js só age
  // quando esta função rejeita.
  //
  // A 1ª versão disso só checava `client.connected` — e isso NÃO detecta o
  // caso real que aconteceu em produção (visto em 2026-09-19, ~14:33-14:49
  // UTC: zero alertas e zero resultados processados por 16+ minutos, sem
  // nenhum log de queda): o socket MTProto pode continuar "conectado" do
  // ponto de vista do GramJS enquanto a assinatura de updates do servidor
  // trava silenciosamente — `client.connected` fica `true` o tempo todo,
  // então aquele watchdog nunca disparava. O processo ficava "vivo" mas
  // surdo, sem processar nenhuma mensagem nova, até alguém notar na mão.
  //
  // Watchdog novo: mede tempo desde o último update de QUALQUER tipo que
  // o GramJS de fato entregou (`lastUpdateAt`, atualizado nos dois
  // addEventHandler acima, antes de qualquer filtro/parse — conta mesmo
  // update que a gente ignora). Esse canal costuma trazer alguma coisa a
  // cada poucos segundos/minutos em horário de jogo; 10 minutos de
  // silêncio total é anômalo o bastante pra forçar reconexão sem gerar
  // falso positivo numa janela real de calmaria entre partidas.
  const STALE_THRESHOLD_MS = 10 * 60_000;
  const CHECK_INTERVAL_MS = 60_000;
  try {
    while (true) {
      await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
      if (!client.connected) {
        throw new Error('Conexão com o Telegram caiu (client.connected = false).');
      }
      const silentForMs = Date.now() - lastUpdateAt;
      if (silentForMs > STALE_THRESHOLD_MS) {
        throw new Error(
          `Listener mudo: nenhum update do Telegram em ${Math.round(silentForMs / 60_000)}min (client.connected ainda true).`,
        );
      }
    }
  } finally {
    if (pollTimer) clearInterval(pollTimer);
    // Sem isto, o client (e seus 2 addEventHandler) continuava vivo depois
    // que esta função rejeitava — index.js cria um client NOVO na mesma
    // sessão, e os dois passam a processar a mesma mensagem (alerta
    // duplicado, aposta automática em dobro), além do risco de
    // AUTH_KEY_DUPLICATED.
    await client.disconnect().catch(() => {});
  }
}

module.exports = { startTelegramListener, syncGestaoBanca };

// Permite execução direta: node src/services/telegram.js
if (require.main === module) {
  startTelegramListener().catch((err) => {
    console.error('Falha ao iniciar o listener do Telegram:', err);
    process.exit(1);
  });
}
