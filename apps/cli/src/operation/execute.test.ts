import { describe, expect, it } from 'vitest';
import { noAuth } from '../auth/none.js';
import { findByOperationId, findOperation, loadCatalog } from '../catalog/catalog.js';
import type { OperationSpec } from '../catalog/types.js';
import { OperateError } from '../errors.js';
import {
  checkEffect,
  executeOperation,
  type ExecuteOptions,
  dryRunPreview,
  sendRequest,
} from './execute.js';
import type { OperationInput } from './request.js';

const catalog = loadCatalog();

function op(operationId: string): OperationSpec {
  const operation = findByOperationId(catalog, operationId);
  if (operation === undefined) throw new Error(`unknown operation ${operationId}`);
  return operation;
}

interface Call {
  readonly url: string;
  readonly method: string | undefined;
  readonly body: unknown;
}

function options(
  respond: (call: Call) => Response = () =>
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
  overrides: Partial<ExecuteOptions> = {},
): ExecuteOptions & { calls: Call[] } {
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: input as string, method: init?.method, body: init?.body };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  return {
    calls,
    target: { baseUrl: 'http://h/engine-rest', headers: { 'X-Team': 'a' } },
    client: {
      fetch: fetch,
      auth: noAuth(),
      timeoutMs: 1000,
      now: () => 0,
    },
    readOnly: false,
    yes: false,
    dryRun: false,
    all: false,
    validate: true,
    schemas: catalog.schemas,
    ...overrides,
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

function input(overrides: Partial<OperationInput> = {}): OperationInput {
  return { pathArgs: [], query: {}, ...overrides };
}

const list = op('getProcessInstances');
const start = op('startProcessInstanceByKey');
const remove = op('deleteProcessInstance');

describe('executeOperation', () => {
  it('re-exports the shared helpers', () => {
    expect(typeof checkEffect).toBe('function');
    expect(typeof dryRunPreview).toBe('function');
    expect(typeof sendRequest).toBe('function');
  });

  it('sends a single request and decodes the response', async () => {
    const opts = options(
      () =>
        new Response('[{"id":"1"}]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const result = await executeOperation(list, input({ query: { maxResults: '1' } }), opts);
    expect(result).toEqual({
      kind: 'json',
      status: 200,
      value: [{ id: '1' }],
      text: '[{"id":"1"}]',
      request: {
        method: 'GET',
        url: 'http://h/engine-rest/process-instance?maxResults=1',
        headers: { Accept: 'application/json', 'X-Team': 'a' },
      },
    });
    expect(opts.calls).toHaveLength(1);
  });

  it('previews the request with --dry-run without sending it', async () => {
    const opts = options(undefined, { dryRun: true });
    const result = await executeOperation(
      start,
      input({ pathArgs: ['order'], body: { businessKey: 'b' } }),
      opts,
    );
    expect(result).toEqual({
      kind: 'dry-run',
      request: {
        method: 'POST',
        url: 'http://h/engine-rest/process-definition/key/order/start',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Team': 'a' },
        body: { businessKey: 'b' },
      },
    });
    expect(opts.calls).toEqual([]);
  });

  it('previews the first page with --dry-run --all', async () => {
    const opts = options(undefined, { dryRun: true, all: true });
    const result = await executeOperation(list, input({ query: { maxResults: '50' } }), opts);
    expect(result).toMatchObject({
      kind: 'dry-run',
      request: { url: 'http://h/engine-rest/process-instance?firstResult=0&maxResults=50' },
    });
    expect(opts.calls).toEqual([]);
  });

  it('fetches all pages with --all', async () => {
    const opts = options(
      (call) =>
        new Response(call.url.includes('firstResult=0') ? '[1,2]' : '[3]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      { all: true },
    );
    const result = await executeOperation(list, input({ query: { maxResults: '2' } }), opts);
    expect(result).toMatchObject({ kind: 'json', value: [1, 2, 3] });
    expect(opts.calls.map((call) => call.url)).toEqual([
      'http://h/engine-rest/process-instance?firstResult=0&maxResults=2',
      'http://h/engine-rest/process-instance?firstResult=2&maxResults=2',
    ]);
  });

  it('ignores --all for operations without pagination', async () => {
    const opts = options(
      () =>
        new Response('{"id":"x"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      { all: true },
    );
    const message = op('deliverMessage');
    const result = await executeOperation(
      message,
      input({ body: { messageName: 'm', all: true } }),
      opts,
    );
    expect(result).toMatchObject({ kind: 'json', value: { id: 'x' } });
    expect(opts.calls.map((call) => call.url)).toEqual(['http://h/engine-rest/message']);
    const dryRun = await executeOperation(
      op('getProcessInstance'),
      input({ pathArgs: ['x'] }),
      options(undefined, { all: true, dryRun: true }),
    );
    expect(dryRun).toMatchObject({ request: { url: 'http://h/engine-rest/process-instance/x' } });
  });

  it('validates the body before sending', async () => {
    const opts = options();
    const error = await caught(
      executeOperation(start, input({ pathArgs: ['k'], body: { businessKy: 'b' } }), opts),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toBe(
      'Invalid request body: $: unknown property "businessKy", did you mean "businessKey"?',
    );
    expect(opts.calls).toEqual([]);
  });

  it('validates the body with --dry-run too', async () => {
    await expect(
      executeOperation(
        start,
        input({ pathArgs: ['k'], body: { businessKy: 'b' } }),
        options(undefined, { dryRun: true }),
      ),
    ).rejects.toThrow('Invalid request body');
  });

  it('skips validation with --no-validate', async () => {
    const opts = options(() => new Response(null, { status: 204 }), { validate: false });
    const result = await executeOperation(
      start,
      input({ pathArgs: ['k'], body: { businessKy: 'b' } }),
      opts,
    );
    expect(result).toMatchObject({ kind: 'none', status: 204 });
    expect(opts.calls[0]?.body).toBe('{"businessKy":"b"}');
  });

  it('requires --yes for delete operations', async () => {
    const opts = options();
    const error = await caught(executeOperation(remove, input({ pathArgs: ['pi'] }), opts));
    expect(error.code).toBe('CONFIRMATION_REQUIRED');
    expect(error.message).toBe(
      '`operate process-instance delete` is a delete operation and needs confirmation',
    );
    expect(opts.calls).toEqual([]);
  });

  it('sends delete operations with --yes', async () => {
    const opts = options(() => new Response(null, { status: 204, statusText: 'No Content' }), {
      yes: true,
    });
    const result = await executeOperation(remove, input({ pathArgs: ['pi'] }), opts);
    expect(result).toMatchObject({ kind: 'none', status: 204, statusText: 'No Content' });
    expect(opts.calls).toEqual([
      { url: 'http://h/engine-rest/process-instance/pi', method: 'DELETE', body: undefined },
    ]);
  });

  it('checks the guards before validating', async () => {
    const opts = options(undefined, { readOnly: true, readOnlySource: '--read-only' });
    const error = await caught(
      executeOperation(start, input({ pathArgs: ['k'], body: { nope: 1 } }), opts),
    );
    expect(error.code).toBe('READ_ONLY');
    expect(error.message).toBe(
      '`operate process-definition start` is a write operation and read-only mode is enabled',
    );
    expect(error.details.hint).toBe(
      'Read-only mode is enabled by --read-only. Use --dry-run to preview the request.',
    );
  });

  it('allows reads in read-only mode', async () => {
    const result = await executeOperation(list, input(), options(undefined, { readOnly: true }));
    expect(result).toMatchObject({ kind: 'json', value: [] });
  });

  it('labels preset commands by their own name', async () => {
    const suspend = findOperation(catalog, 'process-instance', 'suspend');
    if (suspend === undefined) throw new Error('missing preset');
    const error = await caught(
      executeOperation(
        suspend,
        input({ pathArgs: ['pi'], body: { suspended: true } }),
        options(undefined, { readOnly: true }),
      ),
    );
    expect(error.message).toBe(
      '`operate process-instance suspend` is a write operation and read-only mode is enabled',
    );
  });

  it('turns HTTP errors into OperateErrors', async () => {
    const opts = options(
      () =>
        new Response('{"type":"InvalidRequestException","message":"No instance"}', {
          status: 404,
          statusText: 'Not Found',
          headers: { 'content-type': 'application/json' },
        }),
    );
    const error = await caught(
      executeOperation(op('getProcessInstance'), input({ pathArgs: ['x'] }), opts),
    );
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('HTTP 404 Not Found: No instance');
    expect(error.details.request).toEqual({
      method: 'GET',
      url: 'http://h/engine-rest/process-instance/x',
    });
  });
});
