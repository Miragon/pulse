import { describe, expect, it } from 'vitest';
import { connectionRefused } from '../../../test/support/fake-fetch.js';
import { fakeIdp, type FakeIdpOptions } from '../../../test/support/fake-idp.js';
import { fakeRuntime } from '../../../test/support/fake-runtime.js';
import {
  cachedLogin,
  cacheText,
  oauthConfig,
  oauthDeps,
  REVOCATION_ENDPOINT,
  TOKEN_ENDPOINT,
  TOKEN_FILE,
} from '../../../test/support/oauth.js';
import { logout, type LogoutTarget } from './logout.js';
import type { CachedLogin, LoginClientAuth } from './types.js';

const T0 = 1_700_000_000_000;
const SOURCE = 'auth.issuer of profile "p"';
const TARGET: LogoutTarget = { profile: 'p', source: SOURCE, settings: oauthConfig() };
const SECRET = 'secret-of-this-client';
const CONFIDENTIAL = { clients: { 'operate-cli': { secret: SECRET } } };

/** A cached login of a confidential client (the login recorded its method). */
function confidential(method: LoginClientAuth = 'client_secret_basic', overrides = {}) {
  return cachedLogin(T0, {
    endpoints: { token: TOKEN_ENDPOINT, revocation: REVOCATION_ENDPOINT, clientAuthMethod: method },
    ...overrides,
  });
}

/** Settings of profile p with a client secret; `overrides` change the identity. */
function withSecret(overrides: Parameters<typeof oauthConfig>[0] = {}): LogoutTarget {
  return { ...TARGET, settings: oauthConfig({ clientSecret: SECRET, ...overrides }) };
}

function setup(login: CachedLogin | string | null, idp: FakeIdpOptions = {}) {
  const fake = fakeIdp(idp);
  const files =
    login === null ? {} : { [TOKEN_FILE]: typeof login === 'string' ? login : cacheText(login) };
  const runtime = fakeRuntime({ fetch: fake.fetch, files, now: () => T0 });
  return { idp: fake, runtime, deps: oauthDeps(runtime) };
}

describe('logout', () => {
  it('does nothing without a login, not even lock', async () => {
    const test = setup(null);
    await expect(logout(TOKEN_FILE, TARGET, test.deps)).resolves.toEqual({
      removed: false,
      revoked: null,
      warnings: [],
    });
    expect(test.runtime.locks).toEqual([]);
    expect(test.idp.requests).toEqual([]);
  });

  it('revokes the refresh token, removes the file and tells until when the access token works', async () => {
    const test = setup(cachedLogin(T0));
    await expect(logout(TOKEN_FILE, TARGET, test.deps)).resolves.toEqual({
      removed: true,
      revoked: true,
      warnings: [],
      validUntil: T0 + 300_000,
    });
    expect(test.runtime.files.has(TOKEN_FILE)).toBe(false);
    expect(test.runtime.locks.map((lock) => lock.path)).toEqual([`${TOKEN_FILE}.lock`]);
    const revocation = test.idp.requests[0];
    expect(revocation?.url).toBe(REVOCATION_ENDPOINT);
    expect(Object.fromEntries(revocation?.form ?? [])).toEqual({
      token: 'cached-refresh',
      token_type_hint: 'refresh_token',
      client_id: 'operate-cli',
    });
    expect(revocation?.headers.authorization).toBeUndefined();
  });

  it('revokes the access token when there is no refresh token, with the client secret', async () => {
    const test = setup(
      confidential('client_secret_basic', { refreshToken: null, expiresAt: null }),
      CONFIDENTIAL,
    );
    const result = await logout(TOKEN_FILE, withSecret(), test.deps);
    expect(result).toEqual({ removed: true, revoked: true, warnings: [], validUntil: null });
    expect(test.idp.requests[0]?.form.get('token_type_hint')).toBe('access_token');
    expect(test.idp.requests[0]?.headers.authorization).toBe(
      `Basic ${btoa(`operate-cli:${SECRET}`)}`,
    );
  });

  it('uses client_secret_post when the login recorded it', async () => {
    const test = setup(confidential('client_secret_post'), CONFIDENTIAL);
    await logout(TOKEN_FILE, withSecret(), test.deps);
    expect(test.idp.requests[0]?.form.get('client_secret')).toBe(SECRET);
    expect(test.idp.revoked).toEqual(['cached-refresh']);
  });

  it('never sends a client secret for a public login, whatever the settings hold', async () => {
    const test = setup(cachedLogin(T0));
    const result = await logout(TOKEN_FILE, withSecret({ clientId: 'b-client' }), test.deps);
    expect(result.revoked).toBe(true);
    const request = test.idp.requests[0];
    expect(request?.headers.authorization).toBeUndefined();
    expect(request?.form.has('client_secret')).toBe(false);
    expect(request?.form.get('client_id')).toBe('operate-cli');
  });

  it.each([
    [
      'another issuer',
      withSecret({ issuer: 'https://b.example.com' }),
      'the login was made for another issuer, client, audience or scopes than the settings of profile "p"',
    ],
    [
      'another client',
      withSecret({ clientId: 'b-client' }),
      'the login was made for another issuer, client, audience or scopes than the settings of profile "p"',
    ],
    ['no client secret', TARGET, 'the settings of profile "p" have no client secret'],
    [
      'settings that do not resolve',
      {
        profile: 'p',
        source: SOURCE,
        unresolved: 'the OAuth settings of profile "p" do not resolve: X',
      },
      'the OAuth settings of profile "p" do not resolve: X',
    ],
    [
      'a profile without OAuth',
      { profile: 'p', source: SOURCE },
      'profile "p" no longer uses OAuth',
    ],
  ])(
    'sends no client secret to the revocation endpoint of a confidential login for %s',
    async (_, target, reason) => {
      const test = setup(confidential(), CONFIDENTIAL);
      const result = await logout(TOKEN_FILE, target, test.deps);
      expect(result).toMatchObject({ removed: true, revoked: false });
      expect(result.warnings).toEqual([
        `Warning: the client secret of the login is not available (${reason}); the refresh token was not revoked and stays valid until it expires.`,
      ]);
      expect(test.idp.requests).toEqual([]);
      expect(test.runtime.files.has(TOKEN_FILE)).toBe(false);
    },
  );

  it('warns that nothing was revoked when no revocation endpoint is known', async () => {
    const test = setup(
      cachedLogin(T0, {
        endpoints: { token: TOKEN_ENDPOINT, revocation: null, clientAuthMethod: 'none' },
      }),
    );
    const result = await logout(TOKEN_FILE, TARGET, test.deps);
    expect(result).toMatchObject({ removed: true, revoked: null });
    expect(result.warnings).toEqual([
      "Warning: operate knows no token revocation endpoint (RFC 7009) for https://login.example.com/realms/camunda (explicit endpoints, or none in its discovery document); the refresh token was not revoked and stays valid until 2023-11-14T22:43:20.000Z. End the session at the authorization server if needed (sign out, or revoke the user's sessions).",
    ]);
    expect(test.idp.requests).toEqual([]);
  });

  it('names the token endpoint origin and an unknown expiry without an issuer', async () => {
    const login = cachedLogin(T0, {
      identity: { ...cachedLogin(T0).identity, issuer: null },
      endpoints: {
        token: 'https://as.example.com/oauth/token',
        revocation: null,
        clientAuthMethod: 'none',
      },
      refreshExpiresAt: null,
    });
    const result = await logout(TOKEN_FILE, TARGET, setup(login).deps);
    expect(result.warnings[0]).toContain(
      'for https://as.example.com (explicit endpoints, or none in its discovery document); the refresh token was not revoked and stays valid until it expires.',
    );
    // a hand-edited cache with an unusable token endpoint still logs out
    const odd = { ...login, endpoints: { ...login.endpoints, token: 'not a url' } };
    const oddResult = await logout(TOKEN_FILE, TARGET, setup(odd).deps);
    expect(oddResult.warnings[0]).toContain('endpoint (RFC 7009) for not a url (explicit');
  });

  it('has nothing to warn about without a refresh token and without an endpoint', async () => {
    const login = cachedLogin(T0, {
      refreshToken: null,
      endpoints: { token: TOKEN_ENDPOINT, revocation: null, clientAuthMethod: 'none' },
    });
    await expect(logout(TOKEN_FILE, TARGET, setup(login).deps)).resolves.toEqual({
      removed: true,
      revoked: null,
      warnings: [],
      validUntil: T0 + 300_000,
    });
  });

  it('warns and still removes the file when the revocation fails', async () => {
    const test = setup(cachedLogin(T0, { expiresAt: T0 - 1 }));
    test.idp.queue('revocation', connectionRefused());
    const result = await logout(TOKEN_FILE, TARGET, test.deps);
    expect(result).toEqual({
      removed: true,
      revoked: false,
      warnings: [
        `Warning: could not revoke the refresh token at ${REVOCATION_ENDPOINT} (Cannot reach the authorization server at ${REVOCATION_ENDPOINT} (ECONNREFUSED)); it stays valid until it expires.`,
      ],
    });
    expect(test.runtime.files.has(TOKEN_FILE)).toBe(false);
  });

  it('removes a file of unknown format', async () => {
    const test = setup('garbage');
    await expect(logout(TOKEN_FILE, TARGET, test.deps)).resolves.toEqual({
      removed: true,
      revoked: null,
      warnings: [],
    });
  });
});
