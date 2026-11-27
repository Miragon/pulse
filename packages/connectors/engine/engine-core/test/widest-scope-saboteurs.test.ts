import { describe, expect, test } from "vitest"
import type { InstanceFilter } from "../src/index.js"
import { CASE, ConformanceKit, type CaseName } from "../src/testing/index.js"
import { SabotagedRuntime, type Sabotage } from "./support/sabotaged-runtime.js"

function inTheWholeEngine(filter: InstanceFilter): boolean {
  return filter.bpmnProcessId === undefined && filter.definitionId === undefined
}

function withIncidentAnywhere(filter: InstanceFilter): boolean {
  return inTheWholeEngine(filter) && filter.withIncident === true
}

const SABOTAGES: readonly (readonly [string, Sabotage, readonly CaseName[]])[] = [
  [
    "the whole engine's instances with an incident come as their parts answered, each read otherwise",
    (runtime) => {
      let reads = 0
      return {
        searchInstances: async (filter, page) => {
          const found = await runtime.searchInstances(filter, page)
          if (!withIncidentAnywhere(filter)) {
            return found
          }
          reads += 1
          return reads % 2 === 0 ? { ...found, items: [...found.items].reverse() } : found
        },
      }
    },
    [CASE.instancesNewestFirst],
  ],
  [
    "each page of the whole engine's instances with an incident starts every part over",
    (runtime) => ({
      searchInstances: (filter, page) =>
        runtime.searchInstances(
          filter,
          withIncidentAnywhere(filter) ? { limit: page.limit } : page,
        ),
    }),
    [CASE.instancesPagesFull],
  ],
  [
    "the whole engine's count without an incident subtracts the first part's with one alone",
    (runtime) => ({
      countInstances: async (filter) => {
        const counted = await runtime.countInstances(filter)
        if (!inTheWholeEngine(filter) || filter.withIncident !== false) {
          return counted
        }
        const withOne = await runtime.countInstances({ ...filter, withIncident: true })
        return { count: counted.count + withOne.count - 1 }
      },
    }),
    [CASE.instancesCounted],
  ],
  [
    "the whole engine's count with an incident at an element counts the first part alone",
    (runtime) => ({
      countInstances: async (filter) =>
        withIncidentAnywhere(filter) && filter.activeElementId !== undefined
          ? { count: 0 }
          : runtime.countInstances(filter),
    }),
    [CASE.instancesCounted],
  ],
]

describe("the laws over the widest scope with an incident", () => {
  test.each(SABOTAGES)("catch a runtime where %s", async (_flaw, sabotage, expected) => {
    expect(await SabotagedRuntime.failingCases(SabotagedRuntime.with(sabotage))).toEqual(
      [...expected].sort(),
    )
  })

  test("count more instances with an incident than any process holds", async () => {
    const { runtime } = SabotagedRuntime.conforming()

    expect(await runtime.countInstances({ withIncident: true })).toStrictEqual({ count: 3 })
  })

  test("run again on their own, with the variable conditions", () => {
    const names = ConformanceKit.instanceLaws().map((law) => law.name)

    expect(names).toContain(CASE.instancesCounted)
    expect(names).toContain(CASE.instancesPagesFull)
    expect(names).toContain(CASE.variablesLike)
    expect(names).not.toContain(CASE.incidentsPaging)
    expect(
      names.every((name) => name.startsWith("instances:") || name.startsWith("variables:")),
    ).toBe(true)
  })

  test("register as tests of the kit's runner, the laws it is handed alone", () => {
    const registered: string[] = []
    const kit = new ConformanceKit((name) => registered.push(name))

    kit.registerRuntimeLaws(
      () => Promise.resolve(SabotagedRuntime.conforming()),
      ConformanceKit.instanceLaws(),
    )

    expect(registered).toStrictEqual(
      ConformanceKit.instanceLaws().map((law) => `conformance: ${law.name}`),
    )
  })
})
