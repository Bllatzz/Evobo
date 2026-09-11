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
  const qs = params.toString();
  return apiFetch(`/telegram-tips${qs ? `?${qs}` : ""}`);
}

export const patchTelegramTip = (id: string, input: UpdateTelegramTipInput): Promise<TelegramTip> =>
  apiFetch(`/telegram-tips/${id}`, { method: "PATCH", body: JSON.stringify(input) });

export const fetchTelegramGroups = (): Promise<TelegramGroup[]> => apiFetch("/telegram-tips/groups");

export const createTelegramGroup = (input: { name: string; telegramChatId: string }): Promise<TelegramGroup> =>
  apiFetch("/telegram-tips/groups", { method: "POST", body: JSON.stringify(input) });

export const fetchTelegramBanca = (): Promise<TelegramBancaSummary> => apiFetch("/telegram-tips/banca");

export const fetchTelegramSettings = (): Promise<TelegramBancaSettings> => apiFetch("/telegram-tips/settings");

export const saveTelegramSettings = (input: UpdateTelegramBancaSettingsInput): Promise<TelegramBancaSettings> =>
  apiFetch("/telegram-tips/settings", { method: "PUT", body: JSON.stringify(input) });

export const fetchBookmakerBalances = (): Promise<TelegramBookmakerBalance[]> =>
  apiFetch("/telegram-tips/bookmaker-balances");

export const fetchBookmakerNames = (): Promise<string[]> => apiFetch("/telegram-tips/bookmakers");

export const saveBookmakerBalances = (rows: TelegramBookmakerBalance[]): Promise<TelegramBookmakerBalance[]> =>
  apiFetch("/telegram-tips/bookmaker-balances", { method: "PUT", body: JSON.stringify(rows) });
