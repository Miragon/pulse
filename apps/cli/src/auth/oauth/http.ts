/**
 * HTTP to the authorization server (design §16.7): every request goes through `deps.fetch`, never
 * follows redirects, is bounded by `--timeout` and asks for JSON; forms are
 * application/x-www-form-urlencoded. `--verbose` traces method, URL, headers (the client
 * credentials always masked: the trace writer cannot tell them from the engine's Bearer token)
 * and status, never bodies: codes, verifiers, tokens and secrets travel only in bodies.
 */

import { redactUrl } from '../../config/redact.js';
import { OperateError } from '../../errors.js';
import { failureDetail, networkError } from '../../http/client.js';
import { statusTextOf } from '../../http/status.js';
import { isRecord } from '../../util.js';
import { base64 } from '../basic.js';
import type { ClientAuthMethod, OAuthDeps } from './types.js';

/** How the client authenticates: public (client id in the form) or with a secret. */
export interface ClientCredentials {
  readonly clientId: string;
  readonly clientSecret?: string | undefined;
  readonly method: ClientAuthMethod;
}

/** An answer of the authorization server; `json` is the body when it is a JSON object. */
export interface ServerAnswer {
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly json: Record<string, unknown> | undefined;
}

/** Where the requests go, for messages: the issuer or endpoint and where it was configured. */
export interface Endpoint {
  readonly url: string;
  /** `OPERATE_OAUTH_ISSUER`, `auth.issuer of profile "p"`, ... */
  readonly source: string;
}

const MASKED_BASIC = 'Basic ***';

/** RFC 6749 §2.3.1: id and secret are form-encoded before they are joined and Base64 encoded. */
function formEncode(text: string): string {
  return new URLSearchParams({ x: text }).toString().slice(2);
}

/** Basic client authentication: `Basic base64(utf8(formEncode(id) ":" formEncode(secret)))`. */
export function clientBasicHeader(clientId: string, clientSecret: string): string {
  return `Basic ${base64(`${formEncode(clientId)}:${formEncode(clientSecret)}`)}`;
}

/**
 * Adds the client authentication to a token request: `client_id` in the form for a public
 * client, the Authorization header (client_secret_basic) or `client_id` + `client_secret` in the
 * form (client_secret_post) for a confidential one. Returns the extra headers.
 */
export function authenticate(form: URLSearchParams, client: ClientCredentials) {
  const { clientId, clientSecret } = client;
  if (clientSecret === undefined) {
    form.set('client_id', clientId);
    return {};
  }
  if (client.method === 'client_secret_post') {
    form.set('client_id', clientId);
    form.set('client_secret', clientSecret);
    return {};
  }
  return { Authorization: clientBasicHeader(clientId, clientSecret) };
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Longest excerpt of a text from the authorization server that messages show. */
const MAX_SHOWN = 200;

/** Server text as messages may show it: control characters removed, at most 200 characters. */
export function sanitize(text: string): string {
  const clean = text.replace(/\p{Cc}/gu, '');
  return clean.length > MAX_SHOWN ? `${clean.slice(0, MAX_SHOWN)}…` : clean;
}

/** The URL as messages show it: without query and fragment. */
export function shownUrl(url: string): string {
  return redactUrl(url);
}

function unreachable(error: unknown, method: string, endpoint: Endpoint, deps: OAuthDeps) {
  const { url } = endpoint;
  const mapped = networkError(error, { method, url, headers: {} }, deps.timeoutMs);
  const detail =
    mapped.code === 'TIMEOUT' ? `timed out after ${deps.timeoutMs} ms` : failureDetail(error);
  return new OperateError(
    mapped.code === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK',
    `Cannot reach the authorization server at ${shownUrl(url)}${detail === undefined ? '' : ` (${detail})`}`,
    {
      request: { method, url: shownUrl(url) },
      hint: `Check the issuer or endpoint (${endpoint.source}) and the network; a private CA needs NODE_EXTRA_CA_CERTS.`,
    },
    error,
  );
}

function traceHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  return headers.Authorization === undefined
    ? { ...headers }
    : { ...headers, Authorization: MASKED_BASIC };
}

async function request(
  method: 'GET' | 'POST',
  endpoint: Endpoint,
  init: { headers: Record<string, string>; body?: string },
  deps: OAuthDeps,
): Promise<ServerAnswer> {
  const headers = { Accept: 'application/json', ...init.headers };
  deps.trace?.({ type: 'request', method, url: endpoint.url, headers: traceHeaders(headers) });
  const started = deps.now();
  let response: Response;
  let body: Uint8Array;
  try {
    response = await deps.fetch(endpoint.url, {
      method,
      headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      redirect: 'manual',
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
    body = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw unreachable(error, method, endpoint, deps);
  }
  const statusText = statusTextOf(response.status, response.statusText);
  deps.trace?.({
    type: 'response',
    status: response.status,
    statusText,
    durationMs: deps.now() - started,
    bytes: body.length,
  });
  const json = parseObject(new TextDecoder().decode(body));
  return { url: endpoint.url, status: response.status, statusText, json };
}

/** GET a JSON document (discovery). */
export function getJson(endpoint: Endpoint, deps: OAuthDeps): Promise<ServerAnswer> {
  return request('GET', endpoint, { headers: {} }, deps);
}

/** POST a form with client authentication (token and revocation requests). */
export function postForm(
  endpoint: Endpoint,
  form: URLSearchParams,
  client: ClientCredentials,
  deps: OAuthDeps,
): Promise<ServerAnswer> {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    ...authenticate(form, client),
  };
  return request('POST', endpoint, { headers, body: form.toString() }, deps);
}

/** `503 Service Unavailable`. */
export function statusOf(answer: Pick<ServerAnswer, 'status' | 'statusText'>): string {
  return `${answer.status}${answer.statusText === '' ? '' : ` ${answer.statusText}`}`;
}

/** `HTTP 503 Service Unavailable`. */
export function statusLine(answer: Pick<ServerAnswer, 'status' | 'statusText'>): string {
  return `HTTP ${statusOf(answer)}`;
}
