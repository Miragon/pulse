/** Builds the operation catalog from the OpenAPI document. Pure: same input, same output. */

import type { Catalog, GroupSpec, OperationSpec, Schema } from '../../src/catalog/types.js';
import { markEngineDates } from './dates.js';
import { GROUP_DESCRIPTIONS } from './groups.js';
import { kebab, shortCommandName } from './naming.js';
import type { OpenApiDocument } from './openapi.js';
import { type UnnamedOperation, extractOperations } from './operations.js';
import { BULK_OPERATIONS, EFFECT_OVERRIDES } from './effects.js';
import { EXTRA_ALIASES, NAME_OVERRIDES } from './overrides.js';
import { applyPresets } from './presets.js';
import { assertResolvableRefs } from './refs.js';
import { assertUniqueSummaries, summarize } from './summaries.js';

export function buildCatalog(source: OpenApiDocument, sourceUrl: string): Catalog {
  const spec = markEngineDates(source);
  assertResolvableRefs(spec);
  const unnamed = extractOperations(spec);
  assertKnownOperations(unnamed, [...BULK_OPERATIONS], 'Bulk classification');
  assertKnownOperations(unnamed, Object.keys(EFFECT_OVERRIDES), 'Effect overrides');
  const operations = applyPresets(summarize(assignNames(unnamed))).sort(
    (a, b) => compareText(a.group, b.group) || compareText(a.name, b.name),
  );
  assertUniqueNames(operations);
  assertUniqueSummaries(operations);
  return {
    source: { title: spec.info.title, version: spec.info.version, url: sourceUrl },
    groups: buildGroups(unnamed),
    operations,
    schemas: stripExamples(spec.components?.schemas ?? {}) as Record<string, Schema>,
  };
}

/** Locale-independent order, so the generated file is identical on every machine. */
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function buildGroups(operations: readonly UnnamedOperation[]): GroupSpec[] {
  const tags = [...new Set(operations.map((operation) => operation.tag))].sort();
  return tags.map((tag) => ({
    name: kebab(tag),
    tag,
    description: GROUP_DESCRIPTIONS[tag] ?? `${tag} operations`,
  }));
}

export function assignNames(
  operations: readonly UnnamedOperation[],
  overrides: Readonly<Record<string, string>> = NAME_OVERRIDES,
  extraAliases: Readonly<Record<string, readonly string[]>> = EXTRA_ALIASES,
): OperationSpec[] {
  assertKnownOperations(operations, Object.keys(overrides), 'Name overrides');
  assertKnownOperations(operations, Object.keys(extraAliases), 'Extra aliases');
  const candidates = operations.map((operation) => ({
    operation,
    group: kebab(operation.tag),
    full: kebab(operation.operationId),
    short:
      overrides[operation.operationId] ??
      shortCommandName(operation.operationId, operation.tag) ??
      kebab(operation.operationId),
  }));
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = `${candidate.group} ${candidate.short}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const named = candidates.map(({ operation, group, full, short }) => {
    const name = (counts.get(`${group} ${short}`) ?? 0) > 1 ? full : short;
    const { tag: _tag, ...rest } = operation;
    const extra = extraAliases[operation.operationId] ?? [];
    return { ...rest, group, name, aliases: [...(name === full ? [] : [full]), ...extra] };
  });
  return named;
}

function assertKnownOperations(
  operations: readonly UnnamedOperation[],
  ids: readonly string[],
  what: string,
): void {
  const known = new Set(operations.map((operation) => operation.operationId));
  const stale = ids.filter((id) => !known.has(id));
  if (stale.length > 0) throw new Error(`${what} for unknown operations: ${stale.join(', ')}`);
}

export function assertUniqueNames(operations: readonly OperationSpec[]): void {
  const seen = new Map<string, string>();
  for (const operation of operations) {
    for (const name of [operation.name, ...operation.aliases]) {
      const key = `${operation.group} ${name}`;
      const previous = seen.get(key);
      if (previous !== undefined) {
        throw new Error(`Command name clash "${key}": ${previous} and ${operation.operationId}`);
      }
      seen.set(key, operation.operationId);
    }
  }
}

const EXAMPLE_KEYS: ReadonlySet<string> = new Set(['example', 'examples']);

/**
 * Removes `example` and `examples` from schemas at every level. Inside a `properties` map the keys
 * are property names, so a property called `example` is kept.
 */
export function stripExamples(value: unknown, propertyMap = false): unknown {
  if (Array.isArray(value)) return value.map((item) => stripExamples(item));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => propertyMap || !EXAMPLE_KEYS.has(key))
      .map(([key, child]) => [key, stripExamples(child, !propertyMap && key === 'properties')]),
  );
}
