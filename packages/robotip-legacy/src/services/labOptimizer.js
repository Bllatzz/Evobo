'use strict';

// Otimizador do Laboratório: campanhas que melhoram um robô gerando backtests
// de variações no robotip.com.br (motor em labEngine.js).
//
// Ciclo de uma campanha:
//   1. pega o campeão (melhor versão até agora) e gera vizinhos (labEngine);
//   2. no modo 'auto', manda o melhor vizinho pro Robotip enquanto houver slot
//      livre (10 − em uso − reserva) e menos que max_in_flight rodando;
//   3. quando o relatório fica pronto, compara com a versão de onde saiu; se
//      bateu o campeão, vira o novo campeão e o ciclo recomeça dele.
// No modo 'suggest' (padrão) nada é gerado sozinho — a fila só é mostrada e
// o botão "Gerar" manda um por vez.

const pool = require('../db/pool');
const robotip = require('./robotipApi');
const engine = require('./labEngine');
const { runListSync, syncReportDetail } = require('./robotipSync');

const QUOTA_TOTAL = 10;
const TICK_MS = 5 * 60 * 1000;
// Relatório que não aparece na lista do Robotip depois disso = não foi criado.
const MISSING_AFTER_MS = 30 * 60 * 1000;
// Margem pra contar como "melhorou"/"piorou" (fora disso é empate/ruído).
const SCORE_TOLERANCE = 0.03;

const log = (...args) => console.log(`[robotip-legacy] [${new Date().toISOString()}] [LAB-OPT]`, ...args);

const REPORT_COLS = `
  r.id, r.name, r.market, r.query_filter, r.done, r.error, r.count, r.greens,
  r.mean_odd::float, r.months, r.pval::float, r.first_day::text, r.last_day::text,
  r.per_day_calc AS per_day,
  r.detail_synced_at`;

// ── Slots ───────────────────────────────────────────────────────────────────

/**
 * Slots de backtest: cada relatório ocupa um até o seu `scheduled_to` (o site
 * devolve um por hora, a partir de 4h depois). Runs recém-enviados que ainda
 * não apareceram na lista também contam.
 */
async function getQuota() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM rt_reports WHERE deleted_at IS NULL AND scheduled_to > NOW())::int AS used,
      (SELECT COUNT(*) FROM rt_lab_runs WHERE status = 'submitted' AND report_id IS NULL)::int AS unseen,
      (SELECT MIN(scheduled_to) FROM rt_reports WHERE deleted_at IS NULL AND scheduled_to > NOW()) AS next_free_at`);
  const used = Math.min(QUOTA_TOTAL, rows[0].used + rows[0].unseen);
  return { total: QUOTA_TOTAL, used, free: QUOTA_TOTAL - used, next_free_at: rows[0].next_free_at };
}

// ── Dados de um mercado ─────────────────────────────────────────────────────

async function marketReports(market) {
  const { rows } = await pool.query(
    `SELECT ${REPORT_COLS} FROM rt_reports r
     WHERE r.deleted_at IS NULL AND r.market = $1 AND r.done AND NOT r.error`,
    [market]
  );
  return rows;
}

async function reportById(id) {
  if (id == null) return null;
  const { rows } = await pool.query(`SELECT ${REPORT_COLS} FROM rt_reports r WHERE r.id = $1`, [id]);
  return rows[0] ?? null;
}

async function campaignById(id, client = pool) {
  const { rows } = await client.query('SELECT *, odd_margin::float FROM rt_lab_campaigns WHERE id = $1', [id]);
  return rows[0] ?? null;
}

/**
 * Estado completo de uma campanha: campeão, fila de candidatos ordenada e
 * o aprendido do mercado. Usado pela tela e pelo loop automático.
 */
async function planCampaign(campaign, { limit = 20 } = {}) {
  const [reports, runsRes] = await Promise.all([
    marketReports(campaign.market),
    pool.query('SELECT * FROM rt_lab_runs WHERE campaign_id = $1 ORDER BY submitted_at DESC', [campaign.id]),
  ]);
  const runs = runsRes.rows;
  const margin = campaign.odd_margin;
  const champion = reports.find((r) => r.id === campaign.champion_report_id) ?? null;
  const championMetrics = engine.metricsOf(champion, margin);

  // Já testado = qualquer relatório do mercado com o mesmo filtro, ou run
  // desta campanha ainda rodando/que falhou de verdade no envio.
  const testedSigs = new Set(reports.map((r) => engine.normalizeFilter(r.query_filter)));
  for (const run of runs) if (run.status !== 'failed' || run.report_id) testedSigs.add(run.sig);

  // Sem relatório do campeão ainda (campanha criada a partir de um robô sem
  // backtest): o único candidato é rodar o próprio robô.
  if (!champion) {
    const sig = engine.normalizeFilter(campaign.champion_filter);
    const pending = runs.some((r) => r.sig === sig && r.status === 'submitted');
    const candidates = pending ? [] : [{
      filter: campaign.champion_filter, sig,
      mutation: { kind: 'baseline', key: null, label: 'backtest do robô como está' },
      predicted: null, evidence: 0, gain: null, priority: Infinity,
    }];
    return { champion: null, championMetrics: null, candidates, runs, effects: engine.learnEffects(reports) };
  }

  const effects = engine.learnEffects(reports);
  const ranked = reports
    .filter((r) => r.count >= campaign.min_count)
    .map((r) => ({ r, score: engine.metricsOf(r, margin).score }))
    .filter((x) => x.score != null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);
  const winners = runs.filter((r) => r.verdict === 'better' && r.report_id !== campaign.champion_report_id).slice(0, 6);
  const candidates = engine.rankCandidates(
    engine.generateCandidates({
      championFilter: champion.query_filter,
      marketReports: ranked,
      winners,
      testedSigs,
      openMax: engine.openMaxByKey(reports),
    }),
    { championMetrics, effects, margin }
  ).slice(0, limit);
  return { champion, championMetrics, candidates, runs, effects };
}

// ── Enviar / acompanhar ─────────────────────────────────────────────────────

const KIND_SHORT = { tighten: '↑', loosen: '↓', remove: '−', add: '+', combo: '⊕', baseline: 'base' };

/** Gera o backtest de um candidato no Robotip e registra o run. */
async function submitCandidate(campaign, candidate) {
  const quota = await getQuota();
  if (quota.free <= 0) throw Object.assign(new Error('Sem slot de backtest livre agora.'), { status: 409 });

  const { rows } = await pool.query(
    `INSERT INTO rt_lab_runs (campaign_id, parent_report_id, filter, sig, mutation, predicted, report_name)
     VALUES ($1, $2, $3, $4, $5, $6, 'pendente-' || gen_random_uuid())
     RETURNING id`,
    [campaign.id, campaign.champion_report_id, candidate.filter, candidate.sig,
      JSON.stringify(candidate.mutation), candidate.predicted ? JSON.stringify(candidate.predicted) : null]
  );
  const runId = rows[0].id;
  const m = candidate.mutation;
  const name = `LAB ${campaign.id}.${runId} ${KIND_SHORT[m.kind] ?? ''} ${m.key ?? ''}`.trim().slice(0, 60);
  await pool.query('UPDATE rt_lab_runs SET report_name = $2 WHERE id = $1', [runId, name]);

  try {
    await robotip.createReport({
      name,
      market: campaign.market,
      filter: candidate.filter,
      termex: campaign.termex,
      isLive: campaign.is_live,
    });
  } catch (err) {
    await pool.query(
      `UPDATE rt_lab_runs SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1`,
      [runId, err.message.slice(0, 500)]
    );
    throw err;
  }
  log(`campanha ${campaign.id}: gerou "${name}"`);
  return runId;
}

function verdictFor(result, parent) {
  if (!parent) return 'champion';
  if (result.score >= parent.score + Math.abs(parent.score) * SCORE_TOLERANCE) return 'better';
  if (result.score <= parent.score - Math.abs(parent.score) * SCORE_TOLERANCE) return 'worse';
  return 'same';
}

/**
 * Liga runs enviados aos relatórios (pelo nome) e avalia os que ficaram
 * prontos. Promove o campeão quando um resultado bate o atual.
 */
async function checkSubmittedRuns() {
  const { rows: pending } = await pool.query(
    `SELECT run.*, r.id AS found_id, r.done AS found_done, r.error AS found_error
     FROM rt_lab_runs run
     LEFT JOIN LATERAL (
       SELECT id, done, error FROM rt_reports
       WHERE name = run.report_name AND deleted_at IS NULL
       ORDER BY id DESC LIMIT 1
     ) r ON TRUE
     WHERE run.status = 'submitted'`
  );
  for (const run of pending) {
    try {
      if (!run.found_id) {
        if (Date.now() - new Date(run.submitted_at).getTime() > MISSING_AFTER_MS) {
          await pool.query(
            `UPDATE rt_lab_runs SET status = 'failed', error = 'Relatório não apareceu no Robotip', finished_at = NOW() WHERE id = $1`,
            [run.id]
          );
        }
        continue;
      }
      if (run.report_id !== run.found_id) await pool.query('UPDATE rt_lab_runs SET report_id = $2 WHERE id = $1', [run.id, run.found_id]);
      if (run.found_error) {
        await pool.query(
          `UPDATE rt_lab_runs SET status = 'failed', error = 'Robotip deu erro ao processar', finished_at = NOW() WHERE id = $1`,
          [run.id]
        );
        continue;
      }
      if (!run.found_done) continue;
      await evaluateRun(run.id, run.found_id);
    } catch (err) {
      log(`run ${run.id} falhou ao avaliar:`, err.message);
    }
  }
}

/** Baixa o detalhe (dias) se ainda não tiver — é o que dá jogos/dia de verdade. */
async function ensureDetail(reportId) {
  if (reportId == null) return;
  const { rows } = await pool.query('SELECT detail_synced_at FROM rt_reports WHERE id = $1', [reportId]);
  if (rows[0] && !rows[0].detail_synced_at) {
    await syncReportDetail(reportId).catch((err) => log(`detalhe do ${reportId}:`, err.message));
  }
}

async function evaluateRun(runId, reportId) {
  await syncReportDetail(reportId).catch((err) => log(`detalhe do ${reportId}:`, err.message));
  const { rows: meta } = await pool.query(
    'SELECT run.parent_report_id, c.champion_report_id FROM rt_lab_runs run JOIN rt_lab_campaigns c ON c.id = run.campaign_id WHERE run.id = $1',
    [runId]
  );
  if (meta[0]) {
    await ensureDetail(meta[0].parent_report_id);
    await ensureDetail(meta[0].champion_report_id);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM rt_lab_runs WHERE id = $1 FOR UPDATE', [runId]);
    const run = rows[0];
    if (!run || run.status !== 'submitted') { await client.query('ROLLBACK'); return; }
    const { rows: cRows } = await client.query('SELECT *, odd_margin::float FROM rt_lab_campaigns WHERE id = $1 FOR UPDATE', [run.campaign_id]);
    const campaign = cRows[0];
    const [report, parent, champion] = await Promise.all([
      reportById(reportId), reportById(run.parent_report_id), reportById(campaign.champion_report_id),
    ]);
    const margin = campaign.odd_margin;
    const result = engine.metricsOf(report, margin);
    const parentM = engine.metricsOf(parent, margin);
    const championM = engine.metricsOf(champion, margin);

    let verdict = result ? verdictFor(result, parentM) : 'worse';
    // Sem relatório de campeão (baseline) ou bateu o campeão atual com volume
    // suficiente: vira o novo campeão.
    const promote = result && report.count >= campaign.min_count && (!championM || result.score > championM.score);
    const isBaseline = !campaign.champion_report_id;
    if (isBaseline && result) verdict = 'champion';
    await client.query(
      `UPDATE rt_lab_runs SET status = 'done', verdict = $2, report_id = $3, finished_at = NOW() WHERE id = $1`,
      [runId, verdict, reportId]
    );
    if (promote || (isBaseline && result)) {
      await client.query(
        `UPDATE rt_lab_campaigns SET champion_filter = $2, champion_report_id = $3, updated_at = NOW() WHERE id = $1`,
        [campaign.id, run.filter, reportId]
      );
      log(`campanha ${campaign.id}: novo campeão ${reportId}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Modo automático: preenche os slots livres com os melhores candidatos. */
async function fillAutoCampaigns() {
  const { rows: campaigns } = await pool.query(
    `SELECT *, odd_margin::float FROM rt_lab_campaigns WHERE status = 'active' AND mode = 'auto' ORDER BY updated_at`
  );
  for (const campaign of campaigns) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM rt_lab_runs WHERE campaign_id = $1 AND status = 'submitted'`,
      [campaign.id]
    );
    let inFlight = rows[0].n;
    if (inFlight >= campaign.max_in_flight) continue;
    const plan = await planCampaign(campaign);
    // Rodando em paralelo, não manda duas mudanças no mesmo parâmetro.
    const busyKeys = new Set(plan.runs.filter((r) => r.status === 'submitted').map((r) => r.mutation.key));
    for (const cand of plan.candidates) {
      if (inFlight >= campaign.max_in_flight) break;
      // Só gasta slot com o que deve melhorar (ou o baseline).
      if (cand.mutation.kind !== 'baseline' && !(cand.gain > 0)) break;
      if (busyKeys.has(cand.mutation.key)) continue;
      const quota = await getQuota();
      if (quota.free <= campaign.reserve_slots) return;
      await submitCandidate(campaign, cand);
      busyKeys.add(cand.mutation.key);
      inFlight++;
    }
  }
}

let ticking = null;

async function tick() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM rt_lab_runs WHERE status = 'submitted')::int AS pending,
      (SELECT COUNT(*) FROM rt_lab_campaigns WHERE status = 'active' AND mode = 'auto')::int AS auto`);
  if (!rows[0].pending && !rows[0].auto) return;
  await runListSync();
  await checkSubmittedRuns();
  await fillAutoCampaigns();
}

function runOptimizerTick() {
  if (!ticking) ticking = tick().finally(() => { ticking = null; });
  return ticking;
}

function startLabOptimizer() {
  if (!robotip.isConfigured()) return;
  setInterval(() => runOptimizerTick().catch((err) => log('tick falhou:', err.message)), TICK_MS);
}

module.exports = {
  QUOTA_TOTAL,
  getQuota,
  campaignById,
  planCampaign,
  submitCandidate,
  runOptimizerTick,
  checkSubmittedRuns,
  ensureDetail,
  startLabOptimizer,
};
