import { detectMimeType, buildOcrPrompt, parseOcrResponseText, type OcrResult } from "./ocrShared.js";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini";
const OPENAI_FETCH_TIMEOUT_MS = 30_000;

/**
 * Mesma extração que geminiVision.ts, mas via OpenAI (Chat Completions com
 * imagem) — usado como provedor alternativo (ver visionProvider.ts). Mesma
 * convenção de erro: falha permanente vira selections vazio, falha
 * transitória (5xx/429/rede) lança pra acionar o retry com backoff do
 * worker (ver processMessage.ts).
 */
export async function extractTipDetails(
  photoBuffer: Buffer,
  photoName: string,
  expectedCount: number | null,
): Promise<OcrResult> {
  const empty: OcrResult = { selections: [], totalOdd: null };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return empty;

  const dataUrl = `data:${detectMimeType(photoName)};base64,${photoBuffer.toString("base64")}`;
  const body = {
    model: OPENAI_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildOcrPrompt(expectedCount) },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  };

  // Erros de rede/timeout do fetch propagam por conta própria (transitório).
  const res = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(OPENAI_FETCH_TIMEOUT_MS),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[OPENAI] Resposta de erro:", res.status, detail);
    if (res.status >= 500 || res.status === 429) {
      throw new Error(`OpenAI respondeu ${res.status} (transitório)`);
    }
    return empty; // 4xx (chave inválida, imagem rejeitada etc.) — repetir não muda o resultado
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json?.choices?.[0]?.message?.content;
  return parseOcrResponseText(text);
}
