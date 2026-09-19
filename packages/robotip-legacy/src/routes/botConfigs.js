'use strict';

const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// ── GET /api/bot-configs ──────────────────────────────────────────────────────
// Lista todos os bots conhecidos (com histórico em alerts) e seu status auto_bet.
// Bots sem linha em bot_configs aparecem com auto_bet = false.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        a.bot_name,
        COALESCE(bc.auto_bet, FALSE) AS auto_bet
      FROM (
        SELECT DISTINCT bot_name FROM alerts WHERE bot_name IS NOT NULL
      ) a
      LEFT JOIN bot_configs bc ON bc.bot_name = a.bot_name
      ORDER BY a.bot_name
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/bot-configs error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── PATCH /api/bot-configs/:botName ──────────────────────────────────────────
// Toggle auto_bet para o bot informado (upsert).
router.patch('/:botName', async (req, res) => {
  try {
    const { botName } = req.params;
    const { auto_bet } = req.body;

    if (typeof auto_bet !== 'boolean') {
      return res.status(400).json({ error: 'Campo "auto_bet" deve ser boolean.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO bot_configs (bot_name, auto_bet)
       VALUES ($1, $2)
       ON CONFLICT (bot_name) DO UPDATE SET auto_bet = EXCLUDED.auto_bet
       RETURNING bot_name, auto_bet`,
      [botName, auto_bet]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /api/bot-configs/:botName error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── POST /api/bot-configs/:botName/apply-odds ────────────────────────────────
// Update direto: sobrescreve bet_odds de TODAS as apostas já registradas do
// bot (alerts + gestao_banca). Não persiste nada — é só um update em massa.
router.post('/:botName/apply-odds', async (req, res) => {
  try {
    const { botName } = req.params;
    const odds = Number(req.body.odds);

    if (!Number.isFinite(odds) || odds <= 0) {
      return res.status(400).json({ error: 'Campo "odds" deve ser um número maior que zero.' });
    }

    const [alertsRes, gestaoRes] = await Promise.all([
      pool.query(`UPDATE alerts SET bet_odds = $1 WHERE bot_name = $2`, [odds, botName]),
      pool.query(`UPDATE gestao_banca SET bet_odds = $1 WHERE bot_name = $2`, [odds, botName]),
    ]);

    res.json({ updated_alerts: alertsRes.rowCount, updated_bets: gestaoRes.rowCount });
  } catch (err) {
    console.error('POST /api/bot-configs/:botName/apply-odds error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
