/**
 * The authorization server's endpoints (design §16.7): the configured explicit endpoints, or
 * OpenID Connect discovery with the RFC 8414 location as fallback. The metadata must name exactly
 * the configured issuer, support PKCE S256 and a client authentication operate can do. Only
 * `operate auth login` discovers; refreshes and logout use the endpoints cached at login.
 */

import { configError } from '../../config/config-error.js';
import { ISSUER_EXAMPLE, validateOAuthUrl } from '../../config/oauth.js';
import { endpointSource } from '../../config/resolve-oauth.js';
import { ENV, type OAuthConfig } from '../../config/types.js';
import { OperateError } from '../../errors.js';
import { getJson, sanitize, type ServerAnswer, shownUrl, statusLine, statusOf } from './http.js';
import type { ClientAuthMethod, OAuthDeps, ServerMetadata } from './types.js';

const OIDC_PATH = '/.well-known/openid-configuration';
const RFC8414_PATH = '/.well-known/oauth-authorization-server';

const DISCOVERY_HINT = `The issuer is the URL in front of ${OIDC_PATH}, e.g. ${ISSUER_EXAMPLE}; or configure both endpoints (--oauth-authorization-endpoint, --oauth-token-endpoint).`;

/** The two discovery locations of an issuer: OpenID Connect first, then RFC 8414. */
export function discoveryUrls(issuer: string): [string, string] {
  const trimmed = issuer.replace(/\/+$/, '');
  const url = new URL(trimmed);
  const path = url.pathname === '/' ? '' : url.pathname;
  return [`${trimmed}${OIDC_PATH}`, `${url.origin}${RFC8414_PATH}${path}`];
}

/** `GET <url> → <status>`. */
function attempt(answer: ServerAnswer): string {
  return `GET ${shownUrl(answer.url)} → ${statusOf(answer)}`;
}

/**
 * CONFIG for an unusable discovery answer; `earlier` is the OpenID Connect answer (404) when the
 * RFC 8414 location was tried after it, so the message names the URL the hint talks about.
 */
function failed(answer: ServerAnswer, problem?: string, earlier?: ServerAnswer): OperateError {
  const suffix = problem === undefined ? '' : `, ${problem}`;
  const before = earlier === undefined ? '' : `${attempt(earlier)}, then `;
  return configError(
    `OAuth discovery failed: ${before}${attempt(answer)}${suffix}`,
    DISCOVERY_HINT,
  );
}

function serverFailed(answer: ServerAnswer): OperateError {
  return new OperateError(
    'HTTP_SERVER_ERROR',
    `The authorization server failed: ${statusLine(answer)}`,
    {
      status: answer.status,
      request: { method: 'GET', url: shownUrl(answer.url) },
      hint: 'Retry later.',
    },
  );
}

async function fetchDocument(issuer: string, config: OAuthConfig, deps: OAuthDeps) {
  const source = endpointSource(config);
  const [oidc, rfc8414] = discoveryUrls(issuer);
  const first = await getJson({ url: oidc, source }, deps);
  const answer = first.status === 404 ? await getJson({ url: rfc8414, source }, deps) : first;
  if (answer.status >= 500) throw serverFailed(answer);
  if (answer.status !== 200) throw failed(answer, undefined, answer === first ? undefined : first);
  if (answer.json === undefined) throw failed(answer, 'but the answer is not a JSON object');
  return { answer, document: answer.json };
}

/** A required endpoint of the document, validated like a configured one. */
function endpointOf(
  answer: ServerAnswer,
  document: Record<string, unknown>,
  key: string,
  kind: 'authorization endpoint' | 'token endpoint',
) {
  const value = document[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw failed(answer, `but the document has no ${key}`);
  }
  return validateOAuthUrl(value, kind, `${key} of the discovery document`);
}

/** The revocation endpoint when it is valid; an unusable one is ignored. */
function revocationOf(document: Record<string, unknown>): string | null {
  const value = document.revocation_endpoint;
  if (typeof value !== 'string') return null;
  try {
    return validateOAuthUrl(
      value,
      'token endpoint',
      'revocation_endpoint of the discovery document',
    );
  } catch {
    return null;
  }
}

function checkPkce(document: Record<string, unknown>, issuer: string): void {
  const methods = document.code_challenge_methods_supported;
  if (!Array.isArray(methods) || methods.includes('S256')) return;
  throw configError(
    `The authorization server ${issuer} does not support PKCE with S256`,
    'Its discovery document lists code_challenge_methods_supported without S256; operate only uses S256 (RFC 7636, RFC 9700). Enable S256 for the client.',
  );
}

/**
 * client_secret_basic when the document lists no methods or lists it, else client_secret_post
 * when listed; a confidential client needs one of them.
 */
function clientAuthMethodOf(
  document: Record<string, unknown>,
  config: OAuthConfig,
): ClientAuthMethod {
  const methods = document.token_endpoint_auth_methods_supported;
  if (!Array.isArray(methods) || methods.includes('client_secret_basic'))
    return 'client_secret_basic';
  if (methods.includes('client_secret_post')) return 'client_secret_post';
  if (config.clientSecret === undefined) return 'client_secret_basic';
  throw configError(
    'The authorization server supports neither client_secret_basic nor client_secret_post',
    'operate authenticates a confidential client with its secret only. Use a public client (no client secret) with PKCE.',
  );
}

/**
 * Where to fix the issuer. The document's value stays out of the command: hints are run as they
 * are, and the value comes from the server (the message shows it).
 */
function issuerFix(config: OAuthConfig): string {
  return config.sources.endpoints === 'env'
    ? `${ENV.oauthIssuer}=<issuer>`
    : `operate config set ${config.profile ?? '<profile>'} --oauth-issuer <issuer>`;
}

function checkIssuer(answer: ServerAnswer, document: Record<string, unknown>, config: OAuthConfig) {
  const named = document.issuer;
  const issuer = config.issuer ?? '';
  if (named === issuer) return;
  if (typeof named !== 'string') throw failed(answer, 'but the document has no issuer');
  throw configError(
    `The discovery document names issuer "${sanitize(named)}", not "${issuer}"`,
    `Set the issuer exactly as the document names it (Auth0 issuers end with "/"): ${issuerFix(config)}.`,
  );
}

async function discover(
  issuer: string,
  config: OAuthConfig,
  deps: OAuthDeps,
): Promise<ServerMetadata> {
  const { answer, document } = await fetchDocument(issuer, config, deps);
  checkIssuer(answer, document, config);
  const authorizationEndpoint = endpointOf(
    answer,
    document,
    'authorization_endpoint',
    'authorization endpoint',
  );
  const tokenEndpoint = endpointOf(answer, document, 'token_endpoint', 'token endpoint');
  checkPkce(document, issuer);
  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    revocationEndpoint: revocationOf(document),
    issParameterRequired: document.authorization_response_iss_parameter_supported === true,
    clientAuthMethod: clientAuthMethodOf(document, config),
  };
}

/** The endpoints of the login: the configured ones (no request), else discovered. */
export async function serverMetadata(
  config: OAuthConfig,
  deps: OAuthDeps,
): Promise<ServerMetadata> {
  const { issuer, authorizationEndpoint, tokenEndpoint } = config;
  if (authorizationEndpoint !== undefined && tokenEndpoint !== undefined) {
    return {
      issuer: issuer ?? null,
      authorizationEndpoint,
      tokenEndpoint,
      revocationEndpoint: null,
      issParameterRequired: false,
      clientAuthMethod: 'client_secret_basic',
    };
  }
  // resolution guarantees an issuer without endpoints
  return discover(issuer ?? '', config, deps);
}
