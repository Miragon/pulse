import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { connectionRefused } from '../../../test/support/fake-fetch.js';
import { fakeIdp, jwt, oauthError, tokenJson } from '../../../test/support/fake-idp.js';
import { fakeRuntime } from '../../../test/support/fake-runtime.js';
import { oauthDeps, TOKEN_ENDPOINT } from '../../../test/support/oauth.js';
import { OperateError } from '../../errors.js';
import type { TraceEvent } from '../../http/types.js';
import { authenticate, clientBasicHeader, sanitize, statusLine } from './http.js';
import {
  exchangeCode,
  idTokenClaims,
  parseTokenResponse,
  refreshTokens,
  revokeToken,
  type TokenClient,
  tokenError,
} from './token.js';

const PUBLIC: TokenClient = {
  clientId: 'operate-cli',
  method: 'client_secret_basic',
  endpoint: { url: TOKEN_ENDPOINT, source: 'auth.issuer of profile "p"' },
  who: { profile: 'p' },
};

async function rejection(promise: Promise<unknown>): Promise<OperateError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    return error as OperateError;
  }
  throw new Error('expected an error');
}

function capture(
  answer: Response | Error = tokenJson({ access_token: 'a', token_type: 'Bearer' }),
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const events: TraceEvent[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: typeof input === 'string' ? input : 'unexpected', init: init ?? {} });
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer.clone());
  };
  return { calls, events, deps: oauthDeps(fakeRuntime({ fetch }), { events }) };
}

function formOf(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(typeof init.body === 'string' ? init.body : ''));
}

describe('client authentication (RFC 6749 §2.3.1)', () => {
  it('sends the client id in the form for a public client', () => {
    const form = new URLSearchParams();
    expect(authenticate(form, PUBLIC)).toEqual({});
    expect(form.toString()).toBe('client_id=operate-cli');
  });

  it('form-encodes id and secret before Base64 for client_secret_basic', () => {
    const form = new URLSearchParams();
    const headers = authenticate(form, {
      ...PUBLIC,
      clientId: 'my client:1',
      clientSecret: 'pä ss:w+rd',
    });
    expect(form.toString()).toBe('');
    expect(headers).toEqual({
      Authorization: `Basic ${Buffer.from('my+client%3A1:p%C3%A4+ss%3Aw%2Brd').toString('base64')}`,
    });
    expect(clientBasicHeader('a', 'b')).toBe(`Basic ${btoa('a:b')}`);
  });

  it('puts id and secret into the form for client_secret_post', () => {
    const form = new URLSearchParams();
    const client = { ...PUBLIC, clientSecret: 's:1', method: 'client_secret_post' as const };
    expect(authenticate(form, client)).toEqual({});
    expect(Object.fromEntries(form)).toEqual({ client_id: 'operate-cli', client_secret: 's:1' });
  });

  it('round-trips any id and secret through the Basic header', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string(), (id, secret) => {
        const header = clientBasicHeader(id, secret);
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        const [encodedId = '', ...rest] = decoded.split(':');
        const parse = (text: string) => new URLSearchParams(`x=${text}`).get('x');
        expect(parse(encodedId)).toBe(id);
        expect(parse(rest.join(':'))).toBe(secret);
      }),
    );
  });
});

describe('token requests', () => {
  it('exchanges the code with the verifier and the redirect URI as sent', async () => {
    const { calls, events, deps } = capture();
    const code = {
      code: 'c-1',
      redirectUri: 'http://127.0.0.1:5000/callback',
      verifier: 'v'.repeat(43),
    };
    await exchangeCode(PUBLIC, code, deps);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(TOKEN_ENDPOINT);
    expect(calls[0]?.init).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.init.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(formOf(calls[0]!.init)).toEqual({
      grant_type: 'authorization_code',
      code: 'c-1',
      redirect_uri: 'http://127.0.0.1:5000/callback',
      code_verifier: 'v'.repeat(43),
      client_id: 'operate-cli',
    });
    expect(events.map((event) => event.type)).toEqual(['request', 'response']);
    expect(events[0]).toMatchObject({ method: 'POST', url: TOKEN_ENDPOINT });
  });

  it('refreshes without a scope; masks the client credentials in the trace', async () => {
    const { calls, events, deps } = capture();
    await refreshTokens({ ...PUBLIC, clientSecret: 'top-secret' }, 'r-1', deps);
    expect(formOf(calls[0]!.init)).toEqual({ grant_type: 'refresh_token', refresh_token: 'r-1' });
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      clientBasicHeader('operate-cli', 'top-secret'),
    );
    expect(events[0]).toEqual({
      type: 'request',
      method: 'POST',
      url: TOKEN_ENDPOINT,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ***',
      },
    });
    expect(events[1]).toMatchObject({ type: 'response', status: 200, statusText: 'OK' });
    expect(JSON.stringify(events)).not.toContain('r-1');
  });

  it('revokes with a token type hint and resolves to undefined on 200', async () => {
    const { calls, deps } = capture(new Response(null, { status: 200 }));
    await expect(
      revokeToken(PUBLIC, { value: 'r-1', hint: 'refresh_token' }, deps),
    ).resolves.toBeUndefined();
    expect(formOf(calls[0]!.init)).toEqual({
      token: 'r-1',
      token_type_hint: 'refresh_token',
      client_id: 'operate-cli',
    });
  });

  it('resolves to the reason of a failed revocation, never rejects', async () => {
    const error = capture(oauthError(400, 'unsupported_token_type', 'nope'));
    await expect(
      revokeToken(PUBLIC, { value: 'a', hint: 'access_token' }, error.deps),
    ).resolves.toBe('HTTP 400 Bad Request (unsupported_token_type: nope)');
    const status = capture(new Response('', { status: 503 }));
    await expect(
      revokeToken(PUBLIC, { value: 'a', hint: 'access_token' }, status.deps),
    ).resolves.toBe('HTTP 503 Service Unavailable');
    const down = capture(connectionRefused());
    await expect(
      revokeToken(PUBLIC, { value: 'a', hint: 'access_token' }, down.deps),
    ).resolves.toBe(`Cannot reach the authorization server at ${TOKEN_ENDPOINT} (ECONNREFUSED)`);
  });

  it('reports a timeout as TIMEOUT', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const { deps } = capture(timeout);
    const error = await rejection(refreshTokens(PUBLIC, 'r', { ...deps, timeoutMs: 1234 }));
    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toBe(
      `Cannot reach the authorization server at ${TOKEN_ENDPOINT} (timed out after 1234 ms)`,
    );
  });

  it('shows URLs without query in messages', async () => {
    const { deps } = capture(connectionRefused());
    const client = { ...PUBLIC, endpoint: { url: `${TOKEN_ENDPOINT}?key=secret`, source: 's' } };
    const error = await rejection(refreshTokens(client, 'r', deps));
    expect(error.message).toBe(
      `Cannot reach the authorization server at ${TOKEN_ENDPOINT}?… (ECONNREFUSED)`,
    );
  });
});

describe('parseTokenResponse', () => {
  it('reads a complete Keycloak answer', () => {
    expect(
      parseTokenResponse({
        access_token: 'eyJ.a-b_c~d+e/f==',
        token_type: 'bearer',
        expires_in: 300,
        refresh_token: 'r',
        refresh_expires_in: 1800,
        scope: 'openid offline_access',
        id_token: jwt({ sub: 's-1', preferred_username: 'alice', email: 'a@x' }),
      }),
    ).toEqual({
      accessToken: 'eyJ.a-b_c~d+e/f==',
      expiresIn: 300,
      refreshToken: 'r',
      refreshExpiresIn: 1800,
      scope: 'openid offline_access',
      subject: 's-1',
      user: 'alice',
    });
  });

  it('accepts a missing token type, numeric strings and absent optional values', () => {
    expect(parseTokenResponse({ access_token: 'a', expires_in: '60' })).toEqual({
      accessToken: 'a',
      expiresIn: 60,
      refreshToken: null,
      refreshExpiresIn: null,
      scope: null,
      subject: null,
      user: null,
    });
  });

  it.each([0, -5, 'soon', null, Number.NaN, '1e3'])('treats expires_in %j as unknown', (value) => {
    expect(parseTokenResponse({ access_token: 'a', expires_in: value }).expiresIn).toBeNull();
  });

  it.each([undefined, '', 'has space', 'ä', 42])('refuses the access token %j', (value) => {
    let error: unknown;
    try {
      parseTokenResponse({ access_token: value });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: 'CONFIG',
      message: 'The authorization server answered without a usable access token',
    });
  });

  it('refuses an answer that is not a JSON object', () => {
    expect(() => parseTokenResponse(undefined)).toThrow(
      'The authorization server answered without a usable access token',
    );
  });

  it.each(['DPoP', 'mac', 7])('refuses the token type %j', (type) => {
    expect(() => parseTokenResponse({ access_token: 'a', token_type: type })).toThrow(
      `Unsupported token type "${String(type)}"; operate sends Bearer tokens only`,
    );
  });
});

describe('idTokenClaims', () => {
  it('takes the email when there is no preferred_username, sanitized', () => {
    expect(idTokenClaims(jwt({ sub: 'x\u001b[2J', email: 'a@x' }))).toEqual({
      subject: 'x[2J',
      user: 'a@x',
    });
  });

  it.each([['not-a-jwt'], ['a.!!!.c'], [jwt({}).replace(/\..*\./, '.W10.')], [42]])(
    'is empty for %j',
    (token) => {
      expect(idTokenClaims(token)).toEqual({ subject: null, user: null });
    },
  );
});

describe('tokenError (design §16.9)', () => {
  const answer = (status: number, json?: Record<string, unknown>) => ({
    url: TOKEN_ENDPOINT,
    status,
    statusText: statusLine({ status, statusText: '' }) === `HTTP ${status}` ? '' : 'x',
    json,
  });
  const HINT =
    'Run `operate auth login --profile p` in a terminal: a person logs in once in the browser, operate refreshes the token afterwards. Agents cannot log in themselves.';

  it('maps invalid_grant on refresh to LOGIN_REQUIRED', () => {
    const error = tokenError(
      answer(400, { error: 'invalid_grant', error_description: 'Session not active' }),
      'refresh',
      PUBLIC,
    );
    expect(error.code).toBe('LOGIN_REQUIRED');
    expect(error.message).toBe(
      'The authorization server rejected the refresh token of profile "p" (invalid_grant: Session not active)',
    );
    expect(error.details.hint).toBe(
      `The session expired, was revoked, or the refresh token was replayed. ${HINT}`,
    );
  });

  it.each(['invalid_client', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope'])(
    'maps %s to CONFIG on refresh and exchange',
    (code) => {
      for (const grant of ['refresh', 'exchange'] as const) {
        const error = tokenError(answer(401, { error: code }), grant, PUBLIC);
        expect(error.code).toBe('CONFIG');
        expect(error.message).toBe(
          `The authorization server rejected client operate-cli (${code})`,
        );
        expect(error.details.hint).toContain('Keycloak answers unauthorized_client');
      }
    },
  );

  it('maps other refresh errors to LOGIN_REQUIRED', () => {
    for (const code of ['invalid_request', 'not_allowed']) {
      const error = tokenError(
        answer(400, { error: code, error_description: 'd' }),
        'refresh',
        PUBLIC,
      );
      expect(error.code).toBe('LOGIN_REQUIRED');
      expect(error.message).toBe(`Refreshing the OAuth login of profile "p" failed (${code}: d)`);
      expect(error.details.hint).toBe(HINT);
    }
  });

  it('maps exchange errors to LOGIN_FAILED', () => {
    const grant = tokenError(
      answer(400, { error: 'invalid_grant', error_description: 'Code not valid' }),
      'exchange',
      PUBLIC,
    );
    expect(grant.code).toBe('LOGIN_FAILED');
    expect(grant.message).toBe(
      'The authorization server rejected the authorization code (invalid_grant: Code not valid)',
    );
    expect(grant.details.hint).toBe(
      'The code expired or was already used; run `operate auth login --profile p` again.',
    );
    const other = tokenError(answer(400, { error: 'invalid_request' }), 'exchange', PUBLIC);
    expect(other.code).toBe('LOGIN_FAILED');
    expect(other.message).toBe('The code exchange failed (invalid_request)');
  });

  it('sanitizes and cuts the description', () => {
    const long = 'x'.repeat(250);
    const error = tokenError(
      answer(400, { error: 'invalid_grant', error_description: `a\nb\u0007${long}` }),
      'refresh',
      PUBLIC,
    );
    expect(error.message).toBe(
      `The authorization server rejected the refresh token of profile "p" (invalid_grant: ab${'x'.repeat(198)}…)`,
    );
  });

  it('maps 5xx to HTTP_SERVER_ERROR, keeping the login on refresh', () => {
    const refresh = tokenError(
      { url: TOKEN_ENDPOINT, status: 503, statusText: 'Service Unavailable', json: { error: 'x' } },
      'refresh',
      PUBLIC,
    );
    expect(refresh).toMatchObject({
      code: 'HTTP_SERVER_ERROR',
      message: 'The authorization server failed: HTTP 503 Service Unavailable',
    });
    expect(refresh.details.hint).toBe('Retry later; the login is kept.');
    expect(
      tokenError(
        { url: TOKEN_ENDPOINT, status: 500, statusText: '', json: undefined },
        'exchange',
        PUBLIC,
      ).details.hint,
    ).toBe('Retry later.');
  });

  it('maps redirects and answers without a JSON error to CONFIG', () => {
    const redirect = tokenError(
      { url: TOKEN_ENDPOINT, status: 302, statusText: 'Found', json: undefined },
      'refresh',
      PUBLIC,
    );
    expect(redirect.code).toBe('CONFIG');
    expect(redirect.message).toBe(
      `Unexpected answer from ${TOKEN_ENDPOINT}: HTTP 302 Found (operate follows no redirects)`,
    );
    expect(redirect.details.hint).toBe('Check the token endpoint (auth.issuer of profile "p").');
    const forbidden = tokenError(
      { url: TOKEN_ENDPOINT, status: 403, statusText: 'Forbidden', json: { error: 'x' } },
      'refresh',
      PUBLIC,
    );
    expect(forbidden.message).toBe(`Unexpected answer from ${TOKEN_ENDPOINT}: HTTP 403 Forbidden`);
    const empty = tokenError(
      { url: TOKEN_ENDPOINT, status: 400, statusText: 'Bad Request', json: { error: '' } },
      'refresh',
      PUBLIC,
    );
    expect(empty.message).toBe(`Unexpected answer from ${TOKEN_ENDPOINT}: HTTP 400 Bad Request`);
  });

  it('is what a failed token request throws', async () => {
    const idp = fakeIdp();
    const deps = oauthDeps(fakeRuntime({ fetch: idp.fetch }));
    const error = await rejection(refreshTokens(PUBLIC, 'garbage', deps));
    expect(error.message).toBe(
      'The authorization server rejected the refresh token of profile "p" (invalid_grant: Invalid refresh token)',
    );
  });
});

describe('sanitize', () => {
  it('removes control characters and cuts after 200 characters', () => {
    expect(sanitize('a\u0000b\nc')).toBe('abc');
    expect(sanitize('y'.repeat(200))).toBe('y'.repeat(200));
    expect(sanitize('y'.repeat(201))).toBe(`${'y'.repeat(200)}…`);
  });
});
