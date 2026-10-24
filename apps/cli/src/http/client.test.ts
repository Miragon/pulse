import { describe, expect, it, vi } from 'vitest';
import type { AuthProvider } from '../auth/types.js';
import { OperateError } from '../errors.js';
import { type ClientOptions, networkError, send } from './client.js';
import type { HttpRequest, TraceEvent } from './types.js';

const URL_ = 'http://localhost:8080/engine-rest/process-instance';

const REQUEST: HttpRequest = {
  method: 'GET',
  url: URL_,
  headers: { Accept: 'application/json', 'X-Tenant': 'acme' },
};

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(...outcomes: (Response | Error | (() => Promise<Response>))[]) {
  const calls: Call[] = [];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const next = outcomes.shift();
    if (next === undefined) return Promise.reject(new Error('unexpected fetch call'));
    if (next instanceof Error) return Promise.reject(next);
    return typeof next === 'function' ? next() : Promise.resolve(next);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function json(status: number, body: unknown = {}, statusText = ''): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

function noAuth(headers: Record<string, string> = {}): AuthProvider {
  return { type: 'none', headers: () => Promise.resolve(headers) };
}

function options(
  fetch: typeof globalThis.fetch,
  overrides: Partial<ClientOptions> = {},
): ClientOptions {
  return { fetch, auth: noAuth(), timeoutMs: 1000, now: () => 0, ...overrides };
}

async function failure(promise: Promise<unknown>): Promise<OperateError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof OperateError))
    throw new Error(`expected OperateError, got ${String(error)}`);
  return error;
}

describe('send', () => {
  it('sends method, url, merged headers, body and a timeout signal', async () => {
    const { fetch, calls } = fakeFetch(json(200, { ok: true }, 'OK'));
    const auth = noAuth({ Authorization: 'Bearer t' });
    const request: HttpRequest = { ...REQUEST, method: 'POST', body: '{"a":1}' };
    await send(request, options(fetch, { auth }));
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(URL_);
    expect(call?.init.method).toBe('POST');
    expect(call?.init.body).toBe('{"a":1}');
    expect(call?.init.headers).toEqual({
      Accept: 'application/json',
      'X-Tenant': 'acme',
      Authorization: 'Bearer t',
    });
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    // redirects are errors (redirectError), never followed
    expect(call?.init.redirect).toBe('manual');
  });

  it('lets auth headers replace request headers case-insensitively', async () => {
    const { fetch, calls } = fakeFetch(json(200));
    const request = { ...REQUEST, headers: { authorization: 'Basic user', Accept: '*/*' } };
    await send(request, options(fetch, { auth: noAuth({ Authorization: 'Bearer new' }) }));
    expect(calls[0]?.init.headers).toEqual({ Accept: '*/*', Authorization: 'Bearer new' });
  });

  it('omits the body when the request has none', async () => {
    const { fetch, calls } = fakeFetch(json(200));
    await send(REQUEST, options(fetch));
    expect(calls[0]?.init).not.toHaveProperty('body');
  });

  it('returns status, status text, content type, headers and the raw body', async () => {
    const { fetch } = fakeFetch(json(200, { id: 'a' }, 'OK'));
    const response = await send(REQUEST, options(fetch));
    expect(response.status).toBe(200);
    expect(response.statusText).toBe('OK');
    expect(response.contentType).toBe('application/json');
    expect(response.headers).toEqual({ 'content-type': 'application/json' });
    expect(new TextDecoder().decode(response.body)).toBe('{"id":"a"}');
  });

  it('fills in the reason phrase when the server sends none (Tomcat)', async () => {
    const events: TraceEvent[] = [];
    const { fetch } = fakeFetch(new Response(null, { status: 204 }));
    const response = await send(REQUEST, options(fetch, { trace: (event) => events.push(event) }));
    expect(response.statusText).toBe('No Content');
    expect(events[1]).toMatchObject({ type: 'response', status: 204, statusText: 'No Content' });
  });

  it('reports an empty content type when the response has none', async () => {
    const { fetch } = fakeFetch(new Response(null, { status: 204, statusText: 'No Content' }));
    const response = await send(REQUEST, options(fetch));
    expect(response.contentType).toBe('');
    expect(response.body).toEqual(new Uint8Array());
  });

  describe('credential refresh', () => {
    it('retries exactly once with fresh headers when refresh() returns true', async () => {
      const { fetch, calls } = fakeFetch(json(401), json(200, { ok: 1 }));
      let token = 'old';
      const refresh = vi.fn(() => {
        token = 'new';
        return Promise.resolve(true);
      });
      const auth: AuthProvider = {
        type: 'oauth',
        headers: () => Promise.resolve({ Authorization: `Bearer ${token}` }),
        refresh,
      };
      const response = await send(REQUEST, options(fetch, { auth }));
      expect(response.status).toBe(200);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(2);
      expect(
        calls.map((call) => (call.init.headers as Record<string, string>).Authorization),
      ).toEqual(['Bearer old', 'Bearer new']);
    });

    it('does not retry a second time when the retry is rejected again', async () => {
      const { fetch, calls } = fakeFetch(json(401), json(401, { message: 'still' }));
      const refresh = vi.fn(() => Promise.resolve(true));
      const response = await send(REQUEST, options(fetch, { auth: { ...noAuth(), refresh } }));
      expect(response.status).toBe(401);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(2);
    });

    it('returns the 401 response when refresh() returns false', async () => {
      const { fetch, calls } = fakeFetch(json(401, { first: true }));
      const refresh = vi.fn(() => Promise.resolve(false));
      const response = await send(REQUEST, options(fetch, { auth: { ...noAuth(), refresh } }));
      expect(response.status).toBe(401);
      expect(new TextDecoder().decode(response.body)).toBe('{"first":true}');
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(1);
    });

    it('returns the 401 response when the provider cannot refresh', async () => {
      const { fetch, calls } = fakeFetch(json(401));
      const response = await send(REQUEST, options(fetch));
      expect(response.status).toBe(401);
      expect(calls).toHaveLength(1);
    });

    it('propagates an error of refresh() instead of the 401', async () => {
      const { fetch, calls } = fakeFetch(json(401));
      const failure = new OperateError('LOGIN_REQUIRED', 'revoked');
      const refresh = vi.fn(() => Promise.reject(failure));
      await expect(send(REQUEST, options(fetch, { auth: { ...noAuth(), refresh } }))).rejects.toBe(
        failure,
      );
      expect(calls).toHaveLength(1);
    });

    it.each([200, 400, 403, 404, 500])('does not refresh after status %i', async (status) => {
      const { fetch, calls } = fakeFetch(json(status));
      const refresh = vi.fn(() => Promise.resolve(true));
      const response = await send(REQUEST, options(fetch, { auth: { ...noAuth(), refresh } }));
      expect(response.status).toBe(status);
      expect(refresh).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1);
    });
  });

  describe('trace', () => {
    it('emits a request event with the final headers and a response event', async () => {
      const { fetch } = fakeFetch(json(201, { id: 'abc' }, 'Created'));
      const events: TraceEvent[] = [];
      const times = [100, 142];
      const now = vi.fn(() => times.shift() ?? 0);
      await send(
        { ...REQUEST, method: 'POST' },
        options(fetch, {
          auth: noAuth({ Authorization: 'Bearer t' }),
          now,
          trace: (e) => events.push(e),
        }),
      );
      expect(events).toEqual([
        {
          type: 'request',
          method: 'POST',
          url: URL_,
          headers: { Accept: 'application/json', 'X-Tenant': 'acme', Authorization: 'Bearer t' },
        },
        { type: 'response', status: 201, statusText: 'Created', durationMs: 42, bytes: 12 },
      ]);
    });

    it('emits events for both attempts of a retried request', async () => {
      const { fetch } = fakeFetch(json(401, {}, 'Unauthorized'), json(200, [], 'OK'));
      const events: TraceEvent[] = [];
      const auth: AuthProvider = { ...noAuth(), refresh: () => Promise.resolve(true) };
      await send(REQUEST, options(fetch, { auth, trace: (e) => events.push(e) }));
      expect(events.map((event) => event.type)).toEqual([
        'request',
        'response',
        'request',
        'response',
      ]);
      expect(events[1]).toMatchObject({ status: 401, statusText: 'Unauthorized', bytes: 2 });
      expect(events[3]).toMatchObject({ status: 200, statusText: 'OK', bytes: 2 });
    });

    it('emits only the request event when the request fails', async () => {
      const { fetch } = fakeFetch(new TypeError('fetch failed'));
      const events: TraceEvent[] = [];
      await expect(send(REQUEST, options(fetch, { trace: (e) => events.push(e) }))).rejects.toThrow(
        OperateError,
      );
      expect(events.map((event) => event.type)).toEqual(['request']);
    });

    it('does not mistake a failing trace callback for a network error', async () => {
      const { fetch } = fakeFetch(json(200));
      const trace = (event: TraceEvent) => {
        if (event.type === 'response') throw new Error('trace broke');
      };
      await expect(send(REQUEST, options(fetch, { trace }))).rejects.toThrow(
        new Error('trace broke'),
      );
    });
  });

  describe('failures', () => {
    it('turns an elapsed timeout into a TIMEOUT error', async () => {
      const waiting = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(init.signal?.reason as Error);
            });
          }),
      );
      const error = await failure(send(REQUEST, options(waiting, { timeoutMs: 5 })));
      expect(error.code).toBe('TIMEOUT');
      expect(error.exitCode).toBe(8);
      expect(error.message).toBe('Request timed out after 5 ms');
      expect(error.details).toEqual({
        request: { method: 'GET', url: URL_ },
        hint: 'Increase the timeout with --timeout <ms> or OPERATE_TIMEOUT, or check the engine load.',
      });
      expect((error.cause as Error).name).toBe('TimeoutError');
    });

    it('wraps network errors with the system error code', async () => {
      const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8080'), {
        code: 'ECONNREFUSED',
      });
      const thrown = new TypeError('fetch failed', { cause });
      const { fetch } = fakeFetch(thrown);
      const error = await failure(send(REQUEST, options(fetch)));
      expect(error.code).toBe('NETWORK');
      expect(error.exitCode).toBe(8);
      expect(error.message).toBe(`Cannot reach ${URL_} (ECONNREFUSED)`);
      expect(error.details).toEqual({
        request: { method: 'GET', url: URL_ },
        hint: 'Is the engine running? Check --url, OPERATE_URL or `operate config show`. Run `operate ping` to test the connection.',
      });
      expect(error.cause).toBe(thrown);
    });

    it('fails with a network error when reading the body fails', async () => {
      const broken = new Response('x');
      vi.spyOn(broken, 'arrayBuffer').mockRejectedValue(
        new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } }),
      );
      const { fetch } = fakeFetch(broken);
      const error = await failure(send(REQUEST, options(fetch)));
      expect(error.message).toBe(`Cannot reach ${URL_} (UND_ERR_SOCKET)`);
    });
  });
});

describe('networkError', () => {
  const hints = {
    tls: 'The TLS certificate is not trusted. Point NODE_EXTRA_CA_CERTS to your CA bundle.',
    dns: 'The host name does not resolve. Check --url, OPERATE_URL or your profile.',
    generic:
      'Is the engine running? Check --url, OPERATE_URL or `operate config show`. Run `operate ping` to test the connection.',
  };

  function fetchFailed(cause: unknown): TypeError {
    return new TypeError('fetch failed', { cause });
  }

  it.each(['TimeoutError', 'AbortError'])('maps %s to TIMEOUT', (name) => {
    const error = networkError(new DOMException('aborted', name), REQUEST, 250);
    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toBe('Request timed out after 250 ms');
  });

  it('takes the first code of an AggregateError-style cause', () => {
    const cause = {
      errors: [{ code: 'ECONNREFUSED' }, { code: 'EHOSTUNREACH' }],
      message: '',
    };
    const error = networkError(fetchFailed(cause), REQUEST, 1);
    expect(error.message).toBe(`Cannot reach ${URL_} (ECONNREFUSED)`);
    expect(error.details.hint).toBe(hints.generic);
  });

  it('prefers cause.code over cause.errors', () => {
    const cause = { code: 'ETIMEDOUT', errors: [{ code: 'ECONNREFUSED' }] };
    expect(networkError(fetchFailed(cause), REQUEST, 1).message).toBe(
      `Cannot reach ${URL_} (ETIMEDOUT)`,
    );
  });

  it.each([
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ])('hints at the CA bundle for %s', (code) => {
    const error = networkError(fetchFailed({ code }), REQUEST, 1);
    expect(error.code).toBe('NETWORK');
    expect(error.message).toBe(`Cannot reach ${URL_} (${code})`);
    expect(error.details.hint).toBe(hints.tls);
  });

  it.each(['ENOTFOUND', 'EAI_AGAIN'])('hints at the host name for %s', (code) => {
    const error = networkError(fetchFailed({ code }), REQUEST, 1);
    expect(error.details.hint).toBe(hints.dns);
  });

  it('uses the cause message when there is no code', () => {
    const error = networkError(fetchFailed(new Error('other side closed')), REQUEST, 1);
    expect(error.message).toBe(`Cannot reach ${URL_} (other side closed)`);
    expect(error.details.hint).toBe(hints.generic);
  });

  it('uses the error message when there is neither code nor cause', () => {
    const thrown = new TypeError('Headers.append: "a\nb" is an invalid header value.');
    expect(networkError(thrown, REQUEST, 1).message).toBe(
      `Cannot reach ${URL_} (Headers.append: "a\nb" is an invalid header value.)`,
    );
  });

  it('drops the generic "fetch failed" message', () => {
    expect(networkError(new TypeError('fetch failed'), REQUEST, 1).message).toBe(
      `Cannot reach ${URL_}`,
    );
  });

  it('ignores empty and non-string codes', () => {
    expect(networkError(fetchFailed({ code: '' }), REQUEST, 1).message).toBe(
      `Cannot reach ${URL_}`,
    );
    expect(networkError(fetchFailed({ code: 42, errors: 'x' }), REQUEST, 1).message).toBe(
      `Cannot reach ${URL_}`,
    );
  });

  it.each([
    ['UND_ERR_INVALID_ARG', 'invalid keep-alive header'],
    ['UND_ERR_NOT_SUPPORTED', 'expect header not supported'],
  ])('reports %s as an invalid request (USAGE), not as network error', (code, message) => {
    const error = networkError(
      fetchFailed(Object.assign(new Error(message), { code })),
      REQUEST,
      1,
    );
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe(`Cannot send GET ${URL_}: invalid request (${message})`);
    expect(error.details.hint).toContain('hop-by-hop headers such as Connection');
    const bare = networkError(fetchFailed({ code }), REQUEST, 1);
    expect(bare.message).toBe(`Cannot send GET ${URL_}: invalid request (${code})`);
  });

  it('copes with thrown values that are not objects', () => {
    for (const thrown of [undefined, null, 'boom', 7]) {
      const error = networkError(thrown, REQUEST, 1);
      expect(error.code).toBe('NETWORK');
      expect(error.message).toBe(`Cannot reach ${URL_}`);
      expect(error.details).toEqual({
        request: { method: 'GET', url: URL_ },
        hint: hints.generic,
      });
    }
  });
});
