import { apiFetch } from "./api";
import type {
  TelegramTip,
  TelegramGroup,
  TelegramBancaSummary,
  TelegramBancaSettings,
  TelegramBookmakerBalance,
  UpdateTelegramTipInput,
  UpdateTelegramBancaSettingsInput,
} from "@evobo/shared-types";

export type { TelegramTip, TelegramGroup, TelegramBancaSummary, TelegramBancaSettings, TelegramBookmakerBalance };

export type TelegramTipsFilter = {
  page?: number;
  limit?: number;
  groupId?: string;
  bookmaker?: string;
  result?: string;
  takenStatus?: string;
  search?: string;
  /** "YYYY-MM-DD", inclusive on both ends — filtra por receivedAt (fuso São Paulo). */
  dateFrom?: string;
  dateTo?: string;
};

export type TelegramTipsPage = { data: TelegramTip[]; total: number; page: number; limit: number; totalPages: number };

export function fetchTelegramTips(filter: TelegramTipsFilter = {}): Promise<TelegramTipsPage> {
  const params = new URLSearchParams();
  if (filter.page) params.set("page", String(filter.page));
  if (filter.limit) params.set("limit", String(filter.limit));
  if (filter.groupId) params.set("groupId", filter.groupId);
  if (filter.bookmaker) params.set("bookmaker", filter.bookmaker);
  if (filter.result) params.set("result", filter.result);
  if (filter.takenStatus) params.set("takenStatus", filter.takenStatus);
  if (filter.search) params.set("search", filter.search);
  if (filter.dateFrom) params.set("dateFrom", filter.dateFrom);
  if (filter.dateTo) params.set("dateTo", filter.dateTo);
  const qs = params.toString();
  return apiFetch(`/telegram-tips${qs ? `?${qs}` : ""}`);
}

export const patchTelegramTip = (id: string, input: UpdateTelegramTipInput): Promise<TelegramTip> =>
  apiFetch(`/telegram-tips/${id}`, { method: "PATCH", body: JSON.stringify(input) });

export const fetchTelegramGroups = (): Promise<TelegramGroup[]> => apiFetch("/telegram-tips/groups");

export const createTelegramGroup = (input: { name: string; telegramChatId: string }): Promise<TelegramGroup> =>
  apiFetch("/telegram-tips/groups", { method: "POST", body: JSON.stringify(input) });

/** `days`: 7 | 30 | 90 | undefined (all-time) — scopes the chart/totals/breakdowns to that window. */
export const fetchTelegramBanca = (bookmaker?: string, days?: number): Promise<TelegramBancaSummary> => {
  const params = new URLSearchParams();
  if (bookmaker) params.set("bookmaker", bookmaker);
  if (days) params.set("days", String(days));
  const qs = params.toString();
  return apiFetch(`/telegram-tips/banca${qs ? `?${qs}` : ""}`);
};

export type TelegramTodaySummary = {
  pendingCount: number;
  takenTodayCount: number;
  takenTodayUnits: number;
  resultTodayUnits: number;
};

export const fetchTelegramTodaySummary = (): Promise<TelegramTodaySummary> => apiFetch("/telegram-tips/today-summary");

export const fetchTelegramSettings = (): Promise<TelegramBancaSettings> => apiFetch("/telegram-tips/settings");

export const saveTelegramSettings = (input: UpdateTelegramBancaSettingsInput): Promise<TelegramBancaSettings> =>
  apiFetch("/telegram-tips/settings", { method: "PUT", body: JSON.stringify(input) });

export const fetchBookmakerBalances = (): Promise<TelegramBookmakerBalance[]> =>
  apiFetch("/telegram-tips/bookmaker-balances");

export const fetchBookmakerNames = (): Promise<string[]> => apiFetch("/telegram-tips/bookmakers");

/** Admin only — renomeia a casa em toda tip que a referencia. */
export const renameBookmaker = (name: string, newName: string): Promise<{ renamed: number }> =>
  apiFetch(`/telegram-tips/bookmakers/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify({ name: newName }) });

/** Admin only — remove a casa de toda tip que a referencia (bookmaker vira null), nunca apaga a tip. */
export const deleteBookmaker = (name: string): Promise<{ cleared: number }> =>
  apiFetch(`/telegram-tips/bookmakers/${encodeURIComponent(name)}`, { method: "DELETE" });

/** Admin only — wipes every TelegramTip and reimports messages since
 * `sinceUnix` (unix seconds) using the worker's already-connected live
 * Telegram session. Destructive; the caller should confirm first. */
export const rebuildTelegramTips = (
  sinceUnix: number,
  untilUnix?: number,
): Promise<{ results: { group: string; messages: number; created: number; skipped: number }[] }> =>
  apiFetch("/telegram-tips/admin/rebuild", {
    method: "POST",
    body: JSON.stringify(untilUnix !== undefined ? { sinceUnix, untilUnix } : { sinceUnix }),
  });

export const saveBookmakerBalances = (rows: TelegramBookmakerBalance[]): Promise<TelegramBookmakerBalance[]> =>
  apiFetch("/telegram-tips/bookmaker-balances", { method: "PUT", body: JSON.stringify(rows) });
