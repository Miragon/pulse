import { describe, expect, it } from 'vitest';
import { portOf } from '../../test/support/engine-port.js';
import {
  BASE_URL,
  engineError,
  fakeServer,
  json,
  noContent,
  text,
} from '../../test/support/fake-fetch.js';
import { basicAuth } from '../auth/basic.js';
import { loadCatalog } from '../catalog/catalog.js';
import { OperateError } from '../errors.js';
import {
  countByIds,
  ID_CHUNK,
  isMissing,
  json as jsonOf,
  listByIds,
  pageQuery,
  queryInput,
} from './engine.js';
import { WORKFLOW_DOCS } from '../docs/workflow.js';
import { findByOperationId } from '../catalog/catalog.js';

const NO_INPUT = { pathArgs: [], query: {} };

async function caught(promise: Promise<unknown>): Promise<OperateError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OperateError) return error;
    throw error;
  }
  throw new Error('expected an OperateError');
}

describe('enginePort', () => {
  it('sends catalog operations with the hints of their generated command', async () => {
    const server = fakeServer().on(
      'GET',
      '/process-instance/p1',
      engineError(404, 'InvalidRequestException', 'gone'),
    );
    const port = portOf(server.fetch);
    const error = await caught(port.call('getProcessInstance', { pathArgs: ['p1'], query: {} }));
    expect(error).toMatchObject({
      code: 'NOT_FOUND',
      details: {
        hint: 'Check the id or key. List the existing ones with `operate process-instance list`.',
      },
    });
  });

  it('finds missing resources as undefined, but rethrows routing 404s', async () => {
    const server = fakeServer()
      .on('GET', '/process-instance/p1', json({ id: 'p1' }))
      .on('GET', '/process-instance/p2', engineError(404, 'InvalidRequestException', 'missing'));
    const port = portOf(server.fetch);
    expect(await port.find('getProcessInstance', { pathArgs: ['p1'], query: {} })).toEqual({
      id: 'p1',
    });
    expect(await port.find('getProcessInstance', { pathArgs: ['p2'], query: {} })).toBeUndefined();
    const routing = await caught(port.find('getProcessInstance', { pathArgs: ['p3'], query: {} }));
    expect(routing.details.engineType).toBe('NotFoundException');
  });

  it('pages lists, stops at a short page and reports truncation beyond the cap', async () => {
    const items = Array.from({ length: 1203 }, (_, index) => ({ id: `i${index}` }));
    const server = fakeServer().on('GET', '/incident', (request) => {
      const first = Number(request.query.get('firstResult'));
      return json(items.slice(first, first + Number(request.query.get('maxResults'))));
    });
    const port = portOf(server.fetch);
    const all = await port.list('getIncidents', { processInstanceId: 'p' });
    expect(all).toMatchObject({ truncated: false });
    expect(all.items).toHaveLength(1203);
    expect(server.requests.map((request) => request.query.toString())).toEqual([
      'processInstanceId=p&firstResult=0&maxResults=500',
      'processInstanceId=p&firstResult=500&maxResults=500',
      'processInstanceId=p&firstResult=1000&maxResults=500',
    ]);
    const capped = await port.list('getIncidents', {}, 600);
    expect(capped.items).toHaveLength(600);
    expect(capped.truncated).toBe(true);
    const exact = await port.list('getIncidents', {}, 1203);
    expect(exact).toMatchObject({ truncated: false });
    expect(pageQuery({ a: 'b' }, 0, 500)).toEqual({ a: 'b', firstResult: '0', maxResults: '500' });
  });

  it('stops paging when the engine ignores the page size', async () => {
    const server = fakeServer().on(
      'GET',
      '/incident',
      json(Array.from({ length: 600 }, () => ({}))),
    );
    const port = portOf(server.fetch);
    expect((await port.list('getIncidents', {})).items).toHaveLength(600);
    expect(server.requests).toHaveLength(1);
  });

  it('reads text responses; 404, 204 and blank texts are undefined', async () => {
    const server = fakeServer()
      .on('GET', '/job/j1/stacktrace', text('trace', 'text/plain'))
      .on('GET', '/job/j2/stacktrace', engineError(404, 'InvalidRequestException', 'no job'))
      .on('GET', '/job/j3/stacktrace', text('  \n', 'text/plain'))
      .on('GET', '/external-task/e1/errorDetails', noContent());
    const port = portOf(server.fetch);
    expect(await port.text('getStacktrace', ['j1'])).toBe('trace');
    expect(await port.text('getStacktrace', ['j2'])).toBeUndefined();
    expect(await port.text('getStacktrace', ['j3'])).toBeUndefined();
    expect(await port.text('getExternalTaskErrorDetails', ['e1'])).toBeUndefined();
    const server500 = fakeServer().on(
      'GET',
      '/job/j1/stacktrace',
      engineError(500, 'ProcessEngineException', 'boom'),
    );
    expect((await caught(portOf(server500.fetch).text('getStacktrace', ['j1']))).code).toBe(
      'HTTP_SERVER_ERROR',
    );
  });

  it('previews requests with the auth headers known without network access and names routes', async () => {
    const auth = basicAuth({
      type: 'basic',
      username: 'demo',
      password: 'pw',
      sources: { username: 'flag', password: 'flag' },
    });
    const port = portOf(fakeServer().fetch, { engine: 'second', auth });
    const { request: preview, note } = await port.preview({
      operationId: 'complete',
      input: { pathArgs: ['t1'], query: {}, body: { variables: {} } },
    });
    expect(preview).toMatchObject({
      method: 'POST',
      url: `${BASE_URL}/engine/second/task/t1/complete`,
      body: { variables: {} },
    });
    expect(preview.headers.Authorization).toMatch(/^Basic /);
    expect(note).toBeUndefined();
    expect(port.route('complete', { pathArgs: ['t1'], query: {} })).toBe(
      'POST /engine/second/task/t1/complete',
    );
    expect(port.route('getRestAPIVersion', NO_INPUT)).toBe('GET /version');
  });

  it('refuses unknown operations and query parameters as internal errors', async () => {
    const port = portOf(fakeServer().fetch);
    expect((await caught(port.call('noSuchOperation', NO_INPUT))).message).toBe(
      'The catalog has no operation noSuchOperation',
    );
    expect((await caught(port.call('getIncidents', queryInput({ nope: 'x' })))).message).toBe(
      'getIncidents has no query parameter nope',
    );
    expect(() => port.route('getIncidents', queryInput({ nope: undefined }))).not.toThrow();
  });

  it('keeps at most 8 requests in flight', async () => {
    let running = 0;
    let peak = 0;
    const fetch: typeof globalThis.fetch = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
      return json({ count: 1 });
    };
    const port = portOf(fetch);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => port.call('getIncidentsCount', NO_INPUT)),
    );
    expect(results).toHaveLength(20);
    expect(peak).toBe(8);
  });
});

describe('id chunks', () => {
  const ids = Array.from({ length: ID_CHUNK * 2 + 1 }, (_, index) => `p${index}`);

  it('counts over id lists in chunks of 50 and sends nothing for no ids', async () => {
    const server = fakeServer().on('GET', '/process-instance/count', json({ count: 2 }));
    const port = portOf(server.fetch);
    const request = { operationId: 'getProcessInstancesCount', key: 'processInstanceIds' };
    expect(await countByIds(port, { ...request, ids, query: { withIncident: 'true' } })).toBe(6);
    expect(
      server.requests.map((entry) => entry.query.get('processInstanceIds')?.split(',').length),
    ).toEqual([50, 50, 1]);
    expect(server.requests.every((entry) => entry.query.get('withIncident') === 'true')).toBe(true);
    expect(await countByIds(port, { ...request, ids: [] })).toBe(0);
    expect(server.requests).toHaveLength(3);
  });

  it('lists over id lists and concatenates the chunks', async () => {
    const server = fakeServer().on('GET', '/task', (request) =>
      json([{ id: request.query.get('processInstanceIdIn')?.split(',')[0] }]),
    );
    const items = await listByIds(portOf(server.fetch), {
      operationId: 'getTasks',
      key: 'processInstanceIdIn',
      ids,
      cap: 5,
    });
    expect(items).toEqual([{ id: 'p0' }, { id: 'p50' }, { id: 'p100' }]);
    expect(server.requests[0]?.query.get('maxResults')).toBe('6');
  });
});

describe('isMissing', () => {
  it('is true only for engine 404s', () => {
    expect(
      isMissing(new OperateError('NOT_FOUND', 'x', { engineType: 'InvalidRequestException' })),
    ).toBe(true);
    expect(isMissing(new OperateError('NOT_FOUND', 'x', { engineType: 'NotFoundException' }))).toBe(
      false,
    );
    expect(isMissing(new OperateError('NOT_FOUND', 'x'))).toBe(false);
    expect(
      isMissing(new OperateError('USAGE', 'x', { engineType: 'InvalidRequestException' })),
    ).toBe(false);
    expect(isMissing(new Error('x'))).toBe(false);
  });
});

describe('WORKFLOW_DOCS calls', () => {
  it('names only operations of the catalog', () => {
    const catalog = loadCatalog();
    for (const doc of WORKFLOW_DOCS) {
      for (const operationId of doc.calls)
        expect(findByOperationId(catalog, operationId), `${doc.name} ${operationId}`).toBeDefined();
    }
  });
});

describe('enginePort details', () => {
  it('asks for one item more than the cap on the last page', async () => {
    const items = Array.from({ length: 700 }, (_, index) => ({ id: `i${index}` }));
    const server = fakeServer().on('GET', '/incident', (request) => {
      const first = Number(request.query.get('firstResult'));
      return json(items.slice(first, first + Number(request.query.get('maxResults'))));
    });
    await portOf(server.fetch).list('getIncidents', {}, 600);
    expect(server.requests.map((request) => request.query.get('maxResults'))).toEqual([
      '500',
      '101',
    ]);
  });

  it('has no JSON value for a text response and refuses path parameters as query', async () => {
    const server = fakeServer().on('GET', '/job/j1/stacktrace', text('trace', 'text/plain'));
    const port = portOf(server.fetch);
    expect(await jsonOf(port, 'getStacktrace', { pathArgs: ['j1'], query: {} })).toBeUndefined();
    const error = await caught(
      port.call('getStacktrace', { pathArgs: ['j1'], query: { id: 'x' } }),
    );
    expect([error.code, error.message]).toEqual([
      'INTERNAL',
      'getStacktrace has no query parameter id',
    ]);
    expect((await caught(port.call('noSuchOperation', NO_INPUT))).code).toBe('INTERNAL');
  });
});
