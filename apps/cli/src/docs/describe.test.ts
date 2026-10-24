import { describe, expect, it } from 'vitest';
import { findByOperationId, findOperation, loadCatalog } from '../catalog/catalog.js';
import { expandSchema } from '../catalog/schema.js';
import type { OperationSpec } from '../catalog/types.js';
import { type DescribeView, describeOperation, renderDescribeText } from './describe.js';
import { examplesFor } from './examples.js';
import { operationOptions } from './options.js';

const catalog = loadCatalog();

function view(group: string, name: string): DescribeView {
  const operation = findOperation(catalog, group, name);
  if (operation === undefined) throw new Error(`unknown command ${group} ${name}`);
  return describeOperation(operation, catalog);
}

function option(described: DescribeView, flag: string) {
  return described.options.find((entry) => entry.flag === flag);
}

describe('describeOperation', () => {
  it('describes a JSON body operation with exactly the documented fields', () => {
    const start = view('process-definition', 'start');
    const operation = findByOperationId(catalog, 'startProcessInstanceByKey')!;
    expect(Object.keys(start)).toEqual([
      'command',
      'operationId',
      'method',
      'path',
      'summary',
      'description',
      'effect',
      'deprecated',
      'arguments',
      'options',
      'body',
      'responses',
      'examples',
    ]);
    expect(start).toMatchObject({
      command: 'operate process-definition start <key>',
      operationId: 'startProcessInstanceByKey',
      method: 'POST',
      path: '/process-definition/key/{key}/start',
      summary: operation.summary,
      description: operation.description,
      effect: 'write',
      deprecated: false,
      arguments: [
        {
          name: 'key',
          description:
            'The key of the process definition (the latest version thereof) to be retrieved.',
        },
      ],
    });
    expect(start.examples).toEqual(examplesFor(operation));
  });

  it('lists the options with syntax, type, required, enum, format and repeatable', () => {
    const start = view('process-definition', 'start');
    expect(start.options.map((entry) => entry.flag)).toEqual(
      operationOptions(findByOperationId(catalog, 'startProcessInstanceByKey')!).map(
        (o) => o.syntax,
      ),
    );
    expect(option(start, '--business-key <value>')).toEqual({
      flag: '--business-key <value>',
      type: 'string',
      required: false,
      description: 'The business key of the process instance.',
    });
    expect(option(start, '--var <name=value>')).toMatchObject({
      type: 'variables',
      required: false,
      repeatable: true,
    });
    const instances = view('process-instance', 'list');
    expect(option(instances, '--sort-order <value>')).toMatchObject({ enum: ['asc', 'desc'] });
    expect(option(instances, '--max-results <n>')).toEqual({
      flag: '--max-results <n>',
      type: 'integer',
      format: 'int32',
      required: false,
      description: expect.stringMatching(/^Pagination of results/),
    });
    expect(option(view('decision-definition', 'list'), '--version <n>')).toMatchObject({
      type: 'integer',
      format: 'int32',
    });
    expect(option(instances, '--all')).toEqual({
      flag: '--all',
      type: 'boolean',
      required: false,
      description:
        'Fetch all pages and print one combined list (page size --max-results, default 500).',
    });
    const history = view('historic-process-instance', 'list');
    expect(option(history, '--started-after <date-time>')).toMatchObject({
      type: 'date-time',
      format: 'date-time',
    });
  });

  it('adds required options to the command', () => {
    const fetch = view('external-task', 'fetch-and-lock');
    expect(fetch.command).toBe(
      'operate external-task fetch-and-lock --worker-id <value> --max-tasks <n>',
    );
    expect(option(fetch, '--max-tasks <n>')).toEqual({
      flag: '--max-tasks <n>',
      type: 'integer',
      required: true,
      format: 'int32',
      description: 'Mandatory. The maximum number of tasks to return.',
    });
  });

  it('describes the JSON body with its expanded schema and variable options', () => {
    const start = view('process-definition', 'start');
    expect(start.body).toEqual({
      contentType: 'application/json',
      schemaName: 'StartProcessInstanceDto',
      schema: expandSchema(
        { $ref: '#/components/schemas/StartProcessInstanceDto' },
        catalog.schemas,
        3,
      ),
      variableFlags: { '--var': 'variables' },
    });
    expect(start.body?.schema).toMatchObject({ title: 'StartProcessInstanceDto', type: 'object' });
    expect(view('message', 'correlate').body?.variableFlags).toEqual({
      '--correlation-key': 'correlationKeys',
      '--local-correlation-key': 'localCorrelationKeys',
      '--var': 'processVariables',
      '--local-var': 'processVariablesLocal',
      '--triggered-scope-var': 'processVariablesToTriggeredScope',
    });
    expect(view('process-instance', 'set-variable').body).not.toHaveProperty('variableFlags');
  });

  it('describes multipart bodies and resource file arguments', () => {
    const deploy = view('deployment', 'create');
    expect(deploy.command).toBe('operate deployment create <files...>');
    expect(deploy.arguments).toEqual([
      { name: 'files', description: 'Resource files to deploy (BPMN, DMN, forms, scripts, ...).' },
    ]);
    expect(deploy.body).toEqual({
      contentType: 'multipart/form-data',
      schemaName: 'MultiFormDeploymentDto',
      schema: expandSchema(
        { $ref: '#/components/schemas/MultiFormDeploymentDto' },
        catalog.schemas,
        3,
      ),
    });
    expect(option(deploy, '--deployment-activation-time <date-time>')).toMatchObject({
      format: 'date-time',
    });
    expect(option(view('task-variable', 'set-binary'), '--data <path>')).toEqual({
      flag: '--data <path>',
      type: 'file',
      required: false,
      description: expect.any(String),
    });
  });

  it('builds the multipart schema from the fields when the schema is unknown', () => {
    const base = findByOperationId(catalog, 'createDeployment')!;
    const spec: OperationSpec = {
      ...base,
      body: {
        kind: 'multipart',
        resources: false,
        fields: [
          { name: 'file', flag: 'file', type: 'binary', description: 'The file.' },
          { name: 'flag', flag: 'flag', type: 'boolean', description: 'A flag.' },
          { name: 'when', flag: 'when', type: 'string', format: 'date-time', description: 'When.' },
        ],
      },
    };
    const expected = {
      contentType: 'multipart/form-data',
      schema: {
        type: 'object',
        properties: {
          file: { type: 'string', format: 'binary', description: 'The file.' },
          flag: { type: 'boolean', description: 'A flag.' },
          when: { type: 'string', format: 'date-time', description: 'When.' },
        },
      },
    };
    expect(describeOperation(spec, catalog).body).toEqual(expected);
    const named = { ...catalog, schemas: { ...catalog.schemas, undefined: { type: 'string' } } };
    expect(describeOperation(spec, named).body).toEqual(expected);
    const unknown = {
      ...spec,
      body: { ...spec.body!, schemaName: 'NoSuchSchema' },
    } as OperationSpec;
    expect(describeOperation(unknown, catalog).body).toEqual({
      ...expected,
      schemaName: 'NoSuchSchema',
    });
  });

  it('has no body for operations without one and no schema for empty responses', () => {
    const get = view('process-instance', 'get');
    expect(get).not.toHaveProperty('body');
    expect(get.options).toEqual([]);
    expect(get.responses).toEqual([
      {
        status: 200,
        kind: 'json',
        contentTypes: ['application/json'],
        schema: expandSchema(
          { $ref: '#/components/schemas/ProcessInstanceDto' },
          catalog.schemas,
          2,
        ),
      },
    ]);
    const deleted = view('process-instance', 'delete').responses;
    expect(deleted).toEqual([{ status: 204, kind: 'none', contentTypes: [] }]);
    expect(deleted[0]).not.toHaveProperty('schema');
  });

  it('expands response schemas two levels deep', () => {
    const tasks = view('task', 'list').responses[0]!.schema as { items: Record<string, unknown> };
    expect(tasks.items.title).toBe('TaskWithAttachmentAndCommentDto');
    const json = JSON.stringify(view('process-instance', 'get').responses);
    expect(json).toContain('"title":"LinkableDto"');
    expect(json).toContain('"$ref":"AtomLink"');
  });

  it('describes every operation of the catalog as JSON', () => {
    for (const operation of catalog.operations) {
      const described = describeOperation(operation, catalog);
      expect(JSON.parse(JSON.stringify(described))).toEqual(described);
      expect(described.options).toHaveLength(operationOptions(operation).length);
      expect(described.responses).toHaveLength(operation.responses.length);
      expect(described.command.startsWith(`operate ${operation.group} ${operation.name}`)).toBe(
        true,
      );
    }
  });
});

describe('renderDescribeText', () => {
  const sample: DescribeView = {
    command: 'operate sample run <id> --mode <value>',
    operationId: 'runSample',
    method: 'POST',
    path: '/sample/{id}/run',
    summary: 'Run a sample',
    description: 'Runs the **sample**.\n\n* first\n* second',
    effect: 'bulk',
    deprecated: true,
    arguments: [{ name: 'id', description: 'The id.' }],
    options: [
      {
        flag: '--mode <value>',
        type: 'string',
        required: true,
        enum: ['fast', 'slow'],
        description: 'Mandatory. The mode.',
      },
      {
        flag: '--var <name=value>',
        type: 'variables',
        required: false,
        repeatable: true,
        description: 'A variable.',
      },
      { flag: '--quiet', type: 'boolean', required: false, description: '' },
      {
        flag: '--level <n>',
        type: 'integer',
        required: true,
        description: 'The level. Mandatory. Below 10.',
      },
    ],
    body: {
      contentType: 'application/json',
      schemaName: 'SampleDto',
      schema: {
        title: 'SampleDto',
        type: 'object',
        required: ['mode'],
        properties: {
          mode: { type: 'string', enum: ['fast', 'slow'] },
          variables: { type: 'object', additionalProperties: { $ref: 'VariableValueDto' } },
        },
      },
      variableFlags: { '--var': 'variables', '--local-var': 'localVariables' },
    },
    responses: [
      {
        status: 200,
        kind: 'json',
        contentTypes: ['application/json'],
        schema: { type: 'array', items: { title: 'ResultDto', properties: { id: {}, state: {} } } },
      },
      { status: 200, kind: 'binary', contentTypes: ['application/octet-stream', '*/*'] },
      {
        status: 200,
        kind: 'json',
        contentTypes: ['application/json'],
        schema: { type: 'object', additionalProperties: {} },
      },
      { status: 204, kind: 'none', contentTypes: [] },
    ],
    examples: ['operate sample run abc --mode fast --yes'],
  };

  it('renders every section', () => {
    expect(renderDescribeText(sample)).toBe(
      [
        'USAGE',
        '  operate sample run <id> --mode <value> [options]',
        '',
        'DESCRIPTION',
        '  Run a sample',
        '  POST /sample/{id}/run (effect: bulk, operationId: runSample)',
        '  Deprecated: avoid in new scripts.',
        '',
        '  Runs the sample.',
        '',
        '  * first',
        '  * second',
        '',
        'ARGUMENTS',
        '  <id>  The id.',
        '',
        'OPTIONS',
        '  --mode <value>      Required. The mode. One of: fast, slow.',
        '  --var <name=value>  A variable.',
        '  --quiet',
        '  --level <n>         Required. The level. Mandatory. Below 10.',
        '',
        'BODY',
        '  application/json, SampleDto',
        '  Variable options: --var (variables), --local-var (localVariables)',
        '  mode: string, required, one of fast|slow',
        '  variables: map<VariableValueDto>',
        '',
        'RESPONSES',
        '  200 json (application/json): array<ResultDto>',
        '    Fields: id, state',
        '  200 binary (application/octet-stream, */*)',
        '  200 json (application/json): map<any>',
        '  204 no content',
        '',
        'EXAMPLES',
        '  operate sample run abc --mode fast --yes',
        '',
      ].join('\n'),
    );
  });

  it('leaves out empty sections and optional lines', () => {
    const minimal: DescribeView = {
      ...sample,
      command: 'operate sample get',
      description: '  ',
      deprecated: false,
      arguments: [],
      options: [],
      responses: [],
      examples: [],
      body: { contentType: 'multipart/form-data', schema: { type: 'object' } },
    };
    expect(renderDescribeText(minimal)).toBe(
      [
        'USAGE',
        '  operate sample get [options]',
        '',
        'DESCRIPTION',
        '  Run a sample',
        '  POST /sample/{id}/run (effect: bulk, operationId: runSample)',
        '',
        'BODY',
        '  multipart/form-data',
        '',
      ].join('\n'),
    );
    const { body: _body, ...withoutBody } = minimal;
    expect(renderDescribeText(withoutBody)).not.toContain('BODY');
  });

  it('keeps every catalog operation within 100 columns, except single overlong words', () => {
    for (const operation of catalog.operations) {
      const text = renderDescribeText(describeOperation(operation, catalog));
      expect(text.endsWith('\n')).toBe(true);
      for (const line of text.slice(0, -1).split('\n')) {
        if (line.length <= 100) continue;
        const words = line.trim().replace(/ \\$/, '').split(' ');
        expect(words.length, line).toBe(1);
      }
    }
  });

  it('renders a real operation with wrapped examples that still paste into a shell', () => {
    const text = renderDescribeText(view('process-instance', 'modify'));
    expect(text).toContain(
      [
        'EXAMPLES',
        '  operate process-instance modify 6f2b8c3e-0f4a-11ef-a1b2-0242ac120002 --body @modification.json \\',
        '      --dry-run',
      ].join('\n'),
    );
    expect(text).toContain('\nRESPONSES\n  204 no content\n');
  });

  it('wraps the facts line, the variable options and the response fields', () => {
    const long = renderDescribeText({ ...sample, operationId: `run${'Sample'.repeat(12)}` });
    expect(long).toContain(
      [
        '  POST /sample/{id}/run (effect: bulk, operationId:',
        `    run${'Sample'.repeat(12)})`,
      ].join('\n'),
    );
    const correlate = renderDescribeText(view('message', 'correlate'));
    expect(correlate).toContain(
      [
        '  Variable options: --correlation-key (correlationKeys), --local-correlation-key',
        '    (localCorrelationKeys), --var (processVariables), --local-var (processVariablesLocal),',
        '    --triggered-scope-var (processVariablesToTriggeredScope)',
      ].join('\n'),
    );
    const fetch = renderDescribeText(view('external-task', 'fetch-and-lock'));
    expect(fetch).toContain(
      [
        'RESPONSES',
        '  200 json (application/json): array<LockedExternalTaskDto>',
        '    Fields: activityId, activityInstanceId, errorMessage, errorDetails, executionId, id,',
        '      lockExpirationTime, processDefinitionId, processDefinitionKey, processDefinitionVersionTag,',
        '      processInstanceId, tenantId, retries, suspended, workerId, priority, topicName, businessKey,',
        '      variables, extensionProperties, createTime',
        '',
      ].join('\n'),
    );
    expect(fetch).toContain(
      '  --max-tasks <n>               Required. The maximum number of tasks to return.\n',
    );
  });
});
