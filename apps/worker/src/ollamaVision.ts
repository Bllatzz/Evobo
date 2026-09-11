import { buildOcrPrompt, parseOcrResponseText, type OcrResult } from "./ocrShared.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_VISION_MODEL ?? "qwen2.5vl:7b";
const OLLAMA_FETCH_TIMEOUT_MS = 90_000; // inferência local em CPU/GPU compartilhada é bem mais lenta que uma API

/**
 * Mesma extração que geminiVision.ts, mas via um modelo de visão rodando
 * localmente no Ollama — usado como provedor alternativo (ver
 * visionProvider.ts) enquanto a cota/billing do Gemini não está disponível.
 * Qualidade abaixo do Gemini pra texto miúdo, mas sem custo nem cota.
 */
export async function extractTipDetails(
  photoBuffer: Buffer,
  _photoName: string,
  expectedCount: number | null,
): Promise<OcrResult> {
  const body = {
    model: OLLAMA_MODEL,
    prompt: buildOcrPrompt(expectedCount),
    images: [photoBuffer.toString("base64")],
    stream: false,
    format: "json",
    options: { temperature: 0 },
  };

  // Erros de rede/timeout do fetch propagam por conta própria (transitório) —
  // mesma convenção do Gemini: o Ollama não estar de pé agora é passageiro.
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(OLLAMA_FETCH_TIMEOUT_MS),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[OLLAMA] Resposta de erro:", res.status, detail);
    throw new Error(`Ollama respondeu ${res.status} (transitório)`);
  }

  const json = (await res.json()) as { response?: string };
  return parseOcrResponseText(json.response);
}
