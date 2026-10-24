/** Access to the generated operation catalog (`loadCatalog`: the one of camunda7). */

import generated from "../generated/catalog.camunda7.json" with { type: "json" }
import type { Catalog, GroupSpec, OperationSpec } from "./types.js"

export function loadCatalog(): Catalog {
  return generated as unknown as Catalog
}

export function findGroup(catalog: Catalog, name: string): GroupSpec | undefined {
  return catalog.groups.find((group) => group.name === name)
}

export function operationsInGroup(catalog: Catalog, group: string): OperationSpec[] {
  return catalog.operations.filter((operation) => operation.group === group)
}

/** Finds an operation by group and command name or alias. */
export function findOperation(
  catalog: Catalog,
  group: string,
  name: string,
): OperationSpec | undefined {
  return catalog.operations.find(
    (operation) =>
      operation.group === group && (operation.name === name || operation.aliases.includes(name)),
  )
}

/**
 * Finds an operation by its OpenAPI operationId (case-insensitive). Presets (`suspend`, `activate`)
 * share the operationId of their base operation; the base operation wins.
 */
export function findByOperationId(catalog: Catalog, id: string): OperationSpec | undefined {
  const wanted = id.toLowerCase()
  const matches = catalog.operations.filter(
    (operation) => operation.operationId.toLowerCase() === wanted,
  )
  return matches.find((operation) => operation.preset === undefined) ?? matches[0]
}

/** `/engine/{name}` in front of an engine scoped path. */
const ENGINE_PREFIX = /^\/engine\/[^/]+(?=\/)/
const PLACEHOLDER = /^\{[^}]+\}$/

/** A percent-decoded path segment; malformed escapes stay as they are. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** Literal segments of a matching path template (more is more specific), or -1. */
function templateScore(template: string, path: string): number {
  const expected = template.split("/")
  const actual = path.split("/").map(decodeSegment)
  const matches =
    expected.length === actual.length &&
    expected.every((segment, index) =>
      PLACEHOLDER.test(segment) ? actual[index] !== "" : segment === actual[index],
    )
  return matches ? expected.filter((segment) => !PLACEHOLDER.test(segment)).length : -1
}

/**
 * The catalog operation for a method and a (normalized) path of a raw request; `/engine/{name}`
 * prefixes are ignored and segments compared percent-decoded. The most specific template wins.
 */
export function findOperationByPath(
  catalog: Catalog,
  method: string,
  path: string,
): OperationSpec | undefined {
  const stripped = path.replace(ENGINE_PREFIX, "")
  let best: { operation: OperationSpec; score: number } | undefined
  for (const operation of catalog.operations) {
    if (operation.method !== method) continue
    // presets share method and path with their base operation, which wins
    const score =
      templateScore(operation.path, stripped) - (operation.preset === undefined ? 0 : 0.5)
    if (score > 0 && score > (best?.score ?? 0)) best = { operation, score }
  }
  return best?.operation
}
