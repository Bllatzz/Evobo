import { prisma } from "../../db/prisma.js";

export type TipsterPerformance = {
  authorId: string;
  tipsCount: number;
  greenCount: number;
  redCount: number;
  roi: number;
  hitRate: number;
};

type Row = {
  authorId: string;
  tipsCount: bigint;
  greenCount: bigint;
  redCount: bigint;
  profit: number;
  staked: number;
};

/**
 * ROI/hit-rate over the last 30 days, computed at request time rather than
 * via a materialized view (the DB schema plan mentioned one, but with
 * current volume a plain aggregate query is simpler to keep correct and
 * needs no refresh job). Void tips are excluded from both profit and the
 * staked denominator. No settlement flow exists yet, so every value is
 * legitimately 0 until tips actually get marked green/red — not faked.
 */
export async function getTipsterPerformance(): Promise<Map<string, TipsterPerformance>> {
  const rows = await prisma.$queryRaw<Row[]>`
    select
      author_id as "authorId",
      count(*) as "tipsCount",
      count(*) filter (where status = 'green') as "greenCount",
      count(*) filter (where status = 'red') as "redCount",
      coalesce(sum(case
        when status = 'green' then stake_units * (odds - 1)
        when status = 'red' then -stake_units
        else 0
      end), 0)::float8 as profit,
      coalesce(sum(case when status in ('green', 'red') then stake_units else 0 end), 0)::float8 as staked
    from tips
    where created_at > now() - interval '30 days'
    group by author_id
  `;

  const map = new Map<string, TipsterPerformance>();
  for (const row of rows) {
    const tipsCount = Number(row.tipsCount);
    const greenCount = Number(row.greenCount);
    const redCount = Number(row.redCount);
    const decided = greenCount + redCount;
    map.set(row.authorId, {
      authorId: row.authorId,
      tipsCount,
      greenCount,
      redCount,
      roi: row.staked > 0 ? (row.profit / row.staked) * 100 : 0,
      hitRate: decided > 0 ? (greenCount / decided) * 100 : 0,
    });
  }
  return map;
}

const EMPTY: TipsterPerformance = {
  authorId: "",
  tipsCount: 0,
  greenCount: 0,
  redCount: 0,
  roi: 0,
  hitRate: 0,
};

export async function getTipsterPerformanceFor(authorId: string): Promise<TipsterPerformance> {
  const all = await getTipsterPerformance();
  return all.get(authorId) ?? { ...EMPTY, authorId };
}
