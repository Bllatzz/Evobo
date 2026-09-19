'use strict';

const pool = require('../db/pool');
const EXCLUDED_BOTS = require('../config/gestaoExcludedBots');

async function getIncluirBotsExcluidos() {
  const { rows } = await pool.query('SELECT incluir_bots_excluidos FROM gestao_settings WHERE id = TRUE');
  return rows[0]?.incluir_bots_excluidos ?? false;
}

// Lista de bots a excluir das queries de gestão de banca — vazia quando o
// toggle "incluir_bots_excluidos" está ligado.
async function botsExcluidosGestao() {
  const incluir = await getIncluirBotsExcluidos();
  return incluir ? [] : EXCLUDED_BOTS;
}

module.exports = { getIncluirBotsExcluidos, botsExcluidosGestao, EXCLUDED_BOTS };
