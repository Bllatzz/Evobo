import * as gemini from "./geminiVision.js";
import * as ollama from "./ollamaVision.js";

/** OCR_PROVIDER=ollama usa o modelo de visão local (ver ollamaVision.ts) em
 * vez do Gemini — troca de volta é só remover a env var. */
export const extractTipDetails =
  process.env.OCR_PROVIDER === "ollama" ? ollama.extractTipDetails : gemini.extractTipDetails;
