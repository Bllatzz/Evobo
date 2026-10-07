'use strict';

// Nomes legíveis dos parâmetros do Robotip — cópia de
// robotip/frontend/src/lib/labParams.js (só marketLabel/paramLabel), usada no
// nome dos backtests que o Laboratório gera. Mudou lá, muda aqui.

// Tradução dos parâmetros/mercados do robotip.com.br pra texto legível.
//
// O filtro de um robô/relatório é uma query string no formato do site:
//   "!ligas=&$ligas=&tm->=-70&tm-<=-86&gotCornerMkt-==-1&..."
// cada pedaço é `parâmetro-operador-valor`. `!ligas`/`$ligas` são listas de
// ligas excluídas/incluídas e `data` é o filtro de datas (unix).

const OPS = {
  '>=': '>=', 'maior ou igual a': '>=', 'maior que': '>',
  '<=': '<=', 'menor ou igual a': '<=', 'menor que': '<',
  '==': '==', 'igual a': '==',
};
const PART_RE = /^(.+?)-(>=|<=|==|maior ou igual a|menor ou igual a|maior que|menor que|igual a)-(.*)$/;

// Teto "sem limite" que o site usa nos sliders (odd até 200, posse até 100…).
const OPEN_MAX = { default: 200, possession: 100 };

const EXACT = {
  tm: 'Minuto',
  data: 'Data',
  gotCornerMkt: 'Mercado de escanteios na Bet365',
  CasaFav: 'Casa é o favorito',
  dif_gols_emp: 'Placar empatado (dif. gols)',
  dif_gols_qualquer: 'Dif. de gols (qualquer lado)',
  dif_gols_favorito: 'Favorito ganhando por',
  dif_gols_underdog: 'Underdog ganhando por',
  dif_gols_underdog_emp_gan: 'Underdog empatando/ganhando por',
  dif_gols_favorito_emp_gan: 'Favorito empatando/ganhando por',
  dif_gols_visitante_emp_gan: 'Visitante empatando/ganhando por',
  favorite_win_odd: 'Odd vitória favorito (pré-live)',
  favorite_win_odd_last: 'Odd vitória favorito (ao vivo)',
  home_win_odd: 'Odd vitória casa',
  btts_ft_yes_odd: 'Odd ambas marcam – Sim',
  goals_home: 'Gols casa',
  goals_away: 'Gols visitante',
  Ranking_favorite: 'Ranking do favorito',
  Ranking_underdog: 'Ranking do underdog',
};

const STATS = [
  ['dangerous_attacks', 'AP'],
  ['attacks', 'Ataques'],
  ['possession_rt', 'Posse %'],
  ['corners', 'Escanteios'],
  ['goals', 'Gols'],
  ['on_target', 'Chutes no alvo'],
  ['off_target', 'Chutes fora'],
  ['total_chutes', 'Chutes totais'],
  ['yellowcards', 'Amarelos'],
  ['redcards', 'Vermelhos'],
  ['pi_1', 'PI1'],
  ['pi_2', 'PI2'],
  ['cg', 'CG'],
];

const SIDES = { total: 'total', favorite: 'favorito', underdog: 'underdog', home: 'casa', away: 'visitante', any: 'qualquer' };

function lineLabel(digits) {
  return (Number(digits) / 10).toFixed(1);
}

// esc_as_ht_odd_over_odd_last_line05 → "Over 0.5 Escanteios HT"
const MARKET_RE = /^(esc_as|ou_gols|ou_yellowcards)(_ht)?_odd_(over|under)_odd(_last)?_line(\d+)$/;
const MARKET_KIND = { esc_as: 'Escanteios', ou_gols: 'Gols', ou_yellowcards: 'Cartões' };

function marketLabel(market) {
  const m = MARKET_RE.exec(market || '');
  if (m) {
    const side = m[3] === 'over' ? 'Over' : 'Under';
    return `${side} ${lineLabel(m[5])} ${MARKET_KIND[m[1]]} ${m[2] ? 'HT' : 'FT'}`;
  }
  const special = {
    favorite_win_odd_last: 'Vitória do favorito',
    home_win_odd: 'Vitória da casa',
    btts_ft_no_odd_last: 'Ambas marcam – Não',
  };
  return special[market] || market;
}

/** Grupo pro filtro de mercado da tela: "Escanteios", "Gols", "Outros". */
function marketGroup(market) {
  const m = MARKET_RE.exec(market || '');
  if (!m) return 'Outros';
  if (m[1] === 'esc_as') return 'Escanteios';
  if (m[1] === 'ou_gols') return 'Gols';
  return 'Outros';
}

function paramLabel(key) {
  if (EXACT[key]) return EXACT[key];
  const market = MARKET_RE.exec(key);
  if (market) return `Odd ${marketLabel(key)}${market[4] ? '' : ' (pré-live)'}`;

  let rest = key;
  const tags = [];
  const minutes = /^num_(.+?)_(\d+)min_(.+)$/.exec(rest);
  if (minutes) {
    rest = `${minutes[1]}_${minutes[3]}`;
    tags.push(`últ. ${minutes[2]} min`);
  }
  if (/_rolling_10$/.test(rest)) { rest = rest.replace(/_rolling_10$/, ''); tags.push('/min últ. 10 min'); }
  if (/_rolling(_ft)?$/.test(rest)) { rest = rest.replace(/_rolling(_ft)?$/, ''); tags.push('/min últ. 5 min'); }
  if (/_rolling/.test(rest)) { rest = rest.replace(/_rolling/, ''); tags.push('/min últ. 5 min'); }
  let period = '';
  if (/_ht$/.test(rest)) { rest = rest.replace(/_ht$/, ''); period = 'HT'; }
  if (/_ft$/.test(rest)) { rest = rest.replace(/_ft$/, ''); period = 'FT'; }
  if (!period && /_ht_/.test(rest)) period = 'HT';
  const prelive = /prelive/.test(rest);
  const suffered = /suffered/.test(rest);
  const respective = /atrespective/.test(rest);
  const predictions = /_game_predictions$/.exec(rest);
  if (predictions) {
    const p = /^(over|btts)_?(\d+)?(g|c)?(_ht)?/.exec(rest);
    if (p && p[1] === 'btts') return 'Previsão ambas marcam (%)';
    if (p) return `Previsão Over ${lineLabel(p[2])} ${p[3] === 'c' ? 'escanteios' : 'gols'}${p[4] ? ' HT' : ''} (%)`;
  }

  const stat = STATS.find(([prefix]) => rest === prefix || rest.startsWith(`${prefix}_`));
  if (!stat) return key;
  const sideKey = Object.keys(SIDES).find((s) => rest.endsWith(`_${s}`));
  const side = sideKey ? SIDES[sideKey] : '';
  const parts = [stat[1] + (suffered ? ' sofridos' : '') + (tags.find((t) => t.startsWith('/')) ?? '')];
  if (side) parts.push(side);
  if (period) parts.push(period);
  if (prelive) parts.push(respective ? 'média pré-live (mesmo mando)' : 'média pré-live');
  const window = tags.find((t) => !t.startsWith('/'));
  if (window) parts.push(window);
  return parts.join(' – ').replace(' – /', '/');
}

function fmtNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(Number(n.toFixed(2))).replace('.', ',') : v;
}

function fmtDate(unix) {
  const d = new Date(Number(unix) * 1000);
  return Number.isNaN(d.getTime()) ? unix : d.toLocaleDateString('pt-BR');
}

/**
 * Parse do filtro em linhas legíveis, juntando min/max do mesmo parâmetro:
 * [{ key, label, text, min, max, eq }]
 */

module.exports = { marketLabel, paramLabel };
