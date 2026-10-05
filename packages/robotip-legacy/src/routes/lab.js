'use strict';

// Laboratório de robôs: leitura dos robôs e relatórios de backtest
// sincronizados do robotip.com.br (services/robotipSync.js).

const express = require('express');
const pool = require('../db/pool');
const { runListSync, syncPendingDetails, syncReportDetail } = require('../services/robotipSync');

const router = express.Router();

// Relatório ↔ robô: o site não liga um ao outro, então casa pela query string
// de parâmetros (ignorando o "&" final que às vezes vem sobrando).
const REPORT_SELECT = `
  SELECT r.id, r.name, r.market, r.query_filter, r.termex, r.is_live, r.lay_bet, r.done, r.error,
         r.count, r.greens, r.green_rate::float, r.mean_odd::float, r.profit::float,
         r.max_drawdown::float, r.pval::float, r.months, r.first_day::text, r.last_day::text, r.active_days,
         -- Calculado no sync do detalhe (98% das entradas, ver migration 017);
         -- sem detalhe o frontend estima pelos meses.
         r.per_day_calc AS per_day,
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
// Atualiza robôs e relatórios agora; os detalhes pendentes seguem em segundo
// plano (podem levar minutos) em vez de segurar o request.
router.post('/sync', async (req, res) => {
  try {
    const result = await runListSync();
    syncPendingDetails().catch((err) => console.error('POST /api/lab/sync detalhes:', err.message));
    res.json(result);
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

// ── Otimizador ───────────────────────────────────────────────────────────────

const engine = require('../services/labEngine');
const optimizer = require('../services/labOptimizer');

const fail = (res, where, err) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(`${where} error:`, err);
  return res.status(500).json({ error: 'Erro interno.' });
};

/** Métricas que a tela mostra de um relatório, na odd do operador. */
function reportSummary(r, margin) {
  if (!r) return null;
  const m = engine.metricsOf(r, margin);
  return {
    id: r.id, name: r.name, count: r.count, greens: r.greens, mean_odd: r.mean_odd, months: r.months,
    first_day: r.first_day, last_day: r.last_day, query_filter: r.query_filter,
    acc: m?.acc ?? null, odd: m?.odd ?? null, per_day: m?.perDay ?? null, edge: m?.edge ?? null, score: m?.score ?? null,
  };
}

function effectsList(effects) {
  return [...effects.values()]
    .map((e) => ({ key: e.key, kind: e.kind, n: e.n, d_acc: e.dAcc, d_odd: e.dOdd, vol_ratio: e.volRatio, examples: e.examples }))
    .sort((a, b) => b.n - a.n);
}

// Mercado de um robô = a chave de odd do filtro que é mercado de algum relatório.
async function inferMarket(filter) {
  const { rows } = await pool.query('SELECT DISTINCT market FROM rt_reports WHERE deleted_at IS NULL');
  const markets = new Set(rows.map((r) => r.market));
  return engine.parsePieces(filter).map((p) => p.key).find((k) => markets.has(k)) ?? null;
}

// ── GET /api/lab/quota ────────────────────────────────────────────────────────
router.get('/quota', async (req, res) => {
  try {
    res.json(await optimizer.getQuota());
  } catch (err) {
    fail(res, 'GET /api/lab/quota', err);
  }
});

// ── GET /api/lab/insights?market= ─────────────────────────────────────────────
// O que cada mudança de parâmetro fez nos pares de relatórios do mercado.
router.get('/insights', async (req, res) => {
  const market = typeof req.query.market === 'string' ? req.query.market : '';
  if (!market) return res.status(400).json({ error: 'market obrigatório.' });
  try {
    const { rows } = await pool.query(
      `${REPORT_SELECT} WHERE r.deleted_at IS NULL AND r.market = $1 AND r.done AND NOT r.error`,
      [market]
    );
    res.json({ market, reports: rows.length, effects: effectsList(engine.learnEffects(rows)) });
  } catch (err) {
    fail(res, 'GET /api/lab/insights', err);
  }
});

// ── GET /api/lab/robots ───────────────────────────────────────────────────────
// Cada robô com o mercado, o backtest mais recente do mesmo filtro (ignorando
// período) e a campanha, se já tiver uma.
router.get('/robots', async (req, res) => {
  const margin = Number.isFinite(Number(req.query.margin)) ? Number(req.query.margin) : 0.2;
  try {
    const [bots, reports, campaigns, marketsRes] = await Promise.all([
      pool.query('SELECT id, name, filter FROM rt_bots WHERE deleted_at IS NULL ORDER BY name'),
      pool.query(`${REPORT_SELECT} WHERE r.deleted_at IS NULL AND r.done AND NOT r.error ORDER BY r.created_at DESC NULLS LAST`),
      pool.query('SELECT id, origin_bot_id, status, mode FROM rt_lab_campaigns'),
      pool.query('SELECT DISTINCT market FROM rt_reports WHERE deleted_at IS NULL'),
    ]);
    const markets = new Set(marketsRes.rows.map((r) => r.market));
    const bySig = new Map();
    for (const r of reports.rows) {
      const sig = `${r.market}::${engine.normalizeFilter(r.query_filter, { ignoreData: true })}`;
      if (!bySig.has(sig)) bySig.set(sig, r);
    }
    res.json(bots.rows.map((b) => {
      const market = engine.parsePieces(b.filter).map((p) => p.key).find((k) => markets.has(k)) ?? null;
      const report = market ? bySig.get(`${market}::${engine.normalizeFilter(b.filter, { ignoreData: true })}`) ?? null : null;
      const campaign = campaigns.rows.find((c) => c.origin_bot_id === b.id) ?? null;
      return {
        id: b.id, name: b.name, filter: b.filter, market,
        params: engine.parsePieces(b.filter).filter((p) => p.op && p.key !== 'data').length,
        report: reportSummary(report, margin), campaign,
      };
    }));
  } catch (err) {
    fail(res, 'GET /api/lab/robots', err);
  }
});

// ── GET /api/lab/campaigns ────────────────────────────────────────────────────
router.get('/campaigns', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.market, c.mode, c.status, c.odd_margin::float, c.champion_report_id,
             c.origin_bot_id, c.origin_report_id, c.created_at, c.updated_at,
             COUNT(run.id)::int AS runs,
             COUNT(run.id) FILTER (WHERE run.status = 'submitted')::int AS in_flight,
             COUNT(run.id) FILTER (WHERE run.verdict = 'better')::int AS wins
      FROM rt_lab_campaigns c LEFT JOIN rt_lab_runs run ON run.campaign_id = c.id
      GROUP BY c.id ORDER BY c.updated_at DESC`);
    const champions = await Promise.all(rows.map((c) => pool.query(
      `${REPORT_SELECT} WHERE r.id = $1`, [c.champion_report_id]
    ).then((r) => reportSummary(r.rows[0], c.odd_margin))));
    res.json(rows.map((c, i) => ({ ...c, champion: champions[i] })));
  } catch (err) {
    fail(res, 'GET /api/lab/campaigns', err);
  }
});

// ── POST /api/lab/campaigns ───────────────────────────────────────────────────
// Body: { report_id } ou { bot_id } (+ name, odd_margin opcionais).
router.post('/campaigns', async (req, res) => {
  const { report_id: reportId, bot_id: botId } = req.body ?? {};
  try {
    let market;
    let filter;
    let termex = '';
    let isLive = true;
    let name;
    let championReportId = null;
    if (reportId != null) {
      const { rows } = await pool.query('SELECT * FROM rt_reports WHERE id = $1 AND deleted_at IS NULL', [Number(reportId)]);
      const r = rows[0];
      if (!r) return res.status(404).json({ error: 'Relatório não encontrado.' });
      if (!r.done || r.error || !r.count) return res.status(409).json({ error: 'Relatório sem resultado pra partir dele.' });
      ({ market, query_filter: filter, termex, is_live: isLive, name } = r);
      // Com filtro de data não serve de ponto de partida: o primeiro teste
      // roda o mesmo robô sem a data.
      championReportId = engine.hasDataFilter(filter) ? null : r.id;
    } else if (botId != null) {
      const { rows } = await pool.query('SELECT * FROM rt_bots WHERE id = $1 AND deleted_at IS NULL', [Number(botId)]);
      const b = rows[0];
      if (!b) return res.status(404).json({ error: 'Robô não encontrado.' });
      market = typeof req.body.market === 'string' && req.body.market ? req.body.market : await inferMarket(b.filter);
      if (!market) return res.status(400).json({ error: 'Não deu pra descobrir o mercado do robô — informe market.' });
      ({ filter, termex, name } = b);
      // Já tem backtest desse mesmo filtro? Começa dele.
      const { rows: reps } = await pool.query(
        `SELECT id, query_filter FROM rt_reports
         WHERE deleted_at IS NULL AND market = $1 AND done AND NOT error AND count > 0
         ORDER BY created_at DESC NULLS LAST`,
        [market]
      );
      const sig = engine.normalizeFilter(filter, { ignoreData: true });
      const match = reps.find((r) => !engine.hasDataFilter(r.query_filter) && engine.normalizeFilter(r.query_filter) === sig);
      if (match) { championReportId = match.id; filter = match.query_filter; }
    } else {
      return res.status(400).json({ error: 'Informe report_id ou bot_id.' });
    }
    filter = engine.stripData(filter);
    const margin = Number.isFinite(Number(req.body.odd_margin)) ? Number(req.body.odd_margin) : 0.2;
    const { rows } = await pool.query(
      `INSERT INTO rt_lab_campaigns (name, market, is_live, termex, origin_bot_id, origin_report_id,
                                     champion_filter, champion_report_id, odd_margin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [String(req.body.name || name).slice(0, 120), market, isLive, termex ?? '',
        botId != null ? Number(botId) : null, reportId != null ? Number(reportId) : null,
        filter, championReportId, margin]
    );
    await optimizer.ensureDetail(championReportId);
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    fail(res, 'POST /api/lab/campaigns', err);
  }
});

const campaignId = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// ── GET /api/lab/campaigns/:id ────────────────────────────────────────────────
router.get('/campaigns/:id', async (req, res) => {
  const id = campaignId(req);
  if (!id) return res.status(400).json({ error: 'id inválido.' });
  try {
    const campaign = await optimizer.campaignById(id);
    if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
    const [plan, quota] = await Promise.all([optimizer.planCampaign(campaign), optimizer.getQuota()]);
    const margin = campaign.odd_margin;
    const reportIds = [...new Set(plan.runs.flatMap((r) => [r.report_id, r.parent_report_id]).filter(Boolean))];
    const { rows: runReports } = reportIds.length
      ? await pool.query(`${REPORT_SELECT} WHERE r.id = ANY($1::int[])`, [reportIds])
      : { rows: [] };
    const byId = new Map(runReports.map((r) => [r.id, r]));
    res.json({
      ...campaign,
      quota,
      champion: reportSummary(plan.champion, margin),
      candidates: plan.candidates.map((c) => ({
        sig: c.sig, filter: c.filter, mutation: c.mutation, evidence: c.evidence,
        gain: Number.isFinite(c.gain) ? c.gain : null, predicted: c.predicted,
      })),
      runs: plan.runs.map((r) => ({
        id: r.id, status: r.status, verdict: r.verdict, error: r.error, mutation: r.mutation, predicted: r.predicted,
        filter: r.filter, report_name: r.report_name, report_id: r.report_id, parent_report_id: r.parent_report_id,
        submitted_at: r.submitted_at, finished_at: r.finished_at,
        result: reportSummary(byId.get(r.report_id), margin),
        parent: reportSummary(byId.get(r.parent_report_id), margin),
      })),
      effects: effectsList(plan.effects).slice(0, 40),
    });
  } catch (err) {
    fail(res, 'GET /api/lab/campaigns/:id', err);
  }
});

// ── PATCH /api/lab/campaigns/:id ──────────────────────────────────────────────
router.patch('/campaigns/:id', async (req, res) => {
  const id = campaignId(req);
  if (!id) return res.status(400).json({ error: 'id inválido.' });
  const b = req.body ?? {};
  const sets = [];
  const params = [id];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (b.mode !== undefined) {
    if (!['suggest', 'auto'].includes(b.mode)) return res.status(400).json({ error: 'mode inválido.' });
    add('mode', b.mode);
  }
  if (b.status !== undefined) {
    if (!['active', 'paused'].includes(b.status)) return res.status(400).json({ error: 'status inválido.' });
    add('status', b.status);
  }
  const num = (key, col, lo, hi, int) => {
    if (b[key] === undefined) return true;
    const n = Number(b[key]);
    if (!Number.isFinite(n) || n < lo || n > hi || (int && !Number.isInteger(n))) return false;
    add(col, n);
    return true;
  };
  if (!num('odd_margin', 'odd_margin', 0, 2, false)
    || !num('reserve_slots', 'reserve_slots', 0, 10, true)
    || !num('max_in_flight', 'max_in_flight', 1, 10, true)
    || !num('min_count', 'min_count', 0, 100000, true)) return res.status(400).json({ error: 'valor fora da faixa.' });
  if (typeof b.name === 'string' && b.name.trim()) add('name', b.name.trim().slice(0, 120));
  if (!sets.length) return res.status(400).json({ error: 'nada pra mudar.' });
  try {
    const { rowCount } = await pool.query(`UPDATE rt_lab_campaigns SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, params);
    if (!rowCount) return res.status(404).json({ error: 'Campanha não encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    fail(res, 'PATCH /api/lab/campaigns/:id', err);
  }
});

// ── DELETE /api/lab/campaigns/:id ─────────────────────────────────────────────
// Só apaga do Laboratório; os relatórios no Robotip ficam.
router.delete('/campaigns/:id', async (req, res) => {
  const id = campaignId(req);
  if (!id) return res.status(400).json({ error: 'id inválido.' });
  try {
    await pool.query('DELETE FROM rt_lab_campaigns WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    fail(res, 'DELETE /api/lab/campaigns/:id', err);
  }
});

// ── POST /api/lab/campaigns/:id/submit ────────────────────────────────────────
// Gera agora o backtest de um candidato da fila (body: { sig }). Gasta 1 slot.
router.post('/campaigns/:id/submit', async (req, res) => {
  const id = campaignId(req);
  if (!id) return res.status(400).json({ error: 'id inválido.' });
  const sig = req.body?.sig;
  if (typeof sig !== 'string' || !sig) return res.status(400).json({ error: 'sig obrigatório.' });
  try {
    const campaign = await optimizer.campaignById(id);
    if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
    const plan = await optimizer.planCampaign(campaign, { limit: 200 });
    const candidate = plan.candidates.find((c) => c.sig === sig);
    if (!candidate) return res.status(409).json({ error: 'Esse candidato não está mais na fila (já testado ou o campeão mudou).' });
    const runId = await optimizer.submitCandidate(campaign, candidate);
    res.status(201).json({ run_id: runId });
  } catch (err) {
    if (!err.status) return res.status(502).json({ error: err.message });
    fail(res, 'POST /api/lab/campaigns/:id/submit', err);
  }
});

// ── POST /api/lab/optimizer/tick ──────────────────────────────────────────────
// Confere agora os backtests rodando (sem esperar o loop de 5 min).
router.post('/optimizer/tick', async (req, res) => {
  try {
    await optimizer.runOptimizerTick();
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
