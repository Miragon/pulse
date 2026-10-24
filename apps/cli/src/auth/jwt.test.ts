import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { jwtWith, VALID_CLAIMS } from '../../test/support/bearer.js';
import { decodeBase64Url, EXPIRY_SKEW_MS, isExpired, jwtClaims } from './jwt.js';

function segment(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

describe('decodeBase64Url', () => {
  it('decodes base64url without padding as UTF-8', () => {
    expect(decodeBase64Url(segment('{"a":"äß/+"}'))).toBe('{"a":"äß/+"}');
    expect(() => decodeBase64Url('_w')).toThrow();
  });
});

describe('jwtClaims', () => {
  it('reads expiry, subject, user, issuer and audience', () => {
    expect(jwtClaims(jwtWith(VALID_CLAIMS))).toEqual({
      expiresAt: VALID_CLAIMS.exp * 1000,
      subject: VALID_CLAIMS.sub,
      user: 'alice',
      issuer: VALID_CLAIMS.iss,
      audience: ['engine-rest', 'account'],
    });
  });

  it('accepts a single audience, missing claims and an unsecured JWT without signature', () => {
    const token = `${segment('{"alg":"none"}')}.${segment('{"aud":"engine-rest"}')}.`;
    expect(jwtClaims(token)).toEqual({
      expiresAt: null,
      subject: null,
      user: null,
      issuer: null,
      audience: ['engine-rest'],
    });
  });

  it('ignores claims of the wrong type and cleans the ones it shows', () => {
    const claims = jwtClaims(
      jwtWith({
        exp: '1700000000',
        sub: 42,
        preferred_username: 'al\u001b[31mice',
        iss: '',
        aud: ['a', 7, null, 'b\u0000'],
      }),
    );
    expect(claims).toEqual({
      expiresAt: null,
      subject: null,
      user: 'al[31mice',
      issuer: null,
      audience: ['a', 'b'],
    });
    const long = jwtClaims(jwtWith({ sub: 'x'.repeat(300) }))?.subject ?? '';
    expect(long).toHaveLength(201);
    expect(long.endsWith('…')).toBe(true);
  });

  it('gives no expiry for an exp beyond the dates JavaScript can show', () => {
    expect(jwtClaims(jwtWith({ exp: 1e15 }))?.expiresAt).toBeNull();
    expect(jwtClaims(jwtWith({ exp: Number.MAX_VALUE }))?.expiresAt).toBeNull();
    expect(jwtClaims(jwtWith({ exp: 8.64e12 }))?.expiresAt).toBe(8.64e15);
  });

  it.each([
    ['an opaque token', 'abc123'],
    ['two parts', `${segment('{}')}.${segment('{}')}`],
    ['five parts (JWE)', 'a.b.c.d.e'],
    ['a header that is no JSON', `${segment('nope')}.${segment('{}')}.x`],
    ['a payload that is an array', `${segment('{}')}.${segment('[1]')}.x`],
    ['a payload with base64 padding', `${segment('{}')}.${segment('{"a":1}')}=.x`],
    [
      'a payload that is not UTF-8',
      `${segment('{}')}.${Buffer.from([0xff, 0xfe]).toString('base64url')}.x`,
    ],
    ['an empty header', `.${segment('{}')}.x`],
  ])('is undefined for %s', (_name, token) => {
    expect(jwtClaims(token)).toBeUndefined();
  });

  it('reads back the exp of any JWT (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_000_000_000 }), fc.string(), (exp, sub) => {
        const claims = jwtClaims(jwtWith({ exp, sub }));
        expect(claims?.expiresAt).toBe(exp * 1000);
        const shown = sub.replace(/\p{Cc}/gu, '');
        expect(claims?.subject).toBe(
          shown === '' ? null : shown.length > 200 ? `${shown.slice(0, 200)}…` : shown,
        );
      }),
    );
  });
});

describe('isExpired', () => {
  it('allows 30 s of clock skew: expired only more than 30 s after exp', () => {
    const expiresAt = 1_700_000_000_000;
    expect(EXPIRY_SKEW_MS).toBe(30_000);
    expect(isExpired({ expiresAt }, expiresAt)).toBe(false);
    expect(isExpired({ expiresAt }, expiresAt + 30_000)).toBe(false);
    expect(isExpired({ expiresAt }, expiresAt + 30_001)).toBe(true);
    expect(isExpired({ expiresAt: null }, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('is false up to exp + 30 s and true after it, monotone in time (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_000_000_000 }),
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.nat(10_000_000),
        (exp, offset, later) => {
          const expiresAt = exp * 1000;
          const now = expiresAt + offset;
          expect(isExpired({ expiresAt }, now)).toBe(offset > EXPIRY_SKEW_MS);
          if (isExpired({ expiresAt }, now))
            expect(isExpired({ expiresAt }, now + later)).toBe(true);
        },
      ),
    );
  });

  it('agrees with the claims of a JWT at the boundary (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_000_000_000 }), (exp) => {
        const claims = jwtClaims(jwtWith({ exp }));
        expect(claims).toBeDefined();
        if (claims === undefined) return;
        expect(isExpired(claims, exp * 1000 + EXPIRY_SKEW_MS)).toBe(false);
        expect(isExpired(claims, exp * 1000 + EXPIRY_SKEW_MS + 1)).toBe(true);
      }),
    );
  });
});
