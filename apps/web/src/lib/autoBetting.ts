import type { AutoBetBookmaker, AutoBetRunView, AutoBetSettingsView, SaveBookmakerCredentialInput, UpdateAutoBetSettingsInput } from "@evobo/shared-types";
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

export const fetchAutoBetSettings = (): Promise<AutoBetSettingsView> => apiFetch("/auto-betting/settings");

export const updateAutoBetSettings = (input: UpdateAutoBetSettingsInput): Promise<AutoBetSettingsView> =>
  apiFetch("/auto-betting/settings", { method: "PUT", body: JSON.stringify(input) });

/** days: 1 = hoje, 7, 30. */
export const fetchAutoBetRuns = (days: 1 | 7 | 30, limit = 100): Promise<AutoBetRunView[]> =>
  apiFetch(`/auto-betting/runs?days=${days}&limit=${limit}`);
