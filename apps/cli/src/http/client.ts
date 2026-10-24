/** Sends requests with authentication, timeout, tracing and one retry after a credential refresh. */

import type { AuthProvider } from '../auth/types.js';
import { OperateError } from '../errors.js';
import { isRecord, mergeHeaders } from '../util.js';
import { statusTextOf } from './status.js';
import type { HttpRequest, HttpResponse, TraceEvent } from './types.js';

export interface ClientOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly auth: AuthProvider;
  readonly timeoutMs: number;
  readonly now: () => number;
  /** Receives one event per request and response (`--verbose`); the CLI formats and masks them. */
  readonly trace?: (event: TraceEvent) => void;
}

const CERTIFICATE_ERRORS: ReadonlySet<string | undefined> = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const DNS_ERRORS: ReadonlySet<string | undefined> = new Set(['ENOTFOUND', 'EAI_AGAIN']);

/** undici refuses to build the request (e.g. a header it does not allow): nothing was sent. */
const REQUEST_ERRORS: ReadonlySet<string | undefined> = new Set([
  'UND_ERR_INVALID_ARG',
  'UND_ERR_NOT_SUPPORTED',
]);

/** Generic message of undici's fetch; the useful information is in `cause`. */
const GENERIC_FETCH_MESSAGE = 'fetch failed';

/**
 * Sends the request. A 401 response triggers `auth.refresh()` (if the provider supports it) and,
 * when that reports new credentials, exactly one retry.
 */
export async function send(request: HttpRequest, options: ClientOptions): Promise<HttpResponse> {
  const response = await attempt(request, options);
  if (response.status !== 401 || options.auth.refresh === undefined) return response;
  return (await options.auth.refresh()) ? attempt(request, options) : response;
}

async function attempt(request: HttpRequest, options: ClientOptions): Promise<HttpResponse> {
  const headers = mergeHeaders(request.headers, await options.auth.headers());
  options.trace?.({ type: 'request', method: request.method, url: request.url, headers });
  const started = options.now();
  const response = await exchange(request, headers, options);
  options.trace?.({
    type: 'response',
    status: response.status,
    statusText: response.statusText,
    durationMs: options.now() - started,
    bytes: response.body.length,
  });
  return response;
}

async function exchange(
  request: HttpRequest,
  headers: Readonly<Record<string, string>>,
  options: ClientOptions,
): Promise<HttpResponse> {
  try {
    const response = await options.fetch(request.url, {
      method: request.method,
      headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      // 3xx answers are errors (see redirectError): following them would turn writes into GETs
      // of a login page and send custom credential headers to another origin
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const body = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      statusText: statusTextOf(response.status, response.statusText),
      contentType: response.headers.get('content-type') ?? '',
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  } catch (error) {
    throw networkError(error, request, options.timeoutMs);
  }
}

function stringProperty(value: unknown, key: string): string | undefined {
  const property = isRecord(value) ? value[key] : undefined;
  return typeof property === 'string' && property !== '' ? property : undefined;
}

/** System error code of a failed fetch: `cause.code`, or the first of `cause.errors` (AggregateError). */
function errorCode(error: unknown): string | undefined {
  const cause = isRecord(error) ? error.cause : undefined;
  const first: unknown =
    isRecord(cause) && Array.isArray(cause.errors) ? (cause.errors as unknown[])[0] : undefined;
  return stringProperty(cause, 'code') ?? stringProperty(first, 'code');
}

/** Most specific explanation of a failure: the system code, else the most specific message. */
export function failureDetail(error: unknown): string | undefined {
  const cause = isRecord(error) ? error.cause : undefined;
  const message = stringProperty(cause, 'message') ?? stringProperty(error, 'message');
  return errorCode(error) ?? (message === GENERIC_FETCH_MESSAGE ? undefined : message);
}

export function networkError(
  error: unknown,
  request: HttpRequest,
  timeoutMs: number,
): OperateError {
  const target = { method: request.method, url: request.url };
  const name = stringProperty(error, 'name');
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new OperateError(
      'TIMEOUT',
      `Request timed out after ${timeoutMs} ms`,
      {
        request: target,
        hint: 'Increase the timeout with --timeout <ms> or OPERATE_TIMEOUT, or check the engine load.',
      },
      error,
    );
  }
  if (REQUEST_ERRORS.has(errorCode(error))) return invalidRequestError(error, target);
  const detail = failureDetail(error);
  return new OperateError(
    'NETWORK',
    `Cannot reach ${request.url}${detail === undefined ? '' : ` (${detail})`}`,
    { request: target, hint: networkHint(errorCode(error)) },
    error,
  );
}

/** undici could not build the request; nothing reached the network. */
function invalidRequestError(
  error: unknown,
  target: { readonly method: string; readonly url: string },
): OperateError {
  const cause = isRecord(error) ? error.cause : undefined;
  const reason = stringProperty(cause, 'message') ?? errorCode(error) ?? 'unknown reason';
  return new OperateError(
    'USAGE',
    `Cannot send ${target.method} ${target.url}: invalid request (${reason})`,
    {
      request: target,
      hint: 'Check the extra headers (-H, OPERATE_HEADERS, the profile headers): hop-by-hop headers such as Connection, Keep-Alive, Transfer-Encoding, Upgrade and Expect are not allowed.',
    },
    error,
  );
}

function networkHint(code: string | undefined): string {
  if (CERTIFICATE_ERRORS.has(code)) {
    return 'The TLS certificate is not trusted. Point NODE_EXTRA_CA_CERTS to your CA bundle.';
  }
  if (DNS_ERRORS.has(code)) {
    return 'The host name does not resolve. Check --url, OPERATE_URL or your profile.';
  }
  return 'Is the engine running? Check --url, OPERATE_URL or `operate config show`. Run `operate ping` to test the connection.';
}
