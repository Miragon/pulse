/**
 * Builds the JSON request body from the command line. Merge order: `--body` is the base object,
 * then preset properties, then field flags, then variable map flags (per key), then `--value`.
 */

import type { BodyFieldSpec, JsonBodySpec, OperationSpec } from '../catalog/types.js';
import { usageError } from '../errors.js';
import { isRecord, parseJson, stringifyJson } from '../util.js';
import {
  type CommandValues,
  type InputDeps,
  lastString,
  listValues,
  occurrences,
  scalarFlag,
} from './command-values.js';
import { readInputFile } from './files.js';
import { parseVariables, typeValue, VALUE_LABEL } from './variables.js';
import { convertScalar } from './values.js';

type Flags = CommandValues['flags'];
type JsonObject = Record<string, unknown>;

const BODY_HINT = `Pass a JSON value, @file.json or - for stdin, e.g. --body '{"businessKey":"order-1"}'.`;

const decoder = new TextDecoder();

async function bodyText(raw: string, deps: InputDeps): Promise<string> {
  if (raw === '-') return decoder.decode(await deps.readStdin());
  if (raw.startsWith('@')) return decoder.decode(await readInputFile(deps.fs, raw.slice(1)));
  return raw;
}

function sourceOf(raw: string): string {
  if (raw === '-') return ' (from stdin)';
  return raw.startsWith('@') ? ` (from ${raw.slice(1)})` : '';
}

/**
 * Parses a `--body <json|@file|->` value: inline JSON, a JSON file or stdin. Integers beyond 2^53
 * (Long variables) are kept exactly.
 */
export async function readBody(raw: string, deps: InputDeps): Promise<unknown> {
  const text = await bodyText(raw, deps);
  try {
    return parseJson(text);
  } catch (error) {
    const reason = (error as Error).message;
    throw usageError(`Invalid JSON in --body${sourceOf(raw)}: ${reason}`, BODY_HINT);
  }
}

function fieldValue(field: BodyFieldSpec, value: NonNullable<Flags[string]>): unknown {
  const label = `--${field.flag}`;
  if (field.type !== 'array') return scalarFlag(field, value, label);
  const items = { type: field.items ?? 'string' };
  return listValues(value).map((item) => convertScalar(items, item, label));
}

function withPreset(body: JsonObject, preset: OperationSpec['preset']): JsonObject {
  if (preset === undefined) return body;
  for (const [name, value] of Object.entries(preset)) {
    if (Object.hasOwn(body, name) && stringifyJson(body[name]) !== stringifyJson(value)) {
      throw usageError(
        `This command always sends "${name}": ${String(stringifyJson(value))}; --body must not change it`,
        'Remove the property from --body.',
      );
    }
  }
  return { ...body, ...preset };
}

function withFields(body: JsonObject, spec: JsonBodySpec, flags: Flags): JsonObject {
  const result = { ...body };
  for (const field of spec.fields) {
    const value = flags[field.flag];
    if (value !== undefined) result[field.name] = fieldValue(field, value);
  }
  return result;
}

function withVariableMaps(body: JsonObject, spec: JsonBodySpec, flags: Flags): JsonObject {
  const result = { ...body };
  for (const map of spec.variableMaps) {
    const value = flags[map.flag];
    if (value === undefined) continue;
    const existing = result[map.name];
    const parsed = parseVariables(occurrences(value), map.flag);
    result[map.name] = { ...(isRecord(existing) ? existing : {}), ...parsed };
  }
  return result;
}

/** `--value` of variableValue bodies; the type comes from `--type` (or the body) if present. */
function withValue(body: JsonObject, spec: JsonBodySpec, flags: Flags): JsonObject {
  const value = flags.value;
  if (!spec.variableValue || value === undefined) return body;
  const explicitType = typeof body.type === 'string' ? body.type : undefined;
  const typed = typeValue(lastString(value), explicitType, VALUE_LABEL);
  return { ...body, value: typed.value, type: typed.type };
}

function hasOptions(operation: OperationSpec, spec: JsonBodySpec, flags: Flags): boolean {
  const flagNames = [...spec.fields, ...spec.variableMaps].map((option) => option.flag);
  return (
    operation.preset !== undefined ||
    flagNames.some((flag) => flags[flag] !== undefined) ||
    (spec.variableValue && flags.value !== undefined)
  );
}

export async function buildJsonBody(
  operation: OperationSpec,
  spec: JsonBodySpec,
  flags: Flags,
  deps: InputDeps,
): Promise<unknown> {
  const base = flags.body === undefined ? undefined : await readBody(lastString(flags.body), deps);
  if (base !== undefined && !isRecord(base)) {
    if (!hasOptions(operation, spec, flags)) return base;
    throw usageError(
      '--body must be a JSON object to combine it with other options',
      'Put all properties into --body, or pass them as options only.',
    );
  }
  const merged = withFields(withPreset(base ?? {}, operation.preset), spec, flags);
  return withValue(withVariableMaps(merged, spec, flags), spec, flags);
}
