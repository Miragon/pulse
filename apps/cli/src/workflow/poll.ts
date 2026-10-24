/**
 * The polling loop of `wait` and `--wait` (design §17.2.6): a check right away, then after
 * sleeps of 250, 500, 1000, 2000, 2000, ... ms; the last sleep ends at the deadline, where a
 * final check runs. Pure: the clock and the sleep are injected.
 */

export interface PollTiming {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly timeoutMs: number;
  /** Called once, before the first sleep (the wait really waits). */
  readonly waiting?: () => void;
}

export interface PollResult<T> {
  /** The value of the check that ended the loop; undefined after the deadline. */
  readonly value?: T;
  readonly polls: number;
  readonly elapsedMs: number;
}

const FIRST_DELAY_MS = 250;
const MAX_DELAY_MS = 2000;

/**
 * Runs `check` until it returns a value or the deadline passed. `check` gets the number of the
 * poll (1 for the first).
 */
export async function poll<T>(
  check: (polls: number) => Promise<T | undefined>,
  timing: PollTiming,
): Promise<PollResult<T>> {
  const started = timing.now();
  const deadline = started + timing.timeoutMs;
  let delay = FIRST_DELAY_MS;
  for (let polls = 1; ; polls++) {
    const value = await check(polls);
    const now = timing.now();
    if (value !== undefined) return { value, polls, elapsedMs: now - started };
    if (now >= deadline) return { polls, elapsedMs: now - started };
    if (polls === 1) timing.waiting?.();
    await timing.sleep(Math.min(delay, deadline - now));
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }
}
