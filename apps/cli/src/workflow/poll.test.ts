import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fakeClock } from '../../test/support/engine-port.js';
import { poll } from './poll.js';

describe('poll', () => {
  it('checks at once, then after 250, 500, 1000, 2000, 2000 ms, and a final check at the deadline', async () => {
    const clock = fakeClock(0);
    const checks: number[] = [];
    const result = await poll(
      () => {
        checks.push(clock.now());
        return Promise.resolve(undefined);
      },
      { ...clock, timeoutMs: 7000 },
    );
    expect(checks).toEqual([0, 250, 750, 1750, 3750, 5750, 7000]);
    expect(clock.sleeps).toEqual([250, 500, 1000, 2000, 2000, 1250]);
    expect(result).toEqual({ polls: 7, elapsedMs: 7000 });
  });

  it('calls `waiting` once before the first sleep, and not when the first check decides', async () => {
    const clock = fakeClock(0);
    let waiting = 0;
    await poll((polls) => Promise.resolve(polls === 4 ? 'done' : undefined), {
      ...clock,
      timeoutMs: 60_000,
      waiting: () => {
        waiting += 1;
      },
    });
    expect(waiting).toBe(1);
    await poll(() => Promise.resolve('at once'), {
      ...clock,
      timeoutMs: 60_000,
      waiting: () => {
        waiting += 1;
      },
    });
    expect(waiting).toBe(1);
  });

  it('returns the first value with the number of polls', async () => {
    const clock = fakeClock(0);
    const result = await poll((polls) => Promise.resolve(polls === 3 ? 'done' : undefined), {
      ...clock,
      timeoutMs: 60_000,
    });
    expect(result).toEqual({ value: 'done', polls: 3, elapsedMs: 750 });
  });

  it('never sleeps past the deadline and polls at most 2 + timeout / 250 times (property)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 120_000 }), async (timeoutMs) => {
        const clock = fakeClock(0);
        const result = await poll(() => Promise.resolve(undefined), { ...clock, timeoutMs });
        expect(clock.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(timeoutMs);
        expect(result.polls).toBeLessThanOrEqual(2 + timeoutMs / 250);
        expect(Math.max(...clock.sleeps)).toBeLessThanOrEqual(2000);
      }),
    );
  });
});
