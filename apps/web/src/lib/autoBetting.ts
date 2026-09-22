import type { AutoBetBookmaker, SaveBookmakerCredentialInput } from "@evobo/shared-types";
import { apiFetch } from "./api";

/** Login salvo de uma casa — só a dica mascarada, a API nunca devolve o login pra tela. */
export type SavedCredential = { bookmaker: AutoBetBookmaker; usernameHint: string; updatedAt: string };

export const fetchCredentials = (): Promise<{ enabled: boolean; credentials: SavedCredential[] }> =>
  apiFetch("/auto-betting/credentials");

export const saveCredential = (bookmaker: AutoBetBookmaker, input: SaveBookmakerCredentialInput): Promise<null> =>
  apiFetch(`/auto-betting/credentials/${bookmaker}`, { method: "PUT", body: JSON.stringify(input) });

export const deleteCredential = (bookmaker: AutoBetBookmaker): Promise<null> =>
  apiFetch(`/auto-betting/credentials/${bookmaker}`, { method: "DELETE" });

export type ExtensionKeyInfo = { createdAt: string; lastUsedAt: string | null } | null;

export const fetchExtensionKey = (): Promise<{ key: ExtensionKeyInfo }> => apiFetch("/auto-betting/extension-key");

/** Gera uma chave nova (a anterior para de funcionar) — o texto só vem nesta resposta. */
export const createExtensionKey = (): Promise<{ key: string }> =>
  apiFetch("/auto-betting/extension-key", { method: "POST" });

export const revokeExtensionKey = (): Promise<null> => apiFetch("/auto-betting/extension-key", { method: "DELETE" });
