'use strict';

// Motor do otimizador do Laboratório — funções puras, sem banco nem rede.
//
// Ideia: um robô é uma lista de faixas de parâmetro ("tm entre 45 e 85",
// "odd >= 1.3"...). A partir de um robô campeão, gera vizinhos mudando UMA
// coisa (aperta/afrouxa uma faixa, tira um filtro, puxa um filtro dos melhores
// relatórios do mercado, junta duas mudanças que já deram certo), estima o que
// cada um deve fazer com assertividade e volume usando os pares de relatórios
// que já diferem só naquele parâmetro, e ordena pelo ganho esperado.
//
// Régua: jogos/dia × (assertividade × odd que o operador pega − 1), em stakes
// por dia — o mesmo "Stake/dia" do frontend.

const OPS = ['>=', '<=', '==', 'maior ou igual a', 'menor ou igual a', 'maior que', 'menor que'];
const PIECE_RE = new RegExp(`^(.+?)-(${OPS.map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})-(.*)$`);
const LOWER_OPS = new Set(['>=', 'maior ou igual a', 'maior que']);
const UPPER_OPS = new Set(['<=', 'menor ou igual a', 'menor que']);

// Peças que o otimizador nunca mexe (período, ligas, flag de mercado de canto).
const isFixedKey = (key) => key === 'data' || key === 'gotCornerMkt';

/** "tm->=-45&tm-<=-85&!ligas=1,2&" → [{ key, op, value, raw }] (ligas/data ficam com raw). */
function parsePieces(query) {
  return String(query || '')
    .split('&')
    .filter(Boolean)
    .map((raw) => {
      if (raw.startsWith('!ligas=') || raw.startsWith('$ligas=')) return { key: raw.slice(0, 6), op: null, value: null, raw };
      const m = PIECE_RE.exec(raw);
      if (!m) return { key: raw, op: null, value: null, raw };
      return { key: m[1], op: m[2], value: m[3], raw };
    });
}

const pieceToString = (p) => (p.op ? `${p.key}-${p.op}-${p.value}` : p.raw);

function serialize(pieces) {
  return `${pieces.map(pieceToString).join('&')}&`;
}

/**
 * Filtro sem período (peças `data-…`). Backtest gerado pelo Laboratório
 * NUNCA leva filtro de data: um período herdado (ex.: até 02/04/2026) faz
 * todo teste cobrir só os meses antes dele, porque o Robotip conta ~4.900
 * entradas de trás pra frente a partir do fim do período.
 */
function stripData(query) {
  return serialize(parsePieces(query).filter((p) => p.key !== 'data'));
}

const hasDataFilter = (query) => parsePieces(query).some((p) => p.key === 'data');

/** Forma canônica pra saber se um filtro já foi testado: peças ordenadas, números normalizados. */
function normalizeFilter(query, { ignoreData = false } = {}) {
  return parsePieces(query)
    .filter((p) => !(ignoreData && p.key === 'data'))
    .map((p) => {
      if (!p.op) return p.raw.startsWith('!ligas=') || p.raw.startsWith('$ligas=')
        ? `${p.key}${p.raw.slice(6).split(',').filter(Boolean).sort().join(',')}`
        : p.raw;
      const n = Number(p.value);
      return `${p.key}|${p.op}|${Number.isFinite(n) ? n : p.value}`;
    })
    .sort()
    .join('&');
}

/** Faixas por parâmetro: { key → { min, max, minOp, maxOp, eq } } (só peças numéricas mexíveis). */
function rangesOf(pieces) {
  const out = new Map();
  for (const p of pieces) {
    if (!p.op || isFixedKey(p.key)) continue;
    const n = Number(p.value);
    if (!Number.isFinite(n)) continue;
    const cur = out.get(p.key) ?? { key: p.key };
    if (LOWER_OPS.has(p.op)) { cur.min = n; cur.minOp = p.op; }
    else if (UPPER_OPS.has(p.op)) { cur.max = n; cur.maxOp = p.op; }
    else cur.eq = n;
    out.set(p.key, cur);
  }
  return out;
}

const round = (v, step) => {
  const decimals = step < 1 ? Math.max(1, -Math.floor(Math.log10(step))) : 0;
  return Number(v.toFixed(decimals));
};

/** Tamanho do "passo" ao apertar/afrouxar um parâmetro. */
function stepFor(key, value) {
  if (key === 'tm') return 5;
  if (key.includes('_odd')) return 0.1;
  if (key.includes('rolling')) return 0.1;
  const abs = Math.abs(value);
  if (Number.isInteger(value)) return Math.max(1, Math.round(abs * 0.15));
  return Math.max(0.1, round(abs * 0.15, 0.1));
}

/**
 * Teto "sem limite" de cada parâmetro (200 pra odds, 300 pra ataques, 100 pra
 * posse...). É o maior "<=" que aparece pra aquela chave em vários relatórios.
 */
function openMaxByKey(reports) {
  const seen = new Map();
  for (const r of reports) {
    for (const p of parsePieces(r.query_filter)) {
      if (!p.op || !UPPER_OPS.has(p.op)) continue;
      const n = Number(p.value);
      if (!Number.isFinite(n)) continue;
      const cur = seen.get(p.key) ?? new Map();
      cur.set(n, (cur.get(n) ?? 0) + 1);
      seen.set(p.key, cur);
    }
  }
  const out = new Map();
  for (const [key, counts] of seen) {
    const top = Math.max(...counts.keys());
    if (counts.get(top) >= 2 || top >= 100) out.set(key, top);
  }
  return out;
}

// ── Métricas ────────────────────────────────────────────────────────────────

function perDayOf(r) {
  if (r.per_day != null) return Number(r.per_day);
  if (r.count && r.months) return r.count / (r.months * 30.44);
  return null;
}

/**
 * Regra da odd que o operador pega: `{ fixed: 2 }` (espera a odd chegar nesse
 * valor — o padrão das campanhas) ou `{ margin: 0.2 }` (odd do alerta +
 * margem). Um número sozinho é margem (formato antigo).
 */
function oddRuleOf(rule) {
  if (typeof rule === 'number') return { margin: rule };
  return rule ?? { margin: 0 };
}

function oddFor(meanOdd, rule) {
  const r = oddRuleOf(rule);
  return r.fixed != null ? r.fixed : Number(meanOdd ?? 0) + (r.margin ?? 0);
}

/** Regra de odd de uma campanha. */
function campaignOddRule(campaign) {
  return campaign.target_odd != null ? { fixed: Number(campaign.target_odd) } : { margin: Number(campaign.odd_margin ?? 0) };
}

/** Métricas na odd que o operador pega. */
function metricsOf(r, rule) {
  if (!r || !r.count) return null;
  const acc = r.greens / r.count;
  const odd = oddFor(r.mean_odd, rule);
  const perDay = perDayOf(r);
  const edge = acc * odd - 1;
  return { acc, odd, perDay, edge, score: perDay != null ? perDay * edge : null, count: r.count };
}

// ── Aprendizado: o que cada mudança fez nos pares de relatórios ──────────────

/**
 * Em que direção uma faixa mudou de A pra B: "tighten" (menos jogos — subiu o
 * mínimo / baixou o máximo / passou a existir), "loosen" (o contrário).
 */
function changeKind(ra, rb, openMax) {
  if (!ra && rb) return 'add';
  if (ra && !rb) return 'remove';
  const top = openMax.get(ra.key);
  const maxA = ra.max ?? top ?? Infinity;
  const maxB = rb.max ?? top ?? Infinity;
  const minA = ra.min ?? -Infinity;
  const minB = rb.min ?? -Infinity;
  const tighter = minB >= minA && maxB <= maxA;
  const looser = minB <= minA && maxB >= maxA;
  if (tighter && !looser) return 'tighten';
  if (looser && !tighter) return 'loosen';
  return null;
}

/**
 * Pares de relatórios do mesmo mercado que diferem em exatamente uma faixa
 * (ligas e período iguais). Devolve, por chave+direção, as variações médias
 * de assertividade (pontos), odd e volume (razão).
 */
function learnEffects(reports) {
  const openMax = openMaxByKey(reports);
  // Só relatórios com o detalhe baixado: jogos/dia estimado pelos meses é
  // grosseiro demais pra comparar volume entre dois relatórios.
  const usable = reports.filter((r) => r.done && !r.error && r.count >= 100 && r.per_day != null);
  const parsed = usable.map((r) => {
    const pieces = parsePieces(r.query_filter);
    const fixed = pieces.filter((p) => !p.op || isFixedKey(p.key)).map((p) => p.raw).sort().join('&');
    return { r, ranges: rangesOf(pieces), fixed, sig: normalizeFilter(r.query_filter) };
  });

  const effects = new Map(); // "key|kind" → { key, kind, n, dAcc, dOdd, logVol, examples }
  const seenSig = new Set();
  for (let i = 0; i < parsed.length; i++) {
    for (let j = 0; j < parsed.length; j++) {
      if (i === j) continue;
      const a = parsed[i];
      const b = parsed[j];
      if (a.r.market !== b.r.market || a.fixed !== b.fixed || a.sig === b.sig) continue;
      const keys = new Set([...a.ranges.keys(), ...b.ranges.keys()]);
      const diff = [...keys].filter((k) => JSON.stringify(a.ranges.get(k) ?? null) !== JSON.stringify(b.ranges.get(k) ?? null));
      if (diff.length !== 1) continue;
      const key = diff[0];
      const kind = changeKind(a.ranges.get(key), b.ranges.get(key), openMax);
      // Só conta cada par uma vez, no sentido "apertou/adicionou".
      if (kind !== 'tighten' && kind !== 'add') continue;
      const pairSig = `${a.sig}→${b.sig}`;
      if (seenSig.has(pairSig)) continue;
      seenSig.add(pairSig);

      const accA = a.r.greens / a.r.count;
      const accB = b.r.greens / b.r.count;
      const id = `${key}|${kind}`;
      const cur = effects.get(id) ?? { key, kind, n: 0, dAcc: 0, dOdd: 0, logVol: 0, examples: [] };
      cur.n += 1;
      cur.dAcc += accB - accA;
      cur.dOdd += Number(b.r.mean_odd) - Number(a.r.mean_odd);
      cur.logVol += Math.log(perDayOf(b.r) / perDayOf(a.r));
      if (cur.examples.length < 5) cur.examples.push({ from: a.r.id, to: b.r.id });
      effects.set(id, cur);
    }
  }

  const out = new Map();
  for (const [id, e] of effects) {
    out.set(id, { key: e.key, kind: e.kind, n: e.n, dAcc: e.dAcc / e.n, dOdd: e.dOdd / e.n, volRatio: Math.exp(e.logVol / e.n), examples: e.examples });
  }
  return out;
}

// Sem nenhum par parecido: palpite conservador, só pra ordenar a fila.
const PRIORS = {
  tighten: { dAcc: 0.01, dOdd: -0.02, volRatio: 0.85 },
  loosen: { dAcc: -0.008, dOdd: 0.02, volRatio: 1.15 },
  remove: { dAcc: -0.015, dOdd: 0.03, volRatio: 1.3 },
  add: { dAcc: 0.02, dOdd: -0.04, volRatio: 0.7 },
};

// Quantos pares valem "metade" da evidência; abaixo disso puxa pro palpite.
const SHRINK_PAIRS = 3;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Efeito esperado de uma mutação, a partir do aprendido. Afrouxar/remover =
 * inverso de apertar/adicionar. Os pares mudam o parâmetro em tamanhos
 * diferentes do passo do otimizador, então a média é encolhida pro palpite
 * conforme o número de pares e limitada a um efeito plausível por passo.
 */
function expectedEffect(effects, key, kind) {
  const direct = kind === 'tighten' || kind === 'add';
  const e = effects.get(`${key}|${direct ? kind : kind === 'loosen' ? 'tighten' : 'add'}`);
  if (!e) return null;
  const raw = direct
    ? { dAcc: e.dAcc, dOdd: e.dOdd, logVol: Math.log(e.volRatio) }
    : { dAcc: -e.dAcc, dOdd: -e.dOdd, logVol: -Math.log(e.volRatio) };
  const prior = PRIORS[kind];
  const w = e.n / (e.n + SHRINK_PAIRS);
  return {
    n: e.n,
    dAcc: clamp(w * raw.dAcc + (1 - w) * prior.dAcc, -0.06, 0.06),
    dOdd: clamp(w * raw.dOdd + (1 - w) * prior.dOdd, -0.3, 0.3),
    volRatio: Math.exp(clamp(w * raw.logVol + (1 - w) * Math.log(prior.volRatio), Math.log(0.4), Math.log(2.5))),
  };
}

function predict(base, effect, rule) {
  const acc = Math.min(0.99, Math.max(0.01, base.acc + effect.dAcc));
  // Odd fixa: a mudança não mexe na odd que o operador pega.
  const fixed = oddRuleOf(rule).fixed;
  const odd = fixed != null ? fixed : Math.max(1.01, base.odd + effect.dOdd);
  const perDay = base.perDay * effect.volRatio;
  return { acc, odd, perDay, score: perDay * (acc * odd - 1) };
}

// ── Geração de candidatos ───────────────────────────────────────────────────

function fmtVal(v) {
  return String(v).replace('.', ',');
}

/**
 * Vizinhos do campeão. Cada candidato: { filter, sig, mutation: { kind, key,
 * label, parts? } }. Não repete filtros já testados (`testedSigs`).
 */
// Odd mínima que vale a pena (pedido do operador): abaixo disso não compensa.
const MIN_USEFUL_ODD = 1.6;

function generateCandidates({ championFilter, marketReports, winners = [], testedSigs, openMax }) {
  const pieces = parsePieces(championFilter).filter((p) => p.key !== 'data');
  const ranges = rangesOf(pieces);
  const out = [];
  const push = (newPieces, mutation) => {
    const filter = serialize(newPieces);
    const sig = normalizeFilter(filter);
    if (testedSigs.has(sig) || out.some((c) => c.sig === sig)) return;
    out.push({ filter, sig, mutation });
  };
  const setValue = (key, ops, value) => pieces.map((p) => (p.key === key && ops.has(p.op) ? { ...p, value: String(value) } : p));

  const tunable = [...ranges.values()].filter((r) => r.eq == null);
  for (const r of tunable) {
    const top = openMax.get(r.key);
    const ref = r.min ?? r.max ?? 1;
    const step = stepFor(r.key, ref);
    const isOdd = r.key.includes('_odd');
    // Odd abaixo de 1,6 não compensa (e abaixo de 1 nem existe): mínimo de
    // odd nunca desce de 1,6, e um mínimo que já está abaixo sobe direto pra 1,6.
    const floor = isOdd ? MIN_USEFUL_ODD : r.key.startsWith('dif_') ? -10 : 0;
    if (r.min != null) {
      const up = isOdd && r.min < MIN_USEFUL_ODD ? MIN_USEFUL_ODD : round(r.min + step, step);
      const down = round(r.min - step, step);
      if (r.max == null || up <= r.max) push(setValue(r.key, LOWER_OPS, up), { kind: 'tighten', key: r.key, label: `mínimo ${fmtVal(r.min)} → ${fmtVal(up)}` });
      if (down >= floor) push(setValue(r.key, LOWER_OPS, down), { kind: 'loosen', key: r.key, label: `mínimo ${fmtVal(r.min)} → ${fmtVal(down)}` });
    }
    if (r.max != null && !(top != null && r.max >= top)) {
      const maxStep = stepFor(r.key, r.max);
      const down = round(r.max - maxStep, maxStep);
      const up = round(r.max + maxStep, maxStep);
      if (r.key === 'tm' ? up <= 90 : true) push(setValue(r.key, UPPER_OPS, up), { kind: 'loosen', key: r.key, label: `máximo ${fmtVal(r.max)} → ${fmtVal(up)}` });
      if ((r.min == null || down >= r.min) && (!isOdd || down >= MIN_USEFUL_ODD)) push(setValue(r.key, UPPER_OPS, down), { kind: 'tighten', key: r.key, label: `máximo ${fmtVal(r.max)} → ${fmtVal(down)}` });
    }
  }

  // Tirar um filtro (menos parâmetro = melhor, se não perder assertividade).
  // Minuto e a odd do próprio mercado ficam.
  const removable = [...ranges.keys()].filter((k) => k !== 'tm' && !k.includes('_odd_'));
  if (ranges.size > 2) {
    for (const key of removable) push(pieces.filter((p) => p.key !== key), { kind: 'remove', key, label: 'tirar o filtro' });
  }

  // Puxar um filtro dos melhores relatórios do mercado que o campeão não tem.
  const borrowed = new Set();
  for (const r of marketReports) {
    if (borrowed.size >= 8) break;
    for (const p of parsePieces(r.query_filter)) {
      if (!p.op || isFixedKey(p.key) || ranges.has(p.key) || borrowed.has(p.key)) continue;
      const extra = parsePieces(r.query_filter).filter((q) => q.key === p.key && q.op);
      const rr = rangesOf(extra).get(p.key);
      if (!rr) continue;
      borrowed.add(p.key);
      const top = openMax.get(p.key);
      const parts = [rr.min != null ? `≥ ${fmtVal(rr.min)}` : null, rr.max != null && !(top != null && rr.max >= top) ? `≤ ${fmtVal(rr.max)}` : null, rr.eq != null ? `= ${fmtVal(rr.eq)}` : null].filter(Boolean);
      push([...pieces, ...extra], { kind: 'add', key: p.key, label: `adicionar ${parts.join(' e ')} (de "${r.name}")`, fromReport: r.id });
    }
  }

  // Mudanças que já melhoraram uma versão anterior, aplicadas no campeão atual
  // (é assim que duas melhorias em parâmetros diferentes se juntam).
  for (const w of winners) {
    const keys = w.mutation.kind === 'combo' ? w.mutation.parts.map((p) => p.key) : [w.mutation.key];
    const fromWinner = parsePieces(w.filter).filter((p) => keys.includes(p.key) && p.key !== 'data');
    const merged = pieces.filter((p) => !keys.includes(p.key)).concat(fromWinner);
    const parts = w.mutation.kind === 'combo' ? w.mutation.parts : [w.mutation];
    push(merged, { kind: 'combo', key: keys.join('+'), label: `juntar o que deu certo: ${parts.map((p) => `${p.key} ${p.label}`).join(' + ')}`, parts });
  }
  return out;
}

/** Ordena candidatos pelo ganho previsto em stake/dia (maior primeiro). */
// ── Calibração: previsto × real dos testes já feitos ────────────────────────

// Quantos testes valem "metade" da correção (com poucos testes corrige pouco).
const CALIBRATION_SHRINK = 3;

/**
 * Erro médio das previsões nos testes já feitos: quanto a assertividade e o
 * volume reais ficaram acima (+) ou abaixo (−) do previsto, em relação à
 * versão de onde cada teste saiu. Por tipo de mudança e no geral.
 *
 * `runs`: [{ kind, predicted: { acc, perDay, base? }, parent: metrics, result: metrics }].
 * O volume só entra quando a previsão guardou a base (`predicted.base`) —
 * previsões antigas usavam outra conta de jogos/dia.
 */
function calibrate(runs) {
  const acc = { n: 0, sum: 0 };
  const vol = { n: 0, sum: 0 };
  const byKind = {};
  for (const r of runs) {
    if (!r.predicted || !r.parent || !r.result) continue;
    const k = (byKind[r.kind] ??= { acc: { n: 0, sum: 0 }, vol: { n: 0, sum: 0 } });
    const accErr = (r.result.acc - r.parent.acc) - (r.predicted.acc - (r.predicted.base?.acc ?? r.parent.acc));
    acc.n++; acc.sum += accErr; k.acc.n++; k.acc.sum += accErr;
    const base = r.predicted.base;
    if (base?.perDay && r.parent.perDay && r.result.perDay && r.predicted.perDay) {
      const volErr = Math.log(r.result.perDay / r.parent.perDay) - Math.log(r.predicted.perDay / base.perDay);
      vol.n++; vol.sum += volErr; k.vol.n++; k.vol.sum += volErr;
    }
  }
  const shrunk = (x, fallback = 0) => {
    if (!x.n) return fallback;
    const w = x.n / (x.n + CALIBRATION_SHRINK);
    return w * (x.sum / x.n) + (1 - w) * fallback;
  };
  const global = { accBias: shrunk(acc), logVolBias: shrunk(vol) };
  const kinds = {};
  for (const [kind, k] of Object.entries(byKind)) {
    kinds[kind] = { n: k.acc.n, accBias: shrunk(k.acc, global.accBias), logVolBias: shrunk(k.vol, global.logVolBias) };
  }
  return {
    n: acc.n,
    nVol: vol.n,
    accErr: acc.n ? acc.sum / acc.n : null,
    volErr: vol.n ? Math.exp(vol.sum / vol.n) - 1 : null,
    global,
    kinds,
  };
}

function applyCalibration(effect, kind, calibration) {
  if (!calibration?.n) return effect;
  const b = calibration.kinds[kind] ?? calibration.global;
  return {
    ...effect,
    dAcc: clamp(effect.dAcc + b.accBias, -0.1, 0.1),
    volRatio: effect.volRatio * Math.exp(clamp(b.logVolBias, Math.log(0.5), Math.log(2))),
  };
}

function rankCandidates(candidates, { championMetrics, effects, oddRule, calibration }) {
  return candidates
    .map((c) => {
      let effect;
      let evidence = 0;
      if (c.mutation.kind === 'combo') {
        effect = { dAcc: 0, dOdd: 0, volRatio: 1 };
        for (const part of c.mutation.parts) {
          const e = expectedEffect(effects, part.key, part.kind) ?? PRIORS[part.kind] ?? PRIORS.tighten;
          effect = { dAcc: effect.dAcc + e.dAcc, dOdd: effect.dOdd + e.dOdd, volRatio: effect.volRatio * e.volRatio };
        }
        evidence = 1;
      } else {
        const e = expectedEffect(effects, c.mutation.key, c.mutation.kind);
        evidence = e?.n ?? 0;
        effect = e ?? PRIORS[c.mutation.kind];
      }
      effect = applyCalibration(effect, c.mutation.kind, calibration);
      const base = { acc: championMetrics.acc, odd: championMetrics.odd, perDay: championMetrics.perDay, score: championMetrics.score };
      const predicted = { ...predict(championMetrics, effect, oddRule), base };
      const gain = predicted.score - championMetrics.score;
      // Fila = maior aumento previsto de stake/dia primeiro (pedido do
      // operador); a evidência só aparece na tela, não muda a ordem.
      return { ...c, predicted, evidence, gain, priority: gain };
    })
    .sort((a, b) => b.priority - a.priority);
}

const KIND_LABEL = { tighten: 'Apertar', loosen: 'Afrouxar', remove: 'Tirar', add: 'Adicionar', combo: 'Juntar', baseline: 'Base' };

module.exports = {
  parsePieces,
  serialize,
  stripData,
  hasDataFilter,
  normalizeFilter,
  rangesOf,
  openMaxByKey,
  perDayOf,
  oddFor,
  campaignOddRule,
  metricsOf,
  learnEffects,
  generateCandidates,
  rankCandidates,
  calibrate,
  KIND_LABEL,
};
