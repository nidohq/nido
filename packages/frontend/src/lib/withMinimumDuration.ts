/**
 * Resolve `work`, but never sooner than `minMs`. Runs the promise and a
 * minimum-duration timer concurrently and returns the promise's value once
 * both have settled — used to hold a transient UI (the setup explainer) on
 * screen long enough to read even when the underlying work finishes fast.
 * If `work` rejects, the rejection propagates.
 *
 * `sleep` is injectable so callers (and tests) can substitute the timer.
 */
export function withMinimumDuration<T>(
  work: Promise<T>,
  minMs: number,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  return Promise.all([work, sleep(minMs)]).then(([result]) => result);
}
