type Entry<T> = { value: T; expiresAt: number };

/**
 * Plain in-memory TTL cache — fine for a single API process. If this ever
 * runs across multiple instances, swap for a Redis-backed version (ioredis
 * is already a dependency) so cache hits are shared instead of per-process.
 */
export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  get size(): number {
    return this.store.size;
  }
}
