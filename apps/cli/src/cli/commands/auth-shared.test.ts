import { describe, expect, it } from 'vitest';
import { ISSUER } from '../../../test/support/fake-idp.js';
import { loginFile, loginKey, TOKEN_DIR } from '../../../test/support/oauth.js';
import type { LoadedConfig } from '../../config/types.js';
import { sharedLoginLines, sharedLogoutNote, sharingProfiles, storedLogin } from './auth-shared.js';

const AUTH = { type: 'oauth', issuer: ISSUER, clientId: 'operate-cli' } as const;
const FILE: LoadedConfig = {
  origin: loginKey().origin,
  profiles: {
    orders: { url: 'http://localhost:8112/engine-rest', auth: AUTH },
    billing: { auth: AUTH },
    basic: { auth: { type: 'basic', username: 'u' } },
  },
};

describe('sharingProfiles', () => {
  it('lists the profiles of the login in file order, the selected one first when OAuth came from the environment', () => {
    expect(sharingProfiles(FILE, loginKey(), 'billing')).toEqual(['orders', 'billing']);
    const basic = loginKey({ issuer: null, clientId: null });
    expect(sharingProfiles(FILE, basic, 'basic')).toEqual(['basic']);
    expect(sharingProfiles(FILE, undefined, 'orders')).toEqual([]);
    expect(sharingProfiles(FILE, loginKey(), undefined)).toEqual([]);
  });
});

describe('sharedLoginLines', () => {
  it('lists the other profiles with their URLs, the default URL for one without', () => {
    expect(sharedLoginLines(FILE, ['orders', 'billing'], 'orders')).toEqual([
      'The login also serves another profile with the same issuer, client, audience and scopes:',
      '  billing  http://localhost:8080/engine-rest',
    ]);
    expect(sharedLoginLines(FILE, ['orders', 'billing', 'x'], 'x')).toEqual([
      'The login also serves 2 other profiles with the same issuer, client, audience and scopes:',
      '  orders   http://localhost:8112/engine-rest',
      '  billing  http://localhost:8080/engine-rest',
    ]);
    expect(sharedLoginLines(FILE, ['orders'], 'orders')).toEqual([]);
    expect(sharedLoginLines(FILE, [], undefined)).toEqual([]);
  });
});

describe('sharedLogoutNote', () => {
  it('names the other profiles that lose the login', () => {
    expect(sharedLogoutNote(['a', 'b'], 'a')).toBe(
      'Note: the login was shared; profile "b" needs a new login, too.',
    );
    expect(sharedLogoutNote(['a', 'b', 'c'], 'c')).toBe(
      'Note: the login was shared; profiles "a" and "b" need a new login, too.',
    );
    expect(sharedLogoutNote(['a', 'b', 'c', 'd'], 'a')).toBe(
      'Note: the login was shared; profiles "b", "c" and "d" need a new login, too.',
    );
    expect(sharedLogoutNote(['a'], 'a')).toBeUndefined();
    expect(sharedLogoutNote([], undefined)).toBeUndefined();
  });
});

describe('storedLogin', () => {
  const deps = { tokenPath: (fileName: string) => `${TOKEN_DIR}/${fileName}` };

  it('finds the login of the stored settings and the profiles that share it', async () => {
    const selected = { name: 'billing', profile: { auth: AUTH }, origin: loginKey().origin };
    await expect(storedLogin(FILE, selected, deps)).resolves.toEqual({
      tokenCache: loginFile(),
      profiles: ['orders', 'billing'],
    });
  });

  it('keys a profile of no known origin on the empty origin, never on that of another file', async () => {
    const selected = { name: 'billing', profile: { auth: AUTH } };
    await expect(storedLogin(FILE, selected, deps)).resolves.toEqual({
      tokenCache: loginFile(loginKey({ origin: '' })),
      profiles: ['billing'],
    });
  });
});
