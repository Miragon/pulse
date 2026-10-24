import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canRefresh,
  expiryOf,
  isExpired,
  needsRefresh,
  receivedAt,
  REFRESH_MARGIN_MS,
  refreshMargin,
} from './expiry.js';

const T0 = 1_700_000_000_000;

function login(lifetimeSeconds: number, refreshedAt: number | null = null) {
  const received = refreshedAt ?? T0;
  return { expiresAt: received + lifetimeSeconds * 1000, loggedInAt: T0, refreshedAt };
}

describe('expiryOf', () => {
  it('adds expires_in seconds to the receipt time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: T0 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        (at, seconds) => {
          expect(expiryOf(at, seconds)).toBe(at + seconds * 1000);
        },
      ),
    );
    expect(expiryOf(T0, 0.5)).toBe(T0 + 500);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined])(
    'is unknown for %s',
    (seconds) => {
      expect(expiryOf(T0, seconds)).toBeNull();
    },
  );
});

describe('receivedAt', () => {
  it('is the last refresh, else the login', () => {
    expect(receivedAt({ loggedInAt: 1, refreshedAt: null })).toBe(1);
    expect(receivedAt({ loggedInAt: 1, refreshedAt: 5 })).toBe(5);
    expect(receivedAt({ loggedInAt: 1, refreshedAt: 0 })).toBe(0);
  });
});

describe('refreshMargin', () => {
  it('is 60 s, at most half the lifetime, never negative', () => {
    expect(REFRESH_MARGIN_MS).toBe(60_000);
    expect(refreshMargin(T0 + 300_000, T0)).toBe(60_000);
    expect(refreshMargin(T0 + 120_000, T0)).toBe(60_000);
    expect(refreshMargin(T0 + 60_000, T0)).toBe(30_000);
    expect(refreshMargin(T0 + 5_000, T0)).toBe(2_500);
    expect(refreshMargin(T0, T0)).toBe(0);
    expect(refreshMargin(T0 - 1_000, T0)).toBe(0);
  });
});

describe('needsRefresh', () => {
  it.each([
    [300, 239_999, 240_000],
    [60, 29_999, 30_000],
    [5, 2_499, 2_500],
  ])('a %i s token: false at +%i ms, true from +%i ms', (lifetime, before, from) => {
    expect(needsRefresh(T0 + before, login(lifetime))).toBe(false);
    expect(needsRefresh(T0 + from, login(lifetime))).toBe(true);
    expect(needsRefresh(T0 + from + 1, login(lifetime))).toBe(true);
  });

  it('measures the lifetime from the last refresh', () => {
    const refreshed = login(60, T0 + 1_000_000);
    expect(needsRefresh(T0 + 1_029_999, refreshed)).toBe(false);
    expect(needsRefresh(T0 + 1_030_000, refreshed)).toBe(true);
  });

  it('never for an unknown expiry', () => {
    expect(
      needsRefresh(Number.MAX_SAFE_INTEGER, { expiresAt: null, loggedInAt: T0, refreshedAt: null }),
    ).toBe(false);
  });

  it('is false the moment a token arrives and monotone in time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (lifetime, first, step) => {
          const value = login(lifetime);
          expect(needsRefresh(T0, value)).toBe(false);
          if (needsRefresh(T0 + first, value)) {
            expect(needsRefresh(T0 + first + step, value)).toBe(true);
          }
        },
      ),
    );
  });

  it('refreshes no earlier than half the lifetime and no later than 60 s before expiry', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (lifetime) => {
        const value = login(lifetime);
        const threshold = T0 + lifetime * 1000 - Math.min(60_000, (lifetime * 1000) / 2);
        expect(needsRefresh(Math.ceil(threshold) - 1, value)).toBe(false);
        expect(needsRefresh(Math.ceil(threshold), value)).toBe(true);
      }),
    );
  });
});

describe('isExpired', () => {
  it('is true from the expiry on, never for null', () => {
    expect(isExpired(T0 - 1, T0)).toBe(false);
    expect(isExpired(T0, T0)).toBe(true);
    expect(isExpired(T0 + 1, T0)).toBe(true);
    expect(isExpired(T0, null)).toBe(false);
  });
});

describe('canRefresh', () => {
  it('needs a refresh token that is not known to be expired', () => {
    expect(canRefresh({ refreshToken: 'r', refreshExpiresAt: null }, T0)).toBe(true);
    expect(canRefresh({ refreshToken: 'r', refreshExpiresAt: T0 + 1 }, T0)).toBe(true);
    expect(canRefresh({ refreshToken: 'r', refreshExpiresAt: T0 }, T0)).toBe(false);
    expect(canRefresh({ refreshToken: null, refreshExpiresAt: null }, T0)).toBe(false);
  });
});
