/**
 * A fake OAuth authorization server on a fake fetch, modelled on Keycloak (design §16.10): OIDC
 * discovery, authorization (`authorize` plays the browser and returns the callback query), a token
 * endpoint with real PKCE S256 verification, refresh token rotation with reuse detection (a
 * replayed refresh token ends the session), revocation, client authentication, queued error
 * answers and a request log. `routeFetch` sends requests to the fake AS or the fake engine by
 * origin.
 */

import { createHash } from 'node:crypto';

export const ISSUER = 'https://login.example.com/realms/camunda';

export interface FakeIdpOptions {
  readonly issuer?: string;
  /** Changes of the discovery document; a value of undefined removes the key. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** `expires_in` of access tokens (default 300); null leaves it out. */
  readonly expiresIn?: number | string | null;
  /** `refresh_expires_in` (default 1800); null leaves it out. */
  readonly refreshExpiresIn?: number | null;
  /** Issue refresh tokens (default true). */
  readonly refreshTokens?: boolean;
  /** Rotate refresh tokens on every refresh (default true); false returns none on a refresh. */
  readonly rotate?: boolean;
  /** Registered clients and their secrets (default: public `operate-cli`). */
  readonly clients?: Readonly<Record<string, { readonly secret?: string }>>;
  /** Claims of the ID token (default sub and preferred_username); null: no ID token. */
  readonly idToken?: Readonly<Record<string, unknown>> | null;
  /** The granted `scope` (default: the requested scopes); null leaves it out. */
  readonly scope?: string | null;
}

interface IdpRequest {
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly form: URLSearchParams;
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
}

type Endpoint = 'discovery' | 'token' | 'revocation';
type Queued = Response | Error;

interface PendingCode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly scope: string;
}

export interface FakeIdp {
  readonly issuer: string;
  readonly fetch: typeof globalThis.fetch;
  readonly requests: IdpRequest[];
  /** Access tokens issued, in order. */
  readonly accessTokens: string[];
  /** Refresh tokens issued, in order. */
  readonly refreshTokens: string[];
  /** Tokens revoked through the revocation endpoint. */
  readonly revoked: string[];
  /** Token endpoint requests, optionally of one grant type. */
  tokenRequests(grant?: string): IdpRequest[];
  /** The browser: checks the authorization URL and returns the callback query (with `iss`). */
  authorize(url: string): URLSearchParams;
  /** The next answer of an endpoint (consumed in order before normal handling). */
  queue(endpoint: Endpoint, answer: Queued): void;
  /** Ends every session (admin logout): all refresh tokens become invalid. */
  endSessions(): void;
  /** Registers a live session whose current refresh token is `refreshToken`. */
  seed(refreshToken: string, scope?: string): void;
}

export function tokenJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function oauthError(status: number, error: string, description?: string): Response {
  return tokenJson(
    description === undefined ? { error } : { error, error_description: description },
    status,
  );
}

function base64Url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

/** An unsigned JWT with the claims (operate only decodes ID tokens for display). */
export function jwt(claims: Readonly<Record<string, unknown>>): string {
  return `${base64Url('{"alg":"none"}')}.${base64Url(JSON.stringify(claims))}.sig`;
}

function formEncode(text: string): string {
  return new URLSearchParams({ x: text }).toString().slice(2);
}

function requestOf(input: string | URL | Request, init: RequestInit | undefined): IdpRequest {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const body = init?.body;
  return {
    method: init?.method ?? 'GET',
    url: url.href,
    path: url.pathname,
    form: new URLSearchParams(typeof body === 'string' ? body : ''),
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
  };
}

interface Session {
  current: string;
  alive: boolean;
  readonly scope: string;
}

type Clients = Readonly<Record<string, { readonly secret?: string }>>;

function clientError(error: 'invalid_client' | 'unauthorized_client'): Response {
  return oauthError(401, error, 'Invalid client or Invalid client credentials');
}

/** client_secret_basic: the client of the header, or the error answer. */
function basicClient(clients: Clients, header: string): string | Response {
  const [id = '', secret = ''] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
  const client = Object.entries(clients).find(([name]) => formEncode(name) === id);
  if (client === undefined) return clientError('invalid_client');
  return formEncode(client[1].secret ?? '') === secret
    ? client[0]
    : clientError('unauthorized_client');
}

/** The granted scope and the ID token of a token response. */
function displayValues(options: FakeIdpOptions, scope: string): Record<string, unknown> {
  const granted = options.scope === undefined ? scope : options.scope;
  const claims =
    options.idToken === undefined
      ? { sub: 'user-1', preferred_username: 'alice' }
      : options.idToken;
  return {
    ...(granted === null ? {} : { scope: granted }),
    ...(claims === null ? {} : { id_token: jwt(claims) }),
  };
}

/** The checks of the browser and the AS on an authorization request; returns its query. */
function checkAuthorization(url: string, endpoint: string, clients: Clients): URLSearchParams {
  const parsed = new URL(url);
  const query = parsed.searchParams;
  if (`${parsed.origin}${parsed.pathname}` !== endpoint) {
    throw new Error(`not the authorization endpoint: ${url}`);
  }
  const clientId = query.get('client_id') ?? '';
  if (clients[clientId] === undefined) throw new Error(`unknown client ${clientId}`);
  const redirectUri = query.get('redirect_uri') ?? '';
  if (!/^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(redirectUri)) {
    throw new Error(`bad redirect_uri ${redirectUri}`);
  }
  if (query.get('code_challenge_method') !== 'S256' || query.get('response_type') !== 'code') {
    throw new Error('expected response_type=code with S256');
  }
  return query;
}

export function fakeIdp(options: FakeIdpOptions = {}): FakeIdp {
  const issuer = options.issuer ?? ISSUER;
  const base = new URL(issuer);
  const prefix = base.pathname.replace(/\/+$/, '');
  const paths = {
    discovery: `${prefix}/.well-known/openid-configuration`,
    authorization: `${prefix}/protocol/openid-connect/auth`,
    token: `${prefix}/protocol/openid-connect/token`,
    revocation: `${prefix}/protocol/openid-connect/revoke`,
  };
  const clients = options.clients ?? { 'operate-cli': {} };
  const codes = new Map<string, PendingCode>();
  /** refresh token → its session; the session's current token is the only valid one. */
  const sessions = new Map<string, Session>();
  const queues = new Map<Endpoint, Queued[]>();
  const requests: IdpRequest[] = [];
  const accessTokens: string[] = [];
  const refreshTokenList: string[] = [];
  const revoked: string[] = [];
  let counter = 0;

  const discoveryDocument = (): Record<string, unknown> => {
    const document: Record<string, unknown> = {
      issuer,
      authorization_endpoint: `${base.origin}${paths.authorization}`,
      token_endpoint: `${base.origin}${paths.token}`,
      revocation_endpoint: `${base.origin}${paths.revocation}`,
      code_challenge_methods_supported: ['plain', 'S256'],
      authorization_response_iss_parameter_supported: true,
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    };
    for (const [key, value] of Object.entries(options.metadata ?? {})) {
      if (value === undefined) Reflect.deleteProperty(document, key);
      else document[key] = value;
    }
    return document;
  };

  /** The client of a token request, or the error answer of failed client authentication. */
  const authenticate = (request: IdpRequest): string | Response => {
    const header = request.headers.authorization;
    if (header?.startsWith('Basic ') === true) return basicClient(clients, header);
    const id = request.form.get('client_id') ?? '';
    const client = clients[id];
    if (client === undefined) return clientError('invalid_client');
    if (client.secret !== undefined && request.form.get('client_secret') !== client.secret) {
      return clientError('unauthorized_client');
    }
    return id;
  };

  /** The new refresh token of this grant, or undefined when a refresh keeps the old one. */
  const refreshTokenOf = (scope: string, session: Session | undefined): string | undefined => {
    const rotate = session === undefined || options.rotate !== false;
    if (!rotate) return undefined;
    const refreshToken = `refresh-${counter}`;
    refreshTokenList.push(refreshToken);
    const next = session ?? { current: refreshToken, alive: true, scope };
    next.current = refreshToken;
    sessions.set(refreshToken, next);
    return refreshToken;
  };

  const issue = (scope: string, session?: Session) => {
    counter += 1;
    const accessToken = `access-${counter}`;
    accessTokens.push(accessToken);
    const body: Record<string, unknown> = { access_token: accessToken, token_type: 'Bearer' };
    if (options.expiresIn !== null) body.expires_in = options.expiresIn ?? 300;
    if (options.refreshTokens !== false) {
      const refreshToken = refreshTokenOf(scope, session);
      if (refreshToken !== undefined) body.refresh_token = refreshToken;
      if (options.refreshExpiresIn !== null) {
        body.refresh_expires_in = options.refreshExpiresIn ?? 1800;
      }
    }
    return tokenJson({ ...body, ...displayValues(options, scope) });
  };

  const exchange = (request: IdpRequest, clientId: string): Response => {
    const code = codes.get(request.form.get('code') ?? '');
    if (code?.clientId !== clientId) return oauthError(400, 'invalid_grant', 'Code not valid');
    codes.delete(request.form.get('code') ?? '');
    if (request.form.get('redirect_uri') !== code.redirectUri) {
      return oauthError(400, 'invalid_grant', 'Incorrect redirect_uri');
    }
    const verifier = request.form.get('code_verifier') ?? '';
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
    if (challenge !== code.challenge)
      return oauthError(400, 'invalid_grant', 'PKCE verification failed: Code mismatch');
    return issue(code.scope);
  };

  const refresh = (request: IdpRequest): Response => {
    const token = request.form.get('refresh_token') ?? '';
    const session = sessions.get(token);
    if (session === undefined) return oauthError(400, 'invalid_grant', 'Invalid refresh token');
    if (!session.alive) return oauthError(400, 'invalid_grant', 'Session not active');
    if (session.current !== token) {
      session.alive = false;
      return oauthError(400, 'invalid_grant', 'Maximum allowed refresh token reuse exceeded');
    }
    return issue(session.scope, session);
  };

  const tokenEndpoint = (request: IdpRequest): Response => {
    const client = authenticate(request);
    if (client instanceof Response) return client;
    const grant = request.form.get('grant_type');
    if (grant === 'authorization_code') return exchange(request, client);
    if (grant === 'refresh_token') return refresh(request);
    return oauthError(400, 'unsupported_grant_type');
  };

  const revocation = (request: IdpRequest): Response => {
    const client = authenticate(request);
    if (client instanceof Response) return client;
    const token = request.form.get('token') ?? '';
    revoked.push(token);
    const session = sessions.get(token);
    if (session !== undefined) session.alive = false;
    return new Response(null, { status: 200 });
  };

  const route = (request: IdpRequest): Response => {
    if (request.method === 'GET' && request.path === paths.discovery)
      return tokenJson(discoveryDocument());
    if (request.method === 'POST' && request.path === paths.token) return tokenEndpoint(request);
    if (request.method === 'POST' && request.path === paths.revocation) return revocation(request);
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
  };

  const endpointOf = (request: IdpRequest): Endpoint | undefined => {
    if (request.path === paths.token) return 'token';
    if (request.path === paths.revocation) return 'revocation';
    return request.path.includes('/.well-known/') ? 'discovery' : undefined;
  };

  const idp: FakeIdp = {
    issuer,
    requests,
    accessTokens,
    refreshTokens: refreshTokenList,
    revoked,
    fetch: (input, init) => {
      const request = requestOf(input, init);
      requests.push(request);
      const endpoint = endpointOf(request);
      const queued = endpoint === undefined ? undefined : queues.get(endpoint)?.shift();
      if (queued instanceof Error) return Promise.reject(queued);
      return Promise.resolve(queued ?? route(request));
    },
    tokenRequests: (grant) =>
      requests.filter(
        (request) =>
          request.path === paths.token &&
          (grant === undefined || request.form.get('grant_type') === grant),
      ),
    authorize(url) {
      const query = checkAuthorization(url, `${base.origin}${paths.authorization}`, clients);
      counter += 1;
      const code = `code-${counter}`;
      codes.set(code, {
        clientId: query.get('client_id') ?? '',
        redirectUri: query.get('redirect_uri') ?? '',
        challenge: query.get('code_challenge') ?? '',
        scope: query.get('scope') ?? '',
      });
      return new URLSearchParams({
        state: query.get('state') ?? '',
        session_state: 'session-1',
        iss: issuer,
        code,
      });
    },
    queue(endpoint, answer) {
      queues.set(endpoint, [...(queues.get(endpoint) ?? []), answer]);
    },
    endSessions() {
      for (const session of sessions.values()) session.alive = false;
    },
    seed(refreshToken, scope = 'openid offline_access') {
      sessions.set(refreshToken, { current: refreshToken, alive: true, scope });
    },
  };
  return idp;
}

/** A fetch that sends requests for `origin` to the fake AS and everything else to `other`. */
export function routeFetch(idp: FakeIdp, other: typeof globalThis.fetch): typeof globalThis.fetch {
  const origin = new URL(idp.issuer).origin;
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(url).origin === origin ? idp.fetch(input, init) : other(input, init);
  };
}
