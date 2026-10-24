import { describe, expect, it } from 'vitest';
import { findByOperationId, loadCatalog } from '../catalog/catalog.js';
import type { OperationSpec } from '../catalog/types.js';
import type { FileSystem } from '../runtime.js';
import { buildInput, type InputDeps } from './input.js';
import { buildRequest } from './request.js';

const catalog = loadCatalog();
const target = { baseUrl: 'http://localhost:8080/engine-rest', headers: {} };

function op(operationId: string): OperationSpec {
  const operation = findByOperationId(catalog, operationId);
  if (operation === undefined) throw new Error(`unknown operation ${operationId}`);
  return operation;
}

function deps(files: Record<string, string> = {}): InputDeps {
  const fs: FileSystem = {
    readFile: (path) => {
      const content = files[path];
      if (content === undefined) {
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      }
      return Promise.resolve(new TextEncoder().encode(content));
    },
    writeFile: () => Promise.resolve(),
    mkdir: () => Promise.resolve(),
    exists: () => Promise.resolve(false),
    remove: () => Promise.resolve(false),
    readdir: () => Promise.resolve([]),
    kind: () => Promise.resolve('missing' as const),
  };
  return { fs, readStdin: () => Promise.resolve(new Uint8Array()) };
}

describe('buildInput', () => {
  it('builds path args and query for operations without body', async () => {
    const input = await buildInput(
      op('getProcessInstances'),
      { args: [], flags: { 'business-key': 'k', 'max-results': '5', all: true } },
      deps(),
    );
    expect(input).toEqual({ pathArgs: [], query: { businessKey: 'k', maxResults: '5' } });
  });

  it('builds a JSON body', async () => {
    const operation = op('startProcessInstanceByKey');
    const input = await buildInput(
      operation,
      { args: ['order'], flags: { 'business-key': 'b-1', var: ['amount=10'], validate: false } },
      deps(),
    );
    expect(input).toEqual({
      pathArgs: ['order'],
      query: {},
      body: { businessKey: 'b-1', variables: { amount: { value: 10, type: 'Integer' } } },
    });
    const request = buildRequest(operation, input, target);
    expect(request.url).toBe(
      'http://localhost:8080/engine-rest/process-definition/key/order/start',
    );
    expect(request.body).toBe(
      '{"businessKey":"b-1","variables":{"amount":{"value":10,"type":"Integer"}}}',
    );
  });

  it('sends {} for JSON bodies without options', async () => {
    const input = await buildInput(
      op('startProcessInstanceByKey'),
      { args: ['k'], flags: {} },
      deps(),
    );
    expect(input.body).toEqual({});
  });

  it('builds a multipart body with resources', async () => {
    const input = await buildInput(
      op('createDeployment'),
      { args: ['a.bpmn'], flags: { 'deployment-name': 'app' } },
      deps({ 'a.bpmn': '<a/>' }),
    );
    expect(input.pathArgs).toEqual([]);
    expect(input.query).toEqual({});
    expect(input).not.toHaveProperty('body');
    expect(input.multipart?.fields).toEqual({ 'deployment-name': 'app' });
    expect(input.multipart?.files.map((file) => file.fileName)).toEqual(['a.bpmn']);
  });

  it('builds a multipart body with path args', async () => {
    const input = await buildInput(
      op('setProcessInstanceVariableBinary'),
      { args: ['pi', 'doc'], flags: { data: 'a.bin', 'value-type': 'Bytes' } },
      deps({ 'a.bin': 'x' }),
    );
    expect(input.pathArgs).toEqual(['pi', 'doc']);
    expect(input.multipart?.fields).toEqual({ valueType: 'Bytes' });
    expect(input.multipart?.files.map((file) => file.field)).toEqual(['data']);
  });

  it('rejects unexpected positionals before reading anything', async () => {
    await expect(
      buildInput(op('getProcessInstance'), { args: ['a', 'b'], flags: {} }, deps()),
    ).rejects.toThrow('Unexpected argument(s): b');
  });

  it('validates query values', async () => {
    await expect(
      buildInput(op('getProcessInstances'), { args: [], flags: { 'max-results': 'x' } }, deps()),
    ).rejects.toThrow('--max-results expects an integer, got "x"');
  });
});
