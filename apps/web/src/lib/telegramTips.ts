import { apiFetch } from "./api";
import { TELEGRAM_TIP_MARKET_TYPES } from "@evobo/shared-types";
import type {
  TelegramTip,
  TelegramGroup,
  TelegramBancaSummary,
  TelegramBancaSettings,
  TelegramBookmakerBalance,
  UpdateTelegramTipInput,
  UpdateTelegramTipTakeInput,
  UpdateTelegramBancaSettingsInput,
} from "@evobo/shared-types";

export type { TelegramTip, TelegramGroup, TelegramBancaSummary, TelegramBancaSettings, TelegramBookmakerBalance };
export { TELEGRAM_TIP_MARKET_TYPES };

export type TelegramTipsFilter = {
  page?: number;
  limit?: number;
  groupId?: string;
  bookmaker?: string;
  marketType?: string;
  result?: string;
  takenStatus?: string;
  search?: string;
  /** "YYYY-MM-DD", inclusive on both ends — filtra por receivedAt (fuso São Paulo). */
  dateFrom?: string;
  dateTo?: string;
  /** Comma list of "odd"|"unit"|"match"|"bookmaker" — tips faltando qualquer um desses (OR). */
  missing?: string;
  /** "true" — só tips que o auto-grader do bet-analytix marcou como ambíguas. */
  needsReview?: string;
};

export type TelegramTipsPage = { data: TelegramTip[]; total: number; page: number; limit: number; totalPages: number };

export function fetchTelegramTips(filter: TelegramTipsFilter = {}): Promise<TelegramTipsPage> {
  const params = new URLSearchParams();
  if (filter.page) params.set("page", String(filter.page));
  if (filter.limit) params.set("limit", String(filter.limit));
  if (filter.groupId) params.set("groupId", filter.groupId);
  if (filter.bookmaker) params.set("bookmaker", filter.bookmaker);
  if (filter.marketType) params.set("marketType", filter.marketType);
  if (filter.result) params.set("result", filter.result);
  if (filter.takenStatus) params.set("takenStatus", filter.takenStatus);
  if (filter.search) params.set("search", filter.search);
  if (filter.dateFrom) params.set("dateFrom", filter.dateFrom);
  if (filter.dateTo) params.set("dateTo", filter.dateTo);
  if (filter.missing) params.set("missing", filter.missing);
  if (filter.needsReview) params.set("needsReview", filter.needsReview);
  const qs = params.toString();
  return apiFetch(`/telegram-tips${qs ? `?${qs}` : ""}`);
}

/** Admin only — corrige o registro oficial (odd/unidade/casa/link/mercado/jogo/resultado). */
export const patchTelegramTip = (id: string, input: UpdateTelegramTipInput): Promise<TelegramTip> =>
  apiFetch(`/telegram-tips/${id}`, { method: "PATCH", body: JSON.stringify(input) });

/** Acompanhamento pessoal — se EU peguei, com qual unidade/odd/casa. Sempre no próprio usuário. */
export const patchTelegramTipTake = (id: string, input: UpdateTelegramTipTakeInput): Promise<TelegramTip> =>
  apiFetch(`/telegram-tips/${id}/take`, { method: "PATCH", body: JSON.stringify(input) });

/** Admin only — apaga a tip de vez (nunca a foto, que outras tips do mesmo bilhete podem compartilhar). */
export const deleteTelegramTip = (id: string): Promise<{ deleted: boolean }> =>
  apiFetch(`/telegram-tips/${id}`, { method: "DELETE" });

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

export type TelegramTipsSummary = {
  pendingCount: number;
  takenCount: number;
  takenUnits: number;
  resultUnits: number;
};

/** Números dos cards do topo (Tips pendentes / Peguei / Resultado), no
 * mesmo grupo/casa/busca/período da lista — nunca leva result/takenStatus,
 * cada número já força o próprio critério (ver rota no backend). */
export function fetchTelegramTipsSummary(
  filter: Pick<TelegramTipsFilter, "groupId" | "bookmaker" | "marketType" | "search" | "dateFrom" | "dateTo" | "result" | "takenStatus"> = {},
): Promise<TelegramTipsSummary> {
  const params = new URLSearchParams();
  if (filter.groupId) params.set("groupId", filter.groupId);
  if (filter.bookmaker) params.set("bookmaker", filter.bookmaker);
  if (filter.marketType) params.set("marketType", filter.marketType);
  if (filter.search) params.set("search", filter.search);
  if (filter.dateFrom) params.set("dateFrom", filter.dateFrom);
  if (filter.dateTo) params.set("dateTo", filter.dateTo);
  if (filter.result) params.set("result", filter.result);
  if (filter.takenStatus) params.set("takenStatus", filter.takenStatus);
  const qs = params.toString();
  return apiFetch(`/telegram-tips/summary${qs ? `?${qs}` : ""}`);
}

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

/** Admin only — reenfileira OCR só pras tips que já existem mas ainda faltam
 * odd/mercado/jogo (a foto já foi baixada) — nunca apaga/recria a tip. */
export const retryMissingOcr = (): Promise<{ groupsEnqueued: number; tipsEnqueued: number }> =>
  apiFetch("/telegram-tips/admin/retry-ocr", { method: "POST" });

/** Admin only — dispara sob demanda a checagem no bet-analytix (normalmente roda sozinha às 3h). */
export const runBetAnalytixGrading = (): Promise<{ groupsChecked: number; graded: number; needsReview: number }> =>
  apiFetch("/telegram-tips/admin/grade-now", { method: "POST" });

export type BackfillResultFromEmojiGroupResult = {
  group: string;
  checked: number;
  applied: number;
  unmatched: { messageId: number; greenCount: number; redCount: number; text: string }[];
};

/** Admin only — aplica ✅✅✅/❌❌❌ retroativamente nas mensagens do Super Odds
 * já importadas antes do listener de edição existir. */
export const backfillResultFromEmoji = (): Promise<{ results: BackfillResultFromEmojiGroupResult[] }> =>
  apiFetch("/telegram-tips/admin/backfill-result-emoji", { method: "POST" });

/** Admin only — aplica retroativamente os 👍/👎 que a conta já tinha dado
 * antes do listener de reação existir, em todos os grupos. */
export const backfillReactionTake = (): Promise<{ results: { group: string; checked: number; applied: number }[] }> =>
  apiFetch("/telegram-tips/admin/backfill-reaction-take", { method: "POST" });
