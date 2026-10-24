/**
 * A fake engine for in-process tests: a fetch function that routes `METHOD /path` (relative to the
 * REST API root, without the query string) to handlers and records every request.
 */

export const BASE_URL = 'http://localhost:8080/engine-rest';

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  /** Path relative to the base URL, without the query string. */
  readonly path: string;
  readonly query: URLSearchParams;
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | FormData | undefined;
}

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

export interface FakeServer {
  readonly fetch: typeof globalThis.fetch;
  readonly requests: RecordedRequest[];
  /** Registers a handler or a fixed response (cloned for every call). */
  on(method: string, path: string, reply: Handler | Response): FakeServer;
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function text(body: string, contentType: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

export function binary(data: Uint8Array, contentType = 'application/octet-stream'): Response {
  return new Response(data, { status: 200, headers: { 'content-type': contentType } });
}

export function noContent(): Response {
  return new Response(null, { status: 204, statusText: 'No Content' });
}

/** The engine's ExceptionDto. */
export function engineError(status: number, type: string, message: string): Response {
  return new Response(JSON.stringify({ type, message }), {
    status,
    statusText: status === 404 ? 'Not Found' : '',
    headers: { 'content-type': 'application/json' },
  });
}

/** The error undici's fetch throws when nothing listens on the port. */
export function connectionRefused(): TypeError {
  const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8080'), {
    code: 'ECONNREFUSED',
  });
  return new TypeError('fetch failed', { cause });
}

function relativePath(url: URL, baseUrl: string): string {
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/+$/, '');
  return url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
}

function record(input: string | URL | Request, init: RequestInit | undefined, baseUrl: string) {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const body = init?.body;
  return {
    method: init?.method ?? 'GET',
    url: url.href,
    path: relativePath(url, baseUrl),
    query: url.searchParams,
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    body: typeof body === 'string' || body instanceof FormData ? body : undefined,
  } satisfies RecordedRequest;
}

export function fakeServer(baseUrl = BASE_URL): FakeServer {
  const routes = new Map<string, Handler>();
  const requests: RecordedRequest[] = [];
  const server: FakeServer = {
    requests,
    fetch: (input, init) => {
      const request = record(input, init, baseUrl);
      requests.push(request);
      const handler = routes.get(`${request.method} ${request.path}`);
      if (handler === undefined) {
        const message = `No fake route for ${request.method} ${request.path}`;
        return Promise.resolve(engineError(404, 'NotFoundException', message));
      }
      try {
        return Promise.resolve(handler(request));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    on(method, path, reply) {
      routes.set(`${method} ${path}`, reply instanceof Response ? () => reply.clone() : reply);
      return server;
    },
  };
  return server;
}
