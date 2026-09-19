'use strict';

/**
 * Stake real de cada bot difere do que a mensagem do Telegram manda (o texto
 * sempre vem "Stake: 1%" pra todo bot, é um template fixo do lado deles) —
 * aqui a gente corrige pro valor combinado. Mesma unidade já configurada em
 * betting-userbot/src/bots-config.js (campo `unidades`), que é usada pro
 * dimensionamento real da aposta; esse mapa só corrige o stake_pct gravado
 * em alerts/gestao_banca, que até agora copiava o "1%" do template sem
 * checar o bot.
 */
const BOT_STAKE_OVERRIDES = {
  'Bot vencedor 4º lugar na Copa RobôTip #1: Under 2.5 escanteios': 2,
};

/**
 * Parseia dois minutos de uma linha "↪️ Last X: 48' - 71'" ou "35' - ø".
 * Retorna [homeMin, awayMin], cada um pode ser null se for "ø" ou "-".
 */
function parseTwoMinutes(line) {
  const after = line.includes(':') ? line.split(':').slice(1).join(':') : line;
  const parts = after.split('-').map(s => s.trim());
  const parseMin = (s) => {
    if (!s || s === 'ø' || s === '-') return null;
    const m = s.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  };
  return [parseMin(parts[0]), parseMin(parts[1] ?? '')];
}

/**
 * Parseia uma mensagem de alerta do Telegram no formato RoboTip.
 * Suporta mensagens em inglês ("Opportunity!") e português ("Oportunidade!").
 * @param {string} rawText
 * @returns {object|null}
 */
function parseAlert(rawText) {
  if (!rawText) return null;
  const trimmed = rawText.trim();

  // Strip leading emoji/symbols before checking — bot may prefix with 🚨 etc.
  const firstWord = trimmed.replace(/^[^\p{L}]+/u, '');
  const isAlert = firstWord.startsWith('Opportunity') || firstWord.startsWith('Oportunidade');
  if (!isAlert) return null;

  const lines = rawText.split('\n').map(l => l.trim());

  const result = {
    bot_name: null, odds: null, bet_odds: null, home_team: null, away_team: null,
    robotip_url: null, bet365_url: null,
    game_minute: null, home_odds: null, draw_odds: null,
    away_odds: null, competition: null, score_home: null, score_away: null,
    last_goal_minute: null, last_goal_minute_away: null,
    corners_home: null, corners_away: null,
    last_corner_minute: null,
    last_corner_minute_home: null, last_corner_minute_away: null,
    goals_over_odds: null, stake_pct: null,
    dangerous_home: null, dangerous_away: null,
    dangerous_per_min_5: null, dangerous_per_min_total: null,
    yellow_home: null, yellow_away: null,
    last_yellow_minute_home: null, last_yellow_minute_away: null,
    red_home: null, red_away: null,
    shots_side_home: null, shots_side_away: null,
    last_shot_side_minute_home: null, last_shot_side_minute_away: null,
    shots_target_home: null, shots_target_away: null,
    last_shot_target_minute_home: null, last_shot_target_minute_away: null,
    possession_home: null, possession_away: null,
    pi1: null, pi2: null,
  };

  // ── Bet365 URL (pode aparecer em qualquer linha do rodapé) ────────────────
  // Ex.: "Bet365 (https://www.bet365.bet.br/#/AX/K%5EMelaka%20FC) | Betfair (...)"
  const bet365Match = rawText.match(/Bet365\s*\(\s*(https?:\/\/[^\s)]+)\s*\)/i);
  if (bet365Match) result.bet365_url = bet365Match[1];

  let lastSection = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // ── Bot name: "📊 NOME DO BOT" ─────────────────────────────────────────
    if (!result.bot_name) {
      // Formato: "Bot X | Odds: 1.08"
      const pipeOdds = line.match(/^(.+?)\s*\|\s*Odds:\s*([\d.]+)\s*$/);
      // Formato: "📊 NOME @2.0"
      const atOdds = line.match(/^(.+?)\s*@([\d.]+)\s*$/);
      // Formato: "📊 NOME"
      const emojiLine = line.match(/^📊\s+(.+)$/);

      if (pipeOdds) {
        result.bot_name = pipeOdds[1].replace(/^[^\p{L}\d]+/u, '').trim();
        result.odds = parseFloat(pipeOdds[2]);
        continue;
      }
      if (atOdds && !line.includes('http') && !line.includes(' x ')) {
        const raw = atOdds[1].replace(/^[^\p{L}\d]+/u, '').trim();
        result.bot_name = `${raw} @${atOdds[2]}`;
        result.odds = parseFloat(atOdds[2]);
        continue;
      }
      if (emojiLine && !line.includes(' x ') && !line.includes('http')) {
        result.bot_name = emojiLine[1].replace(/^[^\p{L}\d@]+/u, '').trim();
        continue;
      }
    }

    // ── Times: "⚽️ Home (H) x Away (A)" ────────────────────────────────────
    if (!result.home_team && line.includes(' x ')) {
      // Formato: "Time A x Time B | https://..."
      const withUrl = line.match(/(.+?)\s+x\s+(.+?)\s*\|\s*(https?:\/\/\S+)/);
      // Formato: "⚽️ Time A (H) x Time B (A) (in-play)" ou "(ao vivo)"
      const withHA  = line.match(/(.+?)\s*\(H\)\s*x\s*(.+?)\s*\(A\)/i);

      if (withUrl) {
        result.home_team   = withUrl[1].replace(/^[^\p{L}\d]+/u, '').trim();
        result.away_team   = withUrl[2].trim();
        result.robotip_url = withUrl[3].trim();
      } else if (withHA) {
        result.home_team = withHA[1].replace(/^[^\p{L}\d]+/u, '').trim();
        result.away_team = withHA[2].trim();
        const next = lines[i + 1];
        if (next && next.startsWith('http')) result.robotip_url = next;
      }
      continue;
    }

    // ── URL sozinha ───────────────────────────────────────────────────────
    if (!result.robotip_url && line.startsWith('http')) {
      result.robotip_url = line;
      continue;
    }

    // ── Minuto: "⏰ Time: 80'" (EN) ou "⏱ Minuto: 67" (PT) ───────────────
    if (line.match(/(?:Time|Tempo|Minuto):\s*\d+/i)) {
      const m = line.match(/(\d+)/);
      if (m) result.game_minute = parseInt(m[1], 10);
      continue;
    }

    // ── Odds iniciais ──────────────────────────────────────────────────────
    // EN: "Starting odds: Home: 1.9 - Draw 3.5 - Away: 3.3"
    // PT: "Odds iniciais: Casa: 1.9 - Emp. 3.5 - Fora: 3.3"
    // PT legado: "📊 Odds: 1.85 / 3.40 / 2.10"
    if (line.match(/Starting odds|Odds iniciais/i)) {
      // EN: "Starting odds: Home: 3.8 - Draw 3.8 - Away: 1.7"
      // PT: "Odds iniciais: Casa: 1.9 - Emp. 3.5 - Fora: 3.3"
      const verbose = line.match(/(?:Home|Casa)[:\s]+([\d.]+)[^-]*-\s*(?:Draw|Emp)[^:]*[:\s]+([\d.]+)[^-]*-\s*(?:Away|Fora)[:\s]+([\d.]+)/i);
      if (verbose) {
        result.home_odds = parseFloat(verbose[1]);
        result.draw_odds = parseFloat(verbose[2]);
        result.away_odds = parseFloat(verbose[3]);
      }
      continue;
    }
    if (line.match(/^📊\s+Odds:/i)) {
      const slash = line.match(/Odds[^:]*:\s*([\d.]+)\s*\/\s*([\d.]+)\s*\/\s*([\d.]+)/i);
      if (slash) {
        result.home_odds = parseFloat(slash[1]);
        result.draw_odds = parseFloat(slash[2]);
        result.away_odds = parseFloat(slash[3]);
      }
      continue;
    }

    // ── Competição: "🏟 Denmark Superligaen" ou "🏆 Brasileirão" ──────────
    if (line.includes('🏆') || line.includes('🏟')) {
      result.competition = line.replace(/^[^\p{L}\d]+/u, '').trim();
      continue;
    }

    // ── Placar: "🥅 Score: 0 - 1" (EN) ou "📋 Placar: 1 - 0" (PT) ────────
    if (line.match(/(?:Score|Placar):\s*\d/i)) {
      const m = line.match(/(\d+)\s*-\s*(\d+)/);
      if (m) {
        result.score_home = parseInt(m[1], 10);
        result.score_away = parseInt(m[2], 10);
      }
      continue;
    }

    // ── Último gol ────────────────────────────────────────────────────────
    // EN: "↪️ Last goal: ø - 46'"
    // PT: "↪️ Último gol: 35' - ø"
    if (line.match(/Last goal|[Úú]ltimo gol/i)) {
      const [h, a] = parseTwoMinutes(line);
      result.last_goal_minute      = h;
      result.last_goal_minute_away = a;
      lastSection = null;
      continue;
    }

    // ── Escanteios (contagem) ──────────────────────────────────────────────
    // EN: "⛳️ Corners: 3 - 2" | PT: "🚩 Escanteios: 5 - 3"
    if (line.match(/(?:Corners|Escanteios):\s*\d/i)) {
      const m = line.match(/(\d+)\s*-\s*(\d+)/);
      if (m) {
        result.corners_home = parseInt(m[1], 10);
        result.corners_away = parseInt(m[2], 10);
      }
      lastSection = 'corners';
      continue;
    }

    // ── Último escanteio ───────────────────────────────────────────────────
    // EN: "↪️ Last corner: 67' - 79'"
    // PT: "↪️ Último escanteio: 48' - 71'"
    if (line.match(/Last corner|[Úú]ltimo escanteio/i) ||
        (line.startsWith('↪') && lastSection === 'corners')) {
      const [h, a] = parseTwoMinutes(line);
      result.last_corner_minute_home = h;
      result.last_corner_minute_away = a;
      result.last_corner_minute = h ?? a;
      lastSection = null;
      continue;
    }

    // ── Bet odds: "Corners over +0.5: 1.73" / "Goals over +0.5: 2.01" ────
    // EN e PT: qualquer linha com "over" ou "under" seguido de valor numérico
    if (line.match(/\b(over|under)\b.+:\s*[\d.]+/i) &&
        !line.match(/Attacks|Ataques|AP\/min/i)) {
      const m = line.match(/:\s*([\d.]+)\s*$/);
      if (m) {
        result.bet_odds = parseFloat(m[1]);
        if (line.match(/Goals? over|Gols? over/i)) result.goals_over_odds = result.bet_odds;
      }
      continue;
    }

    // ── Back <label> / Stake ─────────────────────────────────────────────
    // Ex.: "Back Favorito: 2.10", "Back Empate: 3.46", "Back Casa: 1.80",
    //      "Back Fora: 2.50", "Back Azarão: 4.20"
    if (line.match(/^Back\s+.+?:\s*[\d.]+\s*$/i)) {
      const m = line.match(/:\s*([\d.]+)\s*$/);
      if (m) result.bet_odds = parseFloat(m[1]);
      continue;
    }

    if (line.match(/Stake:/i)) {
      const m = line.match(/Stake:\s*([\d.]+)%/i);
      if (m) result.stake_pct = parseFloat(m[1]);
      continue;
    }

    // ── Ataques perigosos / Dangerous attacks — por minuto 5min ──────────
    // EN: "🔥 Dangerous attacks/min. (5min.): 1 - 0.2"
    // PT: "⚡ Ataques perigosos/min. (5min.): ..."
    if (line.match(/(?:Dangerous attacks|Ataques perigosos)[^:]*5\s*min/i) ||
        line.match(/AP\/min[^:]*5\s*min/i)) {
      const m = line.match(/([\d.]+)\s*-\s*([\d.]+)/);
      if (m) result.dangerous_per_min_5 = `${m[1]}-${m[2]}`;
      continue;
    }

    // ── Ataques perigosos / Dangerous attacks — por minuto total ─────────
    if (line.match(/(?:Dangerous attacks|Ataques perigosos)[^:]*[Tt]otal/i) ||
        line.match(/AP\/min[^:]*[Tt]otal/i)) {
      const m = line.match(/([\d.]+)\s*-\s*([\d.]+)/);
      if (m) result.dangerous_per_min_total = `${m[1]}-${m[2]}`;
      continue;
    }

    // ── Ataques perigosos / Dangerous attacks — absoluto ─────────────────
    // EN: "🔥 Dangerous attacks: 42 - 37"
    // PT: "⚡ Ataques perigosos: 18 - 12"
    if (line.match(/(?:Dangerous attacks|Ataques perigosos):\s*\d/i)) {
      const m = line.match(/(\d+)\s*-\s*(\d+)/);
      if (m) {
        result.dangerous_home = parseInt(m[1], 10);
        result.dangerous_away = parseInt(m[2], 10);
      }
      lastSection = 'dangerous';
      continue;
    }

    // ── Cartões amarelos ──────────────────────────────────────────────────
    // EN: "🟨 Yellow cards: 0 - 0" | PT: "🟨 Cartões amarelos: 2 - 3" | legado: "🟨 2-1 | 🟥 0-0"
    if (line.includes('🟨') || line.match(/Yellow cards|[Cc]art[oô]es amarelos/i)) {
      const m = line.match(/(\d+)\s*-\s*(\d+)/);
      if (m) {
        result.yellow_home = parseInt(m[1], 10);
        result.yellow_away = parseInt(m[2], 10);
      }
      // Formato legado: vermelho na mesma linha
      const rm = line.match(/🟥[^\d]*(\d+)\s*-\s*(\d+)/);
      if (rm) {
        result.red_home = parseInt(rm[1], 10);
        result.red_away = parseInt(rm[2], 10);
      }
      lastSection = 'yellow';
      continue;
    }

    // ── Último cartão amarelo ─────────────────────────────────────────────
    // EN: "↪️ Last yellow card: 60' - 78'"
    if (line.match(/Last yellow card|[Úú]ltimo cart[aã]o amarelo/i) ||
        (line.startsWith('↪') && lastSection === 'yellow')) {
      const [h, a] = parseTwoMinutes(line);
      result.last_yellow_minute_home = h;
      result.last_yellow_minute_away = a;
      lastSection = null;
      continue;
    }

    // ── Cartões vermelhos (linha separada) ────────────────────────────────
    // EN: "🟥 Red cards: 0 - 0"
    if (line.includes('🟥') || line.match(/Red cards|[Cc]art[oô]es vermelhos/i)) {
      const m = line.match(/(\d+)\s*-\s*(\d+)/);
      if (m) {
        result.red_home = parseInt(m[1], 10);
        result.red_away = parseInt(m[2], 10);
      }
      continue;
    }

    // ── Chutes fora do alvo / Shots off target ────────────────────────────
    // EN: "🎯 Shots off target: 7 - 6"
    // PT: "👟 Chutes ao lado: 8 - 5"
    if (line.match(/Shots off target|Chutes.*(ao\s+)?lado/i)) {
      const m = line.match(/(\d+)\s*-\s*(\d+)/);
      if (m) {
        result.shots_side_home = parseInt(m[1], 10);
        result.shots_side_away = parseInt(m[2], 10);
      }
      lastSection = 'shots_side';
      continue;
    }

    // EN: "↪️ Last shot off target: 76' - 64'"
    if (line.match(/Last shot off target|[Úú]ltimo chute ao lado/i) ||
        (line.startsWith('↪') && lastSection === 'shots_side')) {
      const [h, a] = parseTwoMinutes(line);
      result.last_shot_side_minute_home = h;
      result.last_shot_side_minute_away = a;
      lastSection = null;
      continue;
    }

    // ── Chutes no alvo / Shots on target ──────────────────────────────────
    // EN: "🎯 Shots on target: 3 - 6"
    // PT: "🎯 Chutes no alvo: 4 - 2"
    if (line.match(/Shots on target|Chutes.*(no\s+)?alvo/i)) {
      const m = line.match(/(\d+)\s*-\s*(\d+)/);
      if (m) {
        result.shots_target_home = parseInt(m[1], 10);
        result.shots_target_away = parseInt(m[2], 10);
      }
      lastSection = 'shots_target';
      continue;
    }

    // EN: "↪️ Last shot on target: 75' - 70'"
    if (line.match(/Last shot on target|[Úú]ltimo chute no alvo/i) ||
        (line.startsWith('↪') && lastSection === 'shots_target')) {
      const [h, a] = parseTwoMinutes(line);
      result.last_shot_target_minute_home = h;
      result.last_shot_target_minute_away = a;
      lastSection = null;
      continue;
    }

    // ── Posse de bola / Ball possession ───────────────────────────────────
    // EN: "💯 Ball possession: 50% - 50%" | PT: "📊 Posse: 58% - 42%"
    if (line.match(/Ball possession|Posse/i)) {
      const m = line.match(/([\d.]+)%\s*-\s*([\d.]+)%/);
      if (m) {
        result.possession_home = parseFloat(m[1]);
        result.possession_away = parseFloat(m[2]);
      }
      lastSection = null;
      continue;
    }

    // ── PI 1 / PI 2 ───────────────────────────────────────────────────────
    // EN: "🧠 PI 1: 70 - 10" | PT: "📈 PI1: 67 | PI2: 43" (legado)
    if (line.match(/PI\s*1[:\s]/i)) {
      // Formato "PI 1: X - Y" (dois valores por linha — EN)
      const twoVals = line.match(/PI\s*1[:\s]+([\d.]+)\s*-\s*([\d.]+)/i);
      if (twoVals) {
        result.pi1 = parseFloat(twoVals[1]);
        // pi2 provavelmente vem na próxima linha; não sobrescreve aqui
      } else {
        const m = line.match(/PI\s*1[:\s]+([\d.]+)/i);
        if (m) result.pi1 = parseFloat(m[1]);
      }
      lastSection = null;
      continue;
    }

    // EN: "⚡️ PI 2: 10 - 2"
    if (line.match(/PI\s*2[:\s]/i)) {
      const m = line.match(/PI\s*2[:\s]+([\d.]+)/i);
      if (m) result.pi2 = parseFloat(m[1]);
      lastSection = null;
      continue;
    }

    // Linha "↪️" genérica sem seção ativa — reseta contexto
    if (line.startsWith('↪')) lastSection = null;
  }

  // Fallback: link embed não vem como texto plano — constrói URL a partir do time da casa
  if (!result.bet365_url && result.home_team) {
    result.bet365_url = 'https://www.bet365.bet.br/#/AX/K%5E' + encodeURIComponent(result.home_team);
  }

  if (result.bot_name && Object.prototype.hasOwnProperty.call(BOT_STAKE_OVERRIDES, result.bot_name)) {
    result.stake_pct = BOT_STAKE_OVERRIDES[result.bot_name];
  }

  return result;
}

/**
 * Extrai o nome da entrada (ex: "Corners over +1.0") da linha de resultado.
 * Formato: "Corners over +1.0 - ODD: 1.72 - GREEN"
 */
function extractEntryFromResultLine(line) {
  const m = line.match(/^(.+?)\s*-\s*ODD:/i);
  return m ? m[1].trim() : null;
}

/**
 * Parseia uma mensagem de resultado do Telegram.
 * Suporta inglês ("Result available!") e português ("Resultado disponível!").
 */
function parseResult(rawText) {
  if (!rawText) return null;
  const trimmed = rawText.trim();

  // EN: "Result available!" | PT: "Resultado..."
  const isResult = trimmed.startsWith('Result available') || trimmed.startsWith('Resultado');
  if (!isResult) return null;

  const lines = rawText.split('\n').map(l => l.trim());

  const teamsLine = lines.find(l => l.includes(' x '));
  if (!teamsLine) return null;

  // Formato preferido: "⚽️ Home (H) x Away (A)" — captura sem (H)/(A)
  const withHA = teamsLine.match(/(.+?)\s*\(H\)\s*x\s*(.+?)\s*\(A\)/i);
  // Fallback: "Home x Away (in-play)"
  const withX  = teamsLine.match(/(.+?)\s+x\s+(.+?)(?:\s*\(in-play\)|\s*\(ao vivo\))?$/i);

  if (!withHA && !withX) return null;

  const raw1 = withHA ? withHA[1] : withX[1];
  const raw2 = withHA ? withHA[2] : withX[2];

  const home_team = raw1.replace(/^[^\p{L}\d]+/u, '').trim();
  const away_team = raw2.trim();

  let result = null;
  let entry  = null;

  for (const line of lines) {
    if (/\b(GREEN|WON)\b/i.test(line)) { result = 'green';     entry = extractEntryFromResultLine(line); break; }
    if (/\b(RED|LOST)\b/i.test(line))  { result = 'red';       entry = extractEntryFromResultLine(line); break; }
    if (/\breembolso\b/i.test(line))   { result = 'reembolso'; entry = extractEntryFromResultLine(line); break; }
  }

  if (!result) return null;

  return { home_team, away_team, result, entry };
}

/**
 * Gera variantes do entry traduzindo termos PT ↔ EN, para que o ILIKE
 * casamento contra raw_message funcione independente do idioma do alerta.
 * Ex.: "Gols under +0.5 HT" → ["Gols under +0.5 HT", "Goals under +0.5 HT"]
 */
function entryAlternatives(entry) {
  if (!entry) return [];
  const map = [
    ['Gols', 'Goals'],
    ['Escanteios', 'Corners'],
    ['Cartões amarelos', 'Yellow cards'],
    ['Cartões vermelhos', 'Red cards'],
    ['Chutes ao lado', 'Shots off target'],
    ['Chutes no alvo', 'Shots on target'],
  ];
  const alts = new Set([entry]);
  for (const [pt, en] of map) {
    const lower = entry.toLowerCase();
    if (lower.includes(pt.toLowerCase())) {
      alts.add(entry.replace(new RegExp(pt, 'gi'), en));
    } else if (lower.includes(en.toLowerCase())) {
      alts.add(entry.replace(new RegExp(en, 'gi'), pt));
    }
  }
  return Array.from(alts);
}

module.exports = { parseAlert, parseResult, entryAlternatives };

// ─── Teste rápido ──────────────────────────────────────────────────────────
if (require.main === module) {
  const msgEN = `Opportunity! 🚨

📊 OVER GOL FT - V1.0 @2.0


⚽️ Al Jubail Club (H) x Al Wehda Mecca (A) (in-play)
https://robotip.com.br/jogo/401318995
⏰ Time: 80'
Starting odds: Home: 3.8 - Draw 3.8 - Away: 1.7
🏟 Saudi Arabia Division 1

🥅 Score: 0 - 2
↪️ Last goal: ø - 46'
Goals over +0.5: 2.08
Stake: 1%

⛳️ Corners: 3 - 2
↪️ Last corner: 67' - 79'
🔥 Dangerous attacks: 42 - 37
🔥 Dangerous attacks/min. (5min.): 1 - 0.2
🔥 Dangerous attacks/min. (Total): 0.52 - 0.46
🟨 Yellow cards: 0 - 0
🟥 Red cards: 0 - 0
🎯 Shots off target: 7 - 6
↪️ Last shot off target: 76' - 64'
🎯 Shots on target: 3 - 6
↪️ Last shot on target: 75' - 70'
💯 Ball possession: 50% - 50%
🧠 PI 1: 70 - 10
⚡️ PI 2: 10 - 2


Match links:

Bet365`;

  const resultEN = `Result available!
⚽️ Al Jubail Club (H) x Al Wehda Mecca (A) (in-play)
Gols over +0.5 - ODD: 2.085 - RED
❌`;

  console.log('=== parseAlert (EN) ===');
  console.log(JSON.stringify(parseAlert(msgEN), null, 2));
  console.log('\n=== parseResult (EN) ===');
  console.log(JSON.stringify(parseResult(resultEN), null, 2));
}
