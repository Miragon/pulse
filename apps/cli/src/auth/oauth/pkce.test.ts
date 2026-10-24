import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { base64Url, challengeOf, createPkce, sha256 } from './pkce.js';

const VERIFIER = /^[A-Za-z0-9\-._~]{43}$/;

function decode(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64url'));
}

describe('base64Url', () => {
  it('encodes without padding and with the URL alphabet', () => {
    expect(base64Url(Uint8Array.of())).toBe('');
    expect(base64Url(Uint8Array.of(0xfb, 0xff))).toBe('-_8');
    expect(base64Url(Uint8Array.of(0x66))).toBe('Zg');
    expect(base64Url(Uint8Array.of(0x66, 0x6f))).toBe('Zm8');
    expect(base64Url(Uint8Array.of(0x66, 0x6f, 0x6f))).toBe('Zm9v');
  });

  it('equals Node base64url for any bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 100 }), (bytes) => {
        expect(base64Url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
      }),
    );
  });
});

describe('PKCE (RFC 7636)', () => {
  it('computes the S256 challenge of the test vector of Appendix B', async () => {
    const bytes = Uint8Array.of(
      116,
      24,
      223,
      180,
      151,
      153,
      224,
      37,
      79,
      250,
      96,
      125,
      216,
      173,
      187,
      186,
      22,
      212,
      37,
      77,
      105,
      214,
      191,
      240,
      91,
      88,
      5,
      88,
      83,
      132,
      141,
      121,
    );
    const verifier = base64Url(bytes);
    expect(verifier).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    await expect(challengeOf(verifier)).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('makes a 43 character verifier of any 32 bytes, and its SHA-256 challenge', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 32 }), async (bytes) => {
        const verifier = base64Url(bytes);
        expect(verifier).toMatch(VERIFIER);
        expect(decode(verifier)).toEqual(bytes);
        const challenge = await challengeOf(verifier);
        expect(challenge).toBe(createHash('sha256').update(verifier, 'ascii').digest('base64url'));
        expect(challenge).toHaveLength(43);
        expect(challenge).not.toMatch(/[+/=]/);
      }),
      { numRuns: 50 },
    );
  });

  it('maps different bytes to different verifiers', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        (left, right) => {
          fc.pre(Buffer.compare(left, right) !== 0);
          expect(base64Url(left)).not.toBe(base64Url(right));
        },
      ),
    );
  });

  it('hashes UTF-8 text with SHA-256', async () => {
    expect(Buffer.from(await sha256('abc')).toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('createPkce', () => {
  it('takes two separate 32 byte random values for the verifier and the state', async () => {
    const requests: number[] = [];
    const values = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
    const pkce = await createPkce((length) => {
      requests.push(length);
      return values[requests.length - 1] ?? new Uint8Array(length);
    });
    expect(requests).toEqual([32, 32]);
    expect(pkce.verifier).toBe(base64Url(values[0]!));
    expect(pkce.state).toBe(base64Url(values[1]!));
    expect(pkce.state).not.toBe(pkce.verifier);
    expect(pkce.challenge).toBe(await challengeOf(pkce.verifier));
  });

  it('gives different states for different random values (injective)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        async (first, second) => {
          fc.pre(Buffer.compare(first, second) !== 0);
          const pkce = await createPkce(
            (() => {
              const queue = [first, second];
              return () => queue.shift() ?? new Uint8Array(32);
            })(),
          );
          expect(pkce.verifier).toMatch(VERIFIER);
          expect(pkce.state).toMatch(VERIFIER);
          expect(pkce.state).not.toBe(pkce.verifier);
        },
      ),
      { numRuns: 25 },
    );
  });
});
