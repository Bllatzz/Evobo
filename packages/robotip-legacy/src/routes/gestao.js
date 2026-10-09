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
      `SELECT g.*, a.robotip_url
       FROM gestao_banca g
       LEFT JOIN alerts a ON a.id = g.alert_id
       WHERE g.deleted_at IS NULL
         AND NOT (g.bot_name = ANY($1::text[]))
       ORDER BY g.received_at ASC`,
      [excluidos]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /gestao error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

const RESULTS = ['green', 'red', 'reembolso'];
const BULK_DELETE_MAX = 5000;

// Valida e normaliza os campos editáveis de uma entrada. Devolve { fields } com
// só o que veio no body, ou { error }.
function parseEntryFields(body) {
  const fields = {};
  for (const k of ['home_team', 'away_team', 'competition', 'bot_name', 'market', 'obs']) {
    if (body[k] === undefined) continue;
    if (body[k] !== null && typeof body[k] !== 'string') return { error: `${k} deve ser texto.` };
    const v = body[k] === null ? null : body[k].trim().slice(0, 200);
    fields[k] = v === '' ? null : v;
  }
  if (body.result !== undefined) {
    if (!RESULTS.includes(body.result)) return { error: "result deve ser 'green', 'red' ou 'reembolso'." };
    fields.result = body.result;
  }
  if (body.bet_odds !== undefined) {
    const v = Number(body.bet_odds);
    if (!Number.isFinite(v) || v < 1 || v >= 10000) return { error: 'bet_odds deve ser número entre 1 e 9999.' };
    fields.bet_odds = v;
  }
  if (body.stake_pct !== undefined) {
    const v = Number(body.stake_pct);
    if (!Number.isFinite(v) || v < 0 || v >= 1000) return { error: 'stake_pct deve ser número entre 0 e 999.' };
    fields.stake_pct = v;
  }
  if (body.commission_pct !== undefined) {
    const v = Number(body.commission_pct);
    if (!Number.isFinite(v) || v < 0 || v >= 100) return { error: 'commission_pct deve ser número entre 0 e 99.' };
    fields.commission_pct = v;
  }
  if (body.lay !== undefined) {
    if (typeof body.lay !== 'boolean') return { error: 'lay deve ser boolean.' };
    fields.lay = body.lay;
  }
  if (body.received_at !== undefined) {
    const d = new Date(body.received_at);
    if (Number.isNaN(d.getTime())) return { error: 'received_at inválido.' };
    fields.received_at = d.toISOString();
  }
  return { fields };
}

// ── POST /api/gestao — entrada manual (sem alerta de origem) ─────────────────
router.post('/', async (req, res) => {
  try {
    const { fields, error } = parseEntryFields(req.body || {});
    if (error) return res.status(400).json({ error });
    for (const k of ['received_at', 'bot_name', 'result', 'bet_odds']) {
      if (fields[k] === undefined || fields[k] === null)
        return res.status(400).json({ error: `${k} é obrigatório.` });
    }
    if (fields.stake_pct === undefined) fields.stake_pct = 1;
    const cols = Object.keys(fields);
    const { rows } = await pool.query(
      `INSERT INTO gestao_banca (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING *`,
      cols.map((k) => fields[k])
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /gestao error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── POST /api/gestao/bulk-delete — exclusão lógica em lote ───────────────────
// Lógica (deleted_at) e não DELETE: o sync re-inseriria a linha a partir de alerts.
router.post('/bulk-delete', async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > BULK_DELETE_MAX
        || !ids.every((id) => Number.isInteger(id) && id > 0))
      return res.status(400).json({ error: `ids deve ser lista de 1 a ${BULK_DELETE_MAX} inteiros.` });
    const { rowCount } = await pool.query(
      `UPDATE gestao_banca SET deleted_at = NOW()
       WHERE id = ANY($1::int[]) AND deleted_at IS NULL`,
      [ids]
    );
    res.json({ ok: true, deleted: rowCount });
  } catch (err) {
    console.error('POST /gestao/bulk-delete error:', err);
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

// ── PATCH /api/gestao/bot/:botName — stake_pct e/ou commission_pct em todas as linhas de um bot ──
router.patch('/bot/:botName', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.stake_pct === undefined && body.commission_pct === undefined)
      return res.status(400).json({ error: 'Informe stake_pct e/ou commission_pct.' });
    const { fields, error } = parseEntryFields({
      stake_pct: body.stake_pct, commission_pct: body.commission_pct,
    });
    if (error) return res.status(400).json({ error });
    const cols = Object.keys(fields);
    const { rowCount } = await pool.query(
      `UPDATE gestao_banca SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(', ')}
       WHERE bot_name = $${cols.length + 1} AND deleted_at IS NULL`,
      [...cols.map((k) => fields[k]), req.params.botName]
    );
    res.json({ ok: true, updated: rowCount });
  } catch (err) {
    console.error('PATCH /gestao/bot/:botName error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── DELETE /api/gestao/bot/:botName — "Deletar estratégia": tira o robô da gestão ──
// Exclusão lógica; os alertas do robô continuam intactos.
router.delete('/bot/:botName', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE gestao_banca SET deleted_at = NOW()
       WHERE bot_name = $1 AND deleted_at IS NULL`,
      [req.params.botName]
    );
    res.json({ ok: true, deleted: rowCount });
  } catch (err) {
    console.error('DELETE /gestao/bot/:botName error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── DELETE /api/gestao/:id — exclusão lógica de um registro ──────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE gestao_banca SET deleted_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── PATCH /api/gestao/:id — edita os campos de um registro ───────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { fields, error } = parseEntryFields(req.body || {});
    if (error) return res.status(400).json({ error });
    delete fields.received_at;
    delete fields.bot_name;
    const cols = Object.keys(fields);
    if (!cols.length) return res.status(400).json({ error: 'Nada para atualizar.' });
    const { rows } = await pool.query(
      `UPDATE gestao_banca SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(', ')}
       WHERE id = $${cols.length + 1} AND deleted_at IS NULL
       RETURNING *`,
      [...cols.map((k) => fields[k]), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
