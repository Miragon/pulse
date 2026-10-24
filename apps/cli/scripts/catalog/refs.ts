/**
 * Fails the generator on `$ref`s that point nowhere. The runtime schema helpers resolve unknown
 * references to `{}` (accept anything), so a spec update that renames a component would otherwise
 * silently drop body flags and switch off body validation.
 */

import { isReference, type OpenApiDocument } from './openapi.js';

const LOCAL_REF = /^#\/components\/([^/]+)\/([^/]+)$/;

/** Every `$ref` string below `value` (objects and arrays, any depth). */
export function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
  } else if (typeof value === 'object' && value !== null) {
    if (isReference(value)) refs.push(value.$ref);
    for (const child of Object.values(value)) collectRefs(child, refs);
  }
  return refs;
}

function resolves(spec: OpenApiDocument, ref: string): boolean {
  const match = LOCAL_REF.exec(ref);
  if (match === null) return false;
  const [, kind = '', name = ''] = match;
  const components = (spec.components ?? {}) as Readonly<Record<string, unknown>>;
  const group = Object.hasOwn(components, kind) ? components[kind] : undefined;
  return typeof group === 'object' && group !== null && Object.hasOwn(group, name);
}

function check(spec: OpenApiDocument, owner: string, value: unknown): void {
  const broken = collectRefs(value).filter((ref) => !resolves(spec, ref));
  if (broken.length > 0) {
    throw new Error(`Unresolvable $ref ${[...new Set(broken)].join(', ')} (used by ${owner})`);
  }
}

/** Throws for the first operation or component that uses a `$ref` without a target. */
export function assertResolvableRefs(spec: OpenApiDocument): void {
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [key, operation] of Object.entries(item)) {
      const operationId = (operation as { operationId?: unknown } | undefined)?.operationId;
      check(spec, typeof operationId === 'string' ? operationId : `${key} ${path}`, operation);
    }
  }
  for (const [kind, group] of Object.entries(spec.components ?? {})) {
    for (const [name, component] of Object.entries(group as Record<string, unknown>)) {
      check(spec, `#/components/${kind}/${name}`, component);
    }
  }
}
