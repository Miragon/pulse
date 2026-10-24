/**
 * Plain text views of expanded schemas (see `expandSchema`): one line type labels such as
 * `array<TaskDto>` and compact indented property lists for `operate describe`. Pure.
 */

import { objectProperties, refName, requiredProperties } from '../catalog/schema.js';
import type { Schema } from '../catalog/types.js';
import { isRecord } from '../util.js';
import { summarize } from './options.js';
import { wrap } from './text.js';

/** Expanded schemas contain no resolvable references any more; unexpanded ones stay names. */
const NO_SCHEMAS = {};

const INDENT = '  ';

function asSchema(value: unknown): Schema | undefined {
  return isRecord(value) ? value : undefined;
}

/** The value schema of a map (`additionalProperties: {...}` without own properties). */
function mapValues(schema: Schema): Schema | undefined {
  return schema.properties === undefined ? asSchema(schema.additionalProperties) : undefined;
}

function scalarLabel(schema: Schema): string | undefined {
  if (typeof schema.type !== 'string') return undefined;
  return typeof schema.format === 'string' ? `${schema.type}(${schema.format})` : schema.type;
}

/** One line type label: `string(date-time)`, `array<TaskDto>`, `map<VariableValueDto>`, ... */
export function schemaLabel(value: unknown): string {
  const schema = asSchema(value);
  if (schema === undefined) return 'any';
  const name = refName(schema) ?? (typeof schema.title === 'string' ? schema.title : undefined);
  if (schema.type === 'array') return `array<${schemaLabel(schema.items)}>`;
  const values = mapValues(schema);
  if (values !== undefined) return `map<${schemaLabel(values)}>`;
  if (name !== undefined) return name;
  if (schema.properties !== undefined || schema.allOf !== undefined) return 'object';
  return scalarLabel(schema) ?? 'any';
}

/** The schema whose properties are listed below a property: array items and map values. */
function nested(schema: Schema): Schema {
  if (schema.type === 'array') return nested(asSchema(schema.items) ?? {});
  return mapValues(schema) ?? schema;
}

/**
 * Text up to a period followed by the next sentence (`summarize` leaves single spaces); `e.g.`,
 * `i.e.` and `etc.` do not end a sentence.
 */
const FIRST_SENTENCE = /.*?(?<!\b(?:e\.g|i\.e|etc))\.(?= [A-Z])/;

/** First sentence of a description, without the redundant `Mandatory.` marker. */
function firstSentence(description: unknown): string {
  if (typeof description !== 'string') return '';
  const text = summarize(description).replace(/^Mandatory\./, '');
  return FIRST_SENTENCE.exec(text)?.[0] ?? text;
}

function propertyText(name: string, schema: Schema, required: boolean): string {
  const values = Array.isArray(schema.enum) ? schema.enum.map(String) : [];
  const facts = [
    schemaLabel(schema),
    ...(required ? ['required'] : []),
    ...(values.length > 0 ? [`one of ${values.join('|')}`] : []),
  ];
  const description = firstSentence(schema.description);
  return `${name}: ${facts.join(', ')}${description === '' ? '' : ` - ${description}`}`;
}

/**
 * Indented property list of an object schema (properties merged across `allOf`), nested
 * properties of objects, array items and map values one level deeper.
 */
export function propertyLines(value: unknown, indent = INDENT): string[] {
  const schema = nested(asSchema(value) ?? {});
  const required = new Set(requiredProperties(schema, NO_SCHEMAS));
  return Object.entries(objectProperties(schema, NO_SCHEMAS)).flatMap(([name, property]) => [
    ...wrap(propertyText(name, property, required.has(name)), indent, `${indent}    `),
    ...propertyLines(property, `${indent}${INDENT}`),
  ]);
}

/**
 * Property names `--fields` can pick: of an object or of the items of an array. Maps have no fixed
 * names, so they have none.
 */
export function fieldNames(value: unknown): string[] {
  const schema = asSchema(value) ?? {};
  const target = schema.type === 'array' ? (asSchema(schema.items) ?? {}) : schema;
  return Object.keys(objectProperties(target, NO_SCHEMAS));
}
