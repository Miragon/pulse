import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { noAuth } from '../auth/none.js';
import { findByOperationId, loadCatalog } from '../catalog/catalog.js';
import type { OperationSpec } from '../catalog/types.js';
import { OperateError } from '../errors.js';
import type { ClientOptions } from '../http/client.js';
import { isPaginated } from '../catalog/rules.js';
import { fetchAllPages, firstPageInput } from './paginate.js';
import type { OperationInput } from './request.js';

const catalog = loadCatalog();
const target = { baseUrl: 'http://h/engine-rest', headers: {} };

function op(operationId: string): OperationSpec {
  const operation = findByOperationId(catalog, operationId);
  if (operation === undefined) throw new Error(`unknown operation ${operationId}`);
  return operation;
}

/** A fake engine serving `total` items, honoring firstResult and maxResults. */
function engine(total: number, respond?: (url: URL) => Response) {
  const urls: URL[] = [];
  const fetch = (input: string | URL | Request) => {
    const url = new URL(input);
    urls.push(url);
    if (respond !== undefined) return Promise.resolve(respond(url));
    const first = Number(url.searchParams.get('firstResult'));
    const max = Number(url.searchParams.get('maxResults'));
    const items = Array.from(
      { length: Math.max(0, Math.min(max, total - first)) },
      (_, i) => first + i,
    );
    return Promise.resolve(
      new Response(JSON.stringify(items), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  const client: ClientOptions = {
    fetch: fetch,
    auth: noAuth(),
    timeoutMs: 1000,
    now: () => 0,
  };
  return { urls, context: { target, client } };
}

function input(query: Record<string, string> = {}): OperationInput {
  return { pathArgs: [], query };
}

const list = op('getProcessInstances');

describe('isPaginated', () => {
  it('is true for operations with a maxResults query param', () => {
    expect(isPaginated(list)).toBe(true);
    expect(isPaginated(op('queryProcessInstances'))).toBe(true);
    expect(isPaginated(op('getProcessInstance'))).toBe(false);
    expect(isPaginated(op('getProcessInstancesCount'))).toBe(false);
  });

  it('ignores path params named maxResults', () => {
    expect(
      isPaginated({
        ...list,
        params: [
          {
            name: 'maxResults',
            in: 'path',
            flag: 'x',
            type: 'string',
            required: true,
            description: '',
          },
        ],
      }),
    ).toBe(false);
  });
});

describe('firstPageInput', () => {
  it('defaults to the first 500 results', () => {
    expect(firstPageInput(input({ businessKey: 'b' }))).toEqual({
      pathArgs: [],
      query: { businessKey: 'b', firstResult: '0', maxResults: '500' },
    });
  });

  it('starts at --first-result with the page size of --max-results', () => {
    expect(firstPageInput(input({ firstResult: '20', maxResults: '10' })).query).toEqual({
      firstResult: '20',
      maxResults: '10',
    });
    expect(firstPageInput(input({ maxResults: '1' })).query).toEqual({
      firstResult: '0',
      maxResults: '1',
    });
  });

  it.each(['0', '-1'])('rejects --max-results %s', (maxResults) => {
    try {
      firstPageInput(input({ maxResults }));
    } catch (error) {
      expect(error).toBeInstanceOf(OperateError);
      expect((error as OperateError).code).toBe('USAGE');
      expect((error as OperateError).message).toBe(
        `--max-results must be at least 1 with --all, got ${maxResults}`,
      );
      expect((error as OperateError).details.hint).toBe('Omit --max-results to use pages of 500.');
      return;
    }
    throw new Error('expected an error');
  });

  it('rejects a page size that is not an integer', () => {
    expect(() => firstPageInput(input({ maxResults: '1.5' }))).toThrow(
      '--max-results must be at least 1 with --all, got 1.5',
    );
  });
});

describe('fetchAllPages', () => {
  it('fetches pages until a short page and concatenates them', async () => {
    const { urls, context } = engine(5);
    const result = await fetchAllPages(list, input({ maxResults: '2' }), context);
    expect(result).toMatchObject({ kind: 'json', status: 200, value: [0, 1, 2, 3, 4] });
    expect(
      urls.map((url) => [url.searchParams.get('firstResult'), url.searchParams.get('maxResults')]),
    ).toEqual([
      ['0', '2'],
      ['2', '2'],
      ['4', '2'],
    ]);
    expect(result.request.url).toBe(
      'http://h/engine-rest/process-instance?firstResult=0&maxResults=2',
    );
  });

  it('stops after an empty page when the total is a multiple of the page size', async () => {
    const { urls, context } = engine(4);
    const result = await fetchAllPages(list, input({ maxResults: '2' }), context);
    expect(result).toMatchObject({ value: [0, 1, 2, 3] });
    expect(urls).toHaveLength(3);
  });

  it('starts at --first-result and uses 500 per page by default', async () => {
    const { urls, context } = engine(503);
    const result = await fetchAllPages(
      list,
      input({ firstResult: '1', businessKey: 'b' }),
      context,
    );
    expect(result).toMatchObject({ value: Array.from({ length: 502 }, (_, i) => i + 1) });
    expect(urls.map((url) => url.search)).toEqual([
      '?firstResult=1&maxResults=500&businessKey=b',
      '?firstResult=501&maxResults=500&businessKey=b',
    ]);
  });

  it('combines pages too large to spread into a call (130,000 items)', async () => {
    const { context } = engine(130_000);
    const result = await fetchAllPages(list, input({ maxResults: '1000000' }), context);
    expect(result.kind).toBe('json');
    expect((result as { value: unknown[] }).value).toHaveLength(130_000);
  });

  it('stops when the engine returns more than a page', async () => {
    const { urls, context } = engine(
      0,
      () =>
        new Response('[1,2,3]', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const result = await fetchAllPages(list, input({ maxResults: '2' }), context);
    expect(result).toMatchObject({ value: [1, 2, 3] });
    expect(urls).toHaveLength(1);
  });

  it('fails when a page is not a JSON array', async () => {
    const { context } = engine(
      0,
      () =>
        new Response('{"count":1}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    try {
      await fetchAllPages(list, input(), context);
    } catch (error) {
      expect(error).toBeInstanceOf(OperateError);
      expect((error as OperateError).code).toBe('INTERNAL');
      expect((error as OperateError).message).toBe(
        'Cannot use --all: GET http://h/engine-rest/process-instance?firstResult=0&maxResults=500 did not return a JSON array (got json)',
      );
      expect((error as OperateError).details.request).toEqual({
        method: 'GET',
        url: 'http://h/engine-rest/process-instance?firstResult=0&maxResults=500',
      });
      return;
    }
    throw new Error('expected an error');
  });

  it('names the result kind for non-JSON pages', async () => {
    const { context } = engine(0, () => new Response(null, { status: 204 }));
    await expect(fetchAllPages(list, input(), context)).rejects.toThrow('(got none)');
  });

  it('collects every item exactly once for any total and page size', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 1, max: 15 }),
        async (total, size) => {
          const { urls, context } = engine(total);
          const result = await fetchAllPages(list, input({ maxResults: String(size) }), context);
          expect(result).toMatchObject({ value: Array.from({ length: total }, (_, i) => i) });
          expect(urls).toHaveLength(Math.floor(total / size) + 1);
        },
      ),
      { numRuns: 50 },
    );
  });
});
