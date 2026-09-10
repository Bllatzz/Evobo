const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const GEMINI_FETCH_TIMEOUT_MS = 30_000;

export type OcrSelection = { market: string | null; game: string | null; odd: number | null };
export type OcrResult = { selections: OcrSelection[]; totalOdd: number | null };

function detectMimeType(filePathOrName: string): string {
  const ext = (filePathOrName.split(".").pop() || "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

/**
 * `expectedCount` fixa quantas seleções o Gemini deve devolver, na ordem do
 * bilhete — usado quando cada seleção da foto mapeia 1:1 pra uma linha de
 * unidade já conhecida no texto (padrão `unit_lines`, ver parseTip.ts).
 * `null` é usado pro padrão `combo` (aposta múltipla): o número de pernas não
 * é conhecido de antemão, então o prompt pede "todas" e uma odd total
 * combinada em vez de uma odd por seleção.
 */
function buildPrompt(expectedCount: number | null): string {
  if (expectedCount !== null) {
    return `Essa imagem é uma captura de tela de um bilhete de aposta esportiva com
${expectedCount} seleção(ões) distinta(s) e independente(s) (não uma múltipla combinada).
Para cada uma, na ordem em que aparecem no bilhete, identifique: "market" (o mercado/seleção
apostada, como está escrito, ex.: "Over 0.5 Gols HT"), "game" (os times do confronto, ex.:
"Flamengo x Vasco", ou null se não identificável) e "odd" (o valor decimal da odd dessa
seleção — não o valor apostado nem o retorno potencial — ou null se não identificável).
Responda APENAS com um JSON no formato {"selections": [{"market":"...","game":"...","odd":1.85}]}
com exatamente ${expectedCount} item(ns), nessa ordem. Não inclua texto além do JSON.`;
  }

  return `Essa imagem é uma captura de tela de um bilhete de aposta esportiva com uma aposta
múltipla/combinada (várias seleções somadas numa odd só). Liste todas as seleções/pernas da
múltipla, na ordem em que aparecem, cada uma com "market" (o mercado, ex.: "Over 0.5 Gols HT")
e "game" (os times do confronto dessa perna, ou null se não identificável). Identifique também
a odd total combinada do bilhete inteiro.
Responda APENAS com um JSON no formato
{"selections": [{"market":"...","game":"..."}], "totalOdd": 4.32} (totalOdd null se não
identificável). Não inclua texto além do JSON.`;
}

/**
 * Tenta extrair mercado/jogo/odd de uma foto de bilhete via Gemini Vision.
 * Falhas permanentes (sem API key, imagem ilegível, JSON malformado) nunca
 * lançam — retornam selections vazio, e quem chama trata como "não deu pra
 * extrair, editar manualmente". Falhas transitórias (5xx/429, rede, timeout)
 * LANÇAM de propósito — o worker configura retry com backoff pra esses
 * casos (ver processMessage.ts), já que uma instabilidade momentânea da API
 * não deveria virar um campo permanentemente em branco.
 */
export async function extractTipDetails(
  photoBuffer: Buffer,
  photoName: string,
  expectedCount: number | null,
): Promise<OcrResult> {
  const empty: OcrResult = { selections: [], totalOdd: null };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return empty;

  const body = {
    contents: [
      {
        parts: [
          { text: buildPrompt(expectedCount) },
          { inline_data: { mime_type: detectMimeType(photoName), data: photoBuffer.toString("base64") } },
        ],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };

  // Erros de rede/timeout do fetch propagam por conta própria (transitório).
  const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(GEMINI_FETCH_TIMEOUT_MS),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[GEMINI] Resposta de erro:", res.status, detail);
    if (res.status >= 500 || res.status === 429) {
      throw new Error(`Gemini respondeu ${res.status} (transitório)`);
    }
    return empty; // 4xx (chave inválida, imagem rejeitada etc.) — repetir não muda o resultado
  }

  try {
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return empty;

    const parsed = JSON.parse(text) as { selections?: unknown; totalOdd?: unknown };
    if (!Array.isArray(parsed.selections)) return empty;

    const selections: OcrSelection[] = parsed.selections.map((s) => {
      const row = (s ?? {}) as Record<string, unknown>;
      return {
        market: typeof row.market === "string" ? row.market : null,
        game: typeof row.game === "string" ? row.game : null,
        odd: typeof row.odd === "number" && row.odd > 1 ? row.odd : null,
      };
    });
    const totalOdd = typeof parsed.totalOdd === "number" && parsed.totalOdd > 1 ? parsed.totalOdd : null;

    return { selections, totalOdd };
  } catch (err) {
    console.error("[GEMINI] Falha ao interpretar resposta:", (err as Error).message);
    return empty;
  }
}
