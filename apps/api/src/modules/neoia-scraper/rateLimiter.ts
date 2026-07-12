/**
 * Serializes calls with a minimum gap between them, regardless of how many
 * callers show up concurrently — each waits its turn rather than firing at
 * once. This is the "don't hammer a third-party service" half of the
 * requirement; the cache in front of it is what keeps this limiter from
 * being hit at all for repeat queries.
 */
export class MinIntervalRateLimiter {
  private lastRun = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private minIntervalMs: number) {}

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    const runAfterPrevious = this.queue;
    let release!: () => void;
    this.queue = new Promise((resolve) => {
      release = resolve;
    });

    await runAfterPrevious;
    const wait = Math.max(0, this.lastRun + this.minIntervalMs - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRun = Date.now();

    try {
      return await fn();
    } finally {
      release();
    }
  }
}
