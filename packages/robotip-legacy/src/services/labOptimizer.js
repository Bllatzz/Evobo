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
const { paramLabel } = require('./labParams');
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
  const { rows } = await client.query('SELECT *, odd_margin::float, target_odd::float FROM rt_lab_campaigns WHERE id = $1', [id]);
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
  const rule = engine.campaignOddRule(campaign);
  const calibration = await marketCalibration(campaign.market, reports, rule);
  // Campeão com filtro de data não vale como ponto de partida (período
  // diferente dos testes, que nunca levam data) — roda o robô de novo sem.
  const champion = reports.find((r) => r.id === campaign.champion_report_id && !engine.hasDataFilter(r.query_filter)) ?? null;
  const championMetrics = engine.metricsOf(champion, rule);

  // Já testado = qualquer relatório do mercado com o mesmo filtro, ou run
  // desta campanha ainda rodando/que falhou de verdade no envio.
  const testedSigs = new Set(reports.map((r) => engine.normalizeFilter(r.query_filter)));
  for (const run of runs) if (run.status !== 'failed' || run.report_id) testedSigs.add(run.sig);

  // Sem relatório do campeão ainda (campanha criada a partir de um robô sem
  // backtest): o único candidato é rodar o próprio robô.
  if (!champion) {
    const filter = engine.stripData(campaign.champion_filter);
    const sig = engine.normalizeFilter(filter);
    const pending = runs.some((r) => r.sig === sig && r.status === 'submitted');
    const candidates = pending ? [] : [{
      filter, sig,
      mutation: { kind: 'baseline', key: null, label: 'backtest do robô como está' },
      predicted: null, evidence: 0, gain: null, priority: Infinity,
    }];
    return { champion: null, championMetrics: null, candidates, runs, effects: engine.learnEffects(reports), calibration };
  }

  const effects = engine.learnEffects(reports);
  const ranked = reports
    .filter((r) => r.count >= campaign.min_count)
    .map((r) => ({ r, score: engine.metricsOf(r, rule).score }))
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
    { championMetrics, effects, oddRule: rule, calibration }
  ).slice(0, limit);
  return { champion, championMetrics, candidates, runs, effects, calibration };
}

/**
 * Previsto × real de todos os testes já avaliados neste mercado (de qualquer
 * campanha) — o motor usa o erro médio pra corrigir as próximas previsões.
 */
async function marketCalibration(market, reports, rule) {
  const { rows } = await pool.query(
    `SELECT run.mutation, run.predicted, run.report_id, run.parent_report_id
     FROM rt_lab_runs run JOIN rt_lab_campaigns c ON c.id = run.campaign_id
     WHERE c.market = $1 AND run.status = 'done' AND run.predicted IS NOT NULL
       AND run.report_id IS NOT NULL AND run.parent_report_id IS NOT NULL`,
    [market]
  );
  const byId = new Map(reports.map((r) => [r.id, r]));
  return engine.calibrate(rows.map((run) => ({
    kind: run.mutation.kind,
    predicted: run.predicted,
    parent: engine.metricsOf(byId.get(run.parent_report_id), rule),
    result: engine.metricsOf(byId.get(run.report_id), rule),
  })));
}

// ── Enviar / acompanhar ─────────────────────────────────────────────────────


/** O que o teste muda, em português (igual à tela da campanha). */
function mutationText(m) {
  if (m.kind === 'baseline') return 'robô como está';
  if (m.kind === 'combo') return m.parts.map((p) => `${paramLabel(p.key)} ${p.kind === 'remove' ? '(tirar)' : p.label}`).join(' + ');
  if (m.kind === 'remove') return `tirar ${paramLabel(m.key)}`;
  if (m.kind === 'add') return `adicionar ${paramLabel(m.key)} ${m.label.replace(/^adicionar /, '').replace(/ \(de ".*"\)$/, '')}`;
  return `${paramLabel(m.key)} ${m.label}`;
}

/**
 * Nome do backtest: "Otimização 1.N: {robô}: {o que mudou}", N = ordem do
 * teste na campanha (o primeiro é 1.0). O run é ligado ao relatório pelo
 * nome, então ele tem que ser único — se já existir (ex.: campanha do mesmo
 * robô recriada), sobe a versão maior (2.N, 3.N…).
 */
async function reportNameFor(campaign, runId, mutation) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM rt_lab_runs WHERE campaign_id = $1 AND id < $2',
    [campaign.id, runId]
  );
  const robot = String(campaign.name).trim();
  for (let major = 1; ; major++) {
    const name = `Otimização ${major}.${rows[0].n}: ${robot}: ${mutationText(mutation)}`.slice(0, 150);
    const { rows: taken } = await pool.query(
      `SELECT 1 FROM rt_lab_runs WHERE report_name = $1
       UNION ALL SELECT 1 FROM rt_reports WHERE name = $1 LIMIT 1`,
      [name]
    );
    if (!taken.length) return name;
  }
}

/** Gera o backtest de um candidato no Robotip e registra o run. */
async function submitCandidate(campaign, candidate) {
  // Última barreira: nada sai daqui com filtro de data.
  if (engine.hasDataFilter(candidate.filter)) candidate = { ...candidate, filter: engine.stripData(candidate.filter), sig: engine.normalizeFilter(engine.stripData(candidate.filter)) };
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
  const name = await reportNameFor(campaign, runId, candidate.mutation);
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
 * Compara dois relatórios só nos dias em que os dois existem. O Robotip corta
 * em ~4.900 entradas contando do fim, então uma versão com mais jogos cobre
 * um período menor — comparar o total de cada um mistura épocas diferentes.
 * Período de cada um = dias entre 1% e 99% das entradas (ignora pontas soltas).
 * Sem dias baixados ou sem período em comum: null (cai no total).
 */
async function compareOnSameDays(aId, bId, rule, client = pool) {
  if (aId == null || bId == null) return null;
  const { rows } = await client.query(
    `WITH d AS (
       SELECT report_id, day, count, greens, mean_odd,
              SUM(count) OVER (PARTITION BY report_id ORDER BY day) AS cum,
              SUM(count) OVER (PARTITION BY report_id) AS total
       FROM rt_report_days WHERE report_id = ANY($1::int[])
     ), w AS (
       SELECT report_id,
              MIN(day) FILTER (WHERE cum >= total * 0.01) AS a,
              MIN(day) FILTER (WHERE cum >= total * 0.99) AS b
       FROM d GROUP BY report_id
     ), c AS (
       SELECT MAX(a) AS a, MIN(b) AS b FROM w HAVING COUNT(*) = 2
     )
     SELECT d.report_id, c.a::text AS a, c.b::text AS b, (c.b - c.a + 1) AS days,
            SUM(d.count)::int AS count, SUM(d.greens)::int AS greens,
            SUM(d.mean_odd * d.count) / NULLIF(SUM(d.count), 0) AS mean_odd
     FROM d CROSS JOIN c
     WHERE c.a <= c.b AND d.day BETWEEN c.a AND c.b
     GROUP BY d.report_id, c.a, c.b`,
    [[aId, bId]]
  );
  const byId = new Map(rows.map((r) => [r.report_id, r]));
  if (!byId.has(aId) || !byId.has(bId)) return null;
  const m = (r) => engine.metricsOf({ count: r.count, greens: r.greens, mean_odd: r.mean_odd, per_day: r.count / Math.max(r.days, 7) }, rule);
  const ra = byId.get(aId);
  return { from: ra.a, to: ra.b, a: m(ra), b: m(byId.get(bId)) };
}

const brief = (m) => (m ? { acc: m.acc, per_day: m.perDay, score: m.score, count: m.count } : null);

/**
 * Julga um resultado: veredito contra a versão de onde saiu e se bate o
 * campeão atual — os dois nos dias em comum.
 */
async function judgeRun({ run, report, parent, champion, campaign, client }) {
  const rule = engine.campaignOddRule(campaign);
  const total = engine.metricsOf(report, rule);
  if (!total) return { verdict: 'worse', promote: false, comparison: null };
  const isBaseline = !champion || engine.hasDataFilter(champion.query_filter);
  if (isBaseline || run.mutation?.kind === 'baseline') {
    return { verdict: 'champion', promote: true, comparison: null };
  }
  const vsParent = parent ? await compareOnSameDays(report.id, parent.id, rule, client) : null;
  const result = vsParent?.a ?? total;
  const parentM = vsParent?.b ?? engine.metricsOf(parent, rule);
  const verdict = verdictFor(result, parentM);
  const vsChamp = champion.id === parent?.id ? vsParent : await compareOnSameDays(report.id, champion.id, rule, client);
  const r2 = vsChamp?.a ?? total;
  const c2 = vsChamp?.b ?? engine.metricsOf(champion, rule);
  const promote = report.count >= campaign.min_count && r2.score > c2.score;
  const comparison = vsParent
    ? { from: vsParent.from, to: vsParent.to, result: brief(result), parent: brief(parentM) }
    : null;
  return { verdict, promote, comparison };
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
    const { rows: cRows } = await client.query('SELECT *, odd_margin::float, target_odd::float FROM rt_lab_campaigns WHERE id = $1 FOR UPDATE', [run.campaign_id]);
    const campaign = cRows[0];
    const [report, parent, champion] = await Promise.all([
      reportById(reportId), reportById(run.parent_report_id), reportById(campaign.champion_report_id),
    ]);
    const { verdict, promote, comparison } = await judgeRun({ run, report, parent, champion, campaign, client });
    await client.query(
      `UPDATE rt_lab_runs SET status = 'done', verdict = $2, report_id = $3, comparison = $4, finished_at = NOW() WHERE id = $1`,
      [runId, verdict, reportId, comparison]
    );
    if (promote) {
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

/**
 * Refaz os vereditos e a cadeia de campeões de uma campanha com a regra de
 * odd atual (ex.: depois de mudar a odd que o operador pega). Não gera
 * backtest nenhum — só reavalia os que já rodaram, na ordem em que rodaram.
 */
async function reevaluateCampaign(campaignId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cRows } = await client.query('SELECT *, odd_margin::float, target_odd::float FROM rt_lab_campaigns WHERE id = $1 FOR UPDATE', [campaignId]);
    const campaign = cRows[0];
    if (!campaign) { await client.query('ROLLBACK'); return; }
    const { rows: runs } = await client.query(
      `SELECT * FROM rt_lab_runs WHERE campaign_id = $1 AND status = 'done' AND report_id IS NOT NULL
       ORDER BY finished_at, id`,
      [campaignId]
    );
    let champion = null;
    let championFilter = null;
    for (const run of runs) {
      const [report, parent] = await Promise.all([reportById(run.report_id), reportById(run.parent_report_id)]);
      // Relatório com data (de antes da regra "nunca data") não entra na cadeia.
      if (!report || engine.hasDataFilter(report.query_filter)) continue;
      const { verdict, promote, comparison } = await judgeRun({ run, report, parent, champion, campaign, client });
      await client.query('UPDATE rt_lab_runs SET verdict = $2, comparison = $3 WHERE id = $1', [run.id, verdict, comparison]);
      if (promote) { champion = report; championFilter = run.filter; }
    }
    if (champion) {
      await client.query(
        'UPDATE rt_lab_campaigns SET champion_filter = $2, champion_report_id = $3, updated_at = NOW() WHERE id = $1',
        [campaignId, championFilter, champion.id]
      );
    }
    await client.query('COMMIT');
    log(`campanha ${campaignId}: reavaliada, campeão ${champion?.id ?? 'sem mudança'}`);
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
    `SELECT *, odd_margin::float, target_odd::float FROM rt_lab_campaigns WHERE status = 'active' AND mode = 'auto' ORDER BY updated_at`
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
  reevaluateCampaign,
  startLabOptimizer,
};
