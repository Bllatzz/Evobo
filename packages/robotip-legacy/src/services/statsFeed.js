'use strict';

// Cliente da StatsFeed pública do robotip.com.br — usado pelos auto-checkers
// (cornerAutoChecker, homeWinAutoChecker) e pela captura de baseline de
// escanteios em telegram.js. Não depende de nada do backend (pool, rotas)
// pra evitar require circular com telegram.js.

const STATS_FEED_URL = 'https://robotip.com.br/api/transfer/StatsFeed';
const FETCH_TIMEOUT_MS = 15_000;

function extractGameId(robotipUrl) {
  const m = robotipUrl && robotipUrl.match(/\/jogo\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Consulta a StatsFeed pra um jogo. Devolve o objeto `data` (goals_home/away,
 * corners_home/away, etc.) ou null se indisponível.
 */
async function fetchStatsFeed(gameId, { ended = true } = {}) {
  const url = `${STATS_FEED_URL}?game_id=${gameId}${ended ? '&ended=1' : ''}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.data ? json.data : null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { extractGameId, fetchStatsFeed, STATS_FEED_URL };
