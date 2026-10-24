import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../catalog/catalog.js';
import { expandSchema } from '../catalog/schema.js';
import { fieldNames, propertyLines, schemaLabel } from './schema-text.js';

const catalog = loadCatalog();

function expanded(name: string, depth: number): unknown {
  return expandSchema({ $ref: `#/components/schemas/${name}` }, catalog.schemas, depth);
}

describe('schemaLabel', () => {
  it('labels scalars with their format', () => {
    expect(schemaLabel({ type: 'string' })).toBe('string');
    expect(schemaLabel({ type: 'string', format: 'date-time' })).toBe('string(date-time)');
    expect(schemaLabel({ type: 'integer', format: 'int64', title: 'Named' })).toBe('Named');
    expect(schemaLabel({ type: 'integer', format: 'int64', title: 42 })).toBe('integer(int64)');
  });

  it('labels references, titled objects, arrays and maps', () => {
    expect(schemaLabel({ $ref: 'TaskDto' })).toBe('TaskDto');
    expect(schemaLabel({ $ref: '#/components/schemas/TaskDto' })).toBe('TaskDto');
    expect(schemaLabel({ title: 'TaskDto', type: 'object', properties: {} })).toBe('TaskDto');
    expect(schemaLabel({ type: 'array', items: { $ref: 'TaskDto' } })).toBe('array<TaskDto>');
    expect(schemaLabel({ type: 'array' })).toBe('array<any>');
    expect(
      schemaLabel({ type: 'object', additionalProperties: { $ref: 'VariableValueDto' } }),
    ).toBe('map<VariableValueDto>');
    expect(
      schemaLabel({ type: 'array', items: { additionalProperties: { type: 'boolean' } } }),
    ).toBe('array<map<boolean>>');
  });

  it('labels untitled objects and schemas without type information', () => {
    expect(schemaLabel({ properties: { a: { type: 'string' } } })).toBe('object');
    expect(schemaLabel({ allOf: [{ $ref: 'X' }] })).toBe('object');
    expect(schemaLabel({ type: 'object', additionalProperties: true })).toBe('object');
    expect(schemaLabel({ description: 'anything' })).toBe('any');
    expect(schemaLabel({ format: 'int32' })).toBe('any');
    expect(
      schemaLabel({
        title: 'Mixed',
        properties: { a: {} },
        additionalProperties: { type: 'string' },
      }),
    ).toBe('Mixed');
    expect(schemaLabel(undefined)).toBe('any');
    expect(schemaLabel([1])).toBe('any');
  });
});

describe('propertyLines', () => {
  it('lists properties with type, required, enum and first sentence of the description', () => {
    const schema = {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: '**Mandatory.** The name. More text here.' },
        mode: { type: 'string', enum: ['fast', 'slow'], description: 'The mode, e.g. Fast. Next.' },
        tags: { type: 'array', items: { type: 'string' } },
        plain: { type: 'boolean', description: 'Ends without a period' },
        later: { type: 'string', description: 'Is Mandatory. Here.' },
        abbreviations: { type: 'string', description: 'Uses i.e. This and etc. That. Then more.' },
        only: { type: 'string', description: '**Mandatory.**' },
      },
    };
    expect(propertyLines(schema)).toEqual([
      '  name: string, required - The name.',
      '  mode: string, one of fast|slow - The mode, e.g. Fast.',
      '  tags: array<string>',
      '  plain: boolean - Ends without a period',
      '  later: string - Is Mandatory.',
      '  abbreviations: string - Uses i.e. This and etc. That.',
      '  only: string',
    ]);
  });

  it('nests object properties, array items and map values, merging allOf', () => {
    const schema = {
      allOf: [{ properties: { id: { type: 'string' } } }, { required: ['id'] }],
      properties: {
        child: { type: 'object', properties: { a: { type: 'integer' } } },
        list: { type: 'array', items: { properties: { b: { type: 'number' } } } },
        map: { type: 'object', additionalProperties: { properties: { c: { type: 'boolean' } } } },
        deeper: { $ref: 'Unexpanded' },
      },
    };
    expect(propertyLines(schema, '')).toEqual([
      'id: string, required',
      'child: object',
      '  a: integer',
      'list: array<object>',
      '  b: number',
      'map: map<object>',
      '  c: boolean',
      'deeper: Unexpanded',
    ]);
  });

  it('wraps long descriptions with a hanging indent', () => {
    const description = `${'word '.repeat(30)}end.`;
    const lines = propertyLines({ properties: { field: { type: 'string', description } } });
    expect(lines[0]).toMatch(/^ {2}field: string - word/);
    expect(lines[1]).toMatch(/^ {6}word/);
    expect(lines.every((line) => line.length <= 100)).toBe(true);
  });

  it('renders the expanded catalog schemas', () => {
    const lines = propertyLines(expanded('FetchExternalTasksDto', 3));
    expect(lines.slice(0, 2)).toEqual([
      '  workerId: string, required - The id of the worker on which behalf tasks are fetched.',
      '  maxTasks: integer(int32), required - The maximum number of tasks to return.',
    ]);
    expect(lines).toContain("    topicName: string, required - The topic's name.");
    expect(propertyLines(undefined)).toEqual([]);
    expect(propertyLines({ type: 'string' })).toEqual([]);
    expect(propertyLines({ type: 'array' })).toEqual([]);
  });
});

describe('fieldNames', () => {
  it('lists the properties of objects and of array items', () => {
    expect(fieldNames({ properties: { id: {}, name: {} } })).toEqual(['id', 'name']);
    expect(fieldNames({ type: 'array', items: { properties: { id: {} } } })).toEqual(['id']);
    expect(fieldNames(expanded('ProcessInstanceDto', 2))).toEqual([
      'id',
      'definitionId',
      'definitionKey',
      'businessKey',
      'caseInstanceId',
      'ended',
      'suspended',
      'tenantId',
      'links',
    ]);
  });

  it('has no names for maps, scalars and missing schemas', () => {
    expect(fieldNames({ type: 'object', additionalProperties: { type: 'string' } })).toEqual([]);
    expect(fieldNames({ type: 'array', items: { additionalProperties: {} } })).toEqual([]);
    expect(fieldNames({ type: 'array' })).toEqual([]);
    expect(fieldNames({ type: 'string' })).toEqual([]);
    expect(fieldNames(undefined)).toEqual([]);
  });
});
