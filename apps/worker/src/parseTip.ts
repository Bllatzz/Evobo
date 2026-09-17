/**
 * Extrai o nome da casa de apostas a partir da URL do bilhete.
 * Ex.: https://www.bet365.bet.br/s/r/ZZnxR -> "bet365"
 *      https://esportiva.bet.br/sports/... -> "esportiva"
 */
// Shorthand tipsters actually type for a house's visible link label ("🔗
// Pix") that isn't the brand name itself — expand as new ones show up.
const BOOKMAKER_ALIASES: Record<string, string> = {
  pix: "pixbet",
};

/** Colapsa variações de escrita da mesma casa (acento, maiúscula, espaço/
 * pontuação — "Betão", "Betao", "BETÃO" viram todas "betao") no mesmo
 * formato que o slug derivado de URL já usa (label da hostname: minúsculo,
 * sem separador) — nunca duplicar a mesma casa só por causa de como o
 * tipster escreveu o texto dessa vez. Duplicado em
 * apps/web/src/components/BookmakerCombobox.tsx (entrada manual) — mesma
 * regra, sem pacote compartilhado entre worker e web pra essa função pura. */
export function normalizeBookmakerSlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeBookmaker(name: string | null): string | null {
  if (!name) return name;
  const slug = normalizeBookmakerSlug(name);
  if (!slug) return null;
  return BOOKMAKER_ALIASES[slug] ?? slug;
}

export function extractBookmaker(url: string | null): string | null {
  if (!url) return null;
  try {
    // Strips generic prefixes (www., m. for mobile, app. for reidopitaco's
    // app.reidopitaco.com.br) so "m.betfast.bet.br", "www.bet365.bet.br" and
    // "app.reidopitaco.com.br" all resolve to the actual brand name instead
    // of the subdomain.
    const label = new URL(url).hostname.replace(/^(www|m|app)\./i, "").split(".")[0] ?? null;
    return normalizeBookmaker(label);
  } catch {
    return null;
  }
}

/** A hidden hyperlink on the message (Telegram `MessageEntityTextUrl`) — the
 * visible text ("esportivabet") and the real URL behind it are different. */
export type TextEntity = { url?: string };

const URL_IN_TEXT_RE = /https?:\/\/\S+/i;
// A tipster sometimes bakes a status mark right onto an existing line
// instead of adding it as its own line ("1,75u✅", "1,5u🔄") — this only ever
// shows up after the tip already resolved or changed (the message got
// edited to append it: ✅/❌ for green/red, 🔄 for "odd moved, leg
// ignored" — same conventions used elsewhere for edited messages), so it's
// pure noise for parsing purposes. Stripped from every line up front, same
// treatment as the boost note below.
const TRAILING_RESULT_MARK_RE = /(?:\s*[✅❌🔄])+\s*$/u;
const UNIT_ONLY_RE = /^(\d+(?:[.,]\d+)?)\s*u$/i;
// "1u com o aumento" — stake line noting the bet uses a bookmaker odds-boost
// ("Aposta Turbinada"); the boosted odd is never spelled out in text (comes
// from the booking code link/photo instead), so the note itself carries no
// market info — stripped down to a plain "<n>u" so every downstream check
// (UNIT_ONLY_RE first among them) treats it exactly like a normal stake line.
const UNIT_WITH_BOOST_RE = /^(\d+(?:[.,]\d+)?)\s*u\s+com\s+(?:o\s+)?aumento\b.*$/i;
const UNIT_COMBO_RE = /^(\d+(?:[.,]\d+)?)\s*u\s+na\s+(.+)$/i;
// "<n>u em cada" — sizes every independent leg of a bet-slip photo/link at
// the same stake (paired with UNIT_COMBO_RE's "<n>u na <Rótulo>" for the
// combo of those same legs); the legs themselves never appear as text here
// (no market lines, no photo-less link) — their count and each one's own
// odd only exist inside the bet-slip photo, discovered later by OCR (see
// unit_each_plus_combo below and its handling in processMessage.ts).
const UNIT_EACH_RE = /^(\d+(?:[.,]\d+)?)\s*u\s+em\s+cada$/i;
// "<n>u na <Rótulo> @<odd>" — like UNIT_COMBO_RE, but the combo's own odd is
// spelled out in the text too (no photo needed to fill it in later).
const UNIT_COMBO_WITH_ODD_RE = /^(\d+(?:[.,]\d+)?)\s*u\s+na\s+(.+?)\s*@\s*(\d+(?:[.,]\d+)?)$/i;
// "<Seleção> @<odd> <n>u" — one leg fully spelled out on its own line
// (market, odd and stake all in the text, e.g. a NFL/"Tripla" style message
// with N standalone legs plus a combo line built from UNIT_COMBO_WITH_ODD_RE).
const SELECTION_AT_ODD_UNIT_RE = /^(.+?)\s*@\s*(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s*u$/i;
// "<Seleção> @<odd>" alone on its line, with the stake on its OWN separate
// "<n>u" line instead of trailing the same one (unlike
// SELECTION_AT_ODD_UNIT_RE above) — e.g. "-2.5 Cantos Sabah @2.65" +
// "1,75u" as two lines. Only tried where a lone unit-only line is already
// expected (see the inline_market fallback below), so it never competes
// with the combo/legs branches that require the unit inline.
const SELECTION_AT_ODD_ONLY_RE = /^(.+?)\s*@\s*(\d+(?:[.,]\d+)?)$/i;
const UNIT_INLINE_RE = /^(.*\S)\s+(\d+(?:[.,]\d+)?)\s*u$/i;
const ODD_LINE_RE = /\bodd\b\s*:?\s*(\d+(?:[.,]\d+)?)/i;
// "+0,50u aq na odd 3.96, fechando 1u" — a REPLY to an already-known tip
// adding more stake to it (odd moved since the original call), never a tip
// of its own: no market/link/photo here, everything (match, bookmaker,
// selection) is inherited from the tip the message replies to. The leading
// "+" is the signal (a tipster would never open a fresh tip that way) —
// safe to key off text alone because the caller (processMessage.ts) only
// even tries this parser when the message is a Telegram reply; a
// coincidental "+0.5u" in a non-reply message never reaches it.
const STAKE_TOPUP_RE = /^\+\s*(\d+(?:[.,]\d+)?)\s*u\b/i;
const LIMIT_LINE_RE = /\blimite\b(?:\s+de\s+aposta)?\s*:?\s*(?:r\$\s*)?(\d+(?:[.,]\d+)?)\s*\$?/i;
// Anchored to the whole line (after stripping a leading emoji and an
// optional "Porcentagem:" label) — a loose "contains a %" match used to
// pick up incidental percentages from free-text commentary lines too (e.g.
// "Só vale com aumento de 30%", a boost note, not the unit-sizing %),
// clobbering the real one.
const PERCENTAGE_LINE_RE = /^(?:porcentagem\s*:?\s*)?(\d+(?:[.,]\d+)?)\s*%$/i;

// A tipster sometimes revises an odd/% mid-message on the same line, e.g.
// "ODD: 3.00 ( nova ODD 2.10)" / "Porcentagem: 4.5% ( nova porcentagem
// 5.20%)" — the "nova" value is the one that actually counts.
const NOVA_ODD_RE = /\bnova\s+odd\b\s*:?\s*(\d+(?:[.,]\d+)?)/i;
const NOVA_PERCENTAGE_RE = /\bnova\s+porcentagem\b\s*:?\s*(\d+(?:[.,]\d+)?)\s*%/i;
// "ODD: 2.00 > 2.25" — same "boosted odd" idea as NOVA_ODD_RE above, but
// spelled with an arrow instead of "( nova ODD X)"; the value AFTER ">" is
// the one that actually applies (the ATIVAR AUMENTO line right below it is
// just the tipster confirming the boost was turned on, never a separate
// signal — it doesn't match PERCENTAGE_LINE_RE so it's harmless leftover
// text for this pattern, which never reads free text into `selection`).
const ODD_ARROW_BOOST_RE = /\bodd\b\s*:?\s*\d+(?:[.,]\d+)?\s*>\s*(\d+(?:[.,]\d+)?)/i;

// Ruído específico do formato Padovan — nunca é conteúdo de tip, é
// removido logo de cara pra não atrapalhar nem o parser Padovan nem o
// genérico (mensagem "só o assinatura do canal" já causou falso positivo).
const SIGNATURE_LINE_RE = /^📡/;
const META_CALL_RE = /^(CALL|ESCADA)\s*#/i;
const CLOSE_TIME_RE = /^🔒/;
const TRACKED_STATUS_RE = /^📊/;
// "Gale 4" — martingale/recovery-bet counter on a line by itself. Never the
// market: without stripping it, a "Gale N" line with no other free-text line
// above it (a follow-up message that doesn't repeat the market, since it's
// implicitly the same selection as the tip being recovered) gets picked up
// by the generic "leftover free line" fallback below and mistaken for one
// (e.g. "Mbappe assist" bilhete → tip saved with selection "Gale 4").
const GALE_LINE_RE = /^gale\s*#?\s*\d+$/i;

// Formato Padovan: "💰 <n>u @ <odd>" (unidade e odd na mesma linha), "🔗 <Casa>"
// ou "🔗 <link>", pernas com "•" (MÚLTIPLA) ou numeradas "1️⃣"/"2️⃣" (ESCADA).
const LINK_LINE_RE = /^🔗\s*(.+)$/;
const STAKE_AT_ODD_RE = /^💰\s*(\d+(?:[.,]\d+)?)\s*u\s*@\s*(\d+(?:[.,]\d+)?)/i;
const KEYCAP_ENTRY_RE = /^([0-9])️?⃣\s*(.+)$/;
const BULLET_RE = /^[•·]\s*(.+)$/;
const MULTIPLA_RE = /MÚLTIPLA/i;
const ESCADA_RE = /ESCADA/i;
// The combo-leg marker inside a "N INDIVIDUAIS + MÚLTIPLA" message — anchored
// to the 🎯 prefix specifically so it doesn't also match the message's own
// header line ("⚽ 3 INDIVIDUAIS + MÚLTIPLA · 3 jogos"), which contains the
// word MÚLTIPLA too but isn't the combo-leg line itself.
const MULTIPLA_MARKER_RE = /^🎯\s*MÚLTIPLA/i;

function toNumber(raw: string): number {
  return parseFloat(raw.replace(",", "."));
}

/**
 * Formatos de mensagem já observados nos grupos rastreados — serve de
 * documentação viva (o `pattern` gravado em cada TelegramTip é uma dessas
 * chaves, ou `null` quando nada bateu) e de referência pra reconhecer um
 * formato novo quando ele aparecer.
 */
export const KNOWN_PATTERNS: Record<string, { description: string; example: string }> = {
  odd_pct_limit: {
    description: "ODD + Porcentagem + Limite de aposta no texto; mercado e jogo vêm da foto (Lemos).",
    example:
      "⚠️ ODD: 2.80\n🚨 Porcentagem: 2.06%\n💰 Limite de aposta: 70$\n\n⚠️ Link de aposta: esportivabet",
  },
  pct_limit_only: {
    description: "Só Porcentagem + Limite, sem odd no texto; mercado, jogo e odd vêm da foto (ST - Super Odds).",
    example: "0.75%\n\nLimite 20\n\nhttps://ginga.bet.br/apostas-esportivas/destaques?shareCode=...",
  },
  unit_lines: {
    description: "Várias linhas '<n>u' sozinhas — cada uma é uma seleção separada; mercado, jogo e odd vêm da foto.",
    example: "0,75u\n0,25u\n0,25u\n\nhttps://www.betano.bet.br/bookingcode/...",
  },
  unit_lines_plus_combo: {
    description:
      "unit_lines + uma linha '<n>u na <Rótulo>' — vira N tips simples (uma por linha '<n>u') mais 1 tip múltipla; mercado, jogo e odd de todas vêm da foto. Aceita '🔄' colado numa linha (edição marcando 'odd mudou, ignorada') como ruído, igual ✅/❌.",
    example: "2u\n1,5u🔄\n1,25u\n\n0,5u na Tripla🔄",
  },
  combo: {
    description: "Uma linha '<n>u na <Rótulo>' — aposta múltipla; 1 tip só com os mercados concatenados vindos da foto.",
    example: "0,25u na Tripla\nhttps://www.bet365.bet.br/s/r/...",
  },
  unit_each_plus_combo: {
    description:
      "'<n>u em cada' + '<n>u na <Rótulo>', sem nenhuma perna descrita em texto — as N seleções e a múltipla vêm todas da foto/link do bilhete; vira N tips simples (uma por perna que a OCR achar, com sua própria odd) mais 1 tip múltipla (odd total do bilhete).",
    example: "1u em cada\n\n0,5u na múltipla\n\nLink Pronto",
  },
  stake_topup: {
    description:
      "Reply a uma tip já existente adicionando mais stake nela ('+<n>u' [+ 'odd <odd>']) — vira uma TelegramTip irmã (match/bookmaker/link herdados da tip respondida), nunca altera a original; sem odd nova no texto, herda a odd atual dela. Ver parseStakeTopUp, não faz parte do parseTip principal (precisa da tip pai, que só processMessage.ts consegue buscar).",
    example: "+0,50u aq na odd 3.96, fechando 1u",
  },
  legs_plus_combo: {
    description:
      "N linhas '<Seleção> @<odd> <n>u' (uma por perna simples) mais uma linha '<n>u na <Rótulo> @<odd>' — vira N tips simples mais 1 tip múltipla, tudo com mercado/odd/unidade já no texto (sem foto).",
    example:
      "Tripla NFL #1\n\nBreece Hall +2.5 Recepções @1.9 1,5u\n\nJalen McMillan Touchdown @4.25 1,25u\n\nSamaje Perine -1.5 Recepções @1.58 1,50u\n\n0,5u na Tripla @12.4",
  },
  inline_market: {
    description:
      "Mercado descrito por extenso no texto (mesma linha da unidade, linha separada, ou jogo E mercado em duas linhas separadas); odd vem da foto/link (e o jogo também, quando não escrito). Aceita '<n>u com o aumento' (aposta turbinada) como linha de unidade.",
    example: "Bernard 2+ Chutes + Bunker Cassierra\n\n1u\n\nhttps://www.bet365.bet.br/s/r/...",
  },
  padovan_single: {
    description: "Padovan, seleção única: mercado + 'Esporte · Time x Time' + '💰 <n>u @ <odd>' + '🔗 Casa' (texto puro) + '🔗 link'.",
    example: "🥊 Fulano Por KO\nMMA · Fulano x Ciclano\n\n💰 2u @ 1,65\n🔗 Betano\n\n🔗 https://...",
  },
  padovan_combo: {
    description: "Padovan 'MÚLTIPLA (mesmo jogo)': pernas em bullet '•', 1 tip com odd combinada.",
    example: "🏈 MÚLTIPLA (mesmo jogo)\n\nTime A x Time B\n • Perna 1\n • Perna 2\n\n💰 0,1u @ 171,00\n🔗 Bet365",
  },
  padovan_escada: {
    description: "Padovan 'ESCADA': seleções independentes numeradas (1️⃣/2️⃣/...), cada uma com sua própria unidade/odd.",
    example: "🏈 ESCADA · Time A x Time B\n\n1️⃣ Perna 1\n 💰 0,5u @ 5,50\n2️⃣ Perna 2\n 💰 0,5u @ 3,90\n\n🔗 Bet365",
  },
  padovan_escada_multipla: {
    description:
      "Padovan 'N INDIVIDUAIS + MÚLTIPLA': mesmas pernas numeradas do ESCADA, mais uma seleção extra combinando todas ('🎯 Múltipla de N' + sua própria unidade/odd).",
    example:
      "⚽ 3 INDIVIDUAIS + MÚLTIPLA\n\n1️⃣ Perna 1\n 💰 1u @ 2,22\n2️⃣ Perna 2\n 💰 2u @ 1,71\n\n🎯 Múltipla de 2\n 💰 0,5u @ 8,56\n\n🔗 Bet365",
  },
};

export type BookmakerOption = { bookmaker: string | null; betUrl: string | null };

export type ParsedSelection = {
  text: string | null;
  unit: number | null;
  odd?: number;
  /** Só quando a tip lista mais de uma casa possível pra mesma seleção — sobrescreve o bookmaker/betUrl do nível do ParsedTip pra essa seleção específica. */
  bookmaker?: string | null;
  betUrl?: string | null;
  /** Quando a tip pode ser feita em mais de uma casa (ex.: "🔗 Betfair · 🔗
   * Betnacional"), é a MESMA aposta — não vira N tips duplicados. Fica 1 tip
   * só, com bookmaker/betUrl em aberto (null) até o usuário escolher em qual
   * casa realmente apostou (select no dashboard). */
  bookmakerOptions?: BookmakerOption[];
};

export type ParsedTip = {
  pattern: keyof typeof KNOWN_PATTERNS | null;
  bookmaker: string | null;
  betUrl: string | null;
  fields: { odd?: number; percentage?: number; limit?: number };
  comboLabel?: string;
  /** Só presente no padrão unit_each_plus_combo — unidade de cada perna
   * independente (a múltipla usa a unidade normal em `selections[0].unit`).
   * As pernas em si não existem aqui: a contagem e os dados de cada uma só
   * aparecem depois, quando a OCR lê a foto (ver processMessage.ts). */
  legsUnit?: number;
  /** Confronto ("Time A x Time B"), quando a linha solta do texto é isso em
   * vez de uma descrição de mercado — ver MATCH_LINE_RE. */
  match?: string;
  selections: ParsedSelection[];
};

/** "Bayern x Bodo" — quando a linha solta do texto é o confronto, não o
 * mercado (ambos aparecem como "texto livre + unidade em linha própria",
 * só o conteúdo distingue um do outro). Também usada pro formato Padovan
 * ("Esporte · Time x Time"), ver extractGameLine. */
const MATCH_LINE_RE = /^(.+?)\s+x\s+(.+)$/i;

function stripLeadingEmoji(s: string): string {
  // Um keycap ("1️⃣", "2️⃣"...) é dígito + variation selector + combining
  // enclosing keycap — nenhum desses é \p{Extended_Pictographic}, então
  // precisa de uma alternativa própria pra não sobrar "2️⃣ " no início do
  // texto (ex.: linha "2️⃣ Tottenham x Everton" usada como rótulo de jogo).
  return s.replace(/^(?:[\p{Extended_Pictographic}️\s]|\d️?⃣)+/u, "");
}

/** "CA Huracán - Racing Club" — separador usado no cabeçalho das
 * combinadas Padovan "MÚLTIPLA (mesmo jogo)" (ver padovan_combo abaixo),
 * diferente do "x" de MATCH_LINE_RE. Só usada ali: por esse ramo ser
 * especificamente "mesmo jogo" (nunca ESCADA/multi-jogo), a 1ª linha nesse
 * formato nunca mistura confrontos diferentes — usar esse separador de
 * forma geral (ex. dentro de extractGameLine) arriscaria confundir
 * descrição de mercado com confronto em outros tipsters. */
const PADOVAN_SAME_GAME_RE = /^(.+?)\s+-\s+(.+)$/;

function extractDashGameLine(line: string): string | null {
  const s = stripLeadingEmoji(line);
  return PADOVAN_SAME_GAME_RE.test(s) ? s : null;
}

/** "MMA · Fulano x Ciclano" / "🏈 ESCADA · Time A x Time B" / "Time A x Time B"
 * (sem prefixo) — tira emoji/rótulo antes do "·" (se houver) e confere se o
 * que sobra é mesmo um confronto. */
function extractGameLine(line: string): string | null {
  let s = stripLeadingEmoji(line);
  const dotIdx = s.indexOf("·");
  if (dotIdx !== -1) s = s.slice(dotIdx + 1).trim();
  return MATCH_LINE_RE.test(s) ? s : null;
}

function isPadovanStyle(lines: string[]): boolean {
  return lines.some((l) => STAKE_AT_ODD_RE.test(l) || KEYCAP_ENTRY_RE.test(l));
}

/**
 * Formato dos grupos Padovan (NBA/NFL, All Sports) — bem mais estruturado que
 * Lemos/ST: unidade E odd já vêm juntas no texto ("💰 2u @ 1,65"), a casa vem
 * como nome legível ("🔗 Betano"), e há marcadores explícitos pra múltipla
 * ("MÚLTIPLA (mesmo jogo)", pernas em "•") e pra seleções independentes
 * agrupadas ("ESCADA", pernas numeradas "1️⃣"/"2️⃣"/...).
 */
function parsePadovanMessage(lines: string[], entities: TextEntity[] | undefined): ParsedTip | null {
  const bookmakerNames: string[] = [];
  const urls: string[] = [];
  const content: string[] = [];

  for (const line of lines) {
    const linkMatch = line.match(LINK_LINE_RE);
    if (linkMatch) {
      const value = linkMatch[1]!.trim();
      if (URL_IN_TEXT_RE.test(value)) {
        urls.push(value);
      } else {
        // Mais de uma casa na mesma linha: "Betfair · 🔗 Betnacional".
        for (const part of value.split(/\s*·\s*🔗\s*/)) {
          const name = normalizeBookmaker(part.trim());
          if (name) bookmakerNames.push(name);
        }
      }
      continue;
    }
    content.push(line);
  }

  if (urls.length === 0) {
    // Uma casa por link oculto (Telegram MessageEntityTextUrl), na mesma
    // ordem em que os nomes aparecem no texto — "🔗 Betfair · 🔗 Betnacional"
    // com dois hyperlinks escondidos vira dois pares reais, não só o
    // primeiro (senão a 2ª casa nunca tem link próprio pra trocar).
    urls.push(...(entities ?? []).map((e) => e.url).filter((u): u is string => !!u));
  }

  // Casa/link únicos (o comum) viram 1 par; quando a tip lista mais de uma
  // casa possível pra mesma seleção ("🔗 Betfair · 🔗 Betnacional"), o
  // tipster sempre lista um link por casa logo depois, na mesma ordem — casa
  // e link são pareados por posição, virando N tips separadas (uma por
  // casa), com o mesmo mercado/jogo/unidade/odd. Descompasso entre
  // quantidade de nomes e de links não dá pra casar com certeza, então usa
  // só o primeiro de cada.
  //
  // O NOME sempre vem do link (hostname), não do texto visível, quando um
  // link existe naquela posição — o texto de um link oculto do Telegram
  // pode ser qualquer rótulo (ex.: "🔗 Super Sub" apontando pra
  // betmgm.com/...), nunca necessariamente o nome real da casa. O texto só
  // vira o nome quando não há link nenhum (o tipster só escreveu o nome).
  const pairs: { bookmaker: string | null; betUrl: string | null }[] =
    bookmakerNames.length > 1 && bookmakerNames.length === urls.length
      ? bookmakerNames.map((name, i) => ({ bookmaker: extractBookmaker(urls[i]!) ?? name, betUrl: urls[i]! }))
      : [{ bookmaker: (urls[0] ? extractBookmaker(urls[0]) : null) ?? bookmakerNames[0] ?? null, betUrl: urls[0] ?? null }];

  const primary = pairs[0]!;
  if (!primary.bookmaker && !primary.betUrl) return null; // sem casa nem link — não é uma tip de verdade

  const gameLine = content.find((l) => extractGameLine(l) !== null) ?? null;
  const match = gameLine ? (extractGameLine(gameLine) ?? undefined) : undefined;

  // MÚLTIPLA de N jogos (mercado combinado em uma linha de bullet, uma
  // única aposta pro conjunto) — checado ANTES do ESCADA porque esse
  // formato às vezes lista os jogos com keycap numerado (1️⃣/2️⃣) só como
  // rótulo ("1️⃣ Tottenham", "2️⃣ Tottenham x Everton"), não como pernas com
  // stake próprio; sem essa ordem, o bloco ESCADA abaixo confundia esses
  // rótulos com pernas de verdade e perdia o texto real da seleção (a
  // linha de bullet).
  const hasMultipleBookmakers = pairs.length > 1;
  if (content.some((l) => MULTIPLA_RE.test(l)) && content.some((l) => BULLET_RE.test(l))) {
    const legs = content
      .map((l) => l.match(BULLET_RE)?.[1]?.trim())
      .filter((l): l is string => !!l);
    const stakeMatch = content.map((l) => l.match(STAKE_AT_ODD_RE)).find((m): m is RegExpMatchArray => m !== null);
    if (legs.length > 0 && stakeMatch) {
      // "MÚLTIPLA (mesmo jogo)" repete o confronto antes das pernas
      // ("CA Huracán - Racing Club\n • CA Huracán - Racing Club\n • ...")
      // usando "-", não "x" — extractGameLine não pega (ver MATCH_LINE_RE),
      // então cai pro separador "-" aqui. Seguro só neste ramo: por ser
      // "mesmo jogo" (não ESCADA/multi-jogo), a 1ª linha nesse formato
      // nunca mistura confrontos diferentes.
      const comboMatch = match ?? content.map(extractDashGameLine).find((v): v is string => v !== null) ?? undefined;
      return {
        pattern: "padovan_combo",
        bookmaker: hasMultipleBookmakers ? null : primary.bookmaker,
        betUrl: hasMultipleBookmakers ? null : primary.betUrl,
        fields: {},
        ...(comboMatch ? { match: comboMatch } : {}),
        selections: [
          {
            text: legs.join("\n"),
            unit: toNumber(stakeMatch[1]!),
            odd: toNumber(stakeMatch[2]!),
            ...(hasMultipleBookmakers ? { bookmakerOptions: pairs } : {}),
          },
        ],
      };
    }
  }

  // ESCADA (numbered independent legs, 1️⃣/2️⃣/...) — also covers the hybrid
  // "N INDIVIDUAIS + MÚLTIPLA" variant, where a trailing "🎯 Múltipla de N"
  // line adds one more selection combining every leg collected so far.
  // Triggered on the keycap entries themselves rather than requiring the
  // literal word "ESCADA", since this tipster doesn't always use it.
  if (content.some((l) => KEYCAP_ENTRY_RE.test(l))) {
    const selections: ParsedSelection[] = [];
    let pendingMarket: string | null = null;
    let comboPending = false;
    for (const line of content) {
      if (MULTIPLA_MARKER_RE.test(line)) {
        comboPending = true;
        continue;
      }
      const entry = line.match(KEYCAP_ENTRY_RE);
      if (entry) {
        pendingMarket = entry[2]!.trim();
        continue;
      }
      const stake = line.match(STAKE_AT_ODD_RE);
      if (stake && comboPending) {
        selections.push({
          text: selections.map((s) => s.text).join("\n") || null,
          unit: toNumber(stake[1]!),
          odd: toNumber(stake[2]!),
        });
        comboPending = false;
      } else if (stake && pendingMarket !== null) {
        selections.push({ text: pendingMarket, unit: toNumber(stake[1]!), odd: toNumber(stake[2]!) });
        pendingMarket = null;
      }
    }
    if (selections.length === 0) return null;
    return {
      pattern: selections.length > 1 && comboPending === false && content.some((l) => MULTIPLA_MARKER_RE.test(l))
        ? "padovan_escada_multipla"
        : "padovan_escada",
      bookmaker: primary.bookmaker,
      betUrl: primary.betUrl,
      fields: {},
      ...(match ? { match } : {}),
      selections,
    };
  }

  const stakeMatch = content.map((l) => l.match(STAKE_AT_ODD_RE)).find((m): m is RegExpMatchArray => m !== null);
  if (!stakeMatch) return null;

  const marketLine = content.find((l) => l !== gameLine && !STAKE_AT_ODD_RE.test(l)) ?? null;
  const market = marketLine ? stripLeadingEmoji(marketLine).trim() : null;
  const unit = toNumber(stakeMatch[1]!);
  const odd = toNumber(stakeMatch[2]!);

  return {
    pattern: "padovan_single",
    bookmaker: primary.bookmaker,
    betUrl: primary.betUrl,
    fields: {},
    ...(match ? { match } : {}),
    selections: [
      {
        text: market,
        unit,
        odd,
        bookmaker: hasMultipleBookmakers ? null : primary.bookmaker,
        betUrl: hasMultipleBookmakers ? null : primary.betUrl,
        ...(hasMultipleBookmakers ? { bookmakerOptions: pairs } : {}),
      },
    ],
  };
}

function extractLink(
  text: string,
  entities: TextEntity[] | undefined,
): { bookmaker: string | null; betUrl: string | null; plainUrlLine: string | null } {
  const hidden = entities?.find((e) => e.url);
  if (hidden?.url) {
    return { bookmaker: extractBookmaker(hidden.url), betUrl: hidden.url, plainUrlLine: null };
  }

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const match = line.match(URL_IN_TEXT_RE);
    if (match) return { bookmaker: extractBookmaker(match[0]), betUrl: match[0], plainUrlLine: line };
  }

  return { bookmaker: null, betUrl: null, plainUrlLine: null };
}

export type StakeTopUp = { addedUnit: number; odd: number | null };

/**
 * "+0,50u aq na odd 3.96, fechando 1u" — só chamado por processMessage.ts, e
 * só quando a mensagem é uma reply (ver STAKE_TOPUP_RE acima pro porquê é
 * seguro sem esse contexto de reply). `odd: null` quando o texto não fala
 * uma odd nova — quem chama decide o que fazer (herdar a odd da tip pai).
 */
export function parseStakeTopUp(rawText: string | null | undefined): StakeTopUp | null {
  if (!rawText || !rawText.trim()) return null;

  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const addedMatch = lines.map((l) => l.match(STAKE_TOPUP_RE)).find((m): m is RegExpMatchArray => m !== null);
  if (!addedMatch) return null;

  const oddMatch = lines.map((l) => l.match(ODD_LINE_RE)).find((m): m is RegExpMatchArray => m !== null);
  return { addedUnit: toNumber(addedMatch[1]!), odd: oddMatch ? toNumber(oddMatch[1]!) : null };
}

/**
 * Parseia uma mensagem de tip de grupo de Telegram. Heurística baseada nos
 * formatos observados em KNOWN_PATTERNS. Retorna `null` quando a mensagem
 * não bate em nenhum padrão conhecido — testado contra tráfego real dos
 * grupos, isso é sempre bate-papo (nunca uma tip de verdade), então essas
 * mensagens são ignoradas em vez de virar uma linha "revisar" vazia.
 */
export function parseTip(rawText: string | null | undefined, entities?: TextEntity[]): ParsedTip | null {
  if (!rawText || !rawText.trim()) return null;

  const allLines = rawText
    .split("\n")
    .map((l) => l.trim().replace(TRAILING_RESULT_MARK_RE, ""))
    .filter((l) => l.length > 0)
    .map((l) => {
      const boost = l.match(UNIT_WITH_BOOST_RE);
      return boost ? `${boost[1]}u` : l;
    });
  const lines = allLines.filter(
    (l) =>
      !SIGNATURE_LINE_RE.test(l) &&
      !META_CALL_RE.test(l) &&
      !CLOSE_TIME_RE.test(l) &&
      !TRACKED_STATUS_RE.test(l) &&
      !GALE_LINE_RE.test(l),
  );
  if (lines.length === 0) return null;

  if (isPadovanStyle(lines)) {
    return parsePadovanMessage(lines, entities);
  }

  const { bookmaker, betUrl, plainUrlLine } = extractLink(lines.join("\n"), entities);
  const remaining0 = lines.filter((l) => l !== plainUrlLine);

  const fields: ParsedTip["fields"] = {};
  const remaining: string[] = [];

  for (const line of remaining0) {
    const oddMatch = line.match(ODD_LINE_RE);
    if (oddMatch) {
      const novaOdd = line.match(NOVA_ODD_RE);
      const arrowOdd = line.match(ODD_ARROW_BOOST_RE);
      fields.odd = toNumber((novaOdd ?? arrowOdd ?? oddMatch)[1]!);
      continue;
    }
    const limitMatch = line.match(LIMIT_LINE_RE);
    if (limitMatch) {
      fields.limit = toNumber(limitMatch[1]!);
      continue;
    }
    const novaPct = line.match(NOVA_PERCENTAGE_RE);
    if (novaPct) {
      fields.percentage = toNumber(novaPct[1]!);
      continue;
    }
    const pctMatch = stripLeadingEmoji(line).trim().match(PERCENTAGE_LINE_RE);
    if (pctMatch) {
      fields.percentage = toNumber(pctMatch[1]!);
      continue;
    }
    remaining.push(line);
  }

  // N pernas simples ("<Seleção> @<odd> <n>u") mais uma múltipla combinando
  // todas elas ("<n>u na <Rótulo> @<odd>") — mercado, odd e unidade já vêm
  // no texto pra cada uma, então não depende de link nem de foto pra valer.
  const legMatches = remaining
    .map((l) => l.match(SELECTION_AT_ODD_UNIT_RE))
    .filter((m): m is RegExpMatchArray => m !== null);
  const comboWithOddMatch = remaining
    .map((l) => l.match(UNIT_COMBO_WITH_ODD_RE))
    .find((m): m is RegExpMatchArray => m !== null);
  if (legMatches.length > 1 && comboWithOddMatch) {
    const legSelections: ParsedSelection[] = legMatches.map((m) => ({
      text: m[1]!.trim(),
      odd: toNumber(m[2]!),
      unit: toNumber(m[3]!),
    }));
    return {
      pattern: "legs_plus_combo",
      bookmaker,
      betUrl,
      fields,
      selections: [
        ...legSelections,
        {
          text: legSelections.map((s) => s.text).join("\n"),
          unit: toNumber(comboWithOddMatch[1]!),
          odd: toNumber(comboWithOddMatch[3]!),
        },
      ],
    };
  }

  // Padrões baseados só em "<n>u" (sem rótulo explícito tipo ODD:/Limite:)
  // exigem casa/link identificados — sem isso, "<texto> <n>u" é bate-papo
  // qualquer (ex.: "1.55 vale 1u", mensagem explicando a tabela de unidades
  // do grupo), não uma tip de verdade.
  const hasLink = betUrl !== null;

  const unitOnlyLines = remaining.filter((l) => UNIT_ONLY_RE.test(l));

  if (hasLink) {
    const eachMatch = remaining.map((l) => l.match(UNIT_EACH_RE)).find((m): m is RegExpMatchArray => m !== null);
    const comboMatch = remaining.map((l) => l.match(UNIT_COMBO_RE)).find((m): m is RegExpMatchArray => m !== null);
    // Checado ANTES do "combo" genérico abaixo: "0,5u na múltipla" bate nos
    // dois, mas aqui há também uma linha "<n>u em cada" — sem esse check
    // primeiro, o combo genérico "vencia" e criava só a múltipla, jogando
    // fora a instrução de apostar em cada perna individualmente (era
    // exatamente o formato que causou 1 tip em vez de 4 em produção).
    if (eachMatch && comboMatch) {
      return {
        pattern: "unit_each_plus_combo",
        bookmaker,
        betUrl,
        fields,
        comboLabel: comboMatch[2]!.trim(),
        legsUnit: toNumber(eachMatch[1]!),
        selections: [{ text: null, unit: toNumber(comboMatch[1]!) }],
      };
    }
    // N linhas "<n>u" soltas, cada uma com SEU PRÓPRIO stake (ao contrário de
    // "em cada" acima, que é um stake uniforme pra uma contagem só
    // descoberta na foto) — MAIS uma linha "<n>u na <Rótulo>" pra múltipla
    // dessas mesmas pernas. Mesmo raciocínio do check acima: sem isso ANTES
    // do "combo" genérico logo abaixo, o combo "vence" sozinho e as pernas
    // soltas somem (era exatamente o formato — 2u/1,5u/1,25u + "0,5u na
    // Tripla" — que fez 3 tips virarem 0 em produção).
    if (comboMatch && unitOnlyLines.length > 1) {
      return {
        pattern: "unit_lines_plus_combo",
        bookmaker,
        betUrl,
        fields,
        comboLabel: comboMatch[2]!.trim(),
        selections: [
          ...unitOnlyLines.map((l) => ({ text: null, unit: toNumber(l.match(UNIT_ONLY_RE)![1]!) })),
          { text: null, unit: toNumber(comboMatch[1]!) },
        ],
      };
    }
    if (comboMatch) {
      return {
        pattern: "combo",
        bookmaker,
        betUrl,
        fields,
        comboLabel: comboMatch[2]!.trim(),
        selections: [{ text: null, unit: toNumber(comboMatch[1]!) }],
      };
    }
  }

  if (hasLink && unitOnlyLines.length > 1) {
    return {
      pattern: "unit_lines",
      bookmaker,
      betUrl,
      fields,
      selections: unitOnlyLines.map((l) => ({ text: null, unit: toNumber(l.match(UNIT_ONLY_RE)![1]!) })),
    };
  }

  if (hasLink) {
    // Cada linha "<rótulo> <n>u" é sua própria seleção — uma mensagem pode
    // ter várias (ex.: "Grêmio + SOTs 1u" e "Grêmio + SOTs em cada tempo
    // 0,5u" na mesma tip), então acumula todas em vez de parar na primeira.
    const inlineMatches = remaining
      .filter((line) => !UNIT_ONLY_RE.test(line))
      .map((line) => line.match(UNIT_INLINE_RE))
      .filter((m): m is RegExpMatchArray => m !== null);

    if (inlineMatches.length > 0) {
      let matchLine: string | undefined;
      const selections: ParsedSelection[] = inlineMatches.map((inline) => {
        const label = inline[1]!.trim();
        const isMatch = MATCH_LINE_RE.test(label);
        if (isMatch) matchLine = label;
        return { text: isMatch ? null : label, unit: toNumber(inline[2]!) };
      });
      return {
        pattern: "inline_market",
        bookmaker,
        betUrl,
        fields,
        ...(matchLine !== undefined ? { match: matchLine } : {}),
        selections,
      };
    }
  }

  if (hasLink && unitOnlyLines.length === 1) {
    const unit = toNumber(unitOnlyLines[0]!.match(UNIT_ONLY_RE)![1]!);
    // Normally just one leftover line (either the match, with the market
    // coming from the photo, or the market, with the game coming from the
    // photo) — but a tipster sometimes writes BOTH on their own lines (e.g.
    // "Time A x Time B" + "Empate e -2.5 Gols"), so the match line alone
    // must not swallow the slot and drop the market line.
    const freeLines = remaining.filter((l) => l !== unitOnlyLines[0]);
    const matchLine = freeLines.find((l) => MATCH_LINE_RE.test(l)) ?? null;
    const marketLine = freeLines.find((l) => l !== matchLine) ?? null;
    // "<Seleção> @<odd>" on its own line (stake lives on the separate "<n>u"
    // line handled above) — pull the odd out instead of leaving "@2.65"
    // baked into the selection text as unstructured noise.
    const marketWithOdd = marketLine?.match(SELECTION_AT_ODD_ONLY_RE);
    return {
      pattern: "inline_market",
      bookmaker,
      betUrl,
      fields,
      ...(matchLine ? { match: matchLine } : {}),
      selections: [
        marketWithOdd
          ? { text: marketWithOdd[1]!.trim(), unit, odd: toNumber(marketWithOdd[2]!) }
          : { text: marketLine, unit },
      ],
    };
  }

  if (fields.odd !== undefined || fields.percentage !== undefined || fields.limit !== undefined) {
    // A linha solta que sobrou em `remaining` (quando existe) é a descrição
    // do mercado por extenso — ex. "Harry kane marcar" antes de "⚠️ ODD:
    // 2.00" — perdida até aqui porque esse fallback nunca olhava pra
    // `remaining`, só pra `fields`; sem foto pra fazer OCR nisso (formato do
    // Lemos/ST raramente tem), isso deixava o mercado permanentemente vazio
    // mesmo quando já estava escrito claro no texto.
    const marketLine = remaining[0] ?? null;
    return {
      pattern: fields.odd !== undefined ? "odd_pct_limit" : "pct_limit_only",
      bookmaker,
      betUrl,
      fields,
      selections: [{ text: marketLine, unit: fields.percentage ?? null, odd: fields.odd }],
    };
  }

  // Nada reconhecível (nem odd/%/limite, nem linha de unidade com link, nem
  // combo) — testado contra tráfego real, isso é sempre bate-papo (bom
  // dia/boa noite, link de convite do grupo, comentário sobre o próprio
  // jogo, explicação da tabela de unidades) nunca uma tip de verdade, então
  // não cria linha nenhuma em vez de virar lixo "revisar".
  return null;
}
