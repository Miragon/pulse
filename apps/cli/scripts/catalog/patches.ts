/**
 * Minimal RFC 6902 JSON Patch (add, replace, remove, test) used to correct known errors of the
 * vendored spec without editing the upstream file. The root pointer "" is not supported.
 */

import { isDeepStrictEqual } from 'node:util';

export interface PatchOperation {
  readonly op: 'add' | 'replace' | 'remove' | 'test';
  readonly path: string;
  readonly value?: unknown;
  /** Why the patch exists; ignored by the algorithm. */
  readonly reason?: string;
}

type Container = Record<string, unknown> | unknown[];

const OPERATIONS: ReadonlySet<string> = new Set(['add', 'replace', 'remove', 'test']);
const NEEDS_VALUE: ReadonlySet<string> = new Set(['add', 'replace', 'test']);
const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

function decode(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function parsePointer(pointer: string): string[] {
  if (!pointer.startsWith('/')) throw new Error(`Invalid JSON pointer "${pointer}"`);
  return pointer.slice(1).split('/').map(decode);
}

function isContainer(value: unknown): value is Container {
  return typeof value === 'object' && value !== null;
}

function notFound(pointer: string): Error {
  return new Error(`JSON patch path not found: ${pointer}`);
}

/** Own member of an object, or array element at a canonical index; undefined when absent. */
function member(container: Container, key: string): unknown {
  if (Array.isArray(container)) return ARRAY_INDEX.test(key) ? container[Number(key)] : undefined;
  return Object.hasOwn(container, key) ? container[key] : undefined;
}

function existing(container: Container, key: string, pointer: string): unknown {
  const value = member(container, key);
  if (value === undefined) throw notFound(pointer);
  return value;
}

function parentOf(document: unknown, segments: readonly string[], pointer: string): Container {
  let current = document;
  for (const segment of segments.slice(0, -1)) {
    if (!isContainer(current)) throw notFound(pointer);
    current = existing(current, segment, pointer);
  }
  if (!isContainer(current)) throw notFound(pointer);
  return current;
}

/** Creates or overwrites an own property (also for keys like `__proto__`). */
function setMember(container: Container, key: string, value: unknown): void {
  Object.defineProperty(container, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function add(parent: Container, key: string, value: unknown, pointer: string): void {
  if (!Array.isArray(parent)) {
    setMember(parent, key, value);
    return;
  }
  const index = key === '-' ? parent.length : Number(key);
  if ((key !== '-' && !ARRAY_INDEX.test(key)) || index > parent.length) throw notFound(pointer);
  parent.splice(index, 0, value);
}

function remove(parent: Container, key: string): void {
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else Reflect.deleteProperty(parent, key);
}

function checkOperation(operation: PatchOperation): void {
  if (!OPERATIONS.has(operation.op)) {
    throw new Error(`Unsupported JSON patch operation "${operation.op}" at ${operation.path}`);
  }
  if (NEEDS_VALUE.has(operation.op) && !('value' in operation)) {
    throw new Error(`JSON patch "${operation.op}" at ${operation.path} needs a value`);
  }
}

function applyOne(document: unknown, operation: PatchOperation): void {
  checkOperation(operation);
  const { op, path } = operation;
  const segments = parsePointer(path);
  const key = segments.at(-1) ?? '';
  const parent = parentOf(document, segments, path);
  if (op === 'test') {
    if (!isDeepStrictEqual(member(parent, key), operation.value)) {
      throw new Error(`JSON patch test failed at ${path}`);
    }
    return;
  }
  if (op === 'add') {
    add(parent, key, structuredClone(operation.value), path);
    return;
  }
  existing(parent, key, path);
  if (op === 'remove') remove(parent, key);
  else setMember(parent, key, structuredClone(operation.value));
}

/** Applies the patch to a deep copy of the document and returns it. */
export function applyPatch<T>(document: T, patch: readonly PatchOperation[]): T {
  const copy = structuredClone(document);
  for (const operation of patch) applyOne(copy, operation);
  return copy;
}
