/**
 * Keycloak as the authorization server of the OAuth and bearer token tests (realm fixture
 * `fixtures/keycloak-realm.json`): the browser step of a login done over HTTP, direct calls of the
 * token endpoint (also the client credentials grant of a CI pipeline), and an admin logout that
 * ends the user's online sessions.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Credentials {
  readonly username: string;
  readonly password: string;
}

/** The realm's only user (offline_access via `default-roles-operate`). */
export const USER: Credentials = { username: 'operate-user', password: 'operate-pw-1' };

/** Clients of the realm fixture. */
export const CLIENTS = {
  /** public, auth code + PKCE S256, audience mapper `engine-rest`, 300 s access tokens */
  public: 'operate-cli',
  /** like `public` with 5 s access tokens */
  short: 'operate-cli-short',
  /** like `public`, but confidential with {@link CLIENT_SECRET} (client_secret_basic) */
  confidential: 'operate-cli-confidential',
  /** like `public` without the audience mapper: Envoy answers 403 */
  noAudience: 'operate-cli-noaud',
  /**
   * a CI pipeline's service account: confidential ({@link CI_CLIENT_SECRET}), client credentials
   * grant only, audience mapper `engine-rest`, 300 s access tokens (bearer token tests)
   */
  ci: 'operate-ci',
} as const;

export const CLIENT_SECRET = 'it-client-secret';
export const CI_CLIENT_SECRET = 'it-ci-secret';

/** The admin of the master realm (`KC_BOOTSTRAP_ADMIN_*` of the container). */
const ADMIN: Credentials = { username: 'admin', password: 'admin' };

/** A timeout for every request to Keycloak or to the CLI's loopback server. */
const REQUEST_TIMEOUT_MS = 60_000;

/** The OpenID Connect endpoints of a Keycloak realm. */
export function endpointsOf(issuer: string) {
  const base = `${issuer}/protocol/openid-connect`;
  return {
    authorization: `${base}/auth`,
    token: `${base}/token`,
    revocation: `${base}/revoke`,
  } as const;
}

function signal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

/** A browser's cookie jar, reduced to what the Keycloak login form needs. */
class CookieJar {
  readonly #cookies = new Map<string, string>();

  remember(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.#cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1));
    }
  }

  header(): string {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

export interface Page {
  readonly status: number;
  readonly html: string;
}

/** Opens the authorization URL like a browser (no redirects followed); 200 is the login form. */
export async function openAuthorizationUrl(url: string, jar = new CookieJar()): Promise<Page> {
  const response = await fetch(url, {
    redirect: 'manual',
    headers: { cookie: jar.header() },
    signal: signal(),
  });
  jar.remember(response);
  return { status: response.status, html: await response.text() };
}

const LOGIN_FORM = /<form[^>]*\bid="kc-form-login"[^>]*\baction="([^"]+)"/s;

function formAction(page: Page, url: string): string {
  const action = LOGIN_FORM.exec(page.html)?.[1];
  if (page.status !== 200 || action === undefined) {
    throw new Error(
      `Keycloak did not show the login form for ${url}: HTTP ${page.status}\n${page.html.slice(0, 1500)}`,
    );
  }
  return action.replaceAll('&amp;', '&');
}

/**
 * Logs in at Keycloak's login form and returns the redirect to the client's callback (the
 * `Location` of the 302), without following it.
 */
async function submitLogin(url: string, credentials: Credentials): Promise<string> {
  const jar = new CookieJar();
  const action = formAction(await openAuthorizationUrl(url, jar), url);
  const response = await fetch(action, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
    body: new URLSearchParams({ ...credentials, credentialId: '' }),
    signal: signal(),
  });
  const location = response.headers.get('location');
  if (response.status !== 302 || location === null) {
    const html = await response.text();
    throw new Error(
      `Keycloak did not redirect after the login: HTTP ${response.status}\n${html.slice(0, 1500)}`,
    );
  }
  return location;
}

export interface BrowserLogin {
  /** The callback URL Keycloak redirected to (carries `state`, `session_state`, `iss`, `code`). */
  readonly callbackUrl: string;
  /** Query parameters of {@link callbackUrl}. */
  readonly callback: URLSearchParams;
  /** The answer of the client's loopback server to the callback. */
  readonly answer: Page;
}

/**
 * The browser part of a login: opens the authorization URL exactly as printed (its host decides
 * the issuer of the tokens), submits the login form with the user's credentials and follows the
 * redirect to the loopback callback, whose page is returned.
 */
export async function keycloakLogin(
  authorizationUrl: string,
  credentials: Credentials = USER,
): Promise<BrowserLogin> {
  const callbackUrl = await submitLogin(authorizationUrl, credentials);
  const response = await fetch(callbackUrl, { redirect: 'manual', signal: signal() });
  return {
    callbackUrl,
    callback: new URL(callbackUrl).searchParams,
    answer: { status: response.status, html: await response.text() },
  };
}

/** JSON answer of the token endpoint (or of any other endpoint answering JSON). */
export interface JsonAnswer {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

async function postForm(
  url: string,
  form: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = {},
): Promise<JsonAnswer> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(form),
    signal: signal(),
  });
  const text = await response.text();
  const body = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  return { status: response.status, body };
}

/** A direct request to the realm's token endpoint (not through the CLI). */
function tokenRequest(issuer: string, form: Readonly<Record<string, string>>): Promise<JsonAnswer> {
  return postForm(endpointsOf(issuer).token, form);
}

/** Refreshes with a public client's refresh token, as an uncoordinated second process would. */
export function refreshRequest(
  issuer: string,
  clientId: string,
  refreshToken: string,
): Promise<JsonAnswer> {
  return tokenRequest(issuer, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
}

function requireString(answer: JsonAnswer, key: string, what: string): string {
  const value = answer.body[key];
  if (answer.status !== 200 || typeof value !== 'string') {
    throw new Error(`${what} failed: HTTP ${answer.status} ${JSON.stringify(answer.body)}`);
  }
  return value;
}

async function adminRequest(keycloakUrl: string, token: string, path: string, method = 'GET') {
  const response = await fetch(`${keycloakUrl}/admin/realms/operate${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    signal: signal(),
  });
  if (!response.ok) throw new Error(`${method} ${path} failed: HTTP ${response.status}`);
  const text = await response.text();
  return text === '' ? undefined : (JSON.parse(text) as unknown);
}

/**
 * Ends every online session of the user, like an administrator in the admin console. Offline
 * sessions (`offline_access`) survive it.
 */
export async function adminLogout(keycloakUrl: string, username: string): Promise<void> {
  const admin = await postForm(`${keycloakUrl}/realms/master/protocol/openid-connect/token`, {
    grant_type: 'password',
    client_id: 'admin-cli',
    ...ADMIN,
  });
  const token = requireString(admin, 'access_token', 'The admin login');
  const query = `/users?username=${encodeURIComponent(username)}&exact=true`;
  const users = (await adminRequest(keycloakUrl, token, query)) as readonly { id: string }[];
  const [user] = users;
  if (user === undefined) throw new Error(`Keycloak has no user ${username}`);
  await adminRequest(keycloakUrl, token, `/users/${user.id}/logout`, 'POST');
}

/**
 * An access token of the client credentials grant (RFC 6749 §4.4), as a CI pipeline gets one with
 * its client secret, without operate.
 */
export async function clientCredentialsToken(
  issuer: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const answer = await tokenRequest(issuer, {
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  return requireString(answer, 'access_token', 'The client credentials grant');
}

interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/** Waits for one request to `/callback` on 127.0.0.1 and answers it. */
async function callbackServer(): Promise<{
  readonly redirectUri: string;
  readonly query: Promise<URLSearchParams>;
}> {
  let deliver: (query: URLSearchParams) => void = () => undefined;
  const query = new Promise<URLSearchParams>((resolve) => {
    deliver = resolve;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.writeHead(url.pathname === '/callback' ? 200 : 404, { connection: 'close' }).end();
    if (url.pathname !== '/callback') return;
    server.close();
    deliver(url.searchParams);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { redirectUri: `http://127.0.0.1:${port}/callback`, query };
}

/**
 * A complete auth code + PKCE login without the CLI (the topology self-check proves the realm's
 * behaviour independently of the code under test).
 */
export async function directLogin(issuer: string, clientId: string, scope: string) {
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const server = await callbackServer();
  const url = new URL(endpointsOf(issuer).authorization);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: server.redirectUri,
    scope,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  await keycloakLogin(url.toString());
  const callback = await server.query;
  if (callback.get('state') !== state) throw new Error('The callback carried another state');
  const answer = await tokenRequest(issuer, {
    grant_type: 'authorization_code',
    code: callback.get('code') ?? '',
    redirect_uri: server.redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  return {
    accessToken: requireString(answer, 'access_token', 'The code exchange'),
    refreshToken: requireString(answer, 'refresh_token', 'The code exchange'),
  } satisfies TokenSet;
}
