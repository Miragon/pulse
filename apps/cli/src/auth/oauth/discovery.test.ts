import { describe, expect, it } from 'vitest';
import { connectionRefused } from '../../../test/support/fake-fetch.js';
import { fakeIdp, ISSUER, tokenJson } from '../../../test/support/fake-idp.js';
import { fakeRuntime } from '../../../test/support/fake-runtime.js';
import { oauthConfig, oauthDeps } from '../../../test/support/oauth.js';
import { OperateError } from '../../errors.js';
import { discoveryUrls, serverMetadata } from './discovery.js';

async function rejection(promise: Promise<unknown>): Promise<OperateError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    return error as OperateError;
  }
  throw new Error('expected an error');
}

function setup(options: Parameters<typeof fakeIdp>[0] = {}) {
  const idp = fakeIdp(options);
  const deps = oauthDeps(fakeRuntime({ fetch: idp.fetch }));
  return { idp, deps };
}

describe('discoveryUrls', () => {
  it('appends the OIDC path and builds the RFC 8414 location from the issuer path', () => {
    expect(discoveryUrls('https://as/realms/x/')).toEqual([
      'https://as/realms/x/.well-known/openid-configuration',
      'https://as/.well-known/oauth-authorization-server/realms/x',
    ]);
    expect(discoveryUrls('https://as')).toEqual([
      'https://as/.well-known/openid-configuration',
      'https://as/.well-known/oauth-authorization-server',
    ]);
  });
});

describe('serverMetadata', () => {
  it('discovers the endpoints with OpenID Connect discovery', async () => {
    const { idp, deps } = setup();
    await expect(serverMetadata(oauthConfig(), deps)).resolves.toEqual({
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/protocol/openid-connect/auth`,
      tokenEndpoint: `${ISSUER}/protocol/openid-connect/token`,
      revocationEndpoint: `${ISSUER}/protocol/openid-connect/revoke`,
      issParameterRequired: true,
      clientAuthMethod: 'client_secret_basic',
    });
    expect(idp.requests.map((request) => [request.method, request.url])).toEqual([
      ['GET', `${ISSUER}/.well-known/openid-configuration`],
    ]);
    expect(idp.requests[0]?.headers.accept).toBe('application/json');
  });

  it('falls back to the RFC 8414 location after a 404', async () => {
    const { idp, deps } = setup();
    idp.queue('discovery', new Response('', { status: 404 }));
    idp.queue(
      'discovery',
      tokenJson({
        issuer: ISSUER,
        authorization_endpoint: 'https://login.example.com/auth',
        token_endpoint: 'https://login.example.com/token',
      }),
    );
    const metadata = await serverMetadata(oauthConfig(), deps);
    expect(metadata).toMatchObject({
      tokenEndpoint: 'https://login.example.com/token',
      revocationEndpoint: null,
      issParameterRequired: false,
      clientAuthMethod: 'client_secret_basic',
    });
    expect(idp.requests.map((request) => request.url)).toEqual([
      `${ISSUER}/.well-known/openid-configuration`,
      'https://login.example.com/.well-known/oauth-authorization-server/realms/camunda',
    ]);
  });

  it('skips discovery with explicit endpoints', async () => {
    const { idp, deps } = setup();
    const config = oauthConfig({
      authorizationEndpoint: 'https://as/authorize?tenant=x',
      tokenEndpoint: 'https://as/token',
    });
    await expect(serverMetadata(config, deps)).resolves.toEqual({
      issuer: ISSUER,
      authorizationEndpoint: 'https://as/authorize?tenant=x',
      tokenEndpoint: 'https://as/token',
      revocationEndpoint: null,
      issParameterRequired: false,
      clientAuthMethod: 'client_secret_basic',
    });
    const noIssuer = await serverMetadata(
      oauthConfig({
        issuer: undefined,
        authorizationEndpoint: 'https://as/authorize',
        tokenEndpoint: 'https://as/token',
      }),
      deps,
    );
    expect(noIssuer.issuer).toBeNull();
    expect(idp.requests).toEqual([]);
  });

  it('requires the issuer exactly as configured', async () => {
    const { deps } = setup({ metadata: { issuer: `${ISSUER}/` } });
    const error = await rejection(serverMetadata(oauthConfig(), deps));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe(`The discovery document names issuer "${ISSUER}/", not "${ISSUER}"`);
    // the server's value stays out of the command (the message shows it)
    expect(error.details.hint).toBe(
      'Set the issuer exactly as the document names it (Auth0 issuers end with "/"): operate config set p --oauth-issuer <issuer>.',
    );
    const env = oauthConfig({
      profile: undefined,
      sources: { endpoints: 'env', clientId: 'env', scopes: 'default', redirectPort: 'default' },
    });
    expect((await rejection(serverMetadata(env, deps))).details.hint).toBe(
      'Set the issuer exactly as the document names it (Auth0 issuers end with "/"): OPERATE_OAUTH_ISSUER=<issuer>.',
    );
  });

  it.each([
    [{ issuer: undefined }, 'but the document has no issuer'],
    [{ token_endpoint: undefined }, 'but the document has no token_endpoint'],
    [{ authorization_endpoint: ' ' }, 'but the document has no authorization_endpoint'],
  ])('reports an incomplete document %j', async (metadata, problem) => {
    const { deps } = setup({ metadata });
    const error = await rejection(serverMetadata(oauthConfig(), deps));
    expect(error.message).toBe(
      `OAuth discovery failed: GET ${ISSUER}/.well-known/openid-configuration → 200 OK, ${problem}`,
    );
    expect(error.details.hint).toBe(
      'The issuer is the URL in front of /.well-known/openid-configuration, e.g. https://login.example.com/realms/camunda; or configure both endpoints (--oauth-authorization-endpoint, --oauth-token-endpoint).',
    );
  });

  it('refuses an http endpoint on a non-loopback host', async () => {
    const { deps } = setup({ metadata: { token_endpoint: 'http://login.example.com/token' } });
    const error = await rejection(serverMetadata(oauthConfig(), deps));
    expect(error.code).toBe('CONFIG');
    expect(error.message).toBe(
      'The OAuth token endpoint (token_endpoint of the discovery document) must use https:// (http:// only for localhost, 127.0.0.1 or [::1]), got "http://login.example.com/token"',
    );
  });

  it('ignores an unusable revocation endpoint', async () => {
    for (const revocation of ['http://evil.example.com/revoke', 42]) {
      const { deps } = setup({ metadata: { revocation_endpoint: revocation } });
      expect((await serverMetadata(oauthConfig(), deps)).revocationEndpoint).toBeNull();
    }
  });

  it('requires PKCE S256 when the document lists the methods', async () => {
    const { deps } = setup({ metadata: { code_challenge_methods_supported: ['plain'] } });
    const error = await rejection(serverMetadata(oauthConfig(), deps));
    expect(error.message).toBe(
      `The authorization server ${ISSUER} does not support PKCE with S256`,
    );
    const missing = setup({ metadata: { code_challenge_methods_supported: undefined } });
    await expect(serverMetadata(oauthConfig(), missing.deps)).resolves.toBeDefined();
  });

  it('chooses the client authentication of a confidential client', async () => {
    const config = oauthConfig({ clientSecret: 's' });
    const methods = async (list: unknown) =>
      (
        await serverMetadata(
          config,
          setup({ metadata: { token_endpoint_auth_methods_supported: list } }).deps,
        )
      ).clientAuthMethod;
    await expect(methods(undefined)).resolves.toBe('client_secret_basic');
    await expect(methods(['client_secret_post', 'client_secret_basic'])).resolves.toBe(
      'client_secret_basic',
    );
    await expect(methods(['private_key_jwt', 'client_secret_post'])).resolves.toBe(
      'client_secret_post',
    );
    const error = await rejection(methods(['private_key_jwt']));
    expect(error.message).toBe(
      'The authorization server supports neither client_secret_basic nor client_secret_post',
    );
    const publicClient = setup({ metadata: { token_endpoint_auth_methods_supported: ['none'] } });
    await expect(serverMetadata(oauthConfig(), publicClient.deps)).resolves.toMatchObject({
      clientAuthMethod: 'client_secret_basic',
    });
  });

  it('reports 404 on both locations, other statuses and non-JSON answers as CONFIG', async () => {
    const both = setup();
    both.idp.queue('discovery', new Response('', { status: 404 }));
    both.idp.queue('discovery', new Response('', { status: 404 }));
    const error = await rejection(serverMetadata(oauthConfig(), both.deps));
    // both locations, so the message names the one the hint talks about
    expect(error.message).toBe(
      `OAuth discovery failed: GET ${ISSUER}/.well-known/openid-configuration → 404 Not Found, then GET https://login.example.com/.well-known/oauth-authorization-server/realms/camunda → 404 Not Found`,
    );
    const fallbackFailed = setup();
    fallbackFailed.idp.queue('discovery', new Response('', { status: 404 }));
    fallbackFailed.idp.queue('discovery', new Response('', { status: 403 }));
    expect((await rejection(serverMetadata(oauthConfig(), fallbackFailed.deps))).message).toBe(
      `OAuth discovery failed: GET ${ISSUER}/.well-known/openid-configuration → 404 Not Found, then GET https://login.example.com/.well-known/oauth-authorization-server/realms/camunda → 403 Forbidden`,
    );
    const redirect = setup();
    redirect.idp.queue('discovery', new Response('', { status: 302, headers: { location: '/x' } }));
    expect((await rejection(serverMetadata(oauthConfig(), redirect.deps))).message).toContain(
      '→ 302 Found',
    );
    const html = setup();
    html.idp.queue('discovery', new Response('<html>', { status: 200 }));
    expect((await rejection(serverMetadata(oauthConfig(), html.deps))).message).toBe(
      `OAuth discovery failed: GET ${ISSUER}/.well-known/openid-configuration → 200 OK, but the answer is not a JSON object`,
    );
  });

  it('reports a server error as HTTP_SERVER_ERROR', async () => {
    const { idp, deps } = setup();
    idp.queue('discovery', new Response('', { status: 503 }));
    const error = await rejection(serverMetadata(oauthConfig(), deps));
    expect(error.code).toBe('HTTP_SERVER_ERROR');
    expect(error.exitCode).toBe(7);
    expect(error.message).toBe('The authorization server failed: HTTP 503 Service Unavailable');
  });

  it('reports an unreachable server as NETWORK naming the issuer source', async () => {
    const { idp, deps } = setup();
    idp.queue('discovery', connectionRefused());
    const error = await rejection(serverMetadata(oauthConfig(), deps));
    expect(error.code).toBe('NETWORK');
    expect(error.exitCode).toBe(8);
    expect(error.message).toBe(
      `Cannot reach the authorization server at ${ISSUER}/.well-known/openid-configuration (ECONNREFUSED)`,
    );
    expect(error.details.hint).toBe(
      'Check the issuer or endpoint (auth.issuer of profile "p") and the network; a private CA needs NODE_EXTRA_CA_CERTS.',
    );
  });
});
