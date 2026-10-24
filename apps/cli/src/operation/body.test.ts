import { describe, expect, it } from 'vitest';
import { findByOperationId, findOperation, loadCatalog } from '../catalog/catalog.js';
import type { JsonBodySpec, OperationSpec } from '../catalog/types.js';
import { OperateError } from '../errors.js';
import type { FileSystem } from '../runtime.js';
import { buildJsonBody, readBody } from './body.js';
import type { FlagValue, InputDeps } from './command-values.js';

const catalog = loadCatalog();
const encoder = new TextEncoder();

function op(operationId: string): OperationSpec {
  const operation = findByOperationId(catalog, operationId);
  if (operation === undefined) throw new Error(`unknown operation ${operationId}`);
  return operation;
}

function jsonSpec(operation: OperationSpec): JsonBodySpec {
  if (operation.body?.kind !== 'json') throw new Error(`${operation.operationId} has no JSON body`);
  return operation.body;
}

function deps(files: Record<string, string> = {}, stdin = ''): InputDeps {
  const fs: FileSystem = {
    readFile: (path) => {
      const content = files[path];
      if (content === undefined) {
        return Promise.reject(Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' }));
      }
      return Promise.resolve(encoder.encode(content));
    },
    writeFile: () => Promise.resolve(),
    mkdir: () => Promise.resolve(),
    exists: (path) => Promise.resolve(path in files),
    remove: () => Promise.resolve(false),
    readdir: () => Promise.resolve([]),
    kind: () => Promise.resolve('missing' as const),
  };
  return { fs, readStdin: () => Promise.resolve(encoder.encode(stdin)) };
}

function build(
  operation: OperationSpec,
  flags: Record<string, FlagValue | undefined>,
  inputDeps: InputDeps = deps(),
): Promise<unknown> {
  return buildJsonBody(operation, jsonSpec(operation), flags, inputDeps);
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

const start = op('startProcessInstanceByKey');

describe('readBody', () => {
  it('parses inline JSON', async () => {
    await expect(readBody('{"a":[1,true,null]}', deps())).resolves.toEqual({ a: [1, true, null] });
    await expect(readBody('[1]', deps())).resolves.toEqual([1]);
    await expect(readBody('"x"', deps())).resolves.toBe('x');
  });

  it('reads @file', async () => {
    await expect(readBody('@body.json', deps({ 'body.json': '{"a":1}' }))).resolves.toEqual({
      a: 1,
    });
  });

  it('reads - from stdin', async () => {
    await expect(readBody('-', deps({}, ' {"b":2}\n'))).resolves.toEqual({ b: 2 });
  });

  it('reports invalid JSON with the parser message and the source', async () => {
    const inline = await caught(readBody('{a:1}', deps()));
    expect(inline.code).toBe('USAGE');
    expect(inline.message).toMatch(/^Invalid JSON in --body: \S/);
    expect(inline.message).toContain(
      (() => {
        try {
          JSON.parse('{a:1}');
        } catch (error) {
          return (error as Error).message;
        }
        return '';
      })(),
    );
    expect(inline.details.hint).toBe(
      `Pass a JSON value, @file.json or - for stdin, e.g. --body '{"businessKey":"order-1"}'.`,
    );
    const file = await caught(readBody('@b.json', deps({ 'b.json': 'nope' })));
    expect(file.message).toMatch(/^Invalid JSON in --body \(from b\.json\): /);
    const stdin = await caught(readBody('-', deps({}, '')));
    expect(stdin.message).toMatch(/^Invalid JSON in --body \(from stdin\): /);
  });

  it('reports missing body files', async () => {
    expect((await caught(readBody('@missing.json', deps()))).message).toBe(
      'File not found: missing.json',
    );
  });

  it('rejects @ without a path', async () => {
    const error = await caught(readBody('@', deps({ '': '{}' })));
    expect(error.message).toBe('File path must not be empty');
  });
});

describe('buildJsonBody', () => {
  it('sends {} when nothing was given', async () => {
    await expect(build(start, {})).resolves.toEqual({});
  });

  it('maps field flags to typed properties', async () => {
    await expect(
      build(start, {
        'business-key': 'order-1',
        'skip-io-mappings': true,
        'with-variables-in-return': false,
      }),
    ).resolves.toEqual({
      businessKey: 'order-1',
      skipIoMappings: true,
      withVariablesInReturn: false,
    });
  });

  it('types integer and date-time fields', async () => {
    await expect(
      build(op('setJobRetries'), { retries: '3', 'due-date': '2024-05-01' }),
    ).resolves.toEqual({ retries: 3, dueDate: '2024-05-01T00:00:00.000+0000' });
    expect((await caught(build(op('setJobRetries'), { retries: 'x' }))).message).toBe(
      '--retries expects an integer, got "x"',
    );
  });

  it('splits repeatable array fields on commas', async () => {
    await expect(
      build(op('queryHistoricProcessInstances'), {
        'process-instance-ids': ['a,b', 'c'],
        'tenant-id-in': 'x',
      }),
    ).resolves.toEqual({ processInstanceIds: ['a', 'b', 'c'], tenantIdIn: ['x'] });
  });

  it('types array items', async () => {
    const operation: OperationSpec = {
      ...start,
      body: {
        kind: 'json',
        schema: {},
        fields: [
          { name: 'numbers', flag: 'numbers', type: 'array', items: 'integer', description: '' },
          { name: 'names', flag: 'names', type: 'array', description: '' },
          { name: 'ratio', flag: 'ratio', type: 'number', description: '' },
        ],
        variableMaps: [],
        variableValue: false,
      },
    };
    await expect(build(operation, { numbers: '1,2', names: 'a', ratio: '0.5' })).resolves.toEqual({
      numbers: [1, 2],
      names: ['a'],
      ratio: 0.5,
    });
    expect((await caught(build(operation, { numbers: '1,x' }))).message).toBe(
      '--numbers expects an integer, got "x"',
    );
  });

  it('validates enum fields', async () => {
    const query = op('queryHistoricProcessInstances');
    await expect(build(query, { 'incident-status': 'open' })).resolves.toEqual({
      incidentStatus: 'open',
    });
    expect((await caught(build(query, { 'incident-status': 'closed' }))).message).toBe(
      '--incident-status expects one of open, resolved, got "closed"',
    );
  });

  it('merges variable flags into the map; flag entries win per key', async () => {
    await expect(
      build(start, {
        body: '{"businessKey":"b","variables":{"a":{"value":"old","type":"String"},"keep":{"value":1,"type":"Integer"}}}',
        var: ['a=1', 'flag=true', 'zip:String=01234'],
      }),
    ).resolves.toEqual({
      businessKey: 'b',
      variables: {
        a: { value: 1, type: 'Integer' },
        keep: { value: 1, type: 'Integer' },
        flag: { value: true, type: 'Boolean' },
        zip: { value: '01234', type: 'String' },
      },
    });
  });

  it('does not split variable values on commas', async () => {
    await expect(build(start, { var: 'list=a,b' })).resolves.toEqual({
      variables: { list: { value: 'a,b', type: 'String' } },
    });
  });

  it('replaces a non-object map from --body', async () => {
    await expect(build(start, { body: '{"variables":null}', var: ['a=1'] })).resolves.toEqual({
      variables: { a: { value: 1, type: 'Integer' } },
    });
  });

  it('fills every variable map by its own flag', async () => {
    await expect(
      build(op('deliverMessage'), {
        'message-name': 'paid',
        'correlation-key': 'orderId=7',
        'local-correlation-key': 'pos=1',
        var: 'amount=1.5',
        'local-var': 'x=null',
        'triggered-scope-var': 'y=s',
        all: true,
      }),
    ).resolves.toEqual({
      messageName: 'paid',
      all: true,
      correlationKeys: { orderId: { value: 7, type: 'Integer' } },
      localCorrelationKeys: { pos: { value: 1, type: 'Integer' } },
      processVariables: { amount: { value: 1.5, type: 'Double' } },
      processVariablesLocal: { x: { value: null, type: 'Null' } },
      processVariablesToTriggeredScope: { y: { value: 's', type: 'String' } },
    });
  });

  it('names the variable flag in parse errors', async () => {
    expect((await caught(build(op('deliverMessage'), { 'local-var': 'oops' }))).message).toBe(
      'Invalid --local-var "oops": expected name=value or name:Type=value',
    );
  });

  it('lets field flags override --body properties', async () => {
    await expect(
      build(start, { body: '{"businessKey":"a","caseInstanceId":"c"}', 'business-key': 'b' }),
    ).resolves.toEqual({ businessKey: 'b', caseInstanceId: 'c' });
  });

  it('applies preset properties', async () => {
    const suspend = findOperation(catalog, 'process-instance', 'suspend');
    const activate = findOperation(catalog, 'process-instance', 'activate');
    if (suspend === undefined || activate === undefined) throw new Error('missing presets');
    await expect(build(suspend, {})).resolves.toEqual({ suspended: true });
    await expect(build(activate, {})).resolves.toEqual({ suspended: false });
    await expect(build(suspend, { body: '{"suspended":true,"x":1}' })).resolves.toEqual({
      suspended: true,
      x: 1,
    });
  });

  it('rejects --body values that conflict with a preset', async () => {
    const suspend = findOperation(catalog, 'process-instance', 'suspend');
    if (suspend === undefined) throw new Error('missing preset');
    const error = await caught(build(suspend, { body: '{"suspended":false}' }));
    expect(error.code).toBe('USAGE');
    expect(error.message).toBe(
      'This command always sends "suspended": true; --body must not change it',
    );
    expect(error.details.hint).toBe('Remove the property from --body.');
  });

  it('passes non-object bodies through when nothing is merged', async () => {
    await expect(build(start, { body: '[1,2]' })).resolves.toEqual([1, 2]);
    await expect(build(start, { body: 'null' })).resolves.toBeNull();
    await expect(build(op('setProcessInstanceVariable'), { body: '"raw"' })).resolves.toBe('raw');
  });

  it('rejects non-object bodies combined with options', async () => {
    const message = '--body must be a JSON object to combine it with other options';
    const hint = 'Put all properties into --body, or pass them as options only.';
    const withField = await caught(build(start, { body: '[1]', 'business-key': 'x' }));
    expect(withField.message).toBe(message);
    expect(withField.details.hint).toBe(hint);
    expect((await caught(build(start, { body: '"x"', var: ['a=1'] }))).message).toBe(message);
    const suspend = findOperation(catalog, 'process-instance', 'suspend');
    if (suspend === undefined) throw new Error('missing preset');
    expect((await caught(build(suspend, { body: 'null' }))).message).toBe(message);
    const variable = op('setProcessInstanceVariable');
    expect((await caught(build(variable, { body: '1', value: 'x' }))).message).toBe(message);
  });

  it('ignores flags of other operations when deciding about non-object bodies', async () => {
    await expect(build(start, { body: '[1]', value: 'x', 'max-results': '1' })).resolves.toEqual([
      1,
    ]);
  });

  it('reads --body from a file or stdin', async () => {
    await expect(
      build(start, { body: '@start.json' }, deps({ 'start.json': '{"businessKey":"f"}' })),
    ).resolves.toEqual({ businessKey: 'f' });
    await expect(build(start, { body: '-' }, deps({}, '{"businessKey":"s"}'))).resolves.toEqual({
      businessKey: 's',
    });
  });

  it('uses the last --body occurrence', async () => {
    await expect(build(start, { body: ['{"a":1}', '{"b":2}'] })).resolves.toEqual({ b: 2 });
  });

  describe('--value', () => {
    const setVariable = op('setProcessInstanceVariable');

    it('auto types the value without --type', async () => {
      await expect(build(setVariable, { value: '42' })).resolves.toEqual({
        value: 42,
        type: 'Integer',
      });
      await expect(build(setVariable, { value: 'hello' })).resolves.toEqual({
        value: 'hello',
        type: 'String',
      });
    });

    it('converts the value with --type', async () => {
      await expect(build(setVariable, { value: '01234', type: 'String' })).resolves.toEqual({
        value: '01234',
        type: 'String',
      });
      await expect(build(setVariable, { value: '{"a":1}', type: 'json' })).resolves.toEqual({
        value: '{"a":1}',
        type: 'Json',
      });
    });

    it('normalizes Date values to the engine format', async () => {
      await expect(build(setVariable, { value: '2024-05-01', type: 'Date' })).resolves.toEqual({
        value: '2024-05-01T00:00:00.000+0000',
        type: 'Date',
      });
      await expect(build(start, { var: 'due:Date=2024-05-01T10:00Z' })).resolves.toEqual({
        variables: { due: { value: '2024-05-01T10:00:00.000+0000', type: 'Date' } },
      });
    });

    it('uses the type from --body when --type is absent', async () => {
      await expect(
        build(setVariable, { body: '{"type":"Long","valueInfo":{}}', value: '5' }),
      ).resolves.toEqual({ type: 'Long', value: 5, valueInfo: {} });
    });

    it('auto types when the body type is not a string', async () => {
      await expect(build(setVariable, { body: '{"type":null}', value: 'true' })).resolves.toEqual({
        type: 'Boolean',
        value: true,
      });
    });

    it('reports conversion errors', async () => {
      expect((await caught(build(setVariable, { value: 'x', type: 'Integer' }))).message).toBe(
        '--value expects an integer, got "x"',
      );
      expect((await caught(build(setVariable, { value: 'x', type: 'Object' }))).message).toBe(
        'Unknown variable type "Object"',
      );
    });

    it('keeps --type alone as a plain field', async () => {
      await expect(build(setVariable, { type: 'Null' })).resolves.toEqual({ type: 'Null' });
    });

    it('is ignored for bodies that are not a variable value', async () => {
      await expect(build(start, { value: '1' })).resolves.toEqual({});
    });
  });
});
