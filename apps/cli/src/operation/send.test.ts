import { describe, expect, it } from 'vitest';
import { basicAuth } from '../auth/basic.js';
import { noAuth } from '../auth/none.js';
import { OperateError } from '../errors.js';
import type { ClientOptions } from '../http/client.js';
import { sendRequest } from './send.js';

function client(response: () => Response): ClientOptions & { urls: string[] } {
  const urls: string[] = [];
  const fetch = (input: string | URL | Request) => {
    urls.push(input as string);
    return Promise.resolve(response());
  };
  return {
    urls,
    fetch: fetch,
    auth: noAuth(),
    timeoutMs: 1000,
    now: () => 0,
  };
}

async function caught(promise: Promise<unknown>): Promise<OperateError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    return error as OperateError;
  }
  throw new Error('expected an error');
}

const request = {
  method: 'POST',
  url: 'http://h/engine-rest/process-definition/key/x/start',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  body: '{"businessKey":"b"}',
};

describe('sendRequest', () => {
  it('decodes JSON responses and attaches the request preview', async () => {
    const options = client(
      () =>
        new Response('{"id":"pi-1"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(sendRequest(request, options)).resolves.toEqual({
      kind: 'json',
      status: 200,
      value: { id: 'pi-1' },
      text: '{"id":"pi-1"}',
      request: {
        method: 'POST',
        url: request.url,
        headers: request.headers,
        body: { businessKey: 'b' },
      },
    });
    expect(options.urls).toEqual([request.url]);
  });

  it('returns none for 204', async () => {
    const result = await sendRequest(
      request,
      client(() => new Response(null, { status: 204, statusText: 'No Content' })),
    );
    expect(result).toMatchObject({ kind: 'none', status: 204, statusText: 'No Content' });
  });

  it('reports 3xx statuses as redirect errors (they are never followed)', async () => {
    const error = await caught(
      sendRequest(
        request,
        client(
          () =>
            new Response('', {
              status: 302,
              headers: { location: 'http://sso.example/login?state=x' },
            }),
        ),
      ),
    );
    expect(error).toMatchObject({
      code: 'HTTP_REDIRECT',
      exitCode: 3,
      message: 'HTTP 302 Found: redirect to http://sso.example/login',
    });
  });

  it('passes the request headers to the 401 hint', async () => {
    const withCredentials = { ...request, headers: { Authorization: 'Basic eDp5' } };
    const error = await caught(
      sendRequest(
        withCredentials,
        client(() => new Response('', { status: 401 })),
      ),
    );
    expect(error.details.hint).toMatch(/^The engine rejected the credentials/);
    expect(error.details.request).toEqual({ method: 'POST', url: request.url });
  });

  it('names the user of rejected Basic auth credentials in the 401 hint', async () => {
    const auth = basicAuth({
      type: 'basic',
      username: 'demo',
      password: 'wrong-password',
      sources: { username: 'profile', password: 'env' },
    });
    const basic = { ...client(() => new Response('', { status: 401 })), auth };
    const error = await caught(sendRequest(request, basic));
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.details.hint).toBe(
      'The engine rejected the credentials of user demo (source: profile for the user, env for the password). Check the username and the password; `operate config show` shows where each comes from. After a failed login the engine refuses the user for a few seconds (and locks it after repeated failures), so wait before retrying.',
    );
    expect(error.details.request).toEqual({ method: 'POST', url: request.url });
    expect(JSON.stringify(error.details)).not.toContain('wrong-password');
    const forbidden = { ...client(() => new Response('', { status: 403 })), auth };
    expect((await caught(sendRequest(request, forbidden))).details.hint).toBe(
      'The user is authenticated but lacks the authorization for this operation.',
    );
  });

  it('passes why the auth provider sends no credentials to the 401 hint', async () => {
    const auth = noAuth('a password is set (from OPERATE_PASSWORD), but no username');
    const unauthenticated = { ...client(() => new Response('', { status: 401 })), auth };
    const error = await caught(sendRequest(request, unauthenticated));
    expect(error.details.hint).toMatch(
      /^The engine requires authentication and operate sent no credentials: a password is set \(from OPERATE_PASSWORD\), but no username\. Use Basic auth: /,
    );
  });

  it('maps HTTP errors with the engine message', async () => {
    const error = await caught(
      sendRequest(
        request,
        client(
          () =>
            new Response('{"type":"RestException","message":"No definition"}', {
              status: 400,
              statusText: 'Bad Request',
              headers: { 'content-type': 'application/json' },
            }),
        ),
      ),
    );
    expect(error.code).toBe('HTTP_CLIENT_ERROR');
    expect(error.message).toBe('HTTP 400 Bad Request: No definition');
    expect(error.details.status).toBe(400);
    expect(error.details.engineType).toBe('RestException');
    expect(error.details.request).toEqual({ method: 'POST', url: request.url });
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [500, 'HTTP_SERVER_ERROR'],
  ])('maps status %i to %s', async (status, code) => {
    const error = await caught(
      sendRequest(
        request,
        client(() => new Response('', { status })),
      ),
    );
    expect(error.code).toBe(code);
  });
});
