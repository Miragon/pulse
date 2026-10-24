/**
 * Variables of the instance view (design §17.2.8): values fetched with `deserializeValues=false`;
 * scalar types become their plain value, every other type keeps what writing it back needs. Pure.
 */

import { isRecord } from '../util.js';
import { type Rec, records, str } from './records.js';

const PLAIN_TYPES: ReadonlySet<string> = new Set([
  'string',
  'boolean',
  'integer',
  'short',
  'long',
  'double',
  'null',
]);

function isEmpty(value: unknown): boolean {
  return (
    value === undefined || value === null || (isRecord(value) && Object.keys(value).length === 0)
  );
}

function plainValue(typed: unknown): unknown {
  if (!isRecord(typed)) return typed;
  const type = typeof typed.type === 'string' ? typed.type : '';
  if (PLAIN_TYPES.has(type.toLowerCase())) return typed.value ?? null;
  return {
    type,
    value: typed.value ?? null,
    ...(isEmpty(typed.valueInfo) ? {} : { valueInfo: typed.valueInfo }),
  };
}

/**
 * A variable map (`{name: {type, value, valueInfo}}`) with String, Boolean, Integer, Short, Long,
 * Double and Null values flattened (Long stays exact), others as `{type, value, valueInfo?}`;
 * sorted by name.
 */
export function plainVariables(map: unknown): Record<string, unknown> {
  if (!isRecord(map)) return {};
  const names = Object.keys(map).sort((left, right) => (left < right ? -1 : 1));
  return Object.fromEntries(names.map((name) => [name, plainValue(map[name])]));
}

/**
 * The process scope rows of historic variable instances (`activityInstanceId` equal to the
 * instance id) as a variable map.
 */
export function historicVariableMap(rows: readonly Rec[], instanceId: string): Rec {
  const scope = records(rows).filter((row) => str(row, 'activityInstanceId') === instanceId);
  return Object.fromEntries(
    scope.flatMap((row) => {
      const name = str(row, 'name');
      return name === undefined
        ? []
        : [[name, { type: row.type, value: row.value, valueInfo: row.valueInfo }]];
    }),
  );
}
