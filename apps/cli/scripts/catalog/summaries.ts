/**
 * One-line summaries of the commands, shown by `operate commands`, `--help` and `describe`. The
 * upstream summaries are often generic ("Get List", "Get") or shared by the by-id / by-key / by-key
 * and tenant id variants of an operation, so an agent cannot pick a command from them. Rules:
 *
 * 1. an explicit override (keyed by operationId; the generator fails for unknown ids),
 * 2. a summary built from the command name for the standard names (`list` → "List process
 *    instances", `get` → "Get a process instance by id", ...),
 * 3. the upstream summary.
 *
 * Summaries that are still shared within a group get the variant from the path appended:
 * "(by id)", "(by key)" or "(by key and tenant id)". The result must be unique per group.
 */

import type { OperationSpec } from "../../src/catalog/types.js"
import { pluralize } from "./naming.js"
import { SUMMARY_OVERRIDES } from "./summary-overrides.js"

type Rule = (noun: Noun, operation: OperationSpec) => string | undefined

interface Noun {
  readonly singular: string
  readonly plural: string
  /** `a` or `an`. */
  readonly article: string
}

function nounOf(group: string): Noun {
  const words = group.split("-")
  const last = words.pop() ?? group
  const singular = [...words, last].join(" ")
  return {
    singular,
    plural: [...words, pluralize(last)].join(" "),
    article: /^[aeio]/.test(singular) ? "an" : "a",
  }
}

function pathParams(operation: OperationSpec): number {
  return operation.params.filter((param) => param.in === "path").length
}

/** ` by id` for operations on `/.../{id}` with no other path parameter. */
function byId(operation: OperationSpec): string {
  return pathParams(operation) === 1 && operation.path.endsWith("/{id}") ? " by id" : ""
}

function onOne(verb: string): Rule {
  return (noun, operation) =>
    pathParams(operation) === 0
      ? undefined
      : `${verb} ${noun.article} ${noun.singular}${byId(operation)}`
}

const NAME_RULES: Readonly<Record<string, Rule>> = {
  list: (noun) => `List ${noun.plural}`,
  count: (noun) => `Count ${noun.plural}`,
  query: (noun) => `List ${noun.plural} (filters in the JSON body)`,
  "query-count": (noun) => `Count ${noun.plural} (filters in the JSON body)`,
  get: onOne("Get"),
  delete: onOne("Delete"),
  update: onOne("Update"),
  create: (noun) => `Create ${noun.article} ${noun.singular}`,
  add: (noun) => `Add ${noun.article} ${noun.singular}`,
}

function baseSummary(
  operation: OperationSpec,
  overrides: Readonly<Record<string, string>>,
): string {
  const override = overrides[operation.operationId]
  if (override !== undefined) return override
  const rule = Object.hasOwn(NAME_RULES, operation.name) ? NAME_RULES[operation.name] : undefined
  return rule?.(nounOf(operation.group), operation) ?? operation.summary
}

/** `by key and tenant id`, `by key` or `by id` from the path of the operation. */
function variantOf(path: string): string | undefined {
  if (path.includes("/key/{key}/tenant-id/")) return "by key and tenant id"
  if (path.includes("/key/{key}")) return "by key"
  return /\/\{id\}(?:\/|$)/.test(path) ? "by id" : undefined
}

function duplicates(operations: readonly OperationSpec[]): Set<string> {
  const seen = new Set<string>()
  const shared = new Set<string>()
  for (const { group, summary } of operations) {
    const key = `${group}\n${summary}`
    if (seen.has(key)) shared.add(key)
    seen.add(key)
  }
  return shared
}

/** Fails when two commands of a group share a summary. */
export function assertUniqueSummaries(operations: readonly OperationSpec[]): void {
  const [shared] = duplicates(operations)
  if (shared !== undefined) {
    const [group, summary] = shared.split("\n")
    throw new Error(`Commands of group ${group} share the summary "${summary}"`)
  }
}

/** Applies the summary rules (see the module comment) to named operations. */
export function summarize(
  operations: readonly OperationSpec[],
  overrides: Readonly<Record<string, string>> = SUMMARY_OVERRIDES,
): OperationSpec[] {
  const known = new Set(operations.map((operation) => operation.operationId))
  const stale = Object.keys(overrides).filter((id) => !known.has(id))
  if (stale.length > 0)
    throw new Error(`Summary overrides for unknown operations: ${stale.join(", ")}`)
  const based = operations.map((operation) => ({
    ...operation,
    summary: baseSummary(operation, overrides),
  }))
  const shared = duplicates(based)
  return based.map((operation) => {
    const variant = variantOf(operation.path)
    return shared.has(`${operation.group}\n${operation.summary}`) && variant !== undefined
      ? { ...operation, summary: `${operation.summary} (${variant})` }
      : operation
  })
}
