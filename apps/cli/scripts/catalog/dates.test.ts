import { describe, expect, it } from 'vitest';
import { demandsEngineDate, markEngineDates } from './dates.js';
import { readPatchedSpec } from './files.js';
import type { OpenApiDocument } from './openapi.js';

const ENGINE_TEXT =
  "Restrict to tasks that are due after the given date. By default, the date must have the format `yyyy-MM-dd'T'HH:mm:ss.SSSZ`, e.g., `2013-01-23T14:42:45.435+0200`.";
/** Upstream wraps the format of some descriptions across lines. */
const WRAPPED_TEXT = "the date must have the format `yyyy-MM-\ndd'T'HH:mm:ss.SSSZ`.";
const STRING = { type: 'string' };

type Tree = Readonly<Record<string, unknown>>;

function isTree(value: unknown): value is Tree {
  return typeof value === 'object' && value !== null;
}

/** JSON pointers (unescaped) of the schemas that gained `format: date-time`. */
function addedFormats(before: unknown, after: unknown, pointer = ''): string[] {
  if (!isTree(before) || !isTree(after)) return [];
  const own = after.format === 'date-time' && before.format === undefined ? [pointer] : [];
  return [
    ...own,
    ...Object.keys(after).flatMap((key) =>
      addedFormats(before[key], after[key], `${pointer}/${key}`),
    ),
  ];
}

/** `GET /task dueDate` for parameters, `TaskQueryDto.followUpBefore` for schema properties. */
function label(spec: OpenApiDocument, pointer: string): string {
  const parameter = /^\/paths\/(.+)\/(get|post|put|delete)\/parameters\/(\d+)\/schema$/.exec(
    pointer,
  );
  if (parameter !== null) {
    const [, path = '', method = '', index = ''] = parameter;
    const operation = spec.paths[path]?.[method] as { parameters: { name: string }[] };
    return `${method.toUpperCase()} ${path} ${operation.parameters[Number(index)]?.name ?? '?'}`;
  }
  return pointer
    .replace(/^\/components\/schemas\//, '')
    .replace(/\/allOf\/\d+/, '')
    .replace('/properties/', '.');
}

describe('demandsEngineDate', () => {
  it('accepts a string without format whose description demands the engine date format', () => {
    expect(demandsEngineDate('dueAfter', STRING, ENGINE_TEXT)).toBe(true);
    expect(demandsEngineDate('executionDate', STRING, WRAPPED_TEXT)).toBe(true);
  });

  it('rejects descriptions without the engine format', () => {
    expect(demandsEngineDate('dueAfter', STRING, 'Restrict to tasks due after the date.')).toBe(
      false,
    );
    expect(demandsEngineDate('dueAfter', STRING, undefined)).toBe(false);
    expect(demandsEngineDate('dueAfter', STRING, "yyyy-MM-dd'T'HH:mm:ss")).toBe(false);
  });

  it('keeps values that already have a format and values that are not strings', () => {
    expect(demandsEngineDate('dueAfter', { type: 'string', format: 'date' }, ENGINE_TEXT)).toBe(
      false,
    );
    expect(demandsEngineDate('dueAfter', { type: 'array' }, ENGINE_TEXT)).toBe(false);
    expect(demandsEngineDate('dueAfter', {}, ENGINE_TEXT)).toBe(false);
  });

  it('rejects expressions and lists, which are not a single date', () => {
    expect(demandsEngineDate('dueAfterExpression', STRING, ENGINE_TEXT)).toBe(false);
    expect(
      demandsEngineDate('dueDates', STRING, `Comma-separated conditions. ${ENGINE_TEXT}`),
    ).toBe(false);
  });
});

describe('markEngineDates', () => {
  const spec: OpenApiDocument = {
    info: { title: 't', version: '1' },
    paths: {
      '/task': {
        parameters: [{ name: 'createdOn', in: 'query', description: ENGINE_TEXT, schema: STRING }],
        get: {
          parameters: [
            { name: 'dueAfter', in: 'query', description: ENGINE_TEXT, schema: STRING },
            { name: 'dueAfterExpression', in: 'query', description: ENGINE_TEXT, schema: STRING },
            { name: 'name', in: 'query', description: 'The name.', schema: STRING },
            { $ref: '#/components/parameters/Due' },
            // neither parameters (no `in` or no `name`) nor schema properties
            { name: 'noIn', description: ENGINE_TEXT, schema: STRING },
            { in: 'query', description: ENGINE_TEXT, schema: STRING },
          ],
          responses: {
            '200': {
              description: 'ok',
              headers: { 'X-At': { description: ENGINE_TEXT, schema: STRING } },
            },
          },
        },
      },
    },
    components: {
      parameters: {
        Due: { name: 'dueBefore', in: 'query', description: ENGINE_TEXT, schema: STRING },
      },
      schemas: {
        Query: {
          allOf: [
            {
              type: 'object',
              properties: {
                followUpBefore: { type: 'string', description: WRAPPED_TEXT },
                name: { type: 'string', description: 'The name.' },
                nested: {
                  type: 'object',
                  properties: { at: { type: 'string', description: ENGINE_TEXT } },
                },
              },
            },
          ],
        },
      },
    },
  };

  it('adds format date-time to parameters and properties, nothing else', () => {
    const marked = markEngineDates(spec);
    expect(addedFormats(spec, marked).map((pointer) => label(spec, pointer))).toEqual([
      '/paths//task/parameters/0/schema',
      'GET /task dueAfter',
      '/components/parameters/Due/schema',
      'Query.followUpBefore',
      'Query.nested/properties/at',
    ]);
  });

  it('copies the spec instead of changing it', () => {
    const before = JSON.stringify(spec);
    markEngineDates(spec);
    expect(JSON.stringify(spec)).toBe(before);
  });

  it('marks exactly these single dates of the vendored spec', () => {
    const vendored = readPatchedSpec();
    const labels = addedFormats(vendored, markEngineDates(vendored)).map((pointer) =>
      label(vendored, pointer),
    );
    const taskFilters = [
      'dueDate',
      'dueAfter',
      'dueBefore',
      'followUpDate',
      'followUpAfter',
      'followUpBefore',
      'followUpBeforeOrNotExistent',
      'createdOn',
      'createdAfter',
      'createdBefore',
      'updatedAfter',
    ];
    expect(labels).toEqual([
      ...taskFilters.map((name) => `GET /task ${name}`),
      ...taskFilters.map((name) => `GET /task/count ${name}`),
      'JobDefinitionSuspensionStateDto.executionDate',
      'TaskQueryDto.followUpBefore',
    ]);
  });
});
