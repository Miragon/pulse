import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { jwtWith, NOW_S, VALID_CLAIMS } from '../../test/support/bearer.js';
import { fakeRuntime, fileText } from '../../test/support/fake-runtime.js';
import { authDeps, TOKEN_DIR } from '../../test/support/oauth.js';
import type { FileSystem } from '../runtime.js';
import {
  commandCachePath,
  commandEntry,
  type CommandToken,
  isFresh,
  readCommandToken,
  writeCommandToken,
} from './command-cache.js';

const NOW = NOW_S * 1000;
const COMMAND = './token.sh dev';
const JWT = jwtWith(VALID_CLAIMS);
const ENTRY: CommandToken = { token: JWT, expiresAt: NOW + 3_600_000, fetchedAt: NOW };

function deps(scope = '/repo') {
  const runtime = fakeRuntime({ cwd: scope });
  return { runtime, deps: authDeps(runtime) };
}

describe('commandEntry', () => {
  it('takes the expiry of a JWT from its exp claim, none of an opaque token', () => {
    expect(commandEntry(JWT, NOW)).toEqual(ENTRY);
    expect(commandEntry('opaque', NOW)).toEqual({
      token: 'opaque',
      expiresAt: null,
      fetchedAt: NOW,
    });
  });
});

describe('commandCachePath', () => {
  it('is a file of the token directory named by a hash of the command and its scope', async () => {
    const { deps: d } = deps();
    const path = await commandCachePath(COMMAND, d);
    expect(path).toMatch(new RegExp(`^${TOKEN_DIR}/command-[0-9a-f]{32}\\.json$`));
    expect(await commandCachePath(COMMAND, deps('/repo').deps)).toBe(path);
    expect(await commandCachePath(COMMAND, deps('/other').deps)).not.toBe(path);
    expect(await commandCachePath('./token.sh prod', d)).not.toBe(path);
    // no separator ambiguity between the line and the scope
    expect(await commandCachePath('a', { ...d, scope: 'b c' })).not.toBe(
      await commandCachePath('a b', { ...d, scope: 'c' }),
    );
  });
});

describe('isFresh', () => {
  it('keeps a token until 60 s before exp, at most half its lifetime', () => {
    expect(isFresh(ENTRY, NOW + 3_540_000 - 1)).toBe(true);
    expect(isFresh(ENTRY, NOW + 3_540_000)).toBe(false);
    const short = { token: JWT, expiresAt: NOW + 60_000, fetchedAt: NOW };
    expect(isFresh(short, NOW + 29_999)).toBe(true);
    expect(isFresh(short, NOW + 30_000)).toBe(false);
  });

  it('keeps a token without expiry (opaque) for the whole call', () => {
    expect(isFresh({ token: 'opaque', expiresAt: null, fetchedAt: NOW }, NOW + 1e9)).toBe(true);
  });

  it('is never fresh past exp', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e7 }), fc.integer({ min: 0, max: 1e7 }), (a, b) => {
        const entry = { token: JWT, expiresAt: NOW + a, fetchedAt: NOW };
        expect(isFresh(entry, NOW + a + b)).toBe(false);
      }),
    );
  });
});

describe('writeCommandToken and readCommandToken', () => {
  it('writes a JWT with exp privately and reads it back', async () => {
    const { runtime, deps: d } = deps();
    const path = await commandCachePath(COMMAND, d);
    expect(await writeCommandToken(path, ENTRY, d)).toBe(true);
    expect(runtime.files.get(path)?.mode).toBe(0o600);
    expect(runtime.dirModes.get(TOKEN_DIR)).toBe(0o700);
    expect(JSON.parse(fileText(runtime, path) ?? '')).toEqual({ token: JWT, fetchedAt: NOW });
    expect(await readCommandToken(path, d)).toEqual(ENTRY);
  });

  it('caches no token without expiry and never throws on a failing write', async () => {
    const { runtime, deps: d } = deps();
    const path = await commandCachePath(COMMAND, d);
    const opaque = { token: 'opaque', expiresAt: null, fetchedAt: NOW };
    expect(await writeCommandToken(path, opaque, d)).toBe(false);
    expect(runtime.files.has(path)).toBe(false);
    const fs: FileSystem = { ...runtime.fs, writeFile: () => Promise.reject(new Error('EACCES')) };
    expect(await writeCommandToken(path, ENTRY, { ...d, fs })).toBe(false);
  });

  it('ignores a missing, unreadable or unusable cache file', async () => {
    const { runtime, deps: d } = deps();
    const path = await commandCachePath(COMMAND, d);
    expect(await readCommandToken(path, d)).toBeUndefined();
    const fs: FileSystem = { ...runtime.fs, readFile: () => Promise.reject(new Error('EACCES')) };
    expect(await readCommandToken(path, { ...d, fs })).toBeUndefined();
    for (const content of [
      '{',
      '[]',
      JSON.stringify({ fetchedAt: NOW }),
      JSON.stringify({ token: 7, fetchedAt: NOW }),
      JSON.stringify({ token: JWT }),
      JSON.stringify({ token: JWT, fetchedAt: 'now' }),
      JSON.stringify({ token: JWT, fetchedAt: null }),
      JSON.stringify({ token: 'not a token', fetchedAt: NOW }),
      // an opaque token or a JWT without exp would never expire
      JSON.stringify({ token: 'opaque', fetchedAt: NOW }),
      JSON.stringify({ token: jwtWith({ sub: 'x' }), fetchedAt: NOW }),
    ]) {
      runtime.files.set(path, { data: new TextEncoder().encode(content) });
      expect(await readCommandToken(path, d), content).toBeUndefined();
    }
  });
});
