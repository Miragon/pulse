import { describe, expect, it } from 'vitest';
import {
  BASE_URL,
  engineError,
  fakeServer,
  type FakeServer,
  json,
  noContent,
} from '../../../test/support/fake-fetch.js';
import {
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from '../../../test/support/fake-runtime.js';
import { loadCatalog } from '../../catalog/catalog.js';
import { OperateError } from '../../errors.js';
import { run } from '../run.js';
import { findOperationByPath } from '../../catalog/catalog.js';
import { apiEffect, parseMethod } from './api.js';

const catalog = loadCatalog();

function cli(server: FakeServer, args: readonly string[], options: FakeRuntimeOptions = {}) {
  return execute(run, args, fakeRuntime({ fetch: server.fetch, ...options }));
}

function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error;
}

function usage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    expect((error as OperateError).code).toBe('USAGE');
    return (error as OperateError).message;
  }
  throw new Error('expected a usage error');
}

describe('api helpers', () => {
  it('accepts known methods in any case', () => {
    expect(parseMethod('get')).toBe('GET');
    expect(parseMethod('Delete')).toBe('DELETE');
    expect(usage(() => parseMethod('FETCH'))).toBe('Unsupported HTTP method "FETCH"');
  });

  it('prefers the base operation over presets with the same method and path', () => {
    const operation = findOperationByPath(catalog, 'PUT', '/batch/b1/suspended');
    expect(operation?.preset).toBeUndefined();
    expect(operation?.path).toBe('/batch/{id}/suspended');
  });

  it('takes the effect from the operation, else from the method', () => {
    const remove = findOperationByPath(catalog, 'POST', '/process-instance/delete');
    expect(apiEffect(remove, 'POST')).toBe('bulk');
    expect(apiEffect(undefined, 'GET')).toBe('read');
    expect(apiEffect(undefined, 'HEAD')).toBe('read');
    expect(apiEffect(undefined, 'OPTIONS')).toBe('read');
    expect(apiEffect(undefined, 'DELETE')).toBe('delete');
    expect(apiEffect(undefined, 'POST')).toBe('write');
    expect(apiEffect(undefined, 'PATCH')).toBe('write');
  });
});

describe('operate api: normalized paths', () => {
  it.each([
    '/process-instance/./delete',
    '/process-instance/delete/',
    '/process-instance//delete',
    '/process-instance/%2e/delete',
    '/x/../process-instance/delete',
    '/process-instance/%64elete',
  ])('needs --yes for the bulk delete written as %s and sends nothing', async (path) => {
    const server = fakeServer();
    const result = await cli(server, ['api', 'POST', path, '--body', '{}']);
    expect(result.code).toBe(2);
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
      message: expect.stringMatching(
        /^`operate api POST \/process-instance\/(?:delete|%64elete)` is a bulk operation/,
      ),
    });
    expect(server.requests).toEqual([]);
  });

  it('sends the normalized path', async () => {
    const server = fakeServer().on('POST', '/process-instance/delete', json({ id: 'batch' }));
    const result = await cli(server, [
      'api',
      'POST',
      '/x/../process-instance/./delete/',
      '--body',
      '{}',
      '--yes',
    ]);
    expect(result.code).toBe(0);
    expect(server.requests[0]?.url).toBe(`${BASE_URL}/process-instance/delete`);
  });

  it('refuses fragments and matrix parameters before sending', async () => {
    const server = fakeServer();
    const result = await cli(server, ['api', 'POST', '/process-instance/delete;x=1', '--yes']);
    expect(errorOf(result.stderr)).toMatchObject({ code: 'USAGE' });
    expect(server.requests).toEqual([]);
  });

  it('adds no engine prefix to engine independent operations', async () => {
    const server = fakeServer().on('GET', '/version', json({ version: '7.24.0' }));
    const result = await cli(server, ['api', 'GET', '/version', '--engine', 'second']);
    expect(result.code).toBe(0);
    expect(server.requests[0]?.url).toBe(`${BASE_URL}/version`);
  });
});

describe('operate api', () => {
  it('sends a GET request and prints the JSON response', async () => {
    const server = fakeServer().on('GET', '/process-definition/count', json({ count: 3 }));
    const result = await cli(server, ['api', 'get', 'process-definition/count']);
    expect(result).toMatchObject({ code: 0, stdout: '{"count":3}\n', stderr: '' });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      method: 'GET',
      url: `${BASE_URL}/process-definition/count`,
      headers: { accept: 'application/json' },
      body: undefined,
    });
  });

  it('builds the query and adds the engine prefix and headers', async () => {
    const server = fakeServer().on('GET', '/engine/second/task', json([]));
    const result = await cli(server, [
      'api',
      'GET',
      '/task?assignee=demo',
      '--query',
      'maxResults=5',
      '--query',
      'name=a b',
      '--engine',
      'second',
      '-H',
      'X-Team: a',
    ]);
    expect(result.code).toBe(0);
    expect(server.requests[0]?.url).toBe(
      `${BASE_URL}/engine/second/task?assignee=demo&maxResults=5&name=a+b`,
    );
    expect(server.requests[0]?.headers['x-team']).toBe('a');
  });

  it('sends requests to paths the catalog does not know', async () => {
    const server = fakeServer().on('GET', '/plugin/stats', json({ ok: true }));
    const result = await cli(server, ['api', 'GET', '/plugin/stats', '--read-only']);
    expect(result).toMatchObject({ code: 0, stdout: '{"ok":true}\n' });
    expect(server.requests[0]?.headers).toEqual({ accept: 'application/json' });
  });

  it('adds the engine prefix to paths the catalog does not know', async () => {
    const server = fakeServer().on('GET', '/engine/second/plugin/stats', json({ ok: true }));
    const result = await cli(server, ['api', 'GET', '/plugin/stats', '--engine', 'second']);
    expect(result).toMatchObject({ code: 0, stdout: '{"ok":true}\n' });
    expect(server.requests[0]?.url).toBe(`${BASE_URL}/engine/second/plugin/stats`);
  });

  it('uses the Accept header of the catalog operation', async () => {
    const result = await cli(fakeServer(), [
      'api',
      'GET',
      '/process-definition/p1/diagram',
      '--dry-run',
    ]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      headers: { Accept: 'application/octet-stream, */*' },
    });
  });

  it('sends --body as JSON from the argument, a file or stdin', async () => {
    const server = fakeServer().on('POST', '/message', noContent());
    const inline = await cli(server, ['api', 'POST', '/message', '--body', '{"messageName":"m"}']);
    expect(inline).toMatchObject({
      code: 0,
      stdout: '',
      stderr: 'Done: POST /message → 204 No Content\n',
    });
    await cli(server, ['api', 'POST', '/message', '--body', '@m.json'], {
      files: { 'm.json': '{"messageName":"f"}' },
    });
    await cli(server, ['api', 'POST', '/message', '--body', '-'], { stdin: '[1]' });
    expect(server.requests.map((request) => request.body)).toEqual([
      '{"messageName":"m"}',
      '{"messageName":"f"}',
      '[1]',
    ]);
    expect(server.requests[0]?.headers['content-type']).toBe('application/json');
  });

  it('reports invalid JSON in --body', async () => {
    const result = await cli(fakeServer(), ['api', 'POST', '/message', '--body', '{']);
    expect(result.code).toBe(2);
    expect(errorOf(result.stderr).message).toMatch(/^Invalid JSON in --body: /);
  });

  it('previews the request with --dry-run', async () => {
    const server = fakeServer();
    const result = await cli(server, ['api', 'DELETE', '/process-instance/p1', '--dry-run']);
    expect(result.code).toBe(0);
    expect(server.requests).toEqual([]);
    expect(JSON.parse(result.stdout)).toEqual({
      method: 'DELETE',
      url: `${BASE_URL}/process-instance/p1`,
      headers: { Accept: 'application/json' },
      curl: `curl -X DELETE '${BASE_URL}/process-instance/p1' -H 'Accept: application/json'`,
    });
  });

  it('guards deletes and bulk operations with --yes', async () => {
    const server = fakeServer()
      .on('DELETE', '/process-instance/p1', noContent())
      .on('DELETE', '/custom/thing', noContent());
    const refused = await cli(server, ['api', 'DELETE', '/process-instance/p1']);
    expect(refused.code).toBe(2);
    expect(errorOf(refused.stderr)).toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
      message:
        '`operate api DELETE /process-instance/p1` is a delete operation and needs confirmation',
    });
    const bulk = await cli(server, ['api', 'POST', '/process-instance/delete', '--body', '{}']);
    expect(errorOf(bulk.stderr)).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const unknown = await cli(server, ['api', 'DELETE', '/custom/thing']);
    expect(errorOf(unknown.stderr)).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(server.requests).toEqual([]);
    const confirmed = await cli(server, ['api', 'DELETE', '/process-instance/p1', '--yes']);
    expect(confirmed.code).toBe(0);
    expect(server.requests).toHaveLength(1);
  });

  it('allows only reads in read-only mode', async () => {
    const server = fakeServer().on('GET', '/task', json([]));
    const write = await cli(server, ['api', 'PUT', '/custom', '--read-only']);
    expect(errorOf(write.stderr)).toMatchObject({
      code: 'READ_ONLY',
      message: '`operate api PUT /custom` is a write operation and read-only mode is enabled',
    });
    const read = await cli(server, ['api', 'GET', '/task', '--read-only']);
    expect(read.code).toBe(0);
  });

  it('maps HTTP errors like the generated commands', async () => {
    const server = fakeServer().on(
      'GET',
      '/process-instance/x',
      engineError(404, 'InvalidRequestException', 'missing'),
    );
    const result = await cli(server, ['api', 'GET', '/process-instance/x']);
    expect(result.code).toBe(5);
    expect(errorOf(result.stderr)).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      hint: 'Check the id or key. List the existing ones with `operate process-instance list`.',
    });
  });

  it('keeps the generic hints for paths the catalog does not know', async () => {
    const server = fakeServer().on('POST', '/custom', engineError(400, 'T', 'bad'));
    const result = await cli(server, ['api', 'POST', '/custom']);
    expect(result.code).toBe(6);
    expect(errorOf(result.stderr)).toMatchObject({
      message: 'HTTP 400 Bad Request: bad',
      hint: 'The engine rejected the request. Check parameters and body with `operate describe <group> <command>`.',
    });
  });

  it('reports usage errors of the arguments', async () => {
    const method = await cli(fakeServer(), ['api', 'FETCH', '/task']);
    expect(errorOf(method.stderr)).toEqual({
      code: 'USAGE',
      exitCode: 2,
      message: 'Unsupported HTTP method "FETCH"',
      hint: 'Use one of: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS.',
    });
    const missing = await cli(fakeServer(), ['api', 'GET']);
    expect(errorOf(missing.stderr)).toMatchObject({
      message: "Missing required argument 'path'",
      hint: 'Run "operate api --help" for the usage.',
    });
  });
});
