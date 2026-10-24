/**
 * The login flow on the fake runtime (loopback server, browser) and the fake identity provider.
 */

import { describe, expect, it } from 'vitest';
import {
  fakeIdp,
  type FakeIdpOptions,
  ISSUER,
  oauthError,
} from '../../../test/support/fake-idp.js';
import {
  fakeRuntime,
  type FakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from '../../../test/support/fake-runtime.js';
import {
  loginDeps,
  oauthConfig,
  type OAuthOverrides,
  TOKEN_DIR,
  TOKEN_FILE,
} from '../../../test/support/oauth.js';
import { OperateError } from '../../errors.js';
import { IGNORED_STATE_NOTICE, login, type LoginOptions } from './login.js';
import type { CachedLogin } from './types.js';

const T0 = 1_700_000_000_000;
const URL_LINE = /^ {2}(https?:\/\/\S+)$/m;
const OPTIONS: LoginOptions = { noBrowser: true, loginTimeoutMs: 300_000 };

interface Setup {
  readonly runtime: FakeRuntime;
  readonly idp: ReturnType<typeof fakeIdp>;
}

function setup(idp: FakeIdpOptions = {}, runtime: FakeRuntimeOptions = {}): Setup {
  const fake = fakeIdp(idp);
  return { idp: fake, runtime: fakeRuntime({ fetch: fake.fetch, now: () => T0, ...runtime }) };
}

/** A browser that logs in at the fake IdP and follows the redirect to the callback. */
function browserOf(idp: ReturnType<typeof fakeIdp>, extra: Record<string, string> = {}) {
  return async (url: string, runtime: FakeRuntime) => {
    const query = idp.authorize(url);
    for (const [key, value] of Object.entries(extra)) query.set(key, value);
    await runtime.loopback.request('/callback', query);
    return true;
  };
}

/** Waits until the login printed its URL; resolves to it. */
async function printedUrl(runtime: FakeRuntime): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const match = URL_LINE.exec(runtime.stderr.text());
    if (match?.[1] !== undefined && runtime.stderr.text().includes('Waiting up to'))
      return match[1];
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`no URL line in: ${runtime.stderr.text()}`);
}

function run(test: Setup, config: OAuthOverrides = {}, options: Partial<LoginOptions> = {}) {
  return login(oauthConfig(config), { ...OPTIONS, ...options }, loginDeps(test.runtime));
}

async function rejection(promise: Promise<unknown>): Promise<OperateError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    return error as OperateError;
  }
  throw new Error('expected an error');
}

/** Starts a --no-browser login and returns the callback query the IdP would redirect with. */
async function started(
  test: Setup,
  config: OAuthOverrides = {},
  options: Partial<LoginOptions> = {},
) {
  const result = run(test, config, options);
  result.catch(() => undefined);
  const url = await printedUrl(test.runtime);
  return { result, url, callback: test.idp.authorize(url) };
}

describe('login', () => {
  it('logs in through the browser, writes the cache and prints the documented lines', async () => {
    const test = setup({}, { loopbackPort: 51_234 });
    const runtime = fakeRuntime({
      fetch: test.idp.fetch,
      now: () => T0,
      loopbackPort: 51_234,
      browser: browserOf(test.idp),
    });
    const result = await login(
      oauthConfig(),
      { noBrowser: false, loginTimeoutMs: 300_000 },
      loginDeps(runtime),
    );
    expect(result.tokenFile).toBe(TOKEN_FILE);
    expect(result.login).toEqual({
      version: 1,
      identity: {
        issuer: ISSUER,
        tokenEndpoint: null,
        clientId: 'operate-cli',
        audience: null,
        scopes: ['offline_access', 'openid'],
      },
      endpoints: {
        token: `${ISSUER}/protocol/openid-connect/token`,
        revocation: `${ISSUER}/protocol/openid-connect/revoke`,
        clientAuthMethod: 'none',
      },
      tokenType: 'Bearer',
      accessToken: 'access-2',
      expiresAt: T0 + 300_000,
      refreshToken: 'refresh-2',
      refreshExpiresAt: T0 + 1_800_000,
      scope: 'openid offline_access',
      subject: 'user-1',
      user: 'alice',
      loggedInAt: T0,
      refreshedAt: null,
    } satisfies CachedLogin);
    expect(JSON.parse(fileText(runtime, TOKEN_FILE) ?? '')).toEqual(result.login);
    expect(runtime.files.get(TOKEN_FILE)?.mode).toBe(0o600);
    expect(runtime.dirModes.get(TOKEN_DIR)).toBe(0o700);
    const url = runtime.browserUrls[0] ?? '';
    expect(runtime.stderr.text()).toBe(
      [
        `Logging in to ${ISSUER} as client operate-cli (profile "p").`,
        'Open this URL in a browser to log in:',
        `  ${url}`,
        'Opened the system browser.',
        'Waiting up to 300 s for the login at http://127.0.0.1:51234/callback (Ctrl+C cancels).',
        'Logged in as alice (profile "p").',
        '',
      ].join('\n'),
    );
    expect(runtime.loopback).toMatchObject({ listens: [0], listening: false, closed: true });
    expect(runtime.randomRequests).toEqual([32, 32]);
  });

  it('builds the authorization URL with the bound port, S256, scopes and audience', async () => {
    const test = setup({}, { loopbackPort: 40_000 });
    const { result, url, callback } = await started(test, { audience: 'engine-rest' });
    const params = new URL(url).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({
      response_type: 'code',
      client_id: 'operate-cli',
      redirect_uri: 'http://127.0.0.1:40000/callback',
      scope: 'openid offline_access',
      code_challenge_method: 'S256',
      audience: 'engine-rest',
    });
    expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('state')).not.toBe(params.get('code_challenge'));
    await test.runtime.loopback.request('/callback', callback);
    await expect(result).resolves.toBeDefined();
    expect(test.runtime.browserUrls).toEqual([]);
  });

  it('listens on the configured redirect port', async () => {
    const test = setup();
    const { result, callback } = await started(test, { redirectPort: 8765 });
    expect(test.runtime.loopback.listens).toEqual([8765]);
    expect(test.runtime.stderr.text()).toContain('for the login at http://127.0.0.1:8765/callback');
    await test.runtime.loopback.request('/callback', callback);
    await result;
  });

  it('says when no browser could be opened', async () => {
    const test = setup({}, { browser: false });
    const result = run(test, {}, { noBrowser: false });
    result.catch(() => undefined);
    const url = await printedUrl(test.runtime);
    expect(test.runtime.browserUrls).toEqual([url]);
    expect(test.runtime.stderr.text()).toContain(
      `  ${url}\nCould not open a browser; open the URL above yourself.\nWaiting up to`,
    );
    await test.runtime.loopback.request('/callback', test.idp.authorize(url));
    await result;
  });

  it('keeps the query of explicit endpoints and needs no discovery', async () => {
    const idp = fakeIdp();
    const test = { idp, runtime: fakeRuntime({ fetch: idp.fetch, now: () => T0 }) };
    const endpoint = `${ISSUER}/protocol/openid-connect/auth`;
    const { result, url, callback } = await started(test, {
      authorizationEndpoint: `${endpoint}?kc_idp_hint=corp`,
      tokenEndpoint: `${ISSUER}/protocol/openid-connect/token`,
    });
    expect(url.startsWith(`${endpoint}?kc_idp_hint=corp&response_type=code&`)).toBe(true);
    await test.runtime.loopback.request('/callback', callback);
    const done = await result;
    expect(done.login.endpoints.revocation).toBeNull();
    expect(done.login.identity.tokenEndpoint).toBe(`${ISSUER}/protocol/openid-connect/token`);
    expect(test.idp.requests.some((request) => request.path.includes('.well-known'))).toBe(false);
    expect(test.runtime.stderr.text()).toContain(`Logging in to ${ISSUER} as client`);
  });

  it('names the origin of the authorization endpoint without an issuer', async () => {
    const test = setup();
    const { result, callback } = await started(test, {
      issuer: undefined,
      authorizationEndpoint: `${ISSUER}/protocol/openid-connect/auth`,
      tokenEndpoint: `${ISSUER}/protocol/openid-connect/token`,
      profile: undefined,
    });
    expect(test.runtime.stderr.text()).toContain(
      'Logging in to https://login.example.com as client operate-cli (no profile).',
    );
    callback.delete('iss');
    await test.runtime.loopback.request('/callback', callback);
    expect((await result).tokenFile).toMatch(/\/env-[0-9a-f]{32}\.json$/);
  });

  it('answers other paths and methods without ending the login', async () => {
    const test = setup();
    const { result, callback } = await started(test);
    await expect(test.runtime.loopback.request('/favicon.ico')).resolves.toMatchObject({
      status: 404,
    });
    await expect(
      test.runtime.loopback.request('/callback', callback, 'POST'),
    ).resolves.toMatchObject({ status: 405 });
    const success = await test.runtime.loopback.request('/callback', callback);
    expect(success.status).toBe(200);
    expect(success.html).toContain('Logged in');
    await result;
  });

  it('refuses a second callback after the first was accepted', async () => {
    const test = setup();
    const done = { result: undefined as unknown };
    const runtime = fakeRuntime({
      fetch: test.idp.fetch,
      now: () => T0,
      browser: async (url, fake) => {
        const query = test.idp.authorize(url);
        const first = fake.loopback.request('/callback', query);
        done.result = await fake.loopback.request('/callback', query);
        await first;
        return true;
      },
    });
    await login(oauthConfig(), { noBrowser: false, loginTimeoutMs: 1000 }, loginDeps(runtime));
    expect(done.result).toMatchObject({ status: 409 });
    expect((done.result as { html: string }).html).toContain(
      'operate already received the login callback.',
    );
  });

  it('ignores callbacks without the right state and keeps waiting, with one notice', async () => {
    const test = setup();
    const { result, callback } = await started(test);
    const wrong = new URLSearchParams(callback);
    wrong.set('state', 'not-the-state');
    for (const query of [
      wrong,
      new URLSearchParams({ code: 'x' }),
      new URLSearchParams(`${callback.toString()}&state=${callback.get('state') ?? ''}`),
    ]) {
      const page = await test.runtime.loopback.request('/callback', query);
      expect(page.status).toBe(400);
      expect(page.html).toContain('This is not the callback of the running login.');
      expect(page.html).not.toContain(callback.get('code') ?? 'never');
    }
    expect(test.runtime.stderr.text().split(IGNORED_STATE_NOTICE)).toHaveLength(2);
    expect(test.idp.tokenRequests()).toEqual([]);
    expect(test.runtime.loopback.listening).toBe(true);
    expect((await test.runtime.loopback.request('/callback', callback)).status).toBe(200);
    await expect(result).resolves.toBeDefined();
    expect(test.idp.tokenRequests()).toHaveLength(1);
  });

  it('fails on an iss mismatch or a missing iss the server advertises', async () => {
    for (const change of [
      (query: URLSearchParams) => {
        query.set('iss', 'https://evil.example.com');
      },
      (query: URLSearchParams) => {
        query.delete('iss');
      },
    ]) {
      const test = setup();
      const { result, callback } = await started(test);
      change(callback);
      const page = await test.runtime.loopback.request('/callback', callback);
      expect(page.status).toBe(400);
      expect(page.html).toContain('The login response came from another issuer.');
      const error = await rejection(result);
      expect(error.code).toBe('LOGIN_FAILED');
      expect(error.message).toBe(
        'The login response came from another issuer (possible mix-up attack)',
      );
      expect(test.idp.tokenRequests()).toEqual([]);
      expect(test.runtime.loopback.closed).toBe(true);
    }
  });

  it('accepts a callback without iss when the server does not advertise it', async () => {
    const test = setup({ metadata: { authorization_response_iss_parameter_supported: undefined } });
    const { result, callback } = await started(test);
    callback.delete('iss');
    await test.runtime.loopback.request('/callback', callback);
    await expect(result).resolves.toBeDefined();
  });

  it.each([
    ['access_denied', 'LOGIN_FAILED', 'The login was denied (access_denied: cancelled)'],
    [
      'invalid_request',
      'CONFIG',
      'The authorization server refused the login request (invalid_request: cancelled)',
    ],
    [
      'temporarily_unavailable',
      'LOGIN_FAILED',
      'The login failed (temporarily_unavailable: cancelled)',
    ],
  ])('maps the callback error %s', async (code, errorCode, message) => {
    const test = setup();
    const { result, callback } = await started(test);
    callback.delete('code');
    callback.set('error', code);
    callback.set('error_description', 'cancelled');
    const page = await test.runtime.loopback.request('/callback', callback);
    expect(page.html).toContain(`The authorization server reported ${code}.`);
    const error = await rejection(result);
    expect(error).toMatchObject({ code: errorCode, message });
  });

  it('fails without a code', async () => {
    const test = setup();
    const { result, callback } = await started(test);
    callback.delete('code');
    await test.runtime.loopback.request('/callback', callback);
    expect((await rejection(result)).message).toBe(
      'The login callback carried no authorization code',
    );
  });

  it('fails when the code exchange is rejected, with a failure page', async () => {
    const test = setup();
    const { result, callback } = await started(test);
    test.idp.queue('token', oauthError(400, 'invalid_grant', 'Code not valid'));
    const page = await test.runtime.loopback.request('/callback', callback);
    expect(page.status).toBe(400);
    expect(page.html).toContain('operate could not exchange the authorization code.');
    const error = await rejection(result);
    expect(error.code).toBe('LOGIN_FAILED');
    expect(error.message).toBe(
      'The authorization server rejected the authorization code (invalid_grant: Code not valid)',
    );
    expect(test.runtime.files.has(TOKEN_FILE)).toBe(false);
  });

  it('sends the verifier whose challenge was in the URL (real S256 check)', async () => {
    const test = setup();
    const { result, url, callback } = await started(test);
    await test.runtime.loopback.request('/callback', callback);
    await result;
    const exchange = test.idp.tokenRequests('authorization_code')[0];
    expect(exchange?.form.get('redirect_uri')).toBe(new URL(url).searchParams.get('redirect_uri'));
    expect(exchange?.form.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('gives up after the login timeout with the redirect URI hint, never the ephemeral port', async () => {
    const test = setup({}, { deadlineResolves: true, loopbackPort: 5555 });
    const error = await rejection(run(test, {}, { loginTimeoutMs: 1500 }));
    expect(error.code).toBe('LOGIN_FAILED');
    expect(error.message).toBe('No login arrived within 1.5 s');
    expect(error.details.hint).toBe(
      'Complete the login in the browser. If it showed an error such as "Invalid parameter: redirect_uri", register http://127.0.0.1/callback (any port; Keycloak, Entra ID) for client operate-cli, or set a fixed port (operate config set p --oauth-redirect-port <port>) and register http://127.0.0.1:<port>/callback; then run the command again.',
    );
    expect(test.runtime.deadlines).toEqual([1500]);
    expect(test.runtime.stderr.text()).toContain('Waiting up to 1.5 s for the login');
    expect(test.runtime.loopback.closed).toBe(true);
  });

  it('names the fixed port, and the variable that sets it, in the timeout hint', async () => {
    const fixed = setup({}, { deadlineResolves: true, loopbackPort: 8765 });
    const error = await rejection(run(fixed, { redirectPort: 8765 }, { loginTimeoutMs: 1000 }));
    expect(error.details.hint).toContain(
      'register http://127.0.0.1/callback (any port; Keycloak, Entra ID) or http://127.0.0.1:8765/callback for client operate-cli; then',
    );
    const env = setup({}, { deadlineResolves: true });
    const sources = { ...oauthConfig().sources, redirectPort: 'env' as const };
    const fromEnv = await rejection(run(env, { sources }, { loginTimeoutMs: 1000 }));
    expect(fromEnv.details.hint).toContain(
      'or set a fixed port (OPERATE_OAUTH_REDIRECT_PORT=<port>)',
    );
    const noProfile = setup({}, { deadlineResolves: true });
    const withoutProfile = await rejection(
      run(noProfile, { profile: undefined }, { loginTimeoutMs: 1000 }),
    );
    expect(withoutProfile.details.hint).toContain('(OPERATE_OAUTH_REDIRECT_PORT=<port>)');
  });

  it('reports a port in use and other listen errors as CONFIG', async () => {
    const busy = setup({}, { listenError: 'EADDRINUSE' });
    const error = await rejection(run(busy, { redirectPort: 8765 }));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe('Port 8765 for the login callback is in use');
    expect(error.details.hint).toBe(
      'Stop the program that uses it or choose another port: operate config set p --oauth-redirect-port <port> (0 = any free port); the port must match the redirect URI registered for client operate-cli.',
    );
    const sources = { ...oauthConfig().sources, redirectPort: 'env' as const };
    const fromEnv = await rejection(
      run(setup({}, { listenError: 'EADDRINUSE' }), { redirectPort: 8765, sources }),
    );
    expect(fromEnv.details.hint).toBe(
      'Stop the program that uses it or choose another port: OPERATE_OAUTH_REDIRECT_PORT=<port> (0 = any free port); the port must match the redirect URI registered for client operate-cli.',
    );
    const denied = setup({}, { listenError: 'EACCES' });
    expect((await rejection(run(denied, { redirectPort: 80 }))).message).toBe(
      'Cannot listen on 127.0.0.1:80 for the login callback (EACCES)',
    );
  });

  it('warns when the server issued no refresh token', async () => {
    const test = setup({ refreshTokens: false, idToken: null });
    const { result, callback } = await started(test);
    await test.runtime.loopback.request('/callback', callback);
    const done = await result;
    expect(done.login).toMatchObject({ refreshToken: null, refreshExpiresAt: null, user: null });
    expect(test.runtime.stderr.text()).toContain(
      'Warning: the authorization server issued no refresh token; commands fail with LOGIN_REQUIRED (exit 4) once the access token expires at 2023-11-14T22:18:20.000Z. Request the offline_access scope or allow refresh tokens for client operate-cli.\nLogged in as an unknown user (profile "p").\n',
    );
    const unknown = setup({ refreshTokens: false, expiresIn: null });
    const second = await started(unknown);
    await unknown.runtime.loopback.request('/callback', second.callback);
    await second.result;
    expect(unknown.runtime.stderr.text()).toContain('once the access token expires. Request');
  });

  it('records client_secret_post for a confidential client that needs it', async () => {
    const test = setup({
      clients: { 'operate-cli': { secret: 's3cret' } },
      metadata: { token_endpoint_auth_methods_supported: ['client_secret_post'] },
    });
    const { result, callback } = await started(test, { clientSecret: 's3cret' });
    await test.runtime.loopback.request('/callback', callback);
    const done = await result;
    expect(done.login.endpoints.clientAuthMethod).toBe('client_secret_post');
    expect(test.idp.tokenRequests()[0]?.form.get('client_secret')).toBe('s3cret');
  });

  it('records client_secret_basic for a confidential client, none for a public one', async () => {
    const test = setup({ clients: { 'operate-cli': { secret: 's3cret' } } });
    const { result, callback } = await started(test, { clientSecret: 's3cret' });
    await test.runtime.loopback.request('/callback', callback);
    expect((await result).login.endpoints.clientAuthMethod).toBe('client_secret_basic');
    const post = setup({
      metadata: { token_endpoint_auth_methods_supported: ['client_secret_post'] },
    });
    const second = await started(post);
    await post.runtime.loopback.request('/callback', second.callback);
    expect((await second.result).login.endpoints.clientAuthMethod).toBe('none');
  });

  it('closes the server when the handler throws for a callback', async () => {
    const test = setup();
    const { result, callback } = await started(test);
    test.idp.queue('token', new Error('socket hang up'));
    await test.runtime.loopback.request('/callback', callback);
    expect((await rejection(result)).code).toBe('NETWORK');
    expect(test.runtime.loopback.closed).toBe(true);
  });

  it('starts neither a server nor a browser when discovery fails', async () => {
    const test = setup();
    test.idp.queue('discovery', new Response('', { status: 404 }));
    test.idp.queue('discovery', new Response('', { status: 404 }));
    expect((await rejection(run(test))).code).toBe('CONFIG');
    expect(test.runtime.loopback.listens).toEqual([]);
    expect(test.runtime.browserUrls).toEqual([]);
  });
});
