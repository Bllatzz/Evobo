'use strict';

// Fábrica genérica de "auto-checker": confere periodicamente o resultado de
// alertas 'pending' de bots que não recebem reply de resultado do tipster no
// Telegram, usando a StatsFeed pública do robotip.com.br. Usada por
// cornerAutoChecker.js e homeWinAutoChecker.js — cada um só define o
// conjunto de bots e a regra de resolução (`resolve`).

const pool = require('../db/pool');
const { broadcast } = require('../routes/alerts');
const { syncGestaoBanca } = require('./telegram');
const { extractGameId } = require('./statsFeed');

/**
 * @param {object} opts
 * @param {string} opts.logPrefix - prefixo dos logs, ex.: 'CORNER-CHECK'
 * @param {string[]} opts.botNames - bot_name(s) cobertos por este checker
 * @param {string} [opts.extraWhere] - condição SQL extra pro WHERE de findDueAlerts (ex.: exigir colunas específicas não-nulas)
 * @param {(alert: object, gameId: string) => Promise<{result: 'green'|'red', detail: string} | null>} opts.resolve
 *   Resolve o resultado do alerta. Retorna null se os dados ainda não estiverem prontos (agenda retry).
 */
function createAutoChecker({
  logPrefix,
  botNames,
  extraWhere = '',
  firstCheckDelay = '2 hours',
  retryInterval = '30 minutes',
  maxAttempts = 6,
  loopIntervalMs = 15 * 60 * 1000,
  alertsPerPass = 5,
  resolve,
}) {
  async function findDueAlerts(limit = alertsPerPass) {
    const { rows } = await pool.query(
      `SELECT * FROM alerts
       WHERE result = 'pending'
         AND bot_name = ANY($1::text[])
         AND robotip_url IS NOT NULL
         AND check_attempts < $2
         AND received_at <= NOW() - INTERVAL '${firstCheckDelay}'
         AND (last_check_at IS NULL OR last_check_at <= NOW() - INTERVAL '${retryInterval}')
         ${extraWhere}
       ORDER BY received_at ASC
       LIMIT $3`,
      [botNames, maxAttempts, limit]
    );
    return rows;
  }

  async function bumpAttempts(alertId) {
    await pool.query(
      `UPDATE alerts SET check_attempts = check_attempts + 1, last_check_at = NOW() WHERE id = $1`,
      [alertId]
    );
  }

  async function checkAlert(alert) {
    const gameId = extractGameId(alert.robotip_url);
    if (!gameId) {
      console.error(`[${logPrefix}] Alerta ${alert.id}: robotip_url sem id de jogo (${alert.robotip_url}).`);
      await bumpAttempts(alert.id);
      return;
    }

    const resolved = await resolve(alert, gameId);

    if (resolved == null) {
      await bumpAttempts(alert.id);
      const attempts = alert.check_attempts + 1;
      if (attempts >= maxAttempts) {
        console.error(
          `[${logPrefix}] Alerta ${alert.id} (${alert.home_team} x ${alert.away_team}): sem dado confiável após ${attempts} tentativas. Verificar manualmente: ${alert.robotip_url}`
        );
      } else {
        console.warn(
          `[${logPrefix}] Alerta ${alert.id} (${alert.home_team} x ${alert.away_team}): StatsFeed sem dado ainda (tentativa ${attempts}/${maxAttempts}).`
        );
      }
      return;
    }

    const { result, detail } = resolved;
    const { rows } = await pool.query(
      `UPDATE alerts
       SET result = $1, check_attempts = check_attempts + 1, last_check_at = NOW(), auto_checked = TRUE
       WHERE id = $2
       RETURNING *`,
      [result, alert.id]
    );
    const updated = rows[0];

    await syncGestaoBanca(updated, result);
    broadcast('alert-updated', updated);

    console.log(
      `[${logPrefix}] Alerta ${alert.id} (${alert.home_team} x ${alert.away_team}): ${detail} ⇒ ${result}`
    );
  }

  async function runPass() {
    const dueAlerts = await findDueAlerts();
    for (const alert of dueAlerts) {
      try {
        await checkAlert(alert);
      } catch (err) {
        console.error(`[${logPrefix}] Falha ao conferir alerta ${alert.id}:`, err.message);
        await bumpAttempts(alert.id).catch(() => {});
      }
    }
  }

  function start() {
    async function tick() {
      try {
        await runPass();
      } catch (err) {
        console.error(`[${logPrefix}] Erro no loop de conferência:`, err.message);
      }
    }
    tick();
    setInterval(tick, loopIntervalMs);
  }

  /**
   * Processa de uma vez só todos os alertas pendentes que já estão prontos
   * pra conferência (ignora o limite de alertsPerPass do loop normal). Usado
   * pra zerar o backlog acumulado sob demanda.
   */
  async function runAllDueNow({ batchSize = 50, delayMs = 200 } = {}) {
    let totalProcessed = 0;
    while (true) {
      const dueAlerts = await findDueAlerts(batchSize);
      if (dueAlerts.length === 0) break;

      for (const alert of dueAlerts) {
        try {
          await checkAlert(alert);
        } catch (err) {
          console.error(`[${logPrefix}] Falha ao conferir alerta ${alert.id}:`, err.message);
          await bumpAttempts(alert.id).catch(() => {});
        }
        totalProcessed++;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return totalProcessed;
  }

  return { start, runAllDueNow, findDueAlerts };
}

module.exports = { createAutoChecker };
