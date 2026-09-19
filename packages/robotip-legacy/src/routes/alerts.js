'use strict';

const express = require('express');
const pool = require('../db/pool');
const { botsExcluidosGestao } = require('../services/gestaoSettings');
const EXCLUDED_BOTS = require('../config/gestaoExcludedBots');

const router = express.Router();

// ── SSE clients ───────────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
  invalidateCache();
}

// ── Cache curto para endpoints agregados (stats/analysis) ──────────────────
// Evitam recomputar um scan pesado a cada poll do frontend; invalidado no
// primeiro broadcast() que segue qualquer insert/update/delete de alerta.
const CACHE_TTL_MS = 20_000;
const queryCache = new Map();

function invalidateCache() { queryCache.clear(); }

async function cached(key, fn) {
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await fn();
  queryCache.set(key, { value, at: Date.now() });
  return value;
}

// ── GET /api/alerts/events ────────────────────────────────────────────────────
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ── Helpers: quantile-based range building ──────────────────────────────────
// Mínimo de amostras resolvidas para calcular quartis do bot.
// Abaixo disso, cai no fallback de faixas fixas.
const MIN_SAMPLES_QUANTILE = 8;

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

// Faixas dinâmicas baseadas nos quartis (Q1, mediana, Q3) dos valores do bot.
// Retorna [{min, max, label}] — max = null representa sem limite superior.
function buildQuantileRanges(values) {
  if (values.length < MIN_SAMPLES_QUANTILE) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const cuts = [0.25, 0.50, 0.75].map(q => Math.floor(quantile(sorted, q)));

  const ranges = [];
  let lo = 0;
  for (const cut of cuts) {
    if (cut < lo) continue; // colapsado (dados de pouca variância) — pula
    ranges.push({ min: lo, max: cut });
    lo = cut + 1;
  }
  ranges.push({ min: lo, max: null });

  return ranges.map(r => ({
    min: r.min,
    max: r.max,
    label: r.max === null ? `${r.min}+` : (r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`),
  }));
}

// ── Definições das stats e fallback de faixas fixas ─────────────────────────
const ANALYSIS_DEFS = [
  {
    key: 'dangerous_total',
    label: 'Ataques Perigosos (total)',
    getValue: r => (r.dangerous_home || 0) + (r.dangerous_away || 0),
    condition: r => r.dangerous_home != null,
    fallbackRanges: [
      { min: 0,   max: 40,   label: '0–40'   },
      { min: 41,  max: 70,   label: '41–70'  },
      { min: 71,  max: 100,  label: '71–100' },
      { min: 101, max: null, label: '101+'   },
    ],
  },
  {
    key: 'corners_total',
    label: 'Escanteios (total)',
    getValue: r => (r.corners_home || 0) + (r.corners_away || 0),
    condition: r => r.corners_home != null,
    fallbackRanges: [
      { min: 0,  max: 3,    label: '0–3' },
      { min: 4,  max: 6,    label: '4–6' },
      { min: 7,  max: 9,    label: '7–9' },
      { min: 10, max: null, label: '10+' },
    ],
  },
  {
    key: 'yellow_total',
    label: 'Amarelos (total)',
    getValue: r => (r.yellow_home || 0) + (r.yellow_away || 0),
    condition: r => r.yellow_home != null,
    fallbackRanges: [
      { min: 0, max: 1,    label: '0–1' },
      { min: 2, max: 3,    label: '2–3' },
      { min: 4, max: 5,    label: '4–5' },
      { min: 6, max: null, label: '6+'  },
    ],
  },
  {
    key: 'red_total',
    label: 'Vermelhos (total)',
    getValue: r => (r.red_home || 0) + (r.red_away || 0),
    condition: r => r.red_home != null,
    fallbackRanges: [
      { min: 0, max: 0,    label: '0'  },
      { min: 1, max: null, label: '1+' },
    ],
  },
  {
    key: 'game_minute',
    label: 'Minuto do Alerta',
    getValue: r => r.game_minute || 0,
    condition: r => r.game_minute != null,
    fallbackRanges: [
      { min: 0,  max: 55,   label: '0–55'  },
      { min: 56, max: 65,   label: '56–65' },
      { min: 66, max: 75,   label: '66–75' },
      { min: 76, max: 85,   label: '76–85' },
      { min: 86, max: null, label: '86+'   },
    ],
  },
  {
    key: 'shots_target_total',
    label: 'Chutes no Alvo (total)',
    getValue: r => (r.shots_target_home || 0) + (r.shots_target_away || 0),
    condition: r => r.shots_target_home != null,
    fallbackRanges: [
      { min: 0,  max: 4,    label: '0–4'  },
      { min: 5,  max: 8,    label: '5–8'  },
      { min: 9,  max: 12,   label: '9–12' },
      { min: 13, max: null, label: '13+'  },
    ],
  },
  {
    key: 'shots_side_total',
    label: 'Chutes ao Lado (total)',
    getValue: r => (r.shots_side_home || 0) + (r.shots_side_away || 0),
    condition: r => r.shots_side_home != null,
    fallbackRanges: [
      { min: 0,  max: 5,    label: '0–5'   },
      { min: 6,  max: 10,   label: '6–10'  },
      { min: 11, max: 15,   label: '11–15' },
      { min: 16, max: null, label: '16+'   },
    ],
  },
  {
    key: 'possession_max',
    label: 'Posse Máxima (%)',
    getValue: r => Math.max(parseFloat(r.possession_home) || 50, parseFloat(r.possession_away) || 50),
    condition: r => r.possession_home != null,
    fallbackRanges: [
      { min: 50, max: 60,   label: '50–60%' },
      { min: 61, max: 70,   label: '61–70%' },
      { min: 71, max: null, label: '71%+'   },
    ],
  },
  {
    key: 'pi1',
    label: 'PI 1',
    getValue: r => parseFloat(r.pi1) || 0,
    condition: r => r.pi1 != null,
    fallbackRanges: [
      { min: 0,  max: 30,   label: '0–30'  },
      { min: 31, max: 60,   label: '31–60' },
      { min: 61, max: 80,   label: '61–80' },
      { min: 81, max: null, label: '81+'   },
    ],
  },
  {
    key: 'pi2',
    label: 'PI 2',
    getValue: r => parseFloat(r.pi2) || 0,
    condition: r => r.pi2 != null,
    fallbackRanges: [
      { min: 0,  max: 5,    label: '0–5'   },
      { min: 6,  max: 12,   label: '6–12'  },
      { min: 13, max: 20,   label: '13–20' },
      { min: 21, max: null, label: '21+'   },
    ],
  },
];

// ── GET /api/alerts/stats ────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const { competition, result, bot_names, bot_name, search } = req.query;
    const botList = bot_names
      ? bot_names.split('|').map(s => s.trim()).filter(Boolean)
      : bot_name ? [bot_name] : [];

    const conditions = [];
    const params     = [];

    if (competition) { params.push(competition); conditions.push(`competition = $${params.length}`); }
    if (result)      { params.push(result);      conditions.push(`result = $${params.length}`); }
    if (botList.length > 0) {
      const placeholders = botList.map((_, i) => `$${params.length + i + 1}`).join(', ');
      botList.forEach(b => params.push(b));
      conditions.push(`bot_name IN (${placeholders})`);
    }
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      conditions.push(`(home_team ILIKE $${idx} OR away_team ILIKE $${idx} OR competition ILIKE $${idx})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const row = await cached(`stats:${req.originalUrl}`, async () => {
      const { rows } = await pool.query(`
        SELECT
          COUNT(*)                                                        AS total,
          COUNT(*) FILTER (WHERE result = 'green')                       AS green_count,
          COUNT(*) FILTER (WHERE result = 'red')                         AS red_count,
          COUNT(*) FILTER (WHERE result = 'pending')                     AS pending_count,
          COUNT(*) FILTER (WHERE result = 'reembolso')                   AS reembolso_count,
          ROUND(COUNT(*) FILTER (WHERE result = 'green')    * 100.0 / NULLIF(COUNT(*), 0), 1) AS green_pct,
          ROUND(COUNT(*) FILTER (WHERE result = 'red')      * 100.0 / NULLIF(COUNT(*), 0), 1) AS red_pct,
          ROUND(COUNT(*) FILTER (WHERE result = 'pending')  * 100.0 / NULLIF(COUNT(*), 0), 1) AS pending_pct,
          ROUND(COUNT(*) FILTER (WHERE result = 'reembolso')* 100.0 / NULLIF(COUNT(*), 0), 1) AS reembolso_pct
        FROM alerts ${where}
      `, params);
      return rows[0];
    });
    res.json({
      total:            parseInt(row.total, 10),
      green_count:      parseInt(row.green_count, 10),
      red_count:        parseInt(row.red_count, 10),
      pending_count:    parseInt(row.pending_count, 10),
      reembolso_count:  parseInt(row.reembolso_count, 10),
      green_pct:        parseFloat(row.green_pct) || 0,
      red_pct:          parseFloat(row.red_pct) || 0,
      pending_pct:      parseFloat(row.pending_pct) || 0,
      reembolso_pct:    parseFloat(row.reembolso_pct) || 0,
    });
  } catch (err) {
    console.error('GET /stats error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── GET /api/alerts/analysis ─────────────────────────────────────────────────
// Retorna análise histórica por bot: para cada stat e faixa, green% com dados resolvidos.
router.get('/analysis', async (req, res) => {
  try {
    const analysis = await cached(`analysis:${req.originalUrl}`, async () => {
    const includeReembolso = req.query.includeReembolso === '1';
    const resultFilter = includeReembolso
      ? `result IN ('green', 'red', 'reembolso')`
      : `result IN ('green', 'red')`;

    const { rows } = await pool.query(`
      SELECT
        bot_name, result,
        dangerous_home, dangerous_away,
        corners_home, corners_away,
        yellow_home, yellow_away,
        red_home, red_away,
        shots_target_home, shots_target_away,
        shots_side_home, shots_side_away,
        possession_home, possession_away,
        game_minute, pi1, pi2
      FROM alerts
      WHERE ${resultFilter} AND bot_name IS NOT NULL
      ORDER BY bot_name
    `);

    const byBot = {};
    for (const row of rows) {
      const bn = row.bot_name;
      if (!byBot[bn]) byBot[bn] = [];
      byBot[bn].push(row);
    }

    const analysisResult = {};
    for (const [bn, records] of Object.entries(byBot)) {
      const green     = records.filter(r => r.result === 'green').length;
      const red       = records.filter(r => r.result === 'red').length;
      const reembolso = records.filter(r => r.result === 'reembolso').length;

      analysisResult[bn] = {
        total:     records.length,
        green,
        red,
        reembolso,
        green_pct: records.length > 0 ? Math.round(green * 100 / records.length) : null,
        stats:     {},
      };

      for (const def of ANALYSIS_DEFS) {
        const eligible = records.filter(def.condition);
        if (eligible.length === 0) continue;

        // Tenta faixas por quartil (personalizadas por bot).
        // Com poucas amostras, cai no fallback de faixas fixas.
        const values       = eligible.map(def.getValue);
        const quantRanges  = buildQuantileRanges(values);
        const ranges       = quantRanges ?? def.fallbackRanges;
        const mode         = quantRanges ? 'quantile' : 'fallback';

        analysisResult[bn].stats[def.key] = {
          label: def.label,
          mode,
          ranges: ranges
            .map(range => {
              const subset = eligible.filter(r => {
                const v = def.getValue(r);
                return v >= range.min && (range.max === null || v <= range.max);
              });
              if (subset.length === 0) return null;
              const g         = subset.filter(r => r.result === 'green').length;
              const rCount    = subset.filter(r => r.result === 'red').length;
              const reembolso = subset.filter(r => r.result === 'reembolso').length;
              const total     = subset.length;
              return {
                label:     range.label,
                min:       range.min,
                max:       range.max,
                total,
                green:     g,
                red:       rCount,
                reembolso,
                green_pct: Math.round(g * 100 / total),
              };
            })
            .filter(Boolean),
        };
      }
    }

    return analysisResult;
    });

    res.json(analysis);
  } catch (err) {
    console.error('GET /analysis error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── GET /api/alerts/bots ──────────────────────────────────────────────────────
router.get('/bots', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT bot_name FROM alerts
       WHERE bot_name IS NOT NULL
         AND NOT (bot_name = ANY($1::text[]))
       ORDER BY bot_name`,
      [EXCLUDED_BOTS]
    );
    res.json(rows.map(r => r.bot_name));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── GET /api/alerts/competitions ─────────────────────────────────────────────
router.get('/competitions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT competition FROM alerts WHERE competition IS NOT NULL ORDER BY competition`
    );
    res.json(rows.map(r => r.competition));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── GET /api/alerts — lista com filtros e paginação ──────────────────────────
router.get('/', async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit  = Math.max(1, parseInt(req.query.limit, 10) || 20);
    const offset = (page - 1) * limit;
    const { competition, result, bot_name, bot_names, date_from, date_to, search } = req.query;
    const botList = bot_names
      ? bot_names.split('|').map(s => s.trim()).filter(Boolean)
      : bot_name ? [bot_name] : [];

    const conditions = [];
    const params     = [];

    if (competition)       { params.push(competition); conditions.push(`competition = $${params.length}`); }
    if (result)            { params.push(result);      conditions.push(`result = $${params.length}`); }
    if (botList.length > 0) {
      const placeholders = botList.map((_, i) => `$${params.length + i + 1}`).join(', ');
      botList.forEach(b => params.push(b));
      conditions.push(`bot_name IN (${placeholders})`);
    }
    if (date_from)   { params.push(date_from);         conditions.push(`received_at >= $${params.length}`); }
    if (date_to)     { params.push(date_to);           conditions.push(`received_at <= $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      conditions.push(`(home_team ILIKE $${idx} OR away_team ILIKE $${idx} OR competition ILIKE $${idx})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query(`SELECT COUNT(*) AS total FROM alerts ${where}`, params);
    const total    = parseInt(countRes.rows[0].total, 10);

    params.push(limit, offset);
    const dataRes = await pool.query(
      `SELECT * FROM alerts ${where} ORDER BY received_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ data: dataRes.rows, total, page, limit, total_pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('GET / error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── GET /api/alerts/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM alerts WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Alerta não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── POST /api/alerts ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const f = req.body;
    const { rows } = await pool.query(
      `INSERT INTO alerts (
        bot_name, odds, bet_odds, home_team, away_team, robotip_url, bet365_url, game_minute,
        home_odds, draw_odds, away_odds, competition, score_home, score_away,
        last_goal_minute, last_goal_minute_away,
        corners_home, corners_away,
        last_corner_minute, last_corner_minute_home, last_corner_minute_away,
        goals_over_odds, stake_pct,
        dangerous_home, dangerous_away, dangerous_per_min_5, dangerous_per_min_total,
        yellow_home, yellow_away, last_yellow_minute_home, last_yellow_minute_away,
        red_home, red_away,
        shots_side_home, shots_side_away, last_shot_side_minute_home, last_shot_side_minute_away,
        shots_target_home, shots_target_away, last_shot_target_minute_home, last_shot_target_minute_away,
        possession_home, possession_away, pi1, pi2, raw_message
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
        $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,
        $36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46
      ) RETURNING *`,
      [
        f.bot_name, f.odds, f.bet_odds, f.home_team, f.away_team, f.robotip_url, f.bet365_url, f.game_minute,
        f.home_odds, f.draw_odds, f.away_odds, f.competition, f.score_home, f.score_away,
        f.last_goal_minute, f.last_goal_minute_away,
        f.corners_home, f.corners_away,
        f.last_corner_minute, f.last_corner_minute_home, f.last_corner_minute_away,
        f.goals_over_odds, f.stake_pct,
        f.dangerous_home, f.dangerous_away, f.dangerous_per_min_5, f.dangerous_per_min_total,
        f.yellow_home, f.yellow_away, f.last_yellow_minute_home, f.last_yellow_minute_away,
        f.red_home, f.red_away,
        f.shots_side_home, f.shots_side_away, f.last_shot_side_minute_home, f.last_shot_side_minute_away,
        f.shots_target_home, f.shots_target_away, f.last_shot_target_minute_home, f.last_shot_target_minute_away,
        f.possession_home, f.possession_away, f.pi1, f.pi2, f.raw_message,
      ]
    );
    broadcast('new-alert', rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST / error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── PATCH /api/alerts/:id ────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { result } = req.body;
    if (!['green', 'red', 'pending', 'reembolso'].includes(result))
      return res.status(400).json({ error: "result deve ser 'green', 'red', 'pending' ou 'reembolso'." });

    const { rows } = await pool.query(
      'UPDATE alerts SET result = $1 WHERE id = $2 RETURNING *',
      [result, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Alerta não encontrado.' });
    const alert = rows[0];
    broadcast('alert-updated', alert);

    // Sincroniza gestao_banca (bots excluídos da gestão não são inseridos, a
    // menos que o toggle "incluir_bots_excluidos" esteja ligado)
    const BOTS_EXCLUIDOS_GESTAO = await botsExcluidosGestao();
    if (['green', 'red', 'reembolso'].includes(result) && !BOTS_EXCLUIDOS_GESTAO.includes(alert.bot_name)) {
      await pool.query(
        `INSERT INTO gestao_banca (alert_id, bot_name, home_team, away_team, competition, result, bet_odds, stake_pct, received_at)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::numeric,$8::numeric,$9::numeric),$10,$11)
         ON CONFLICT (alert_id) DO UPDATE SET result = EXCLUDED.result,
           bet_odds  = COALESCE(EXCLUDED.bet_odds, gestao_banca.bet_odds),
           stake_pct = COALESCE(EXCLUDED.stake_pct, gestao_banca.stake_pct)`,
        [
          alert.id, alert.bot_name, alert.home_team, alert.away_team, alert.competition,
          result,
          alert.bet_odds, alert.goals_over_odds, alert.odds,
          alert.stake_pct ?? 1,
          alert.received_at,
        ]
      );
    } else {
      // resultado voltou para pending — remove da gestão
      await pool.query('DELETE FROM gestao_banca WHERE alert_id = $1', [alert.id]);
    }

    res.json(alert);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── DELETE /api/alerts/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM alerts WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Alerta não encontrado.' });
    invalidateCache();
    res.json({ deleted: true, id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
module.exports.broadcast = broadcast;
