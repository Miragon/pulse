import { describe, expect, test } from "vitest"
import {
  RuntimeError,
  type InstanceFilter,
  type InstanceSummary,
  type ProcessRuntime,
  type RuntimeFailure,
  type VariableCondition,
} from "../src/index.js"
import { CASE, WORLD_LOCAL_VARIABLE, type CaseName } from "../src/testing/index.js"
import { SabotagedRuntime, type Sabotage } from "./support/sabotaged-runtime.js"

const ALL = { limit: 1000 }

const VARIABLE_CASES: readonly CaseName[] = Object.values(CASE).filter(
  (name) =>
    name.startsWith("variables:") && name !== CASE.variablesEmpty && name !== CASE.variablesNamed,
)

function withoutVariables(filter: InstanceFilter): InstanceFilter {
  const { variables, ...rest } = filter
  return variables === undefined ? filter : rest
}

function mapConditions(
  filter: InstanceFilter,
  change: (condition: VariableCondition) => VariableCondition,
): InstanceFilter {
  return filter.variables === undefined
    ? filter
    : { ...filter, variables: filter.variables.map(change) }
}

function numbersAsText(condition: VariableCondition): VariableCondition {
  if (!("valueJson" in condition) || typeof JSON.parse(condition.valueJson) !== "number") {
    return condition
  }
  return { ...condition, valueJson: JSON.stringify(condition.valueJson) }
}

function datesAsText(condition: VariableCondition): VariableCondition {
  return "at" in condition
    ? {
        name: condition.name,
        operator: condition.operator,
        valueJson: JSON.stringify(condition.at),
      }
    : condition
}

function isNullCheck(condition: VariableCondition): boolean {
  return (
    condition.operator === "equals" && "valueJson" in condition && condition.valueJson === "null"
  )
}

async function nullAlsoWithout(
  runtime: ProcessRuntime,
  filter: InstanceFilter,
): Promise<InstanceSummary[]> {
  const others = (filter.variables ?? []).filter((condition) => !isNullCheck(condition))
  const valued = (filter.variables ?? []).flatMap((condition) =>
    isNullCheck(condition)
      ? [{ name: condition.name, operator: "notEquals" as const, valueJson: "null" }]
      : [],
  )
  const candidates = await runtime.searchInstances({ ...filter, variables: others }, ALL)
  const excluded = await Promise.all(
    valued.map((condition) => ids(runtime, { ...filter, variables: [condition] })),
  )
  return candidates.items.filter((item) => excluded.every((found) => !found.has(item.id)))
}

function sqlWildcards(condition: VariableCondition): VariableCondition {
  return condition.operator === "like"
    ? { ...condition, pattern: condition.pattern.replace(/[%_]/g, "*") }
    : condition
}

function questionMarkAsWildcard(condition: VariableCondition): VariableCondition {
  return condition.operator === "like"
    ? { ...condition, pattern: condition.pattern.replace(/\?/g, "*") }
    : condition
}

function asksForOrderingOrDate(filter: InstanceFilter): boolean {
  return (filter.variables ?? []).some(
    (condition) =>
      "at" in condition ||
      condition.operator === "greaterThan" ||
      condition.operator === "lessThan",
  )
}

type Refusal = () => Promise<never>

function refusal(failure: RuntimeFailure): Refusal {
  return () => Promise.reject(new RuntimeError(failure, "this engine cannot compare"))
}

function refusingSearch(runtime: ProcessRuntime, refused: Refusal): Partial<ProcessRuntime> {
  return {
    searchInstances: (filter, page) =>
      asksForOrderingOrDate(filter) ? refused() : runtime.searchInstances(filter, page),
  }
}

function refusingCount(runtime: ProcessRuntime, refused: Refusal): Partial<ProcessRuntime> {
  return {
    countInstances: (filter) =>
      asksForOrderingOrDate(filter) ? refused() : runtime.countInstances(filter),
  }
}

function refusingConditions(runtime: ProcessRuntime, refused: Refusal): Partial<ProcessRuntime> {
  return { ...refusingSearch(runtime, refused), ...refusingCount(runtime, refused) }
}

async function ids(runtime: ProcessRuntime, filter: InstanceFilter): Promise<Set<string>> {
  const page = await runtime.searchInstances(filter, ALL)
  return new Set(page.items.map((item) => item.id))
}

async function anyConditionHolds(
  runtime: ProcessRuntime,
  filter: InstanceFilter,
): Promise<InstanceSummary[]> {
  const conditions = filter.variables ?? []
  const all = await runtime.searchInstances(withoutVariables(filter), ALL)
  const matching = await Promise.all(
    conditions.map((condition) => ids(runtime, { ...filter, variables: [condition] })),
  )
  return all.items.filter((item) => matching.some((found) => found.has(item.id)))
}

async function notEqualsAlsoWithout(
  runtime: ProcessRuntime,
  filter: InstanceFilter,
): Promise<InstanceSummary[]> {
  const others = (filter.variables ?? []).filter((condition) => condition.operator !== "notEquals")
  const equal = (filter.variables ?? []).flatMap((condition) =>
    condition.operator === "notEquals" ? [{ ...condition, operator: "equals" as const }] : [],
  )
  const candidates = await runtime.searchInstances({ ...filter, variables: others }, ALL)
  const excluded = await Promise.all(
    equal.map((condition) => ids(runtime, { ...filter, variables: [condition] })),
  )
  return candidates.items.filter((item) => excluded.every((found) => !found.has(item.id)))
}

async function notEqualsOnlyOwnType(
  runtime: ProcessRuntime,
  filter: InstanceFilter,
): Promise<InstanceSummary[]> {
  const pages = await Promise.all(
    (["greaterThan", "lessThan"] as const).map((operator) =>
      runtime.searchInstances(
        mapConditions(filter, (condition) =>
          condition.operator === "notEquals" &&
          "valueJson" in condition &&
          typeof JSON.parse(condition.valueJson) === "number"
            ? { ...condition, operator }
            : condition,
        ),
        ALL,
      ),
    ),
  )
  const found = new Map(pages.flatMap((page) => page.items).map((item) => [item.id, item]))
  return [...found.values()]
}

const SABOTAGES: readonly (readonly [string, Sabotage, readonly CaseName[]])[] = [
  [
    "the search ignores the variable conditions",
    (runtime) => ({
      searchInstances: (filter, page) => runtime.searchInstances(withoutVariables(filter), page),
    }),
    [...VARIABLE_CASES, CASE.instancesCounted],
  ],
  [
    "the count ignores the variable conditions",
    (runtime) => ({
      countInstances: (filter) => runtime.countInstances(withoutVariables(filter)),
    }),
    [CASE.instancesCounted],
  ],
  [
    "one condition is enough instead of all",
    (runtime) => ({
      searchInstances: async (filter, page) =>
        (filter.variables?.length ?? 0) > 1
          ? { items: await anyConditionHolds(runtime, filter) }
          : runtime.searchInstances(filter, page),
    }),
    [CASE.variablesAllHold],
  ],
  [
    "numbers are compared as text",
    (runtime) => ({
      searchInstances: (filter, page) =>
        runtime.searchInstances(mapConditions(filter, numbersAsText), page),
      countInstances: (filter) => runtime.countInstances(mapConditions(filter, numbersAsText)),
    }),
    [CASE.variablesNumbers, CASE.variablesAllHold],
  ],
  [
    "dates are compared as text",
    (runtime) => ({
      searchInstances: (filter, page) =>
        runtime.searchInstances(mapConditions(filter, datesAsText), page),
      countInstances: (filter) => runtime.countInstances(mapConditions(filter, datesAsText)),
    }),
    [CASE.variablesDates],
  ],
  [
    "null also finds instances without the variable",
    (runtime) => ({
      searchInstances: async (filter, page) =>
        filter.variables?.some(isNullCheck) === true
          ? { items: await nullAlsoWithout(runtime, filter) }
          : runtime.searchInstances(filter, page),
    }),
    [CASE.variablesNull],
  ],
  [
    "a like pattern reads % and _ as wildcards",
    (runtime) => ({
      searchInstances: (filter, page) =>
        runtime.searchInstances(mapConditions(filter, sqlWildcards), page),
      countInstances: (filter) => runtime.countInstances(mapConditions(filter, sqlWildcards)),
    }),
    [CASE.variablesLike],
  ],
  [
    "a like pattern reads ? as a wildcard",
    (runtime) => ({
      searchInstances: (filter, page) =>
        runtime.searchInstances(mapConditions(filter, questionMarkAsWildcard), page),
      countInstances: (filter) =>
        runtime.countInstances(mapConditions(filter, questionMarkAsWildcard)),
    }),
    [CASE.variablesLike],
  ],
  [
    "it declares ordering as refused but answers it",
    () => ({ refusedVariableConditions: () => ["ordering"] }),
    [CASE.variablesNumbers],
  ],
  [
    "it declares dates as refused but answers them",
    () => ({ refusedVariableConditions: () => ["date"] }),
    [CASE.variablesDates],
  ],
  [
    "it refuses ordering and dates without declaring it",
    (runtime) => refusingConditions(runtime, refusal("unsupported")),
    [CASE.variablesNumbers, CASE.variablesDates, CASE.instancesCounted],
  ],
  [
    "it declares a refusal but fails with another failure",
    (runtime) => ({
      refusedVariableConditions: () => ["ordering", "date"],
      ...refusingConditions(runtime, refusal("engineFailure")),
    }),
    [CASE.variablesNumbers, CASE.variablesDates],
  ],
  [
    "it declares a refusal but throws an error that is no runtime error",
    (runtime) => ({
      refusedVariableConditions: () => ["ordering", "date"],
      ...refusingConditions(runtime, () => Promise.reject(new Error("cannot compare"))),
    }),
    [CASE.variablesNumbers, CASE.variablesDates],
  ],
  [
    "it declares a refusal and refuses the search, but its count answers",
    (runtime) => ({
      refusedVariableConditions: () => ["ordering", "date"],
      ...refusingSearch(runtime, refusal("unsupported")),
    }),
    [CASE.variablesNumbers, CASE.variablesDates],
  ],
  [
    "it declares a refusal and refuses the count, but its search answers",
    (runtime) => ({
      refusedVariableConditions: () => ["ordering", "date"],
      ...refusingCount(runtime, refusal("unsupported")),
    }),
    [CASE.variablesNumbers, CASE.variablesDates],
  ],
  [
    "not equals also finds instances without the variable",
    (runtime) => ({
      searchInstances: async (filter, page) =>
        filter.variables?.some((condition) => condition.operator === "notEquals") === true
          ? { items: await notEqualsAlsoWithout(runtime, filter) }
          : runtime.searchInstances(filter, page),
    }),
    [CASE.variablesNotEquals, CASE.variablesDates, CASE.variablesNull],
  ],
  [
    "not equals skips a value of another type",
    (runtime) => ({
      searchInstances: async (filter, page) =>
        filter.variables?.some((condition) => condition.operator === "notEquals") === true
          ? { items: await notEqualsOnlyOwnType(runtime, filter) }
          : runtime.searchInstances(filter, page),
    }),
    [CASE.variablesNotEquals],
  ],
  [
    "a variable local to an element does not match",
    (runtime, harness) => ({
      searchInstances: async (filter, page) => {
        const result = await runtime.searchInstances(filter, page)
        const local = harness.world.instanceIds[WORLD_LOCAL_VARIABLE.instance]
        const namesLocal = filter.variables?.some(
          (condition) => condition.name === WORLD_LOCAL_VARIABLE.name,
        )
        return namesLocal === true
          ? { ...result, items: result.items.filter((item) => item.id !== local) }
          : result
      },
    }),
    [CASE.variablesAnyScope],
  ],
  [
    "ended instances never match by their variables",
    (runtime) => ({
      searchInstances: async (filter, page) => {
        const result = await runtime.searchInstances(filter, page)
        return (filter.variables?.length ?? 0) > 0
          ? { ...result, items: result.items.filter((item) => item.endedAt === undefined) }
          : result
      },
    }),
    [CASE.variablesEnded, CASE.variablesNotEquals, CASE.variablesNull, CASE.instancesCounted],
  ],
  [
    "a version names the variables of every version",
    (runtime, harness) => ({
      listVariableNames: async (definitionId) => [
        ...(await runtime.listVariableNames(definitionId)),
        ...(await runtime.listVariableNames(harness.world.definitionIds["dispatch@1"])),
      ],
    }),
    [CASE.variablesNamed],
  ],
  [
    "a version names a variable once per instance",
    (runtime) => ({
      listVariableNames: async (definitionId) => {
        const names = await runtime.listVariableNames(definitionId)
        return [...names, ...names]
      },
    }),
    [CASE.variablesNamed],
  ],
  [
    "an empty list of conditions finds nothing",
    (runtime) => ({
      searchInstances: (filter, page) =>
        filter.variables?.length === 0
          ? Promise.resolve({ items: [] })
          : runtime.searchInstances(filter, page),
    }),
    [CASE.variablesEmpty],
  ],
]

describe("the variable laws", () => {
  test.each(SABOTAGES)("catch a runtime where %s", async (_flaw, sabotage, expected) => {
    expect(await SabotagedRuntime.failingCases(SabotagedRuntime.with(sabotage))).toEqual(
      [...expected].sort(),
    )
  })

  test("accept a runtime that declares what it refuses and refuses exactly that", async () => {
    const declaring = SabotagedRuntime.with((runtime) => ({
      refusedVariableConditions: () => ["ordering", "date"],
      ...refusingConditions(runtime, refusal("unsupported")),
    }))

    expect(await SabotagedRuntime.failingCases(declaring)).toEqual([])
  })
})
