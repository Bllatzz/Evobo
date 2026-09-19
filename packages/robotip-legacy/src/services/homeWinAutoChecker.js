'use strict';

// Confere automaticamente o resultado do bot "Vitória do time da casa
// (gratuito)", que não recebe reply de resultado do tipster no Telegram.
// Consulta a StatsFeed pública do robotip.com.br pelo id do jogo (extraído
// do `robotip_url` do alerta) e resolve pelo placar final:
//   - time da casa venceu → green
//   - empate ou vitória do time de fora → red
//
// Diferente do cornerAutoChecker, aqui não precisa de baseline capturado no
// momento do alerta — o placar final da StatsFeed já é suficiente sozinho.

const { createAutoChecker } = require('./resultAutoChecker');
const { fetchStatsFeed } = require('./statsFeed');

const CHECK_BOT_NAMES = ['Vitória do time da casa (gratuito)'];

async function resolve(alert, gameId) {
  const stats = await fetchStatsFeed(gameId, { ended: true });
  if (!stats) return null;

  const home = Number(stats.goals_home);
  const away = Number(stats.goals_away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;

  const result = home > away ? 'green' : 'red';

  return { result, detail: `placar final ${home} - ${away}` };
}

const checker = createAutoChecker({
  logPrefix: 'HOMEWIN-CHECK',
  botNames: CHECK_BOT_NAMES,
  resolve,
});

module.exports = {
  startHomeWinAutoChecker: checker.start,
  runAllDueNow: checker.runAllDueNow,
  CHECK_BOT_NAMES,
};
