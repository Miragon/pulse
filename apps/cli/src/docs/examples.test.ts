import { describe, expect, it } from 'vitest';
import { findByOperationId, findOperation, loadCatalog } from '../catalog/catalog.js';
import type { OperationSpec } from '../catalog/types.js';
import { examplesFor } from './examples.js';
import { commandWords } from './text.js';

const catalog = loadCatalog();

function command(group: string, name: string): OperationSpec {
  const found = findOperation(catalog, group, name);
  if (found === undefined) throw new Error(`unknown command ${group} ${name}`);
  return found;
}

/** The everyday commands of design §5, which have curated examples. */
const EVERYDAY: readonly (readonly [string, string, number])[] = [
  ['deployment', 'create', 2],
  ['process-definition', 'list', 2],
  ['process-definition', 'start', 3],
  ['process-definition', 'xml', 1],
  ['process-instance', 'list', 3],
  ['process-instance', 'get', 1],
  ['process-instance', 'get-variables', 2],
  ['process-instance', 'delete', 2],
  ['process-instance', 'modify', 2],
  ['process-instance', 'suspend', 1],
  ['process-instance', 'activate', 1],
  ['process-instance', 'set-variable', 3],
  ['task', 'list', 3],
  ['task', 'claim', 1],
  ['task', 'complete', 2],
  ['external-task', 'fetch-and-lock', 2],
  ['external-task', 'complete', 1],
  ['external-task', 'handle-failure', 2],
  ['incident', 'list', 2],
  ['incident', 'resolve', 1],
  ['job', 'list', 2],
  ['job', 'set-retries', 1],
  ['historic-process-instance', 'list', 2],
  ['message', 'correlate', 2],
  ['decision-definition', 'evaluate-by-key', 1],
];

describe('examplesFor', () => {
  it('returns the curated examples of everyday commands', () => {
    expect(examplesFor(command('process-definition', 'start'))).toEqual([
      'operate process-definition start invoice --business-key INV-1001 --var amount=250 --var approved=false',
      'operate process-definition start invoice --var invoiceDate:Date=2024-05-01 --var zip:String=01234',
      'operate process-definition start invoice --body @start.json --business-key INV-1002',
    ]);
    expect(examplesFor(command('incident', 'resolve'))).toEqual([
      'operate incident resolve 9b4f2a53-0f4a-11ef-a1b2-0242ac120002 --yes',
    ]);
  });

  it.each(EVERYDAY)('has curated examples for %s %s', (group, name, count) => {
    const examples = examplesFor(command(group, name));
    expect(examples).toHaveLength(count);
    for (const example of examples) {
      expect(example.startsWith(`operate ${group} ${name} `)).toBe(true);
      expect(example).not.toContain('my-');
    }
  });

  it('gives presets only the examples of their own command', () => {
    expect(examplesFor(command('process-instance', 'suspend'))).toEqual([
      'operate process-instance suspend 6f2b8c3e-0f4a-11ef-a1b2-0242ac120002',
    ]);
    expect(examplesFor(command('process-instance', 'activate'))).toEqual([
      'operate process-instance activate 6f2b8c3e-0f4a-11ef-a1b2-0242ac120002',
    ]);
    expect(examplesFor(command('process-instance', 'update-suspension-state-by-id'))).toEqual([
      'operate process-instance update-suspension-state-by-id my-id',
    ]);
  });

  it('returns a copy of the curated list', () => {
    const first = examplesFor(command('job', 'set-retries'));
    first.push('changed');
    expect(examplesFor(command('job', 'set-retries'))).toEqual([
      'operate job set-retries ac5a3b64-0f4a-11ef-a1b2-0242ac120002 --retries 3',
    ]);
  });

  it('confirms every delete and bulk example with --yes and previews at least one with --dry-run', () => {
    const all = catalog.operations.flatMap((operation) =>
      examplesFor(operation).map((example) => ({ operation, words: commandWords(example) })),
    );
    for (const { operation, words } of all) {
      const destructive = operation.effect === 'delete' || operation.effect === 'bulk';
      expect(words.includes('--yes'), words.join(' ')).toBe(destructive);
    }
    expect(all.filter(({ words }) => words.includes('--dry-run')).length).toBeGreaterThan(0);
  });

  it('builds a generic example from the positional arguments', () => {
    expect(examplesFor(command('process-instance', 'get-variable'))).toEqual([
      'operate process-instance get-variable my-id my-var-name',
    ]);
    expect(examplesFor(command('engine', 'list'))).toEqual(['operate engine list']);
    expect(examplesFor(command('deployment', 'delete'))).toEqual([
      'operate deployment delete my-id --yes',
    ]);
    expect(examplesFor(command('process-instance', 'delete-async'))).toEqual([
      'operate process-instance delete-async --yes',
    ]);
  });

  it('uses the first allowed value for an enum path parameter', () => {
    expect(examplesFor(command('metrics', 'sum'))).toEqual([
      'operate metrics sum activity-instance-start',
    ]);
  });

  it('adds required options with placeholder values', () => {
    expect(examplesFor(command('authorization', 'check'))).toEqual([
      'operate authorization check --permission-name my-permission-name --resource-name my-resource-name --resource-type 1',
    ]);
    expect(examplesFor(command('historic-process-instance', 'get-duration-report'))).toEqual([
      'operate historic-process-instance get-duration-report --report-type my-report-type --period-unit month',
    ]);
  });

  it('resolves required body properties with the given schemas, by default those of the catalog', () => {
    const add = command('task-identity-link', 'add');
    expect(examplesFor(add)).toEqual(['operate task-identity-link add my-id --type my-type']);
    expect(examplesFor(add, catalog.schemas)).toEqual(examplesFor(add));
    expect(examplesFor(add, {})).toEqual(['operate task-identity-link add my-id']);
  });

  it('uses typed placeholders for numbers, dates, booleans and resource files', () => {
    const base = findByOperationId(catalog, 'createDeployment')!;
    const spec: OperationSpec = {
      ...base,
      operationId: 'fakeOperation',
      group: 'fake',
      name: 'run',
      params: [
        {
          name: 'ratio',
          in: 'query',
          flag: 'ratio',
          type: 'number',
          required: true,
          description: '',
        },
        {
          name: 'since',
          in: 'query',
          flag: 'since',
          type: 'string',
          format: 'date-time',
          required: true,
          description: '',
        },
        {
          name: 'force',
          in: 'query',
          flag: 'force',
          type: 'boolean',
          required: true,
          description: '',
        },
        {
          name: 'quiet',
          in: 'query',
          flag: 'quiet',
          type: 'boolean',
          required: false,
          description: '',
        },
      ],
    };
    expect(examplesFor(spec)).toEqual([
      'operate fake run process.bpmn --ratio 1.5 --since 2024-05-01T10:00:00Z --force',
    ]);
  });
});
