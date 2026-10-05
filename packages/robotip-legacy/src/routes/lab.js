'use strict';

// Laboratório de robôs: leitura dos robôs e relatórios de backtest
// sincronizados do robotip.com.br (services/robotipSync.js).

const express = require('express');
const pool = require('../db/pool');
const { runSyncPass, syncReportDetail } = require('../services/robotipSync');

const router = express.Router();

// Relatório ↔ robô: o site não liga um ao outro, então casa pela query string
// de parâmetros (ignorando o "&" final que às vezes vem sobrando).
const REPORT_SELECT = `
  SELECT r.id, r.name, r.market, r.query_filter, r.termex, r.is_live, r.done, r.error,
         r.count, r.greens, r.green_rate::float, r.mean_odd::float, r.profit::float,
         r.max_drawdown::float, r.pval::float, r.months, r.first_day::text, r.last_day::text, r.active_days,
         CASE WHEN r.first_day IS NOT NULL
              THEN r.count::float / (r.last_day - r.first_day + 1)
         END AS per_day,
         r.created_at, r.scheduled_to, r.detail_synced_at,
         b.id AS bot_id, b.name AS bot_name
  FROM rt_reports r
  LEFT JOIN LATERAL (
    SELECT id, name FROM rt_bots
    WHERE deleted_at IS NULL AND rtrim(filter, '&') = rtrim(r.query_filter, '&')
    ORDER BY id DESC LIMIT 1
  ) b ON TRUE`;

// ── GET /api/lab/status ───────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM rt_bots WHERE deleted_at IS NULL)::int AS bots,
        (SELECT COUNT(*) FROM rt_reports WHERE deleted_at IS NULL)::int AS reports,
        (SELECT COUNT(*) FROM rt_reports
           WHERE deleted_at IS NULL AND done AND NOT error AND detail_synced_at IS NULL)::int AS details_pending,
        (SELECT MAX(synced_at) FROM rt_reports) AS last_sync`);
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/lab/status error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── POST /api/lab/sync ────────────────────────────────────────────────────────
// Roda uma passada de sincronização agora (em vez de esperar o loop).
router.post('/sync', async (req, res) => {
  try {
    res.json(await runSyncPass());
  } catch (err) {
    console.error('POST /api/lab/sync error:', err);
    res.status(502).json({ error: `Falha ao sincronizar com o Robotip: ${err.message}` });
  }
});

// ── GET /api/lab/bots ─────────────────────────────────────────────────────────
router.get('/bots', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, filter, termex, send_telegram, stake::float, synced_at
      FROM rt_bots WHERE deleted_at IS NULL ORDER BY name`);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/lab/bots error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── GET /api/lab/reports ──────────────────────────────────────────────────────
// Lista resumida (sem dias/ligas). ?market= filtra por mercado.
router.get('/reports', async (req, res) => {
  try {
    const params = [];
    let where = 'WHERE r.deleted_at IS NULL';
    if (typeof req.query.market === 'string' && req.query.market) {
      params.push(req.query.market);
      where += ` AND r.market = $${params.length}`;
    }
    const { rows } = await pool.query(`${REPORT_SELECT} ${where} ORDER BY r.created_at DESC NULLS LAST`, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/lab/reports error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── GET /api/lab/reports/:id ──────────────────────────────────────────────────
// Relatório + resultado dia a dia + ligas.
router.get('/reports/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido.' });
  try {
    const [report, days, leagues] = await Promise.all([
      pool.query(`${REPORT_SELECT} WHERE r.id = $1`, [id]),
      pool.query(
        `SELECT day::text, count, greens, mean_odd::float, profit::float
         FROM rt_report_days WHERE report_id = $1 ORDER BY day`,
        [id]
      ),
      pool.query(
        `SELECT league_id, league_name, count, greens, mean_odd::float, profit::float, pval::float, months
         FROM rt_report_leagues WHERE report_id = $1 ORDER BY count DESC`,
        [id]
      ),
    ]);
    if (!report.rows[0]) return res.status(404).json({ error: 'Relatório não encontrado.' });
    res.json({ ...report.rows[0], days: days.rows, leagues: leagues.rows });
  } catch (err) {
    console.error('GET /api/lab/reports/:id error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── POST /api/lab/reports/:id/sync ────────────────────────────────────────────
// Baixa o detalhe (dias/ligas) deste relatório agora, sem esperar o backfill.
router.post('/reports/:id/sync', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido.' });
  try {
    const { rows } = await pool.query('SELECT done, error FROM rt_reports WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Relatório não encontrado.' });
    if (!rows[0].done || rows[0].error) return res.status(409).json({ error: 'Relatório ainda não foi processado no Robotip.' });
    await syncReportDetail(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/lab/reports/:id/sync error:', err);
    res.status(502).json({ error: `Falha ao baixar do Robotip: ${err.message}` });
  }
});

module.exports = router;
