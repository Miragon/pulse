import { describe, expect, it } from 'vitest';
import { cachedLogin, oauthConfig, TOKEN_FILE } from '../../../test/support/oauth.js';
import { loginView, viewRows } from './auth-view.js';

const T0 = 1_700_000_000_000;
const USE = { tokenCache: TOKEN_FILE, profiles: ['p', 'billing'] };

describe('loginView', () => {
  it('shows who is logged in, for what and until when, never a token', () => {
    const view = loginView(
      cachedLogin(T0, { refreshedAt: T0 + 1000, scope: 'openid  profile' }),
      oauthConfig(),
      USE,
      T0 + 2000,
    );
    expect(view).toEqual({
      profile: 'p',
      profiles: ['p', 'billing'],
      issuer: 'https://login.example.com/realms/camunda',
      clientId: 'operate-cli',
      user: 'alice',
      subject: 'user-1',
      scopes: ['openid', 'profile'],
      accessTokenExpiresAt: '2023-11-14T22:18:20.000Z',
      accessTokenValid: true,
      refreshTokenExpiresAt: '2023-11-14T22:43:20.000Z',
      canRefresh: true,
      loggedInAt: '2023-11-14T22:13:20.000Z',
      refreshedAt: '2023-11-14T22:13:21.000Z',
      tokenCache: TOKEN_FILE,
    });
    expect(JSON.stringify(view)).not.toContain('cached-access');
    expect(JSON.stringify(view)).not.toContain('cached-refresh');
  });

  it('falls back to the requested scopes and reports unknown and missing values as null', () => {
    const login = cachedLogin(T0, {
      scope: null,
      expiresAt: null,
      refreshToken: null,
      user: null,
      subject: null,
    });
    const view = loginView(
      login,
      oauthConfig({ issuer: undefined, profile: undefined }),
      { tokenCache: TOKEN_FILE, profiles: [] },
      T0,
    );
    expect(view).toMatchObject({
      profile: null,
      profiles: [],
      issuer: null,
      user: null,
      subject: null,
      scopes: ['openid', 'offline_access'],
      accessTokenExpiresAt: null,
      accessTokenValid: true,
      refreshTokenExpiresAt: null,
      canRefresh: false,
      refreshedAt: null,
    });
    expect(
      loginView(cachedLogin(T0, { refreshExpiresAt: null }), oauthConfig(), USE, T0)
        .refreshTokenExpiresAt,
    ).toBeNull();
  });

  it('reports an expired access token', () => {
    expect(loginView(cachedLogin(T0), oauthConfig(), USE, T0 + 300_000).accessTokenValid).toBe(
      false,
    );
  });
});

describe('viewRows', () => {
  it('joins lists with spaces and shows null as empty', () => {
    expect(viewRows({ profile: null, tokenCache: '/t', removed: true, revoked: null })).toEqual([
      { KEY: 'profile', VALUE: '' },
      { KEY: 'tokenCache', VALUE: '/t' },
      { KEY: 'removed', VALUE: true },
      { KEY: 'revoked', VALUE: '' },
    ]);
    const rows = viewRows(loginView(cachedLogin(T0), oauthConfig(), USE, T0));
    expect(rows.find((row) => row.KEY === 'scopes')?.VALUE).toBe('openid offline_access');
    expect(rows.find((row) => row.KEY === 'profiles')?.VALUE).toBe('p billing');
  });
});
