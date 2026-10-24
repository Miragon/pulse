import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ISSUER } from '../../../test/support/fake-idp.js';
import { oauthConfig } from '../../../test/support/oauth.js';
import { authorizationUrl, callbackCode, hasState, safeEqual } from './callback.js';
import type { ServerMetadata } from './types.js';

const METADATA: ServerMetadata = {
  issuer: ISSUER,
  authorizationEndpoint: `${ISSUER}/auth`,
  tokenEndpoint: `${ISSUER}/token`,
  revocationEndpoint: null,
  issParameterRequired: true,
  clientAuthMethod: 'client_secret_basic',
};
const PKCE = { challenge: 'C'.repeat(43), state: 'S'.repeat(43) };
const REDIRECT = 'http://127.0.0.1:5000/callback';

describe('authorizationUrl', () => {
  it('adds the code flow parameters with PKCE S256 in a fixed order', () => {
    const url = authorizationUrl(
      `${ISSUER}/auth`,
      oauthConfig({ audience: 'engine-rest' }),
      PKCE,
      REDIRECT,
    );
    expect(url).toBe(
      `${ISSUER}/auth?response_type=code&client_id=operate-cli&redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback&scope=openid+offline_access&state=${PKCE.state}&code_challenge=${PKCE.challenge}&code_challenge_method=S256&audience=engine-rest`,
    );
    const params = new URL(url).searchParams;
    expect(params.get('scope')).toBe('openid offline_access');
    expect(params.get('redirect_uri')).toBe(REDIRECT);
  });

  it('keeps the query of the endpoint and leaves out empty scopes and no audience', () => {
    const url = authorizationUrl(
      'https://as/authorize?tenant=a%20b',
      oauthConfig({ scopes: [] }),
      PKCE,
      REDIRECT,
    );
    expect(url.startsWith('https://as/authorize?tenant=a%20b&response_type=code&')).toBe(true);
    expect(new URL(url).searchParams.has('scope')).toBe(false);
    expect(new URL(url).searchParams.has('audience')).toBe(false);
    expect(new URL(url).searchParams.has('nonce')).toBe(false);
    expect(new URL(url).searchParams.has('prompt')).toBe(false);
  });
});

describe('safeEqual', () => {
  it('equals string equality', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (left, right) => {
        expect(safeEqual(left, right)).toBe(left === right);
        expect(safeEqual(left, left)).toBe(true);
      }),
    );
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
    expect(safeEqual('ä', 'a')).toBe(false);
  });
});

describe('hasState', () => {
  it('needs exactly one state equal to the expected one', () => {
    expect(hasState(new URLSearchParams({ state: 'x' }), 'x')).toBe(true);
    expect(hasState(new URLSearchParams(), 'x')).toBe(false);
    expect(hasState(new URLSearchParams({ state: 'y' }), 'x')).toBe(false);
    expect(hasState(new URLSearchParams('state=x&state=x'), 'x')).toBe(false);
  });
});

describe('callbackCode', () => {
  const config = oauthConfig();
  const query = (value: string) => new URLSearchParams(value);

  it('returns the code of a complete callback', () => {
    expect(
      callbackCode(
        query(`iss=${encodeURIComponent(ISSUER)}&code=c-1&session_state=s`),
        METADATA,
        config,
      ),
    ).toEqual({ code: 'c-1' });
  });

  it('checks iss against the expected issuer (RFC 9207)', () => {
    const mismatch = callbackCode(query('iss=https%3A%2F%2Fevil&code=c'), METADATA, config);
    expect(mismatch).toMatchObject({
      error: {
        code: 'LOGIN_FAILED',
        message: 'The login response came from another issuer (possible mix-up attack)',
      },
      reason: 'The login response came from another issuer.',
    });
    expect(callbackCode(query('code=c'), METADATA, config)).toMatchObject({
      reason: 'The login response came from another issuer.',
    });
    expect(
      callbackCode(query(`iss=${ISSUER}&iss=${ISSUER}&code=c`), METADATA, config),
    ).toMatchObject({
      reason: 'The login response came from another issuer.',
    });
    const optional = { ...METADATA, issParameterRequired: false };
    expect(callbackCode(query('code=c'), optional, config)).toEqual({ code: 'c' });
    expect(
      callbackCode(query('iss=https%3A%2F%2Fevil&code=c'), { ...optional, issuer: null }, config),
    ).toEqual({ code: 'c' });
  });

  it('maps the error classes of the callback', () => {
    const optional = { ...METADATA, issParameterRequired: false };
    const denied = callbackCode(
      query('error=access_denied&error_description=User%20cancelled'),
      optional,
      config,
    );
    expect(denied).toMatchObject({
      error: {
        code: 'LOGIN_FAILED',
        message: 'The login was denied (access_denied: User cancelled)',
      },
      reason: 'The authorization server reported access_denied.',
    });
    expect('error' in denied && denied.error.details.hint).toBe(
      'The user cancelled the login or may not use client operate-cli; run `operate auth login --profile p` again.',
    );
    for (const code of [
      'invalid_request',
      'unauthorized_client',
      'unsupported_response_type',
      'invalid_scope',
    ]) {
      expect(callbackCode(query(`error=${code}`), optional, config)).toMatchObject({
        error: {
          code: 'CONFIG',
          message: `The authorization server refused the login request (${code})`,
        },
      });
    }
    expect(
      callbackCode(query('error=server_error&error_description=down'), optional, config),
    ).toMatchObject({
      error: { code: 'LOGIN_FAILED', message: 'The login failed (server_error: down)' },
    });
    expect(callbackCode(query('error=%22bad%22'), optional, config)).toMatchObject({
      error: { message: 'The login failed (invalid_error_code)' },
      reason: 'The authorization server reported invalid_error_code.',
    });
  });

  it('needs exactly one non-empty code and no repeated error', () => {
    const optional = { ...METADATA, issParameterRequired: false };
    for (const value of ['', 'code=', 'code=a&code=b', 'error=a&error=b&code=c']) {
      expect(callbackCode(query(value), optional, config)).toMatchObject({
        error: {
          code: 'LOGIN_FAILED',
          message: 'The login callback carried no authorization code',
        },
        reason: 'The login callback carried no authorization code.',
      });
    }
  });
});
