/**
 * Helpers for the OpenAPI 3.0 schema subset used by the spec: $ref, allOf, properties,
 * additionalProperties, items, type, format, enum, nullable, required.
 */

import type { Schema } from './types.js';

export type Schemas = Readonly<Record<string, Schema>>;

const MAX_REF_DEPTH = 32;

export function refName(schema: Schema): string | undefined {
  const ref = schema.$ref;
  return typeof ref === 'string' ? ref.split('/').at(-1) : undefined;
}

/** The named schema; unknown names (also inherited members such as `constructor`) give `{}`. */
function named(schemas: Schemas, name: string): Schema {
  return (Object.hasOwn(schemas, name) ? schemas[name] : undefined) ?? {};
}

/** Follows `$ref` until a concrete schema is reached. Unknown references resolve to `{}`. */
export function deref(schema: Schema, schemas: Schemas): Schema {
  let current = schema;
  for (let depth = 0; depth < MAX_REF_DEPTH; depth++) {
    const name = refName(current);
    if (name === undefined) return current;
    current = named(schemas, name);
  }
  return current;
}

function asSchema(value: unknown): Schema | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Schema)
    : undefined;
}

function allOfParts(schema: Schema): Schema[] {
  const parts: unknown[] = Array.isArray(schema.allOf) ? schema.allOf : [];
  return parts.map(asSchema).filter((part) => part !== undefined);
}

/**
 * Resolves `schema` and calls `visit` for it and every schema reachable through `allOf`, parts
 * first. Each schema is visited once, so cyclic `allOf` references terminate.
 */
function walkAllOf(
  schema: Schema,
  schemas: Schemas,
  visit: (resolved: Schema) => void,
  seen = new Set<Schema>(),
): void {
  const resolved = deref(schema, schemas);
  if (seen.has(resolved)) return;
  seen.add(resolved);
  for (const part of allOfParts(resolved)) walkAllOf(part, schemas, visit, seen);
  visit(resolved);
}

/** Properties of an object schema, merged across `allOf` (own properties win). */
export function objectProperties(schema: Schema, schemas: Schemas): Record<string, Schema> {
  const merged: Record<string, Schema> = {};
  walkAllOf(schema, schemas, (resolved) => {
    for (const [name, property] of Object.entries(asSchema(resolved.properties) ?? {})) {
      const propertySchema = asSchema(property);
      if (propertySchema !== undefined) merged[name] = propertySchema;
    }
  });
  return merged;
}

/** Required property names, merged across `allOf`, without duplicates. */
export function requiredProperties(schema: Schema, schemas: Schemas): string[] {
  const required = new Set<string>();
  walkAllOf(schema, schemas, (resolved) => {
    if (Array.isArray(resolved.required)) {
      for (const name of resolved.required) required.add(String(name));
    }
  });
  return [...required];
}

export function schemaType(schema: Schema, schemas: Schemas): string | undefined {
  const resolved = deref(schema, schemas);
  if (typeof resolved.type === 'string') return resolved.type;
  if (Array.isArray(resolved.allOf) || resolved.properties !== undefined) return 'object';
  return undefined;
}

export function itemsOf(schema: Schema, schemas: Schemas): Schema | undefined {
  return asSchema(deref(schema, schemas).items);
}

export function additionalPropertiesOf(
  schema: Schema,
  schemas: Schemas,
): Schema | boolean | undefined {
  const value = deref(schema, schemas).additionalProperties;
  return typeof value === 'boolean' ? value : asSchema(value);
}

/**
 * Expands a schema for display: references are inlined up to `depth` levels, deeper references are
 * kept as `{ $ref }` so cyclic schemas stay finite.
 */
export function expandSchema(schema: unknown, schemas: Schemas, depth: number): unknown {
  if (Array.isArray(schema)) return schema.map((item) => expandSchema(item, schemas, depth));
  const value = asSchema(schema);
  if (value === undefined) return schema;
  const name = refName(value);
  if (name !== undefined) {
    if (depth <= 0) return { $ref: name };
    return { title: name, ...(expandSchema(named(schemas, name), schemas, depth - 1) as Schema) };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, expandSchema(child, schemas, depth)]),
  );
}
