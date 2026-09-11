/**
 * Extrai o nome da casa de apostas a partir da URL do bilhete.
 * Ex.: https://www.bet365.bet.br/s/r/ZZnxR -> "bet365"
 *      https://esportiva.bet.br/sports/... -> "esportiva"
 */
export function extractBookmaker(url: string | null): string | null {
  if (!url) return null;
  try {
    // Strips generic prefixes (www., m. for mobile, app. for reidopitaco's
    // app.reidopitaco.com.br) so "m.betfast.bet.br", "www.bet365.bet.br" and
    // "app.reidopitaco.com.br" all resolve to the actual brand name instead
    // of the subdomain.
    return new URL(url).hostname.replace(/^(www|m|app)\./i, "").split(".")[0] ?? null;
  } catch {
    return null;
  }
}

/** A hidden hyperlink on the message (Telegram `MessageEntityTextUrl`) — the
 * visible text ("esportivabet") and the real URL behind it are different. */
export type TextEntity = { url?: string };

const URL_IN_TEXT_RE = /https?:\/\/\S+/i;
const UNIT_ONLY_RE = /^(\d+(?:[.,]\d+)?)\s*u$/i;
const UNIT_COMBO_RE = /^(\d+(?:[.,]\d+)?)\s*u\s+na\s+(.+)$/i;
const UNIT_INLINE_RE = /^(.*\S)\s+(\d+(?:[.,]\d+)?)\s*u$/i;
const ODD_LINE_RE = /\bodd\b\s*:?\s*(\d+(?:[.,]\d+)?)/i;
const LIMIT_LINE_RE = /\blimite\b(?:\s+de\s+aposta)?\s*:?\s*(?:r\$\s*)?(\d+(?:[.,]\d+)?)\s*\$?/i;
const PERCENTAGE_RE = /(\d+(?:[.,]\d+)?)\s*%/;

// Ruído específico do formato Padovan — nunca é conteúdo de tip, é
// removido logo de cara pra não atrapalhar nem o parser Padovan nem o
// genérico (mensagem "só o assinatura do canal" já causou falso positivo).
const SIGNATURE_LINE_RE = /^📡/;
const META_CALL_RE = /^(CALL|ESCADA)\s*#/i;
const CLOSE_TIME_RE = /^🔒/;
const TRACKED_STATUS_RE = /^📊/;

// Formato Padovan: "💰 <n>u @ <odd>" (unidade e odd na mesma linha), "🔗 <Casa>"
// ou "🔗 <link>", pernas com "•" (MÚLTIPLA) ou numeradas "1️⃣"/"2️⃣" (ESCADA).
const LINK_LINE_RE = /^🔗\s*(.+)$/;
const STAKE_AT_ODD_RE = /^💰\s*(\d+(?:[.,]\d+)?)\s*u\s*@\s*(\d+(?:[.,]\d+)?)/i;
const KEYCAP_ENTRY_RE = /^([0-9])️?⃣\s*(.+)$/;
const BULLET_RE = /^[•·]\s*(.+)$/;
const MULTIPLA_RE = /MÚLTIPLA/i;
const ESCADA_RE = /ESCADA/i;

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
  combo: {
    description: "Uma linha '<n>u na <Rótulo>' — aposta múltipla; 1 tip só com os mercados concatenados vindos da foto.",
    example: "0,25u na Tripla\nhttps://www.bet365.bet.br/s/r/...",
  },
  inline_market: {
    description: "Mercado descrito por extenso no texto (mesma linha da unidade ou linha separada); odd e jogo vêm da foto.",
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
};

export type ParsedSelection = {
  text: string | null;
  unit: number | null;
  odd?: number;
  /** Só quando a tip lista mais de uma casa possível pra mesma seleção — sobrescreve o bookmaker/betUrl do nível do ParsedTip pra essa seleção específica. */
  bookmaker?: string | null;
  betUrl?: string | null;
};

export type ParsedTip = {
  pattern: keyof typeof KNOWN_PATTERNS | null;
  bookmaker: string | null;
  betUrl: string | null;
  fields: { odd?: number; percentage?: number; limit?: number };
  comboLabel?: string;
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
  return s.replace(/^[\p{Extended_Pictographic}️\s]+/u, "");
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
          const name = part.trim();
          if (name) bookmakerNames.push(name.toLowerCase());
        }
      }
      continue;
    }
    content.push(line);
  }

  if (urls.length === 0) {
    const hidden = entities?.find((e) => e.url);
    if (hidden?.url) urls.push(hidden.url);
  }

  // Casa/link únicos (o comum) viram 1 par; quando a tip lista mais de uma
  // casa possível pra mesma seleção ("🔗 Betfair · 🔗 Betnacional"), o
  // tipster sempre lista um link por casa logo depois, na mesma ordem — casa
  // e link são pareados por posição, virando N tips separadas (uma por
  // casa), com o mesmo mercado/jogo/unidade/odd. Descompasso entre
  // quantidade de nomes e de links não dá pra casar com certeza, então usa
  // só o primeiro de cada.
  const pairs: { bookmaker: string | null; betUrl: string | null }[] =
    bookmakerNames.length > 1 && bookmakerNames.length === urls.length
      ? bookmakerNames.map((name, i) => ({ bookmaker: name, betUrl: urls[i]! }))
      : [{ bookmaker: bookmakerNames[0] ?? (urls[0] ? extractBookmaker(urls[0]) : null), betUrl: urls[0] ?? null }];

  const primary = pairs[0]!;
  if (!primary.bookmaker && !primary.betUrl) return null; // sem casa nem link — não é uma tip de verdade

  const gameLine = content.find((l) => extractGameLine(l) !== null) ?? null;
  const match = gameLine ? (extractGameLine(gameLine) ?? undefined) : undefined;

  if (content.some((l) => ESCADA_RE.test(l))) {
    const selections: ParsedSelection[] = [];
    let pendingMarket: string | null = null;
    for (const line of content) {
      const entry = line.match(KEYCAP_ENTRY_RE);
      if (entry) {
        pendingMarket = entry[2]!.trim();
        continue;
      }
      const stake = line.match(STAKE_AT_ODD_RE);
      if (stake && pendingMarket !== null) {
        selections.push({ text: pendingMarket, unit: toNumber(stake[1]!), odd: toNumber(stake[2]!) });
        pendingMarket = null;
      }
    }
    if (selections.length === 0) return null;
    return {
      pattern: "padovan_escada",
      bookmaker: primary.bookmaker,
      betUrl: primary.betUrl,
      fields: {},
      ...(match ? { match } : {}),
      selections,
    };
  }

  if (content.some((l) => MULTIPLA_RE.test(l))) {
    const legs = content
      .map((l) => l.match(BULLET_RE)?.[1]?.trim())
      .filter((l): l is string => !!l);
    const stakeMatch = content.map((l) => l.match(STAKE_AT_ODD_RE)).find((m): m is RegExpMatchArray => m !== null);
    if (legs.length === 0 || !stakeMatch) return null;
    return {
      pattern: "padovan_combo",
      bookmaker: primary.bookmaker,
      betUrl: primary.betUrl,
      fields: {},
      ...(match ? { match } : {}),
      selections: [{ text: legs.join("\n"), unit: toNumber(stakeMatch[1]!), odd: toNumber(stakeMatch[2]!) }],
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
    selections: pairs.map((p) => ({ text: market, unit, odd, bookmaker: p.bookmaker, betUrl: p.betUrl })),
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
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const lines = allLines.filter(
    (l) => !SIGNATURE_LINE_RE.test(l) && !META_CALL_RE.test(l) && !CLOSE_TIME_RE.test(l) && !TRACKED_STATUS_RE.test(l),
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
      fields.odd = toNumber(oddMatch[1]!);
      continue;
    }
    const limitMatch = line.match(LIMIT_LINE_RE);
    if (limitMatch) {
      fields.limit = toNumber(limitMatch[1]!);
      continue;
    }
    const pctMatch = line.match(PERCENTAGE_RE);
    if (pctMatch) {
      fields.percentage = toNumber(pctMatch[1]!);
      continue;
    }
    remaining.push(line);
  }

  // Padrões baseados só em "<n>u" (sem rótulo explícito tipo ODD:/Limite:)
  // exigem casa/link identificados — sem isso, "<texto> <n>u" é bate-papo
  // qualquer (ex.: "1.55 vale 1u", mensagem explicando a tabela de unidades
  // do grupo), não uma tip de verdade.
  const hasLink = betUrl !== null;

  if (hasLink) {
    for (const line of remaining) {
      const combo = line.match(UNIT_COMBO_RE);
      if (combo) {
        return {
          pattern: "combo",
          bookmaker,
          betUrl,
          fields,
          comboLabel: combo[2]!.trim(),
          selections: [{ text: null, unit: toNumber(combo[1]!) }],
        };
      }
    }
  }

  const unitOnlyLines = remaining.filter((l) => UNIT_ONLY_RE.test(l));
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
    for (const line of remaining) {
      if (UNIT_ONLY_RE.test(line)) continue;
      const inline = line.match(UNIT_INLINE_RE);
      if (inline) {
        const label = inline[1]!.trim();
        const isMatch = MATCH_LINE_RE.test(label);
        return {
          pattern: "inline_market",
          bookmaker,
          betUrl,
          fields,
          ...(isMatch ? { match: label } : {}),
          selections: [{ text: isMatch ? null : label, unit: toNumber(inline[2]!) }],
        };
      }
    }
  }

  if (hasLink && unitOnlyLines.length === 1) {
    const unit = toNumber(unitOnlyLines[0]!.match(UNIT_ONLY_RE)![1]!);
    const freeLine = remaining.find((l) => l !== unitOnlyLines[0]) ?? null;
    const isMatch = freeLine !== null && MATCH_LINE_RE.test(freeLine);
    return {
      pattern: "inline_market",
      bookmaker,
      betUrl,
      fields,
      ...(isMatch ? { match: freeLine! } : {}),
      selections: [{ text: isMatch ? null : freeLine, unit }],
    };
  }

  if (fields.odd !== undefined || fields.percentage !== undefined || fields.limit !== undefined) {
    return {
      pattern: fields.odd !== undefined ? "odd_pct_limit" : "pct_limit_only",
      bookmaker,
      betUrl,
      fields,
      selections: [{ text: null, unit: fields.percentage ?? null, odd: fields.odd }],
    };
  }

  // Nada reconhecível (nem odd/%/limite, nem linha de unidade com link, nem
  // combo) — testado contra tráfego real, isso é sempre bate-papo (bom
  // dia/boa noite, link de convite do grupo, comentário sobre o próprio
  // jogo, explicação da tabela de unidades) nunca uma tip de verdade, então
  // não cria linha nenhuma em vez de virar lixo "revisar".
  return null;
}
