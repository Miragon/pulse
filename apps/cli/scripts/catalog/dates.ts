/**
 * Dates the spec does not mark as `format: date-time` although their description demands the
 * engine date format: the task filters `dueDate`, `createdAfter`, `updatedAfter`, ... of
 * `task list` / `task count` and two body properties. Marking them gives them the date
 * normalization of every other date-time value (design §2.4) and `string(date-time)` in `describe`.
 */

import type { OpenApiDocument } from './openapi.js';

/** The engine date format as the descriptions state it; some wrap it across lines. */
const ENGINE_DATE_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSSZ";

/** `dueDateExpression` and friends take an EL expression that evaluates to a date. */
const EXPRESSION = 'Expression';

/** Lists of dates (or of conditions on dates) are not a single date. */
const LIST = /comma-separated/i;

type Node = Readonly<Record<string, unknown>>;

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True for a single date string without format whose description demands the engine date format.
 * `schema` is the parameter schema or the property itself; `description` is next to it.
 */
export function demandsEngineDate(name: string, schema: Node, description: unknown): boolean {
  if (schema.type !== 'string' || schema.format !== undefined) return false;
  if (typeof description !== 'string' || name.endsWith(EXPRESSION) || LIST.test(description)) {
    return false;
  }
  return description.replace(/\s+/g, '').includes(ENGINE_DATE_FORMAT);
}

function dated(name: string, schema: Node, description: unknown): Node {
  return demandsEngineDate(name, schema, description) ? { ...schema, format: 'date-time' } : schema;
}

/** A parameter object: `name`, `in` and a `schema`, the description next to the schema. */
function markParameter(node: Node): Node {
  const { name, schema } = node;
  if (typeof name !== 'string' || typeof node.in !== 'string' || !isNode(schema)) return node;
  return { ...node, schema: dated(name, schema, node.description) };
}

/** A schema with `properties`: every property carries its own description. */
function markProperties(node: Node): Node {
  const { properties } = node;
  if (!isNode(properties)) return node;
  const marked = Object.entries(properties).map(([name, property]) => [
    name,
    isNode(property) ? dated(name, property, property.description) : property,
  ]);
  return { ...node, properties: Object.fromEntries(marked) };
}

function mark(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mark);
  if (!isNode(value)) return value;
  const children = Object.entries(value).map(([key, child]) => [key, mark(child)]);
  return markProperties(markParameter(Object.fromEntries(children) as Node));
}

/** A copy of the spec with `format: date-time` on every value that demands the engine format. */
export function markEngineDates(spec: OpenApiDocument): OpenApiDocument {
  return mark(spec) as OpenApiDocument;
}
