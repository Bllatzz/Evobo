'use strict';

// Confere automaticamente o resultado de bots de escanteios que não recebem
// reply de resultado do tipster no Telegram (ex: "Menos de 0,5 escanteios
// (gratuito)"). Consulta a StatsFeed pública do robotip.com.br pelo id do
// jogo (extraído do `robotip_url` do alerta) e compara o total de escanteios
// atual/final com o baseline capturado no momento do alerta:
//   - escanteios atuais > baseline → red
//   - escanteios atuais <= baseline → green
//
// O baseline (`corners_home`/`corners_away`) normalmente vem da própria
// mensagem do alerta, mas bots em CHECK_BOT_NAMES não mandam essa linha —
// pra esses o baseline é capturado ao vivo pela StatsFeed assim que o alerta
// chega (ver telegram.js `fillCornerBaseline`), por isso a query abaixo pode
// exigir os campos NOT NULL sem risco de excluir tudo pra sempre.
//
// A partida costuma acabar bem pouco depois desse alerta disparar (ele sai
// no minuto ~86-90), então a primeira conferência espera FIRST_CHECK_DELAY
// e, se os dados ainda não estiverem disponíveis, tenta de novo a cada
// RETRY_INTERVAL até MAX_ATTEMPTS.

const { createAutoChecker } = require('./resultAutoChecker');
const { fetchStatsFeed } = require('./statsFeed');
const CHECK_BOT_NAMES = require('../config/cornerBaselineBots');

async function resolve(alert, gameId) {
  const stats = await fetchStatsFeed(gameId, { ended: true });
  if (!stats) return null;

  const home = Number(stats.corners_home);
  const away = Number(stats.corners_away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;

  const liveTotal = home + away;
  const alertTotal = alert.corners_home + alert.corners_away;
  const result = liveTotal > alertTotal ? 'red' : 'green';

  return { result, detail: `${alertTotal} → ${liveTotal} escanteios` };
}

const checker = createAutoChecker({
  logPrefix: 'CORNER-CHECK',
  botNames: CHECK_BOT_NAMES,
  extraWhere: 'AND corners_home IS NOT NULL AND corners_away IS NOT NULL',
  resolve,
});

module.exports = {
  startCornerAutoChecker: checker.start,
  runAllDueNow: checker.runAllDueNow,
  CHECK_BOT_NAMES,
};
