import * as gemini from "./geminiVision.js";
import * as ollama from "./ollamaVision.js";
import * as openai from "./openaiVision.js";

/** OCR_PROVIDER=ollama usa o modelo de visão local (ver ollamaVision.ts);
 * OCR_PROVIDER=openai usa a OpenAI (ver openaiVision.ts) — padrão é Gemini. */
export const extractTipDetails =
  process.env.OCR_PROVIDER === "ollama"
    ? ollama.extractTipDetails
    : process.env.OCR_PROVIDER === "openai"
      ? openai.extractTipDetails
      : gemini.extractTipDetails;
