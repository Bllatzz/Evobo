import { apiFetch } from "./api";

export type StatPair = { home: number | null; away: number | null };

export type RobotSignal = {
  id: number;
  market: string;
  marketGroupKey: string;
  botNames: string[];
  highlightStat: "corners" | null;
  stakeUnits: number;
  homeTeam: string | null;
  awayTeam: string | null;
  competition: string | null;
  scoreHome: number | null;
  scoreAway: number | null;
  gameMinute: number | null;
  lastGoalMinute: number | null;
  lastCornerMinute: number | null;
  odds: string | null;
  result: "green" | "red" | "pending" | "reembolso";
  receivedAt: string;
  bet365Url: string | null;
  stats: {
    corners: StatPair | null;
    dangerousAttacks: StatPair | null;
    apMin5: StatPair | null;
    yellow: StatPair | null;
    red: StatPair | null;
    shotsOff: StatPair | null;
    shotsOn: StatPair | null;
    possession: StatPair | null;
  };
};

export const fetchRobotSignals = (): Promise<RobotSignal[]> => apiFetch("/robot-signals");

export type RobotPerformanceSummary = {
  green: number;
  red: number;
  assertPct: number;
  roiPct: number;
  units: number;
};

export const fetchRobotPerformanceSummary = (): Promise<RobotPerformanceSummary> =>
  apiFetch("/robot-signals/performance");

/** "Histórico do Robô" tab — every curated bot grouped by normalized market. */
export type RobotMarketSummary = {
  groupKey: string;
  market: string;
  botNames: string[];
  totalOps: number;
  lucroPct: number;
  assertPct: number;
  roiPct: number;
  avgOdds: number | null;
};

export const fetchRobotMarkets = (): Promise<RobotMarketSummary[]> => apiFetch("/robot-signals/markets");

export type BotOperation = {
  id: number;
  date: string;
  botName: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  competition: string | null;
  result: "green" | "red" | "reembolso";
  stakeUnits: number;
  odds: string | null;
  cumulativeProfit: number;
};

export type MarketPerformance = {
  groupKey: string;
  market: string;
  botNames: string[];
  totalOps: number;
  lucroPct: number;
  assertPct: number;
  roiPct: number;
  avgOdds: number | null;
  opsPerDay: number;
  profitPerOpPct: number;
  maxDrawdownPct: number;
  bestRun: { length: number; profitPct: number };
  worstRun: { length: number; profitPct: number };
  operations: BotOperation[];
};

export const fetchMarketPerformance = (
  groupKey: string,
  range?: { dateFrom?: string; dateTo?: string; oddsMin?: string; oddsMax?: string },
): Promise<MarketPerformance> => {
  const params = new URLSearchParams();
  if (range?.dateFrom) params.set("date_from", range.dateFrom);
  if (range?.dateTo) params.set("date_to", range.dateTo);
  if (range?.oddsMin) params.set("odds_min", range.oddsMin);
  if (range?.oddsMax) params.set("odds_max", range.oddsMax);
  const qs = params.toString();
  return apiFetch(`/robot-signals/market/${encodeURIComponent(groupKey)}${qs ? `?${qs}` : ""}`);
};
