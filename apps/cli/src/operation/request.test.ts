import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { OperationSpec, ParamSpec } from '../catalog/types.js';
import { OperateError } from '../errors.js';
import {
  acceptHeader,
  buildRequest,
  enginePrefix,
  expandPath,
  joinUrl,
  jsonBody,
  queryString,
} from './request.js';

function param(name: string, location: 'path' | 'query' = 'query'): ParamSpec {
  return { name, in: location, flag: name, type: 'string', required: false, description: '' };
}

function operation(overrides: Partial<OperationSpec> = {}): OperationSpec {
  return {
    operationId: 'op',
    group: 'thing',
    name: 'do',
    aliases: [],
    method: 'GET',
    path: '/thing',
    summary: '',
    description: '',
    deprecated: false,
    effect: 'read',
    engineScoped: true,
    params: [],
    responses: [{ status: 200, kind: 'json', contentTypes: ['application/json'], description: '' }],
    ...overrides,
  };
}

const target = { baseUrl: 'http://localhost:8080/engine-rest', headers: {} };

describe('joinUrl', () => {
  it('strips trailing slashes of the base', () => {
    expect(joinUrl('http://h/engine-rest/', '/task')).toBe('http://h/engine-rest/task');
    expect(joinUrl('http://h/engine-rest///', '/task')).toBe('http://h/engine-rest/task');
    expect(joinUrl('http://h/engine-rest', '/task')).toBe('http://h/engine-rest/task');
  });
});

describe('enginePrefix', () => {
  it('adds the encoded engine name', () => {
    expect(enginePrefix('default', true)).toBe('/engine/default');
    expect(enginePrefix('my engine', true)).toBe('/engine/my%20engine');
  });

  it('is empty without an engine', () => {
    expect(enginePrefix(undefined, true)).toBe('');
    expect(enginePrefix('', true)).toBe('');
  });

  it('is empty for operations that are not engine scoped', () => {
    expect(enginePrefix('default', false)).toBe('');
  });

  it('follows engineScoped of the operation when building requests', () => {
    const engine = { ...target, engine: 'second' };
    const scoped = buildRequest(operation({ path: '/task' }), { pathArgs: [], query: {} }, engine);
    expect(scoped.url).toBe('http://localhost:8080/engine-rest/engine/second/task');
    const independent = operation({ path: '/version', engineScoped: false });
    expect(buildRequest(independent, { pathArgs: [], query: {} }, engine).url).toBe(
      'http://localhost:8080/engine-rest/version',
    );
  });
});

describe('expandPath', () => {
  const op = operation({
    path: '/process-instance/{id}/variables/{varName}',
    params: [param('id', 'path'), param('varName', 'path'), param('deserialize')],
  });

  it('replaces placeholders in path order', () => {
    expect(expandPath(op, ['abc', 'amount'])).toBe('/process-instance/abc/variables/amount');
  });

  it('encodes values', () => {
    expect(expandPath(op, ['a/b', 'x y?'])).toBe('/process-instance/a%2Fb/variables/x%20y%3F');
  });

  it('never interprets replacement patterns', () => {
    expect(expandPath(op, ['$&', "$'"])).toBe("/process-instance/%24%26/variables/%24'");
  });

  it('checks the number of arguments', () => {
    const error = (() => {
      try {
        expandPath(op, ['abc']);
      } catch (caught) {
        return caught as OperateError;
      }
      throw new Error('expected an error');
    })();
    // the CLI checks the arguments first; a mismatch here is a bug
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('op needs 2 path argument(s), got 1');
    expect(() => expandPath(op, ['a', 'b', 'c'])).toThrow('op needs 2 path argument(s), got 3');
  });

  it.each(['', '.', '..'])('rejects %j', (value) => {
    expect(() => expandPath(op, ['abc', value])).toThrow(
      'Argument <var-name> must not be empty, "." or ".."',
    );
    expect(() => expandPath(op, [value, 'x'])).toThrow(
      'Argument <id> must not be empty, "." or ".."',
    );
  });

  it('accepts dotted values other than . and ..', () => {
    expect(expandPath(op, ['...', '.a'])).toBe('/process-instance/.../variables/.a');
  });

  it('round trips any value through encoding', () => {
    const single = operation({ path: '/x/{id}/y', params: [param('id', 'path')] });
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((value) => value !== '.' && value !== '..'),
        (value) => {
          const path = expandPath(single, [value]);
          const segment = path.slice('/x/'.length, -'/y'.length);
          expect(segment).toBe(encodeURIComponent(value));
          expect(segment).not.toContain('/');
          expect(decodeURIComponent(segment)).toBe(value);
        },
      ),
    );
  });

  it('rejects empty and dot segments for any position', () => {
    fc.assert(
      fc.property(fc.constantFrom('', '.', '..'), fc.boolean(), (bad, first) => {
        const args = first ? [bad, 'ok'] : ['ok', bad];
        expect(() => expandPath(op, args)).toThrow(OperateError);
      }),
    );
  });
});

describe('queryString', () => {
  const op = operation({
    params: [param('id', 'path'), param('b'), param('a'), param('c')],
  });

  it('is empty without values', () => {
    expect(queryString(op, {})).toBe('');
    expect(queryString(op, { a: undefined })).toBe('');
  });

  it('keeps the catalog order and skips undefined values', () => {
    expect(queryString(op, { c: '3', a: '1', b: undefined })).toBe('?a=1&c=3');
  });

  it('ignores path params and unknown keys', () => {
    expect(queryString(op, { id: 'x', other: 'y', b: '2' })).toBe('?b=2');
  });

  it('encodes values', () => {
    expect(queryString(op, { a: 'x y&z=1' })).toBe('?a=x+y%26z%3D1');
  });

  it('keeps the catalog order and round trips values for any input', () => {
    const names = fc.uniqueArray(fc.stringMatching(/^[a-zA-Z]{1,8}$/), {
      minLength: 1,
      maxLength: 8,
    });
    fc.assert(
      fc.property(
        names.chain((list) =>
          fc.tuple(
            fc.constant(list),
            fc.array(fc.option(fc.string(), { nil: undefined }), {
              minLength: list.length,
              maxLength: list.length,
            }),
            fc.shuffledSubarray(list, { minLength: list.length, maxLength: list.length }),
          ),
        ),
        ([list, values, insertionOrder]) => {
          const spec = operation({ params: list.map((name) => param(name)) });
          const valueOf = new Map(list.map((name, index) => [name, values[index]]));
          const query = Object.fromEntries(insertionOrder.map((name) => [name, valueOf.get(name)]));
          const text = queryString(spec, query);
          const expected = list
            .filter((name) => valueOf.get(name) !== undefined)
            .map((name) => [name, valueOf.get(name)]);
          expect(text === '' ? [] : [...new URLSearchParams(text.slice(1)).entries()]).toEqual(
            expected,
          );
          expect(text === '' || text.startsWith('?')).toBe(true);
        },
      ),
    );
  });
});

describe('acceptHeader', () => {
  it('prefers JSON', () => {
    expect(acceptHeader(operation())).toBe('application/json');
    expect(
      acceptHeader(
        operation({
          responses: [
            {
              status: 200,
              kind: 'json',
              contentTypes: ['application/xml', 'application/json'],
              description: '',
            },
          ],
        }),
      ),
    ).toBe('application/json');
  });

  it('defaults to JSON without content types', () => {
    expect(
      acceptHeader(
        operation({
          responses: [{ status: 204, kind: 'none', contentTypes: [], description: '' }],
        }),
      ),
    ).toBe('application/json');
  });

  it('lists distinct non-JSON types', () => {
    expect(
      acceptHeader(
        operation({
          responses: [
            {
              status: 200,
              kind: 'binary',
              contentTypes: ['application/octet-stream', '*/*'],
              description: '',
            },
            { status: 201, kind: 'binary', contentTypes: ['*/*'], description: '' },
          ],
        }),
      ),
    ).toBe('application/octet-stream, */*');
  });
});

describe('jsonBody', () => {
  it('returns the body without variables', () => {
    expect(jsonBody({ pathArgs: [], query: {}, body: { a: 1 } })).toEqual({ a: 1 });
    expect(jsonBody({ pathArgs: [], query: {} })).toBeUndefined();
    expect(jsonBody({ pathArgs: [], query: {}, body: [1], variables: {} })).toEqual([1]);
  });

  it('merges variables into the variables property; variables win', () => {
    expect(
      jsonBody({
        pathArgs: [],
        query: {},
        body: { businessKey: 'k', variables: { a: { value: 1, type: 'Integer' }, b: 2 } },
        variables: { a: { value: 'x', type: 'String' } },
      }),
    ).toEqual({
      businessKey: 'k',
      variables: { a: { value: 'x', type: 'String' }, b: 2 },
    });
  });

  it('creates the body for variables only', () => {
    expect(
      jsonBody({ pathArgs: [], query: {}, variables: { a: { value: true, type: 'Boolean' } } }),
    ).toEqual({ variables: { a: { value: true, type: 'Boolean' } } });
  });
});

describe('buildRequest', () => {
  it('builds a GET without body', () => {
    const op = operation({
      path: '/thing/{id}',
      params: [param('id', 'path'), param('q')],
    });
    expect(buildRequest(op, { pathArgs: ['a b'], query: { q: 'x' } }, target)).toEqual({
      method: 'GET',
      url: 'http://localhost:8080/engine-rest/thing/a%20b?q=x',
      headers: { Accept: 'application/json' },
    });
  });

  it('adds the engine prefix and target headers; target headers win', () => {
    const request = buildRequest(
      operation(),
      { pathArgs: [], query: {} },
      { baseUrl: 'http://h/rest/', engine: 'e1', headers: { Accept: 'text/plain', 'X-A': '1' } },
    );
    expect(request.url).toBe('http://h/rest/engine/e1/thing');
    expect(request.headers).toEqual({ Accept: 'text/plain', 'X-A': '1' });
  });

  it('lets target headers replace defaults regardless of case', () => {
    const op = operation({
      method: 'POST',
      body: { kind: 'json', schema: {}, fields: [], variableMaps: [], variableValue: false },
    });
    const request = buildRequest(
      op,
      { pathArgs: [], query: {}, body: {} },
      {
        baseUrl: 'http://h/rest',
        headers: { accept: 'application/xml', 'content-type': 'application/json; charset=UTF-8' },
      },
    );
    expect(request.headers).toEqual({
      accept: 'application/xml',
      'content-type': 'application/json; charset=UTF-8',
    });
  });

  it('sends JSON bodies with a content type', () => {
    const op = operation({
      method: 'POST',
      body: { kind: 'json', schema: {}, fields: [], variableMaps: [], variableValue: false },
    });
    const request = buildRequest(op, { pathArgs: [], query: {}, body: { a: 1 } }, target);
    expect(request.body).toBe('{"a":1}');
    expect(request.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
  });

  it('sends no body and no content type when the JSON body is undefined', () => {
    const op = operation({
      method: 'POST',
      body: { kind: 'json', schema: {}, fields: [], variableMaps: [], variableValue: false },
    });
    const request = buildRequest(op, { pathArgs: [], query: {} }, target);
    expect(request).not.toHaveProperty('body');
    expect(request.headers).toEqual({ Accept: 'application/json' });
  });

  it('sends multipart bodies as FormData without a content type', async () => {
    const op = operation({
      method: 'POST',
      body: { kind: 'multipart', fields: [], resources: true },
    });
    const request = buildRequest(
      op,
      {
        pathArgs: [],
        query: {},
        multipart: {
          fields: { 'deployment-name': 'app' },
          files: [{ field: 'a.bpmn', fileName: 'a.bpmn', data: new Blob(['<xml/>']) }],
        },
      },
      target,
    );
    expect(request.headers).toEqual({ Accept: 'application/json' });
    expect(request.body).toBeInstanceOf(FormData);
    const form = request.body as FormData;
    expect(form.get('deployment-name')).toBe('app');
    const file = form.get('a.bpmn') as File;
    expect(file.name).toBe('a.bpmn');
    expect(await file.text()).toBe('<xml/>');
  });

  it('sends an empty form for multipart operations without parts', () => {
    const op = operation({
      method: 'POST',
      body: { kind: 'multipart', fields: [], resources: false },
    });
    const request = buildRequest(op, { pathArgs: [], query: {} }, target);
    expect([...(request.body as FormData).entries()]).toEqual([]);
  });
});
