import { describe, expect, test } from "vitest"
import {
  PageCursor,
  type InstanceFilter,
  type InstanceSummary,
  type Page,
  type PageRequest,
  type ProcessRuntime,
} from "../src/index.js"
import { CASE, type CaseName } from "../src/testing/index.js"
import { SabotagedRuntime, type Sabotage } from "./support/sabotaged-runtime.js"

const EVERY = { limit: 1000 }

type KeyMatch = (key: string, wanted: string) => boolean

async function everyMatching(
  runtime: ProcessRuntime,
  filter: InstanceFilter,
  matches: KeyMatch,
): Promise<readonly InstanceSummary[]> {
  const { businessKey, ...rest } = filter
  const { items } = await runtime.searchInstances(rest, EVERY)
  return businessKey === undefined
    ? items
    : items.filter((item) => matches(item.businessKey ?? "", businessKey))
}

function pageOf(items: readonly InstanceSummary[], page: PageRequest): Page<InstanceSummary> {
  const offset = page.after === undefined ? 0 : Number(page.after)
  const end = offset + page.limit
  const listed = items.slice(offset, end)
  return end < items.length ? { items: listed, next: PageCursor(String(end)) } : { items: listed }
}

function keysMatching(matches: KeyMatch): Sabotage {
  return (runtime) => ({
    searchInstances: async (filter, page) =>
      filter.businessKey === undefined
        ? runtime.searchInstances(filter, page)
        : pageOf(await everyMatching(runtime, filter, matches), page),
    countInstances: async (filter) =>
      filter.businessKey === undefined
        ? runtime.countInstances(filter)
        : { count: (await everyMatching(runtime, filter, matches)).length },
  })
}

function matchesAsWildcardPattern(key: string, wanted: string): boolean {
  const literal = wanted.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  const pattern = literal.replace(/[%*]/g, ".*").replace(/[_?]/g, ".")
  return new RegExp(`^${pattern}$`, "u").test(key)
}

const SABOTAGES: readonly (readonly [string, Sabotage, readonly CaseName[]])[] = [
  [
    "a business key matches every key it begins",
    keysMatching((key, wanted) => key.startsWith(wanted)),
    [CASE.instancesByExactBusinessKey],
  ],
  [
    "a business key matches every key it is a part of",
    keysMatching((key, wanted) => key.includes(wanted)),
    [CASE.instancesByExactBusinessKey],
  ],
  [
    "a business key matches every key that is a part of it",
    keysMatching((key, wanted) => key !== "" && wanted.includes(key)),
    [CASE.instancesByExactBusinessKey],
  ],
  [
    "a business key is a pattern with wildcards (SQL's LIKE, Camunda 8's $like)",
    keysMatching(matchesAsWildcardPattern),
    [CASE.instancesByExactBusinessKey],
  ],
]

describe("the business key laws", () => {
  test.each(SABOTAGES)("catch a runtime where %s", async (_flaw, sabotage, expected) => {
    expect(await SabotagedRuntime.failingCases(SabotagedRuntime.with(sabotage))).toEqual(
      [...expected].sort(),
    )
  })
})
