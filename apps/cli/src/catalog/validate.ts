/**
 * Validates a request body against the OpenAPI schema subset of the spec: $ref, allOf, type,
 * nullable, required, enum, items, properties and additionalProperties. Formats are left to the
 * engine; schemas without type information accept anything. Pure.
 *
 * Recursion follows the value, so cyclic schemas (trees, `orQueries`) always terminate.
 */

import {
  additionalPropertiesOf,
  deref,
  itemsOf,
  objectProperties,
  requiredProperties,
  type Schemas,
  schemaType,
} from './schema.js';
import type { Schema } from './types.js';
import { closeNames } from '../util.js';

export interface Problem {
  /** Location in the body, e.g. `variables.amount.type`, `startInstructions[0]` or `$` (root). */
  readonly path: string;
  readonly message: string;
}

type JsonObject = Readonly<Record<string, unknown>>;

const IDENTIFIER = /^[A-Za-z_$][\w$-]*$/;

export function validateBody(schema: Schema, value: unknown, schemas: Schemas): Problem[] {
  const problems: Problem[] = [];
  check(schema, value, '$', { schemas, problems });
  return problems;
}

interface Context {
  readonly schemas: Schemas;
  readonly problems: Problem[];
}

function check(schema: Schema, value: unknown, path: string, context: Context): void {
  const type = schemaType(schema, context.schemas);
  if (value === null) {
    if (type !== undefined && !isNullable(schema, context.schemas)) {
      report(context, path, `expected ${type}, got null`);
    }
    return;
  }
  if (!matchesType(type, value)) {
    report(context, path, `expected ${String(type)}, got ${describe(value)}`);
    return;
  }
  checkEnum(schema, value, path, context);
  if (type === 'object') checkObject(schema, value as JsonObject, path, context);
  if (type === 'array') checkArray(schema, value as readonly unknown[], path, context);
}

function report(context: Context, path: string, message: string): void {
  context.problems.push({ path, message });
}

function isNullable(schema: Schema, schemas: Schemas): boolean {
  return schema.nullable === true || deref(schema, schemas).nullable === true;
}

/** Schemas without (or with an unknown) type accept every value. */
function matchesType(type: string | undefined, value: unknown): boolean {
  switch (type) {
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'integer':
      return Number.isInteger(value) || typeof value === 'bigint';
    case 'number':
      return Number.isFinite(value) || typeof value === 'bigint';
    case 'string':
    case 'boolean':
      return typeof value === type;
    default:
      return true;
  }
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value !== 'string') return typeof value;
  return JSON.stringify(value.length > 40 ? `${value.slice(0, 37)}...` : value);
}

function checkEnum(schema: Schema, value: unknown, path: string, context: Context): void {
  const allowed = deref(schema, context.schemas).enum;
  if (!Array.isArray(allowed) || allowed.includes(value)) return;
  const choices = allowed.map((choice) => JSON.stringify(choice)).join(', ');
  report(context, path, `must be one of ${choices}, got ${describe(value)}`);
}

function checkArray(
  schema: Schema,
  value: readonly unknown[],
  path: string,
  context: Context,
): void {
  const items = itemsOf(schema, context.schemas);
  if (items === undefined) return;
  value.forEach((item, index) => {
    check(items, item, `${path}[${index}]`, context);
  });
}

function checkObject(schema: Schema, value: JsonObject, path: string, context: Context): void {
  for (const name of requiredProperties(schema, context.schemas)) {
    if (!Object.hasOwn(value, name) || value[name] === undefined) {
      report(context, path, `missing required property "${name}"`);
    }
  }
  const properties = objectProperties(schema, context.schemas);
  const additional = additionalPropertiesOf(schema, context.schemas);
  for (const [key, child] of Object.entries(value)) {
    // undefined values are dropped by JSON.stringify and never reach the engine
    if (child !== undefined) checkProperty({ properties, additional }, [key, child], path, context);
  }
}

interface ObjectShape {
  readonly properties: Readonly<Record<string, Schema>>;
  readonly additional: Schema | boolean | undefined;
}

function checkProperty(
  shape: ObjectShape,
  [key, child]: readonly [string, unknown],
  path: string,
  context: Context,
): void {
  const { properties, additional } = shape;
  const property = Object.hasOwn(properties, key) ? properties[key] : undefined;
  const childSchema = property ?? (typeof additional === 'object' ? additional : undefined);
  if (childSchema !== undefined) {
    check(childSchema, child, joinPath(path, key), context);
    return;
  }
  const known = Object.keys(properties);
  if (additional === false || (additional === undefined && known.length > 0)) {
    report(context, path, unknownProperty(key, known));
  }
}

function joinPath(path: string, key: string): string {
  if (!IDENTIFIER.test(key)) return `${path}[${JSON.stringify(key)}]`;
  return path === '$' ? key : `${path}.${key}`;
}

function unknownProperty(key: string, known: readonly string[]): string {
  const suggestion = suggest(key, known);
  const hint = suggestion === undefined ? '' : `, did you mean "${suggestion}"?`;
  return `unknown property "${key}"${hint}`;
}

/** The closest known name (`closeNames`: case-insensitive, at most 2 edits, similar enough). */
function suggest(key: string, known: readonly string[]): string | undefined {
  return closeNames(key, known)[0];
}
