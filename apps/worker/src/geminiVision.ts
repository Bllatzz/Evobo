import { detectMimeType, buildOcrPrompt, parseOcrResponseText, type OcrResult } from "./ocrShared.js";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const GEMINI_FETCH_TIMEOUT_MS = 30_000;

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
          { text: buildOcrPrompt(expectedCount) },
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

  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  return parseOcrResponseText(text);
}
