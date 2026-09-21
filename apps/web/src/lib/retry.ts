/**
 * Runs `fn`, retrying while it fails with a *transient* error.
 *
 * `delaysMs` is the wait before each retry (so `[1000, 2000]` = up to 3
 * attempts). An error that isn't transient (per `isTransient`) is thrown at
 * once, and so is the last error when the retries run out. `shouldStop` is
 * checked before every retry so a caller that was cancelled (an unmounted
 * effect) stops waiting instead of firing more requests.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  isTransient: (error: unknown) => boolean,
  delaysMs: readonly number[],
  shouldStop: () => boolean = () => false,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const delay = delaysMs[attempt];
      if (delay === undefined || !isTransient(error) || shouldStop()) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (shouldStop()) throw error;
    }
  }
}
