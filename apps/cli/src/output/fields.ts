/**
 * `--fields` projection on JSON values. Paths are dot separated (`a.b.c`). The projection never
 * mutates its input and never writes through inherited properties such as `__proto__`.
 */

import { isRecord } from '../util.js';

type JsonObject = Record<string, unknown>;

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function isAllowed(field: string): boolean {
  return field !== '' && !field.split('.').some((segment) => FORBIDDEN_SEGMENTS.has(segment));
}

/** Parses `a, b.c,a` into unique, trimmed paths; undefined when nothing usable remains. */
export function parseFieldList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const fields = raw
    .split(',')
    .map((field) => field.trim())
    .filter(isAllowed);
  return fields.length === 0 ? undefined : [...new Set(fields)];
}

/** Reads a dot separated path through own properties of nested objects (not arrays). */
export function getPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

/** Creates an own, enumerable property, even for keys like `__proto__`. */
function define(target: JsonObject, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** `a.b` is covered by `a`: picking `a` already includes it. */
function isCovered(field: string, fields: readonly string[]): boolean {
  return fields.some((other) => field.startsWith(`${other}.`));
}

/** The fields by their first segment, in field order: `a.b, c, a.d` → a: [b, d], c: [``]. */
function byHead(fields: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const field of fields.filter((candidate) => !isCovered(candidate, fields))) {
    const [head = '', ...rest] = field.split('.');
    groups.set(head, [...(groups.get(head) ?? []), rest.join('.')]);
  }
  return groups;
}

/** The fields of a nested value: an object, or every object of a list (other items kept). */
function pickNested(value: unknown, fields: readonly string[]): unknown {
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => (isRecord(item) ? pickObject(item, fields) : item));
  }
  return isRecord(value) ? pickObject(value, fields) : undefined;
}

function pickObject(value: JsonObject, fields: readonly string[]): JsonObject {
  const result: JsonObject = {};
  for (const [head, rests] of byHead(fields)) {
    if (!Object.hasOwn(value, head)) continue;
    const child = value[head];
    // `a` keeps all of a; `a.b` picks b of the object a, or of every object of the list a
    const picked = rests.includes('') ? child : pickNested(child, rests);
    const nothing = isRecord(picked) && Object.keys(picked).length === 0;
    if (picked !== undefined && !nothing) define(result, head, picked);
  }
  return result;
}

/**
 * True when the path exists in the value; a list on the way matches when any element has it, an
 * empty list always (it cannot tell).
 */
function hasPath(value: unknown, segments: readonly string[]): boolean {
  if (Array.isArray(value)) {
    const items = value as unknown[];
    return items.length === 0 || items.some((item) => hasPath(item, segments));
  }
  const [head, ...rest] = segments;
  if (head === undefined) return value !== undefined;
  if (!isRecord(value) || !Object.hasOwn(value, head)) return false;
  return rest.length === 0 || hasPath(value[head], rest);
}

/** The objects a projection looks into: the value itself or the objects of an array. */
function objectsOf(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return (value as unknown[]).filter(isRecord);
  return isRecord(value) ? [value] : [];
}

/**
 * Fields that match nothing in the whole value (in no element of a list, also of nested lists),
 * and the top-level keys that exist, for a warning. Nothing is reported for values without
 * objects (empty lists).
 */
export function missingFields(
  value: unknown,
  fields: readonly string[],
): { readonly missing: string[]; readonly available: string[] } {
  const objects = objectsOf(value);
  if (objects.length === 0) return { missing: [], available: [] };
  const missing = fields.filter((field) => !hasPath(objects, field.split('.')));
  return { missing, available: [...new Set(objects.flatMap((object) => Object.keys(object)))] };
}

/**
 * Keeps only the given fields of an object or of every object in an array. A path through a
 * nested list picks the rest of the path from each of its objects (`waitingAt.activityId`).
 */
export function project(value: unknown, fields: readonly string[] | undefined): unknown {
  if (fields === undefined) return value;
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => (isRecord(item) ? pickObject(item, fields) : item));
  }
  return isRecord(value) ? pickObject(value, fields) : value;
}
