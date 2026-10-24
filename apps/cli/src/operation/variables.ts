/**
 * Parses `--var` arguments into Camunda typed variable values.
 *
 *   name=value          auto typed: true/false → Boolean, integers → Integer/Long,
 *                       decimals → Double, null → Null, everything else → String
 *   name:Type=value     explicit type, e.g. zip:String=01234, order:Json={"id":1}
 *
 * The typed conversions are the ones of option values (values.ts): `Date` values are normalized
 * like date-time options, `Long` keeps all 64 bits (as BigInt beyond 2^53).
 */

import { usageError } from '../errors.js';
import { convertScalar, type ScalarSpec } from './values.js';

export interface TypedValue {
  readonly value: unknown;
  readonly type: string;
}

/** How a variable value appears in messages: `label` (`--var amount`) and an example for a type. */
export interface ValueLabel {
  readonly label: string;
  readonly example: (type: string, sample: string) => string;
}

type Converter = (raw: string, label: ValueLabel) => unknown;

/** Option value specs of the scalar variable types, with a sample value for hints. */
const SCALAR_TYPES: readonly (readonly [string, ScalarSpec, string])[] = [
  ['Integer', { type: 'integer', format: 'int32' }, '250'],
  ['Short', { type: 'integer', format: 'int16' }, '7'],
  ['Long', { type: 'integer', format: 'int64' }, '9223372036854775807'],
  ['Double', { type: 'number' }, '2.5'],
  ['Boolean', { type: 'boolean' }, 'true'],
  ['Date', { type: 'string', format: 'date-time' }, '2024-05-01T10:00:00Z'],
];

function scalarConverter(type: string, spec: ScalarSpec, sample: string): Converter {
  return (raw, { label, example }) =>
    convertScalar(spec, raw, label, `Example: ${example(type, sample)}`);
}

function toJson(raw: string, { label, example }: ValueLabel): string {
  try {
    JSON.parse(raw);
  } catch {
    throw usageError(`${label} expects JSON text`, `Example: ${example('Json', `'{"id":42}'`)}`);
  }
  return raw;
}

/** A Map, so that names like `constructor` never resolve to inherited properties. */
const CONVERTERS: ReadonlyMap<string, Converter> = new Map<string, Converter>([
  ['String', (raw) => raw],
  ...SCALAR_TYPES.map(
    ([type, spec, sample]) => [type, scalarConverter(type, spec, sample)] as const,
  ),
  ['Json', toJson],
  ['Xml', (raw) => raw],
  ['Null', () => null],
]);

export const VARIABLE_TYPES: readonly string[] = [...CONVERTERS.keys()];

const INT32 = { min: -(2 ** 31), max: 2 ** 31 - 1 };
const INT64 = { min: -(2n ** 63n), max: 2n ** 63n - 1n };
const INTEGER = /^-?(0|[1-9]\d*)$/;
const DECIMAL = /^-?(0|[1-9]\d*)\.\d+$/;

/** `--var amount`: the label of a `--<flag> name=value` argument. */
function variableLabel(flag: string, name: string): ValueLabel {
  return {
    label: `--${flag} ${name}`,
    example: (type, sample) => `--${flag} ${name}:${type}=${sample}`,
  };
}

/** The label of `--value` (with `--type`). */
export const VALUE_LABEL: ValueLabel = {
  label: '--value',
  example: (type, sample) => `--value ${sample} --type ${type}`,
};

/**
 * Parses one `name=value` / `name:Type=value` argument. `flag` names the option in error messages
 * (`var`, `local-var`, `correlation-key`, ...).
 */
export function parseVariable(argument: string, flag = 'var'): [string, TypedValue] {
  const separator = argument.indexOf('=');
  if (separator <= 0) {
    throw usageError(
      `Invalid --${flag} "${argument}": expected name=value or name:Type=value`,
      `Example: --${flag} amount=100 --${flag} approved=true --${flag} zip:String=01234`,
    );
  }
  const [name, explicitType] = splitNameAndType(argument.slice(0, separator));
  const raw = argument.slice(separator + 1);
  return [name, typeValue(raw, explicitType, variableLabel(flag, name))];
}

export function parseVariables(
  argumentsList: readonly string[],
  flag = 'var',
): Record<string, TypedValue> {
  return Object.fromEntries(argumentsList.map((argument) => parseVariable(argument, flag)));
}

/**
 * Types a single raw value: auto typed without `explicitType`, otherwise converted with the
 * converter of that type (case-insensitive). `label` names the value in error messages.
 */
export function typeValue(
  raw: string,
  explicitType?: string,
  label: ValueLabel = VALUE_LABEL,
): TypedValue {
  if (explicitType === undefined) return autoTyped(raw);
  const type = canonicalType(explicitType);
  const converter = CONVERTERS.get(type);
  if (converter === undefined) throw unknownType(explicitType);
  return { value: converter(raw, label), type };
}

function splitNameAndType(left: string): [string, string | undefined] {
  const colon = left.lastIndexOf(':');
  if (colon <= 0) return [left, undefined];
  return [left.slice(0, colon), left.slice(colon + 1)];
}

function canonicalType(type: string): string {
  return VARIABLE_TYPES.find((known) => known.toLowerCase() === type.toLowerCase()) ?? type;
}

function unknownType(type: string) {
  return usageError(
    `Unknown variable type "${type}"`,
    `Supported types: ${VARIABLE_TYPES.join(', ')}. Use --body for Object, File or Bytes variables.`,
  );
}

/** Integers: Integer (int32), else Long (exact, BigInt beyond 2^53), else beyond int64 a String. */
function autoInteger(raw: string): TypedValue | undefined {
  const value = BigInt(raw);
  if (value >= INT32.min && value <= INT32.max) return { value: Number(value), type: 'Integer' };
  if (value < INT64.min || value > INT64.max) return undefined;
  const exact = value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER;
  return { value: exact ? Number(value) : value, type: 'Long' };
}

function autoTyped(raw: string): TypedValue {
  if (raw === 'true' || raw === 'false') return { value: raw === 'true', type: 'Boolean' };
  if (raw === 'null') return { value: null, type: 'Null' };
  const integer = INTEGER.test(raw) ? autoInteger(raw) : undefined;
  if (integer !== undefined) return integer;
  if (DECIMAL.test(raw)) return { value: Number(raw), type: 'Double' };
  return { value: raw, type: 'String' };
}
