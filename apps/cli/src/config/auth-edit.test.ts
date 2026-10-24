import { describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import {
  changedAuth,
  replacedAuthorization,
  settleAuthorization,
  usesBasicAuth,
} from './auth-edit.js';
import type { Profile, ProfileAuth } from './types.js';

function failure(action: () => unknown): OperateError {
  try {
    action();
  } catch (error) {
    if (error instanceof OperateError) return error;
    throw error;
  }
  throw new Error('expected an OperateError');
}

const STORED: ProfileAuth = { type: 'basic', username: 'demo', passwordEnv: 'OLD_PW' };

describe('changedAuth', () => {
  it('changes nothing without an auth option', () => {
    expect(changedAuth(STORED, {})).toBeUndefined();
    expect(changedAuth(undefined, {})).toBeUndefined();
  });

  it('creates the auth object from the given values, in canonical key order', () => {
    const auth = changedAuth(undefined, {
      authPasswordEnv: ' CAMUNDA_PASSWORD ',
      authUser: ' demo ',
      auth: 'basic',
    });
    expect(auth).toEqual({ type: 'basic', username: 'demo', passwordEnv: 'CAMUNDA_PASSWORD' });
    expect(Object.keys(auth ?? {})).toEqual(['type', 'username', 'passwordEnv']);
    expect(changedAuth(undefined, { auth: ' none ' })).toEqual({ type: 'none' });
    expect(changedAuth(undefined, { authUser: 'demo' })).toEqual({ username: 'demo' });
  });

  it('changes only the given values', () => {
    expect(changedAuth(STORED, { authUser: 'other' })).toEqual({ ...STORED, username: 'other' });
    expect(changedAuth(STORED, { auth: 'none' })).toEqual({ ...STORED, type: 'none' });
  });

  it('replaces a passwordEnv by a password and the other way round', () => {
    expect(changedAuth(STORED, { authPassword: ' s3cr:t ' })).toEqual({
      type: 'basic',
      username: 'demo',
      password: ' s3cr:t ',
    });
    expect(changedAuth({ username: 'demo', password: 'x' }, { authPasswordEnv: 'PW' })).toEqual({
      username: 'demo',
      passwordEnv: 'PW',
    });
    expect(changedAuth({ username: 'demo', password: 'x' }, { authUser: 'u' })).toEqual({
      username: 'u',
      password: 'x',
    });
  });

  it('switches a profile stored with type none to basic when credentials are given', () => {
    const none: ProfileAuth = { type: 'none' };
    expect(changedAuth(none, { authUser: 'demo' })).toEqual({ type: 'basic', username: 'demo' });
    expect(changedAuth(none, { authPasswordEnv: 'PW' })).toEqual({
      type: 'basic',
      passwordEnv: 'PW',
    });
    expect(changedAuth(none, { auth: 'none', authUser: 'demo' })).toEqual({
      type: 'none',
      username: 'demo',
    });
  });

  it('refuses --auth-password-env together with --auth-password-stdin', () => {
    const error = failure(() =>
      changedAuth(undefined, { authPasswordEnv: 'PW', authPassword: 'secret-1' }),
    );
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe('--auth-password-env and --auth-password-stdin exclude each other');
    expect(error.details.hint).toBe(
      'Store the name of the environment variable that holds the password (recommended), or the password itself.',
    );
  });

  it.each([
    [{ auth: 'digest' }, 'Unsupported auth type "digest"'],
    [{ authUser: 'a:b' }, 'The username (from --auth-user) must not contain ":"'],
    [{ authUser: ' ' }, 'The username (from --auth-user) must not be empty'],
    [
      { authPasswordEnv: 'MY-PW' },
      'Invalid --auth-password-env: expected the name of an environment variable',
    ],
    [
      { authPassword: 'a\nb' },
      'The password (from --auth-password-stdin) must not contain control characters (line breaks, NUL, tab, ...)',
    ],
  ])('validates %j', (changes, message) => {
    const error = failure(() => changedAuth(STORED, changes));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe(message);
  });

  it('does not modify the stored object', () => {
    const stored = Object.freeze({ ...STORED });
    changedAuth(stored, { authPassword: 'x', authUser: 'y', auth: 'none' });
    expect(stored).toEqual(STORED);
  });
});

describe('usesBasicAuth', () => {
  it('is true for type basic, or a username without a type', () => {
    expect(usesBasicAuth({ type: 'basic' })).toBe(true);
    expect(usesBasicAuth({ username: 'demo' })).toBe(true);
    expect(usesBasicAuth({ type: 'none', username: 'demo' })).toBe(false);
    expect(usesBasicAuth({ passwordEnv: 'PW' })).toBe(false);
    expect(usesBasicAuth({})).toBe(false);
    expect(usesBasicAuth(undefined)).toBe(false);
  });
});

describe('settleAuthorization', () => {
  const basic: Profile = {
    url: 'http://x',
    auth: { username: 'demo', passwordEnv: 'PW' },
    headers: { AUTHORIZATION: 'Basic eDp5', 'X-Tenant': 'a' },
  };
  const message = 'Profile "p" would have both Basic auth and an Authorization header';

  it('keeps profiles without the conflict unchanged', () => {
    const header: Profile = { headers: { Authorization: 'Bearer t' } };
    expect(settleAuthorization(header, { headers: ['Authorization: Bearer t'] }, 'p')).toBe(header);
    const off: Profile = { ...basic, auth: { ...basic.auth, type: 'none' } };
    expect(settleAuthorization(off, { auth: 'none' }, 'p')).toBe(off);
    const plain: Profile = { auth: { type: 'basic' }, headers: { 'X-Tenant': 'a' } };
    expect(settleAuthorization(plain, { headers: ['X-Tenant: a'] }, 'p')).toBe(plain);
  });

  it('lets given auth options replace a stored Authorization header', () => {
    for (const changes of [
      { auth: 'basic' },
      { authUser: 'demo' },
      { authPasswordEnv: 'PW' },
      { authPassword: 'pw', headers: ['X-Other: b'] },
    ]) {
      expect(settleAuthorization(basic, changes, 'p')).toEqual({
        url: 'http://x',
        auth: basic.auth,
        headers: { 'X-Tenant': 'a' },
      });
    }
    const only: Profile = { auth: { type: 'basic' }, headers: { authorization: 'x' } };
    expect(settleAuthorization(only, { auth: 'basic' }, 'p')).toEqual({ auth: { type: 'basic' } });
  });

  it('refuses an Authorization header with Basic auth, given or stored', () => {
    for (const changes of [
      { headers: [' authorization : Bearer t'] },
      { authUser: 'demo', headers: ['Authorization: Bearer t'] },
      { auth: 'basic', headers: ['X-Tenant: b', ' Authorization : Bearer t'] },
      {},
      { headers: ['X-Tenant: b'] },
    ]) {
      const error = failure(() => settleAuthorization(basic, changes, 'p'));
      expect(error.code).toBe('CONFIG');
      expect(error.message).toBe(message);
      expect(error.details.hint).toBe(
        "Keep one: Basic auth options replace a stored Authorization header (`operate config set p --auth basic`); --auth none switches Basic auth off and keeps the header (`operate config set p --auth none -H 'Authorization: ...'`).",
      );
    }
  });
});

describe('replacedAuthorization', () => {
  it('is true only when the Authorization header is gone', () => {
    const header: Profile = { headers: { authorization: 'x' } };
    expect(replacedAuthorization(header, {})).toBe(true);
    expect(replacedAuthorization(header, undefined)).toBe(true);
    expect(replacedAuthorization(header, header)).toBe(false);
    expect(replacedAuthorization({}, {})).toBe(false);
    expect(replacedAuthorization(undefined, header)).toBe(false);
  });
});
