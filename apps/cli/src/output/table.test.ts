import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  defaultColumns,
  fitWidths,
  formatCell,
  renderObject,
  renderRows,
  renderTable,
  truncate,
} from './table.js';

const segmenter = new Intl.Segmenter();

function graphemeCount(text: string): number {
  return Array.from(segmenter.segment(text)).length;
}

describe('formatCell', () => {
  it('renders null and undefined as empty cells', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
  });

  it('renders numbers and booleans as text', () => {
    expect(formatCell(0)).toBe('0');
    expect(formatCell(-1.5)).toBe('-1.5');
    expect(formatCell(true)).toBe('true');
    expect(formatCell(false)).toBe('false');
  });

  it('renders objects and arrays as compact JSON', () => {
    expect(formatCell({ a: 1, b: [true] })).toBe('{"a":1,"b":[true]}');
    expect(formatCell([])).toBe('[]');
  });

  it('keeps plain strings and runs of spaces unchanged', () => {
    expect(formatCell('')).toBe('');
    expect(formatCell('a  b ')).toBe('a  b ');
  });

  it('collapses line breaks, tabs and their surrounding blanks into one space', () => {
    expect(formatCell('a\nb')).toBe('a b');
    expect(formatCell('a  \r\n\n  b')).toBe('a b');
    expect(formatCell('a\rb')).toBe('a b');
    expect(formatCell('a\tb')).toBe('a b');
    expect(formatCell('a b')).toBe('a b');
    expect(formatCell('a b')).toBe('a b');
    expect(formatCell('\nab\n')).toBe(' ab ');
  });

  it('replaces control characters such as ANSI escapes', () => {
    expect(formatCell('\u001b[31mred')).toBe(' [31mred');
    expect(formatCell('a\u0007b\u007fc')).toBe('a b c');
    expect(formatCell('a\u009bb')).toBe('a b');
  });

  it('cleans what JSON.stringify leaves raw in nested values', () => {
    expect(formatCell({ a: 'x\u009b31my' })).toBe('{"a":"x 31my"}');
    expect(formatCell(['a\u2028b', 'c\u2029d', 'e\u00a0f'])).toBe('["a b","c d","e f"]');
    expect(formatCell({ a: 'x\ny' })).toBe('{"a":"x\\ny"}');
  });
});

describe('defaultColumns', () => {
  it('returns scalar columns in first-seen order across rows', () => {
    expect(
      defaultColumns([
        { id: 1, name: 'a' },
        { name: 'b', state: 'ACTIVE', id: 2 },
      ]),
    ).toEqual(['id', 'name', 'state']);
  });

  it('skips hidden, nested and always-empty columns', () => {
    expect(
      defaultColumns([
        { id: '1', links: 'x', nested: { a: 1 }, list: [1], empty: '', nil: null },
        { id: '2', empty: null, nil: '' },
      ]),
    ).toEqual(['id']);
  });

  it('keeps a column that is nested in one row but a non-empty scalar in another', () => {
    expect(defaultColumns([{ v: { a: 1 } }, { v: 'x' }])).toEqual(['v']);
    expect(defaultColumns([{ v: 'x' }, { v: { a: 1 } }])).toEqual(['v']);
    expect(defaultColumns([{ v: 0 }])).toEqual(['v']);
    expect(defaultColumns([{ v: false }])).toEqual(['v']);
  });

  it('drops a column whose only non-empty value is nested', () => {
    expect(defaultColumns([{ v: '' }, { v: { a: 1 } }])).toEqual([]);
  });

  it('orders columns by the first appearance of the key, whatever its value', () => {
    expect(defaultColumns([{ a: { x: 1 }, b: 1 }, { a: 'x' }])).toEqual(['a', 'b']);
    expect(defaultColumns([{ a: null, b: 1 }, { a: 'x' }])).toEqual(['a', 'b']);
    expect(defaultColumns([{ b: 1 }, { a: 'x', b: 2 }])).toEqual(['b', 'a']);
  });

  it('reads own properties only', () => {
    expect(defaultColumns([{}, { toString: 'x' }])).toEqual(['toString']);
    expect(defaultColumns([{ toString: '' }, {}])).toEqual([]);
  });

  it('returns no columns for no rows', () => {
    expect(defaultColumns([])).toEqual([]);
  });
});

describe('defaultColumns: preferred order', () => {
  it('puts every identifying column in its documented place', () => {
    const preferred = [
      'id',
      'key',
      'name',
      'version',
      'type',
      'value',
      'businessKey',
      'processDefinitionKey',
      'activityId',
      'incidentType',
      'incidentMessage',
      'exceptionMessage',
      'errorMessage',
      'topicName',
      'assignee',
      'state',
      'suspended',
      'ended',
      'retries',
      'created',
      'startTime',
      'endTime',
      'processInstanceId',
    ];
    const row = Object.fromEntries(['other', ...preferred.toReversed()].map((key) => [key, 'x']));
    expect(defaultColumns([row])).toEqual([...preferred, 'other']);
  });
});

describe('truncate', () => {
  it('keeps text that fits', () => {
    expect(truncate('abc', 3)).toBe('abc');
    expect(truncate('abc', 10)).toBe('abc');
    expect(truncate('', 0)).toBe('');
  });

  it('cuts longer text and ends it with an ellipsis', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abcdef', 2)).toBe('a…');
    expect(truncate('abcdef', 1)).toBe('…');
    expect(truncate('abcdef', 0)).toBe('');
  });

  it('counts graphemes, not code units', () => {
    expect(truncate('👍🏽👍🏽👍🏽', 3)).toBe('👍🏽👍🏽👍🏽');
    expect(truncate('👍🏽👍🏽👍🏽', 2)).toBe('👍🏽…');
    expect(truncate('ééé', 2)).toBe('é…');
  });
});

describe('fitWidths', () => {
  it('returns a copy when everything fits', () => {
    const natural = [10, 10];
    const widths = fitWidths(natural, 22);
    expect(widths).toEqual([10, 10]);
    expect(widths).not.toBe(natural);
  });

  it('shrinks the widest column by exactly the overflow', () => {
    expect(fitWidths([10, 10], 21)).toEqual([9, 10]);
    expect(fitWidths([30, 10, 10], 40)).toEqual([16, 10, 10]);
  });

  it('drops trailing columns down to three before truncating implicit columns', () => {
    expect(fitWidths([10, 10, 10, 10, 10], 40)).toEqual([10, 10, 10]);
    expect(fitWidths([10, 10, 10, 10], 40)).toEqual([10, 10, 10]);
    expect(fitWidths([10, 10, 10], 30)).toEqual([6, 10, 10]);
  });

  it('truncates explicit columns before dropping any', () => {
    expect(fitWidths([10, 10, 10, 10, 10], 40, true)).toEqual([6, 6, 6, 6, 8]);
  });

  it('never truncates below six characters and drops columns instead', () => {
    expect(fitWidths([8, 8, 8], 20)).toEqual([6, 6]);
    expect(fitWidths([6, 6, 6, 6], 20, true)).toEqual([6, 6]);
  });

  it('keeps a single column at six characters even when that does not fit', () => {
    expect(fitWidths([10], 3)).toEqual([6]);
    expect(fitWidths([4], 3)).toEqual([4]);
  });

  it('never truncates fixed columns: the others shrink, then trailing ones are dropped', () => {
    expect(fitWidths([30, 6, 20], 50, true, [true])).toEqual([30, 6, 10]);
    expect(fitWidths([30, 6, 20], 40, true, [true, false, false])).toEqual([30, 6]);
    expect(fitWidths([30, 6, 20], 20, true, [true])).toEqual([30]);
    // without fixed columns the widest one is truncated
    expect(fitWidths([30, 6, 20], 50, true)).toEqual([20, 6, 20]);
    expect(fitWidths([30, 6, 20], 50, true, [false, false, true])).toEqual([20, 6, 20]);
  });
});

describe('renderRows', () => {
  it('renders aligned columns with a header and trims trailing blanks', () => {
    const rows = [
      { id: 'a1', name: 'Order', version: 1 },
      { id: 'b22', name: 'Invoice process', version: 12 },
    ];
    expect(renderRows(rows, { maxWidth: 80 })).toBe(
      ['id   name             version', 'a1   Order            1', 'b22  Invoice process  12'].join(
        '\n',
      ),
    );
  });

  it('aligns by graphemes', () => {
    const rows = [
      { a: '👍', b: 'x' },
      { a: 'ab', b: 'y' },
    ];
    expect(renderRows(rows, { maxWidth: 80 })).toBe(['a   b', '👍   x', 'ab  y'].join('\n'));
  });

  it('keeps fixed columns whole and truncates the others', () => {
    const rows = [{ name: 'a-very-long-command-name', text: 'a summary that is long' }];
    expect(renderRows(rows, { columns: ['name', 'text'], fixed: ['name'], maxWidth: 34 })).toBe(
      ['name                      text', 'a-very-long-command-name  a summa…'].join('\n'),
    );
  });

  it('uses explicit columns as dot paths', () => {
    const rows = [{ id: 1, a: { b: 'deep' }, 'a.b': 'flat' }];
    expect(renderRows(rows, { columns: ['a.b', 'missing', 'id'], maxWidth: 80 })).toBe(
      ['a.b   missing  id', 'deep           1'].join('\n'),
    );
  });

  it('shows implicit columns whose keys contain dots', () => {
    expect(renderRows([{ 'order.id': 'o-1' }], { maxWidth: 80 })).toBe('order.id\no-1');
  });

  it('reads implicit columns from own properties only', () => {
    expect(renderRows([{ toString: 'x', other: 1 }, { other: 2 }], { maxWidth: 80 })).toBe(
      ['toString  other', 'x         1', '          2'].join('\n'),
    );
  });

  it('puts the identifying columns first, the others in first-seen order', () => {
    const rows = [
      {
        links: [],
        category: 'http://bpmn.io/schema/bpmn',
        description: null,
        deploymentId: 'd-1',
        version: 1,
        name: 'Invoice',
        key: 'invoice',
        id: 'invoice:1:abc',
        suspended: false,
      },
    ];
    expect(defaultColumns(rows)).toEqual([
      'id',
      'key',
      'name',
      'version',
      'suspended',
      'category',
      'deploymentId',
    ]);
  });

  it('keeps incidentType and incidentMessage of incidents within 120 columns', () => {
    const incident = {
      id: '4ab3d1f6-6b4c-11ef-8f6d-0242ac110002',
      processDefinitionId: 'order-process:1:3c2f88a1-6b4c-11ef-8f6d-0242ac110002',
      processInstanceId: '4a9e2c7b-6b4c-11ef-8f6d-0242ac110002',
      executionId: '4a9e2c7b-6b4c-11ef-8f6d-0242ac110003',
      incidentTimestamp: '2024-09-05T10:00:00.000+0000',
      incidentType: 'failedExternalTask',
      activityId: 'charge-card',
      failedActivityId: 'charge-card',
      causeIncidentId: '4ab3d1f6-6b4c-11ef-8f6d-0242ac110002',
      rootCauseIncidentId: '4ab3d1f6-6b4c-11ef-8f6d-0242ac110002',
      configuration: '4ab0c4b2-6b4c-11ef-8f6d-0242ac110002',
      tenantId: null,
      incidentMessage: 'card declined',
      jobDefinitionId: null,
      annotation: null,
    };
    const [header = ''] = renderRows([incident], { maxWidth: 120 }).split('\n');
    expect(header.split(/ +/)).toEqual(['id', 'activityId', 'incidentType', 'incidentMessage']);
  });

  it('formats large integers exactly', () => {
    expect(renderRows([{ id: 1, value: 9223372036854775807n }], { maxWidth: 80 })).toBe(
      ['id  value', '1   9223372036854775807'].join('\n'),
    );
  });

  it('drops trailing implicit columns but truncates explicit ones', () => {
    const rows = [{ a: 'a'.repeat(10), b: 'b'.repeat(10), c: 'c'.repeat(10), d: 'd'.repeat(10) }];
    expect(renderRows(rows, { maxWidth: 40 }).split('\n')).toEqual([
      `a${' '.repeat(11)}b${' '.repeat(11)}c`,
      `${'a'.repeat(10)}  ${'b'.repeat(10)}  ${'c'.repeat(10)}`,
    ]);
    expect(renderRows(rows, { columns: ['a', 'b', 'c', 'd'], maxWidth: 40 }).split('\n')).toEqual([
      `a${' '.repeat(7)}b${' '.repeat(9)}c${' '.repeat(11)}d`,
      `aaaaa…  bbbbbbb…  ${'c'.repeat(10)}  ${'d'.repeat(10)}`,
    ]);
  });

  it('truncates cells and titles to the fitted widths', () => {
    const rows = [{ id: 'x'.repeat(30), description: 'y'.repeat(30) }];
    expect(renderRows(rows, { maxWidth: 30 })).toBe(
      ['id      description', `xxxxx…  ${'y'.repeat(21)}…`].join('\n'),
    );
    expect(renderRows(rows, { columns: ['description'], maxWidth: 20 })).toBe(
      ['description', `${'y'.repeat(19)}…`].join('\n'),
    );
    expect(renderRows([{ description: 'y' }], { columns: ['description'], maxWidth: 20 })).toBe(
      'description\ny',
    );
    expect(renderRows([{ a: 1, b: 2 }], { columns: ['a', 'x'.repeat(30)], maxWidth: 20 })).toBe(
      [`a  ${'x'.repeat(16)}…`, '1'].join('\n'),
    );
  });

  it('renders rows that are not all objects as one truncated line each', () => {
    expect(renderRows(['a', 1, null, { b: true }], { maxWidth: 80 })).toBe('a\n1\n\n{"b":true}');
    expect(renderRows(['x'.repeat(30), 'line\nbreak'], { maxWidth: 20 })).toBe(
      `${'x'.repeat(19)}…\nline break`,
    );
  });

  it('renders objects without scalar columns as truncated JSON lines', () => {
    expect(renderRows([{ a: { b: 1 } }, { c: [] }], { maxWidth: 80 })).toBe(
      '{"a":{"b":1}}\n{"c":[]}',
    );
    expect(renderRows([{ a: { b: 'x'.repeat(30) } }], { maxWidth: 20 })).toBe(
      `{"a":{"b":"${'x'.repeat(8)}…`,
    );
    expect(renderRows([{ a: 1 }], { columns: [], maxWidth: 80 })).toBe('{"a":1}');
    expect(renderRows([{ a: ['\u009b'] }], { maxWidth: 80 })).toBe('{"a":[" "]}');
  });

  it('sanitizes column titles', () => {
    expect(renderRows([{ 'a\nb': 'v' }], { maxWidth: 80 })).toBe('a b\nv');
  });
});

describe('renderObject', () => {
  it('renders fields as FIELD/VALUE rows and hides links', () => {
    expect(
      renderObject({ id: 'x', links: [], nested: { a: 1 }, nil: null }, { maxWidth: 80 }),
    ).toBe(['FIELD   VALUE', 'id      x', 'nested  {"a":1}', 'nil'].join('\n'));
  });

  it('uses explicit columns as dot paths', () => {
    expect(
      renderObject(
        { a: { b: 1 }, c: 2, 'a.b': 'flat' },
        { columns: ['a.b', 'c', 'x'], maxWidth: 80 },
      ),
    ).toBe(['FIELD  VALUE', 'a.b    1', 'c      2', 'x'].join('\n'));
  });

  it('shows keys with dots and sanitizes keys', () => {
    expect(renderObject({ 'order.id': 5, 'a\nb': 1 }, { maxWidth: 80 })).toBe(
      ['FIELD     VALUE', 'order.id  5', 'a b       1'].join('\n'),
    );
  });

  it('truncates long values to the width', () => {
    expect(renderObject({ id: 'x'.repeat(40) }, { maxWidth: 20 })).toBe(
      ['FIELD  VALUE', `id     ${'x'.repeat(12)}…`].join('\n'),
    );
  });
});

describe('renderTable', () => {
  it('renders empty arrays as "No results."', () => {
    expect(renderTable([], { maxWidth: 80 })).toBe('No results.');
  });

  it('renders arrays as rows and objects as fields', () => {
    expect(renderTable([{ id: 1 }], { maxWidth: 80 })).toBe('id\n1');
    expect(renderTable({ id: 1 }, { maxWidth: 80 })).toBe('FIELD  VALUE\nid     1');
  });

  it('renders scalars as a single cell', () => {
    expect(renderTable('text', { maxWidth: 80 })).toBe('text');
    expect(renderTable(42, { maxWidth: 80 })).toBe('42');
    expect(renderTable(null, { maxWidth: 80 })).toBe('');
  });

  const text = fc.oneof(fc.string({ unit: 'grapheme' }), fc.string({ unit: 'binary' }));
  const cell = fc.oneof(
    text,
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.jsonValue({ maxDepth: 2 }),
  );
  const row = fc.dictionary(text, cell, { maxKeys: 8 });
  const columns = fc.option(fc.array(text, { minLength: 1, maxLength: 8 }), { nil: undefined });
  const maxWidth = fc.integer({ min: 20, max: 160 });

  function linesFit(value: unknown, options: { columns?: string[]; maxWidth: number }): void {
    for (const line of renderTable(value, options).split('\n')) {
      expect(graphemeCount(line)).toBeLessThanOrEqual(options.maxWidth);
    }
  }

  it('never renders a line wider than maxWidth for rows (property)', () => {
    fc.assert(
      fc.property(fc.array(row, { maxLength: 6 }), columns, maxWidth, (rows, cols, width) => {
        linesFit(
          rows,
          cols === undefined ? { maxWidth: width } : { columns: cols, maxWidth: width },
        );
      }),
      { numRuns: 300 },
    );
  });

  it('never renders a line wider than maxWidth for objects and mixed arrays (property)', () => {
    const value = fc.oneof(row, fc.array(fc.oneof(cell, row), { maxLength: 6 }));
    fc.assert(
      fc.property(value, columns, maxWidth, (input, cols, width) => {
        linesFit(
          input,
          cols === undefined ? { maxWidth: width } : { columns: cols, maxWidth: width },
        );
      }),
      { numRuns: 300 },
    );
  });
});
