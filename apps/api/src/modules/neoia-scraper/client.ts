import { TtlCache } from "./cache.js";
import { MinIntervalRateLimiter } from "./rateLimiter.js";
import { withExponentialBackoff } from "./backoff.js";
import type { NeoIaSource, NeoPrediction, NeoQuery } from "./types.js";

/** Identifiable on purpose — the user asked for a real UA, not a masqueraded browser one, out of respect for the third-party service. */
export const USER_AGENT = "EvoboBot/1.0 (+https://evobo.app; contato: suporte@evobo.app)";

export class NeoIaClient {
  private cache: TtlCache<NeoPrediction>;
  private limiter: MinIntervalRateLimiter;

  private retries: number;
  private baseDelayMs: number;

  constructor(
    private source: NeoIaSource,
    opts: {
      cacheTtlMs?: number;
      minIntervalMs?: number;
      retries?: number;
      baseDelayMs?: number;
    } = {},
  ) {
    // The free tier only gives 6 AI credits/day total — cache hard by
    // default (6h) rather than trying to be clever about freshness.
    this.cache = new TtlCache(opts.cacheTtlMs ?? 6 * 60 * 60 * 1000);
    this.limiter = new MinIntervalRateLimiter(opts.minIntervalMs ?? 10_000);
    this.retries = opts.retries ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 2000;
  }

  private cacheKey(query: NeoQuery): string {
    return `${query.homeTeam}|${query.awayTeam}|${query.market}`.toLowerCase();
  }

  async getPrediction(query: NeoQuery): Promise<NeoPrediction> {
    const key = this.cacheKey(query);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const raw = await this.limiter.schedule(() =>
      withExponentialBackoff(() => this.source.fetchPrediction(query), {
        retries: this.retries,
        baseDelayMs: this.baseDelayMs,
      }),
    );

    const prediction: NeoPrediction = { raw, fetchedAt: new Date().toISOString(), source: "neoia" };
    this.cache.set(key, prediction);
    return prediction;
  }
}
