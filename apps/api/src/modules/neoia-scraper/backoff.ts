export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 1000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      const jitter = Math.random() * 200;
      await new Promise((r) => setTimeout(r, base * 2 ** attempt + jitter));
    }
  }
  throw lastError;
}
