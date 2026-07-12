import { describe, expect, it, vi } from "vitest";
import { NeoIaClient } from "../client.js";
import { TtlCache } from "../cache.js";
import { MinIntervalRateLimiter } from "../rateLimiter.js";
import { withExponentialBackoff } from "../backoff.js";
import type { NeoIaSource, NeoQuery } from "../types.js";

const QUERY: NeoQuery = { homeTeam: "Palmeiras", awayTeam: "Flamengo", market: "Over 2.5" };

describe("TtlCache", () => {
  it("returns a stored value before it expires", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("k", "v");
    expect(cache.get("k")).toBe("v");
  });

  it("expires entries after the TTL", async () => {
    const cache = new TtlCache<string>(10);
    cache.set("k", "v");
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.get("k")).toBeUndefined();
  });
});

describe("MinIntervalRateLimiter", () => {
  it("serializes concurrent calls with at least the configured gap between starts", async () => {
    const limiter = new MinIntervalRateLimiter(50);
    const starts: number[] = [];
    const task = () =>
      limiter.schedule(async () => {
        starts.push(Date.now());
      });

    await Promise.all([task(), task(), task()]);

    expect(starts).toHaveLength(3);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(45);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(45);
  });
});

describe("withExponentialBackoff", () => {
  it("returns the result immediately on success, no retries", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withExponentialBackoff(fn, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and eventually succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValueOnce("ok");

    const result = await withExponentialBackoff(fn, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error once retries are exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(withExponentialBackoff(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow(
      "always fails",
    );
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

describe("NeoIaClient", () => {
  function fakeSource(): { source: NeoIaSource; calls: NeoQuery[] } {
    const calls: NeoQuery[] = [];
    return {
      calls,
      source: {
        async fetchPrediction(query) {
          calls.push(query);
          return `prediction for ${query.homeTeam} x ${query.awayTeam}`;
        },
      },
    };
  }

  it("calls the source once and returns a prediction", async () => {
    const { source, calls } = fakeSource();
    const client = new NeoIaClient(source, { cacheTtlMs: 60_000, minIntervalMs: 1 });

    const result = await client.getPrediction(QUERY);

    expect(calls).toHaveLength(1);
    expect(result.raw).toContain("Palmeiras");
    expect(result.source).toBe("neoia");
  });

  it("serves repeat queries from cache without calling the source again — this is what protects the 6 credits/day quota", async () => {
    const { source, calls } = fakeSource();
    const client = new NeoIaClient(source, { cacheTtlMs: 60_000, minIntervalMs: 1 });

    const first = await client.getPrediction(QUERY);
    const second = await client.getPrediction(QUERY);

    expect(calls).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("treats different queries as separate cache entries", async () => {
    const { source, calls } = fakeSource();
    const client = new NeoIaClient(source, { cacheTtlMs: 60_000, minIntervalMs: 1 });

    await client.getPrediction(QUERY);
    await client.getPrediction({ ...QUERY, market: "Under 2.5" });

    expect(calls).toHaveLength(2);
  });

  it("propagates a source failure to the caller after retries are exhausted", async () => {
    const source: NeoIaSource = {
      fetchPrediction: vi.fn().mockRejectedValue(new Error("neo unreachable")),
    };
    const client = new NeoIaClient(source, {
      cacheTtlMs: 60_000,
      minIntervalMs: 1,
      retries: 3,
      baseDelayMs: 1,
    });

    await expect(client.getPrediction(QUERY)).rejects.toThrow("neo unreachable");
    expect(source.fetchPrediction).toHaveBeenCalledTimes(4); // initial + 3 retries

  });
});
