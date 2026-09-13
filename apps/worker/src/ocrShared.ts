/** Categorias fixas de mercado que o OCR classifica por seleção — mantenha em
 * sincronia com `TELEGRAM_TIP_MARKET_TYPES` em packages/shared-types/src/index.ts
 * (essa lista é a de cada perna isolada; "Combinada" não entra aqui porque é
 * sintetizada depois, quando uma única linha de tip junta pernas de
 * categorias diferentes — ver applyMultiLegResult em extractDetailsWorker.ts). */
export const MARKET_TYPE_CATEGORIES = [
  "Resultado (1X2)",
  "Dupla Chance",
  "Handicap",
  "Over/Under Gols",
  "Ambas Marcam",
  "Escanteios",
  "Cartões",
  "Resultado 1º Tempo",
  "Resultado 2º Tempo",
  "Outro",
] as const;
export type MarketTypeCategory = (typeof MARKET_TYPE_CATEGORIES)[number];

/** O que fica de fato salvo em `TelegramTip.marketType` — inclui "Combinada",
 * que nenhuma seleção individual recebe da OCR (ver comentário acima). */
export type MarketType = MarketTypeCategory | "Combinada";

export type OcrSelection = { market: string | null; game: string | null; odd: number | null; marketType: MarketTypeCategory | null };
export type OcrResult = { selections: OcrSelection[]; totalOdd: number | null };

export function detectMimeType(filePathOrName: string): string {
  const ext = (filePathOrName.split(".").pop() || "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

/**
 * `expectedCount > 1` fixa quantas seleções INDEPENDENTES o modelo deve
 * devolver, na ordem do bilhete — usado quando cada uma mapeia 1:1 pra uma
 * linha de unidade já conhecida no texto (padrão `unit_lines`, ver
 * parseTip.ts). Cada uma tem sua própria odd.
 *
 * `expectedCount` 1 ou `null` cobre tanto uma seleção única quanto uma
 * combinada/múltipla (não dá pra saber de antemão qual é só pelo texto) —
 * mesmo pedindo 1 seleção, os modelos tendem a colar o texto de várias
 * pernas num "market" só, separadas por "E"/vírgula/hífen à sua escolha
 * (visto em produção). Em vez de tentar adivinhar o separador depois, o
 * prompt pede pra sempre listar cada perna como um item SEPARADO do array —
 * quem chama junta os itens com quebra de linha real, e usa "totalOdd" (a
 * odd do bilhete inteiro) em vez de somar odds individuais.
 */
export function buildOcrPrompt(expectedCount: number | null): string {
  const marketGameNote = `"market" é o mercado/seleção apostada por extenso, como está escrito
no bilhete — se o mercado inclui o nome de um time/jogador como parte da própria seleção (ex.:
"Club Cienciano - Resultado do 1° Tempo", "Bodo/Glimt Escanteios"), inclua isso TODO dentro de
"market". "game" é só o confronto geral do jogo, os 2 times (ex.: "Flamengo x Vasco"), null se
não identificável — nunca repita ali o que já foi descrito em "market".`;

  const marketTypeNote = `Também "marketType": a categoria desse mercado — escolha EXATAMENTE
uma destas opções, copiando o texto tal como está aqui, sem inventar uma nova categoria: ${MARKET_TYPE_CATEGORIES.map((c) => `"${c}"`).join(", ")}.
Use "Outro" só se nenhuma das demais descrever o mercado.`;

  if (expectedCount !== null && expectedCount > 1) {
    return `Essa imagem é uma captura de tela de um bilhete de aposta esportiva com
${expectedCount} seleções distintas e independentes (não uma múltipla combinada — apostas
separadas, cada uma com sua própria odd).
Para cada uma, na ordem em que aparecem no bilhete, identifique: ${marketGameNote}
${marketTypeNote}
Também "odd": o valor decimal da odd dessa seleção (não o valor apostado nem o retorno
potencial), ou null se não identificável. Se a imagem mostrar a odd riscada/antiga ao lado de um valor novo — separados por seta
("1,43 » 2,00"), "x" ("1.51x » 1.91x") OU um ícone de raio/boost (ex.: "2.65 ⚡ 3.39"), sempre
use o valor DEPOIS do separador (o novo/turbinado), nunca o riscado/antigo.
Responda APENAS com um JSON no formato {"selections": [{"market":"...","game":"...","marketType":"...","odd":<odd real, nunca copie este número>}]}
com exatamente ${expectedCount} item(ns), nessa ordem. Os valores entre aspas/<> acima são só
formato de exemplo — NUNCA copie um número de exemplo, sempre calcule a partir do que está de
fato na imagem; se não der pra ler a odd com confiança, use null. Não inclua texto além do JSON.`;
  }

  return `Essa imagem é uma captura de tela de um bilhete de aposta esportiva. Pode ser uma
seleção única ou uma aposta múltipla/combinada com várias pernas somadas numa odd só.
Liste CADA perna/seleção que aparecer no bilhete como um item SEPARADO do array — mesmo que
sejam só 2 ou 3 pernas curtas, NUNCA junte o texto de duas pernas diferentes num "market" só
(nunca use "E", vírgula ou hífen pra concatenar mais de uma seleção dentro do mesmo campo).
Para cada item: ${marketGameNote}
${marketTypeNote}
Identifique também "totalOdd": a odd total do bilhete inteiro como apostado (se for só 1
seleção, é a odd dela; se for combinada, é a odd combinada final, não a soma das odds
individuais). Se a imagem mostrar a odd riscada/antiga ao lado de um valor novo — separados por seta
("1,43 » 2,00"), "x" ("1.51x » 1.91x") OU um ícone de raio/boost (ex.: "2.65 ⚡ 3.39"), sempre
use o valor DEPOIS do separador (o novo/turbinado), nunca o riscado/antigo.
Responda APENAS com um JSON no formato
{"selections": [{"market":"...","game":"...","marketType":"..."}], "totalOdd": <odd real, nunca copie este número>}
(totalOdd null se não identificável). Os valores entre aspas/<> acima são só formato de
exemplo — NUNCA copie um número de exemplo, sempre calcule a partir do que está de fato na
imagem. Não inclua texto além do JSON.`;
}

/** Interpreta o texto de resposta (já deve ser um JSON puro) no formato comum
 * que todo provedor de OCR (Gemini, Ollama, ...) segue. Nunca lança — JSON
 * malformado ou campos com tipo errado viram resultado vazio. */
export function parseOcrResponseText(text: string | null | undefined): OcrResult {
  const empty: OcrResult = { selections: [], totalOdd: null };
  if (!text) return empty;

  try {
    const parsed = JSON.parse(text) as { selections?: unknown; totalOdd?: unknown };
    if (!Array.isArray(parsed.selections)) return empty;

    // Modelos locais mais fracos às vezes escrevem a palavra "null" (ou
    // "n/a"/"desconhecido") como string em vez de usar o null de verdade do
    // JSON — trata como ausente também, em vez de guardar o texto "null".
    const asTextOrNull = (v: unknown): string | null => {
      if (typeof v !== "string") return null;
      const normalized = v.trim().toLowerCase();
      if (normalized === "" || normalized === "null" || normalized === "n/a" || normalized === "desconhecido") return null;
      return v;
    };

    // Só aceita marketType se bater exatamente (case-insensitive) com uma das
    // categorias fixas — qualquer variação inventada pelo modelo vira null em
    // vez de poluir a coluna com texto livre.
    const asMarketType = (v: unknown): MarketTypeCategory | null => {
      if (typeof v !== "string") return null;
      const needle = v.trim().toLowerCase();
      return MARKET_TYPE_CATEGORIES.find((c) => c.toLowerCase() === needle) ?? null;
    };

    const selections: OcrSelection[] = parsed.selections.map((s) => {
      const row = (s ?? {}) as Record<string, unknown>;
      return {
        market: asTextOrNull(row.market),
        game: asTextOrNull(row.game),
        odd: typeof row.odd === "number" && row.odd > 1 ? row.odd : null,
        marketType: asMarketType(row.marketType),
      };
    });
    const totalOdd = typeof parsed.totalOdd === "number" && parsed.totalOdd > 1 ? parsed.totalOdd : null;

    return { selections, totalOdd };
  } catch (err) {
    console.error("[ocr] Falha ao interpretar resposta:", (err as Error).message);
    return empty;
  }
}
