import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findByOperationId, loadCatalog } from '../catalog/catalog.js';
import type { OperationSpec } from '../catalog/types.js';
import { normalizeDateTime } from '../operation/dates.js';
import { VARIABLE_TYPES } from '../operation/variables.js';
import { operationArguments, operationOptions, summarize, usageLine } from './options.js';

const catalog = loadCatalog();

function operation(id: string): OperationSpec {
  const found = findByOperationId(catalog, id);
  if (found === undefined) throw new Error(`unknown operation ${id}`);
  return found;
}

function option(id: string, flag: string) {
  const found = operationOptions(operation(id), catalog.schemas).find((o) => o.flag === flag);
  if (found === undefined) throw new Error(`no option ${flag} on ${id}`);
  return found;
}

describe('summarize', () => {
  it('keeps only the first paragraph on one line', () => {
    expect(summarize('First line\nsecond line.\n\nOther paragraph.')).toBe(
      'First line second line.',
    );
  });

  it('reduces markdown links and bold text to their text', () => {
    expect(summarize('See [the docs](https://example.com/x) and **Note**: here')).toBe(
      'See the docs and Note: here',
    );
  });

  it('ends the first paragraph at a line holding only whitespace and collapses whitespace', () => {
    expect(summarize('First  part\t here\n  \nSecond')).toBe('First part here');
  });

  it('returns an empty string for empty input', () => {
    expect(summarize('')).toBe('');
    expect(summarize('   \n  ')).toBe('');
  });

  it('never returns line breaks or surrounding whitespace', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = summarize(text);
        expect(result).not.toMatch(/\n/);
        expect(result).toBe(result.trim());
      }),
    );
  });
});

describe('operationOptions', () => {
  it('renders query parameters with typed placeholders and enums', () => {
    expect(option('getProcessInstances', 'sort-order')).toEqual({
      flag: 'sort-order',
      syntax: '--sort-order <value>',
      kind: 'value',
      valueName: '<value>',
      type: 'string',
      required: false,
      source: 'query',
      enum: ['asc', 'desc'],
      description:
        'Sort the results in a given order. Values may be asc for ascending order or desc for descending order. Must be used in conjunction with the sortBy parameter.',
    });
    expect(option('getProcessInstances', 'max-results')).toMatchObject({
      syntax: '--max-results <n>',
      valueName: '<n>',
      type: 'integer',
    });
  });

  it('marks date-time parameters', () => {
    const started = option('getHistoricProcessInstances', 'started-after');
    expect(started).toMatchObject({ type: 'date-time', syntax: '--started-after <date-time>' });
  });

  it('renders booleans as --[no-]flag, true-only filters and no- flags as presence flags', () => {
    expect(option('getProcessInstanceVariables', 'deserialize-values')).toMatchObject({
      kind: 'boolean',
      syntax: '--[no-]deserialize-values',
    });
    const trueOnly = operation('getProcessInstances').params.find((p) => p.trueOnly === true);
    expect(trueOnly).toBeDefined();
    expect(option('getProcessInstances', trueOnly!.flag)).toMatchObject({
      kind: 'presence',
      syntax: `--${trueOnly!.flag}`,
    });
    expect(option('getExternalTasks', 'no-retries-left')).toMatchObject({
      kind: 'presence',
      syntax: '--no-retries-left',
    });
  });

  it('renders JSON body fields, variable maps, --body and --no-validate', () => {
    const start = operationOptions(operation('startProcessInstanceByKey'), catalog.schemas);
    expect(start.map((o) => o.syntax)).toEqual([
      '--business-key <value>',
      '--case-instance-id <value>',
      '--[no-]skip-custom-listeners',
      '--[no-]skip-io-mappings',
      '--[no-]with-variables-in-return',
      '--var <name=value>',
      '--body <json|@file|->',
      '--no-validate',
    ]);
    expect(start.find((o) => o.flag === 'var')).toMatchObject({
      kind: 'repeatable',
      source: 'variables',
      type: 'variables',
    });
    expect(start.find((o) => o.flag === 'validate')).toMatchObject({ kind: 'negated' });
    expect(start.find((o) => o.flag === 'body')).toMatchObject({ kind: 'value', type: 'json' });
  });

  it('renders array body fields as repeatable comma separated options', () => {
    const ids = operationOptions(operation('deleteProcessInstancesAsyncOperation')).find(
      (o) => o.flag === 'process-instance-ids',
    );
    expect(ids).toMatchObject({
      kind: 'repeatable',
      syntax: '--process-instance-ids <values>',
      type: 'array',
      source: 'body-field',
    });
    expect(ids?.description).toMatch(/Comma separated, repeatable\.$/);
  });

  it('marks body fields required by the schema only when schemas are given', () => {
    const fetch = operation('fetchAndLock');
    const required = (schemas?: typeof catalog.schemas) =>
      operationOptions(fetch, schemas)
        .filter((o) => o.required)
        .map((o) => o.flag);
    expect(required(catalog.schemas)).toEqual(['worker-id', 'max-tasks']);
    expect(required()).toEqual([]);
  });

  it('explains variable syntax, all variable types and the Date forms', () => {
    const variable = option('startProcessInstanceByKey', 'var');
    expect(variable.description).toBe(
      'Entry of "variables": name=value (auto typed: true/false, integers, decimals, null, else ' +
        'string) or name:Type=value (String, Integer, Short, Long, Double, Boolean, Date, Json, Xml, ' +
        'Null; Date accepts the date-time forms, e.g. 2024-05-01 or 2024-05-01T10:00:00+02:00); ' +
        'repeatable.',
    );
    expect(variable.description).toContain(`(${VARIABLE_TYPES.join(', ')};`);
    expect(option('deliverMessage', 'correlation-key').description).toMatch(
      /^Entry of "correlationKeys": name=value .*Date accepts the date-time forms/,
    );
    for (const example of ['2024-05-01', '2024-05-01T10:00:00+02:00']) {
      expect(() => normalizeDateTime(example)).not.toThrow();
    }
    expect(option('putTaskVariable', 'value').description).toBe(
      'Variable value; auto typed like --var unless --type is given (--type Date accepts the date-time forms).',
    );
  });

  it('leaves out enum for options without choices', () => {
    expect(option('getProcessInstances', 'business-key')).not.toHaveProperty('enum');
  });

  it('describes --value, --body and --no-validate exactly', () => {
    const put = operationOptions(operation('putTaskVariable'));
    expect(put.slice(1)).toEqual([
      {
        flag: 'value',
        syntax: '--value <value>',
        kind: 'value',
        valueName: '<value>',
        type: 'string',
        required: false,
        source: 'value',
        description:
          'Variable value; auto typed like --var unless --type is given (--type Date accepts the date-time forms).',
      },
      {
        flag: 'body',
        syntax: '--body <json|@file|->',
        kind: 'value',
        valueName: '<json|@file|->',
        type: 'json',
        required: false,
        source: 'body',
        description:
          'Request body as JSON, @path to a JSON file or - for stdin; flags above override its properties.',
      },
      {
        flag: 'validate',
        syntax: '--no-validate',
        kind: 'negated',
        type: 'boolean',
        required: false,
        source: 'validate',
        description: 'Skip the client side validation of the request body against the API schema.',
      },
    ]);
  });

  it('describes multipart options and --base-dir exactly', () => {
    const deploy = operationOptions(operation('createDeployment'));
    expect(deploy[0]).toEqual({
      flag: 'tenant-id',
      syntax: '--tenant-id <value>',
      kind: 'value',
      valueName: '<value>',
      type: 'string',
      required: false,
      source: 'multipart',
      description: 'The tenant id for the deployment to be created.',
    });
    expect(deploy[2]).toMatchObject({ kind: 'boolean', type: 'boolean', source: 'multipart' });
    expect(deploy.at(-1)).toEqual({
      flag: 'base-dir',
      syntax: '--base-dir <dir>',
      kind: 'value',
      valueName: '<dir>',
      type: 'string',
      required: false,
      source: 'base-dir',
      description:
        'Name resources by their path relative to this directory instead of their file name.',
    });
  });

  it('uses <number> for number parameters and a plain repeat note for undocumented arrays', () => {
    const base = operation('deleteProcessInstancesAsyncOperation');
    const body = base.body;
    if (body?.kind !== 'json') throw new Error('expected a JSON body');
    const spec: OperationSpec = {
      ...base,
      params: [
        {
          name: 'ratio',
          in: 'query',
          flag: 'ratio',
          type: 'number',
          required: false,
          description: '',
        },
      ],
      body: {
        ...body,
        fields: [{ name: 'ids', flag: 'ids', type: 'array', items: 'string', description: '' }],
      },
    };
    const [ratio, ids] = operationOptions(spec);
    expect(ratio).toMatchObject({ syntax: '--ratio <number>', valueName: '<number>' });
    expect(ids).toMatchObject({
      syntax: '--ids <values>',
      description: 'Comma separated, repeatable.',
    });
  });

  it('adds --value for single variable bodies', () => {
    const put = operationOptions(operation('putTaskVariable'));
    expect(put.map((o) => o.flag)).toEqual(['type', 'value', 'body', 'validate']);
    expect(put.find((o) => o.flag === 'value')).toMatchObject({ source: 'value', kind: 'value' });
  });

  it('renders multipart fields, files and --base-dir for deployments', () => {
    const deploy = operationOptions(operation('createDeployment'));
    expect(deploy.map((o) => o.syntax)).toEqual([
      '--tenant-id <value>',
      '--deployment-source <value>',
      '--[no-]deploy-changed-only',
      '--[no-]enable-duplicate-filtering',
      '--deployment-name <value>',
      '--deployment-activation-time <date-time>',
      '--base-dir <dir>',
    ]);
    expect(deploy.find((o) => o.flag === 'deploy-changed-only')?.source).toBe('multipart');
    const binary = operationOptions(operation('setBinaryTaskVariable'));
    expect(binary.find((o) => o.flag === 'data')).toMatchObject({
      syntax: '--data <path>',
      type: 'file',
      source: 'file',
    });
  });

  it('adds --all only to paginated operations', () => {
    expect(operationOptions(operation('getProcessInstances')).at(-1)).toMatchObject({
      flag: 'all',
      kind: 'presence',
      source: 'all',
    });
    expect(operationOptions(operation('getProcessInstance')).some((o) => o.flag === 'all')).toBe(
      false,
    );
  });

  it('gives every operation unique flags', () => {
    for (const spec of catalog.operations) {
      const flags = operationOptions(spec).map((o) => o.flag);
      expect(new Set(flags).size, `${spec.group} ${spec.name}`).toBe(flags.length);
    }
  });

  it('keeps syntax consistent with kind for every catalog option', () => {
    for (const spec of catalog.operations) {
      for (const doc of operationOptions(spec, catalog.schemas)) {
        const expected = {
          value: `--${doc.flag} ${doc.valueName ?? ''}`,
          repeatable: `--${doc.flag} ${doc.valueName ?? ''}`,
          boolean: `--[no-]${doc.flag}`,
          presence: `--${doc.flag}`,
          negated: `--no-${doc.flag}`,
        }[doc.kind];
        expect(doc.syntax).toBe(expected);
      }
    }
  });
});

describe('operationArguments and usageLine', () => {
  it('lists path parameters in path order', () => {
    const spec = operation('getProcessInstanceVariable');
    expect(operationArguments(spec)).toEqual([
      { name: 'id', required: true, variadic: false, description: expect.any(String) },
      { name: 'var-name', required: true, variadic: false, description: expect.any(String) },
    ]);
    expect(usageLine(spec)).toBe('operate process-instance get-variable <id> <var-name> [options]');
  });

  it('adds variadic resource files to deployment create', () => {
    const spec = operation('createDeployment');
    expect(operationArguments(spec)).toEqual([
      {
        name: 'files',
        required: true,
        variadic: true,
        description: 'Resource files to deploy (BPMN, DMN, forms, scripts, ...).',
      },
    ]);
    expect(usageLine(spec)).toBe('operate deployment create <files...> [options]');
  });

  it('has no arguments for collection endpoints', () => {
    expect(operationArguments(operation('getProcessInstances'))).toEqual([]);
    expect(usageLine(operation('getProcessInstances'))).toBe(
      'operate process-instance list [options]',
    );
  });
});
