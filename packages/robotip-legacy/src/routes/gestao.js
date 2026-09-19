'use strict';

const express = require('express');
const pool = require('../db/pool');
const { botsExcluidosGestao } = require('../services/gestaoSettings');

const router = express.Router();

// ── GET /api/gestao — lista completa (sem paginação, a página calcula tudo) ──
router.get('/', async (req, res) => {
  try {
    const excluidos = await botsExcluidosGestao();
    const { rows } = await pool.query(
      `SELECT * FROM gestao_banca
       WHERE NOT (bot_name = ANY($1::text[]))
       ORDER BY received_at ASC`,
      [excluidos]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /gestao error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── POST /api/gestao/sync — popula entradas faltando a partir da tabela alerts ──
router.post('/sync', async (req, res) => {
  try {
    const excluidos = await botsExcluidosGestao();
    const { rowCount } = await pool.query(
      `INSERT INTO gestao_banca (alert_id, bot_name, home_team, away_team, competition, result, bet_odds, stake_pct, received_at)
       SELECT id, bot_name, home_team, away_team, competition, result,
              COALESCE(bet_odds, goals_over_odds, odds,
                (regexp_match(raw_message,
                  '(?:Back\\s+[^\\n:]+|Goals?\\s+(?:over|under)[^\\n:]*|Gols?\\s+(?:over|under)[^\\n:]*|Corners?\\s+(?:over|under)[^\\n:]*|Escanteios?\\s+(?:over|under)[^\\n:]*)\\s*:\\s*([0-9]+\\.[0-9]+)',
                  ''
                ))[1]::numeric
              ),
              COALESCE(stake_pct, 1),
              received_at
       FROM alerts
       WHERE result IN ('green','red','reembolso')
         AND NOT (bot_name = ANY($1::text[]))
         AND NOT EXISTS (SELECT 1 FROM gestao_banca g WHERE g.alert_id = alerts.id)`,
      [excluidos]
    );
    res.json({ ok: true, inserted: rowCount });
  } catch (err) {
    console.error('POST /gestao/sync error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── DELETE /api/gestao/reset — apaga todos os registros da gestão ───────────
router.delete('/reset', async (req, res) => {
  try {
    await pool.query('DELETE FROM gestao_banca');
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /gestao/reset error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── PATCH /api/gestao/bot/:botName — atualiza stake_pct para todas as linhas de um bot ──
router.patch('/bot/:botName', async (req, res) => {
  try {
    const { stake_pct } = req.body;
    const v = Number(stake_pct);
    if (!Number.isFinite(v) || v < 0)
      return res.status(400).json({ error: 'stake_pct deve ser número >= 0.' });
    const { rowCount } = await pool.query(
      `UPDATE gestao_banca SET stake_pct = $1 WHERE bot_name = $2`,
      [v, req.params.botName]
    );
    res.json({ ok: true, updated: rowCount });
  } catch (err) {
    console.error('PATCH /gestao/bot/:botName error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── DELETE /api/gestao/:id — apaga um registro ───────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM gestao_banca WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── PATCH /api/gestao/:id — edita odd, stake ou resultado de um registro ──────
router.patch('/:id', async (req, res) => {
  try {
    const { bet_odds, stake_pct, result } = req.body;
    if (result !== undefined && !['green', 'red', 'reembolso', 'pending'].includes(result))
      return res.status(400).json({ error: "result deve ser 'green', 'red', 'reembolso' ou 'pending'." });
    const { rows } = await pool.query(
      `UPDATE gestao_banca
         SET bet_odds  = COALESCE($1, bet_odds),
             stake_pct = COALESCE($2, stake_pct),
             result    = COALESCE($3, result)
       WHERE id = $4
       RETURNING *`,
      [bet_odds ?? null, stake_pct ?? null, result ?? null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
