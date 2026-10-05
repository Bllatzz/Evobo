'use strict';

// Sincroniza robôs e relatórios de backtest do robotip.com.br pras tabelas
// rt_* (migration 014). Só lê do site — nunca cria/edita nada lá.
//
// A cada passada: lista inteira de robôs e relatórios (barata, ~0,5 MB) +
// o detalhe (dias/ligas, ~1 MB cada) de alguns relatórios processados que
// ainda não foram baixados. Relatório processado não muda, então o detalhe é
// baixado uma vez só; o backfill dos antigos vai acontecendo aos poucos.

const pool = require('../db/pool');
const robotip = require('./robotipApi');

const LOOP_INTERVAL_MS = 30 * 60 * 1000;
const DETAILS_PER_PASS = 20;
const PAUSE_BETWEEN_DETAILS_MS = 2000;

const log = (...args) => console.log(`[robotip-legacy] [${new Date().toISOString()}] [LAB-SYNC]`, ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const toTimestamp = (unix) => (unix ? new Date(unix * 1000).toISOString() : null);

// "17-06-26" (DD-MM-YY) → "2026-06-17"
function parseDay(s) {
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? `20${m[3]}-${m[2]}-${m[1]}` : null;
}

function parseJsonField(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  // Relatório sem nenhuma entrada vem com a string "null".
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function syncBots() {
  const bots = await robotip.fetchBots();
  const rows = bots.map((b) => ({
    id: b.id,
    name: b.name ?? '',
    filter: b.filter ?? '',
    termex: b.termex ?? '',
    send_telegram: Boolean(b.send_telegram),
    stake: Number.isFinite(Number(b.stake)) ? Number(b.stake) : null,
  }));
  await pool.query(
    `INSERT INTO rt_bots (id, name, filter, termex, send_telegram, stake, deleted_at, synced_at)
     SELECT id, name, filter, termex, send_telegram, stake, NULL, NOW()
     FROM jsonb_to_recordset($1::jsonb)
       AS x(id int, name text, filter text, termex text, send_telegram boolean, stake numeric)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, filter = EXCLUDED.filter, termex = EXCLUDED.termex,
       send_telegram = EXCLUDED.send_telegram, stake = EXCLUDED.stake,
       deleted_at = NULL, synced_at = NOW()`,
    [JSON.stringify(rows)]
  );
  // Lista vazia é mais provável ser falha do site do que "apagou tudo".
  if (rows.length) await pool.query(
    `UPDATE rt_bots SET deleted_at = NOW() WHERE deleted_at IS NULL AND NOT (id = ANY($1::int[]))`,
    [rows.map((r) => r.id)]
  );
  return rows.length;
}

async function syncReports() {
  const reports = await robotip.fetchReports();
  const rows = reports.map((r) => ({
    id: r.id,
    name: r.name ?? '',
    market: r.market ?? '',
    query_filter: r.query_filter ?? '',
    termex: r.termex ?? '',
    is_live: Boolean(r.isLive),
    lay_bet: Boolean(r.lay_bet),
    done: Boolean(r.done),
    error: Boolean(r.error),
    count: r.count != null ? Math.round(r.count) : null,
    greens: r.greens != null ? Math.round(r.greens) : null,
    green_rate: r.green_rate ?? null,
    mean_odd: r.mean_odd ?? null,
    profit: r.profit ?? null,
    max_drawdown: r.max_drawdown ?? null,
    pval: r.pval ?? null,
    months: r.months ?? null,
    created_at: toTimestamp(r.created_at),
    scheduled_to: toTimestamp(r.scheduled_to),
  }));
  await pool.query(
    `INSERT INTO rt_reports (id, name, market, query_filter, termex, is_live, lay_bet, done, error,
                             count, greens, green_rate, mean_odd, profit, max_drawdown, pval, months,
                             created_at, scheduled_to, deleted_at, synced_at)
     SELECT id, name, market, query_filter, termex, is_live, lay_bet, done, error,
            count, greens, green_rate, mean_odd, profit, max_drawdown, pval, months,
            created_at, scheduled_to, NULL, NOW()
     FROM jsonb_to_recordset($1::jsonb) AS x(
       id int, name text, market text, query_filter text, termex text, is_live boolean,
       lay_bet boolean, done boolean, error boolean, count int, greens int, green_rate numeric,
       mean_odd numeric, profit numeric, max_drawdown numeric, pval numeric, months int,
       created_at timestamptz, scheduled_to timestamptz)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, market = EXCLUDED.market, query_filter = EXCLUDED.query_filter,
       termex = EXCLUDED.termex, is_live = EXCLUDED.is_live, lay_bet = EXCLUDED.lay_bet,
       done = EXCLUDED.done, error = EXCLUDED.error, count = EXCLUDED.count,
       greens = EXCLUDED.greens, green_rate = EXCLUDED.green_rate, mean_odd = EXCLUDED.mean_odd,
       profit = EXCLUDED.profit, max_drawdown = EXCLUDED.max_drawdown, pval = EXCLUDED.pval,
       months = EXCLUDED.months, created_at = EXCLUDED.created_at,
       scheduled_to = EXCLUDED.scheduled_to, deleted_at = NULL, synced_at = NOW()`,
    [JSON.stringify(rows)]
  );
  if (rows.length) await pool.query(
    `UPDATE rt_reports SET deleted_at = NOW() WHERE deleted_at IS NULL AND NOT (id = ANY($1::int[]))`,
    [rows.map((r) => r.id)]
  );
  return rows.length;
}

// Agrega info_res por dia (a API pode repetir a mesma data).
function buildDays(detail) {
  const byDay = new Map();
  for (const d of parseJsonField(detail.info_res)) {
    const day = parseDay(d.date);
    if (!day) continue;
    const cur = byDay.get(day) ?? { day, count: 0, greens: 0, profit: 0, oddSum: 0 };
    const count = Math.round(d.count ?? 0);
    cur.count += count;
    cur.greens += Math.round(d.greens ?? 0);
    cur.profit += d.profit ?? 0;
    cur.oddSum += (d.mean_odd ?? 0) * count;
    byDay.set(day, cur);
  }
  return [...byDay.values()]
    .filter((d) => d.count > 0)
    .map(({ oddSum, ...d }) => ({ ...d, mean_odd: d.count ? oddSum / d.count : null }));
}

function buildLeagues(detail) {
  const byId = new Map();
  for (const l of parseJsonField(detail.leagues)) {
    if (l.league_id == null) continue;
    byId.set(String(l.league_id), {
      league_id: String(l.league_id),
      league_name: l.league_name ?? '',
      count: Math.round(l.count ?? 0),
      greens: Math.round(l.greens ?? 0),
      mean_odd: l.mean_odd ?? null,
      profit: l.profit ?? null,
      pval: l.pval ?? null,
      months: l.months ?? null,
    });
  }
  return [...byId.values()];
}

async function syncReportDetail(id) {
  const detail = await robotip.fetchReportDetail(id);
  if (!detail) throw new Error(`relatório ${id} veio vazio`);
  const days = buildDays(detail);
  const leagues = buildLeagues(detail);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM rt_report_days WHERE report_id = $1', [id]);
    await client.query('DELETE FROM rt_report_leagues WHERE report_id = $1', [id]);
    await client.query(
      `INSERT INTO rt_report_days (report_id, day, count, greens, mean_odd, profit)
       SELECT $1, day, count, greens, mean_odd, profit
       FROM jsonb_to_recordset($2::jsonb) AS x(day date, count int, greens int, mean_odd numeric, profit numeric)`,
      [id, JSON.stringify(days)]
    );
    await client.query(
      `INSERT INTO rt_report_leagues (report_id, league_id, league_name, count, greens, mean_odd, profit, pval, months)
       SELECT $1, league_id, league_name, count, greens, mean_odd, profit, pval, months
       FROM jsonb_to_recordset($2::jsonb) AS x(league_id text, league_name text, count int, greens int,
                                               mean_odd numeric, profit numeric, pval numeric, months int)`,
      [id, JSON.stringify(leagues)]
    );
    await client.query(
      `UPDATE rt_reports SET
         first_day = (SELECT MIN(day) FROM rt_report_days WHERE report_id = $1),
         last_day = (SELECT MAX(day) FROM rt_report_days WHERE report_id = $1),
         active_days = (SELECT COUNT(*) FROM rt_report_days WHERE report_id = $1),
         detail_synced_at = NOW()
       WHERE id = $1`,
      [id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function syncPendingDetails(limit = DETAILS_PER_PASS) {
  const { rows } = await pool.query(
    `SELECT id FROM rt_reports
     WHERE done AND NOT error AND detail_synced_at IS NULL AND deleted_at IS NULL
     ORDER BY created_at DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );
  let ok = 0;
  for (const { id } of rows) {
    try {
      await syncReportDetail(id);
      ok++;
    } catch (err) {
      log(`detalhe do relatório ${id} falhou:`, err.message);
    }
    await sleep(PAUSE_BETWEEN_DETAILS_MS);
  }
  return ok;
}

let running = null;

// Uma passada completa; chamadas concorrentes (loop + botão manual) reaproveitam a mesma.
function runSyncPass() {
  if (!running) {
    running = (async () => {
      const bots = await syncBots();
      const reports = await syncReports();
      const details = await syncPendingDetails();
      log(`${bots} robôs, ${reports} relatórios, ${details} detalhes novos`);
      return { bots, reports, details };
    })().finally(() => { running = null; });
  }
  return running;
}

function startRobotipSync() {
  if (!robotip.isConfigured()) {
    log('ROBOTIP_EMAIL/ROBOTIP_PASSWORD ausentes — sincronização do laboratório desligada');
    return;
  }
  const tick = () => runSyncPass().catch((err) => log('passada falhou:', err.message));
  tick();
  setInterval(tick, LOOP_INTERVAL_MS);
}

module.exports = { startRobotipSync, runSyncPass, syncReportDetail };
