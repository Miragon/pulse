import { BpmnProcessId } from "../../model/ids.js"
import type { InstanceFilter, VariableCondition } from "../../model/queries.js"
import { Conditions } from "./conditions.js"
import { Ensure } from "../ensure.js"
import { CASE, type ConformanceCase } from "../conformance-case.js"
import type { ConformanceHarness } from "../harness.js"
import {
  WORLD_DUE_AT,
  WORLD_LOCAL_VARIABLE,
  WORLD_PROCESS,
  type InstanceAlias,
} from "../world/world.js"

const PAGE_LIMIT = 50
const NEW_YEAR = "2026-01-01T00:00:00.000Z"

interface Expectation {
  readonly conditions: readonly VariableCondition[]
  readonly found: readonly InstanceAlias[]
}

export class VariableSearch {
  static inWorld(
    harness: ConformanceHarness,
    variables: readonly VariableCondition[],
  ): InstanceFilter {
    return { instanceIds: Object.values(harness.world.instanceIds), variables }
  }

  static countedFilters(harness: ConformanceHarness): readonly InstanceFilter[] {
    return [
      VariableSearch.inWorld(harness, [Conditions.equals("route", "review")]),
      VariableSearch.inWorld(harness, [Conditions.greaterThan("amount", 5)]),
      VariableSearch.inWorld(harness, [Conditions.like("route", "*e*")]),
    ]
  }

  static law(name: string, expectations: readonly Expectation[]): ConformanceCase {
    return {
      name,
      run: (harness) => VariableSearch.expect(harness, name, expectations),
    }
  }

  private static async expect(
    harness: ConformanceHarness,
    law: string,
    expectations: readonly Expectation[],
  ): Promise<void> {
    for (const { conditions, found } of expectations) {
      const page = await harness.runtime.searchInstances(
        VariableSearch.inWorld(harness, conditions),
        { limit: PAGE_LIMIT },
      )
      Ensure.sameSet(
        page.items.map((item) => item.id),
        found.map((alias) => harness.world.instanceIds[alias]),
        `${law} (${JSON.stringify(conditions)})`,
      )
    }
  }
}

const emptyConditions: ConformanceCase = {
  name: CASE.variablesEmpty,
  async run(harness) {
    const filter: InstanceFilter = { bpmnProcessId: BpmnProcessId(WORLD_PROCESS.order) }
    const [unconstrained, withEmpty] = await Promise.all([
      harness.runtime.searchInstances(filter, { limit: PAGE_LIMIT }),
      harness.runtime.searchInstances({ ...filter, variables: [] }, { limit: PAGE_LIMIT }),
    ])
    Ensure.that(unconstrained.items.length > 0, this.name, "the process has no instances")
    Ensure.sameSet(
      withEmpty.items.map((item) => item.id),
      unconstrained.items.map((item) => item.id),
      this.name,
    )
  },
}

const ORDER_VARIABLES = ["amount", "dueAt", "giftNote", "reviewNote", "route"]

const namesOfAVersion: ConformanceCase = {
  name: CASE.variablesNamed,
  async run(harness) {
    const { definitionIds, unknown } = harness.world
    const names = await harness.runtime.listVariableNames(definitionIds["order@1"])
    const described = Ensure.describe(names)
    Ensure.that(
      ORDER_VARIABLES.every((name) => names.includes(name)) && !names.includes("orderId"),
      this.name,
      `order@1 names ${described}`,
    )
    Ensure.that(
      described === Ensure.describe([...new Set(names)].sort()),
      this.name,
      `names are not distinct and sorted: ${described}`,
    )
    const none = await harness.runtime.listVariableNames(unknown.definitionId)
    Ensure.that(none.length === 0, this.name, `an unknown version names ${Ensure.describe(none)}`)
  },
}

export const VARIABLE_LAWS: readonly ConformanceCase[] = [
  VariableSearch.law(CASE.variablesEquals, [
    { conditions: [Conditions.equals("route", "review")], found: ["ORD-1001", "ORD-2001"] },
  ]),
  VariableSearch.law(CASE.variablesNotEquals, [
    { conditions: [Conditions.notEquals("route", "review")], found: ["ORD-1002", "ORD-1003"] },
    {
      conditions: [Conditions.notEquals("route", 42)],
      found: ["ORD-1001", "ORD-1002", "ORD-1003", "ORD-2001"],
    },
  ]),
  VariableSearch.law(CASE.variablesNumbers, [
    { conditions: [Conditions.equals("amount", 42)], found: ["ORD-1002"] },
    { conditions: [Conditions.equals("amount", "42")], found: [] },
    {
      conditions: [Conditions.greaterThan("amount", 5), Conditions.lessThan("amount", 100)],
      found: ["ORD-1002"],
    },
    { conditions: [Conditions.greaterThan("amount", 42)], found: [] },
  ]),
  VariableSearch.law(CASE.variablesDates, [
    { conditions: [Conditions.date("dueAt", "equals", WORLD_DUE_AT)], found: ["ORD-1002"] },
    { conditions: [Conditions.date("dueAt", "greaterThan", NEW_YEAR)], found: ["ORD-1002"] },
    { conditions: [Conditions.date("dueAt", "lessThan", NEW_YEAR)], found: [] },
    { conditions: [Conditions.equals("dueAt", WORLD_DUE_AT)], found: [] },
    { conditions: [Conditions.date("route", "greaterThan", NEW_YEAR)], found: [] },
  ]),
  VariableSearch.law(CASE.variablesNull, [
    { conditions: [Conditions.equals("giftNote", null)], found: ["ORD-1002"] },
    { conditions: [Conditions.notEquals("giftNote", null)], found: [] },
    { conditions: [Conditions.equals("route", null)], found: [] },
    {
      conditions: [Conditions.notEquals("route", null)],
      found: ["ORD-1001", "ORD-1002", "ORD-1003", "ORD-2001"],
    },
  ]),
  VariableSearch.law(CASE.variablesLike, [
    { conditions: [Conditions.like("route", "rev*")], found: ["ORD-1001", "ORD-2001"] },
    { conditions: [Conditions.like("route", "r_view")], found: [] },
    { conditions: [Conditions.like("route", "r%")], found: [] },
  ]),
  VariableSearch.law(CASE.variablesAllHold, [
    {
      conditions: [Conditions.equals("route", "charge"), Conditions.equals("amount", 42)],
      found: ["ORD-1002"],
    },
    {
      conditions: [Conditions.equals("route", "review"), Conditions.equals("amount", 42)],
      found: [],
    },
  ]),
  VariableSearch.law(CASE.variablesEnded, [
    { conditions: [Conditions.equals("route", "express")], found: ["ORD-1003"] },
  ]),
  VariableSearch.law(CASE.variablesAnyScope, [
    {
      conditions: [Conditions.equals(WORLD_LOCAL_VARIABLE.name, WORLD_LOCAL_VARIABLE.value)],
      found: [WORLD_LOCAL_VARIABLE.instance],
    },
  ]),
  VariableSearch.law(CASE.variablesUnknownName, [
    { conditions: [Conditions.equals("unknownVariable", "review")], found: [] },
  ]),
  emptyConditions,
  namesOfAVersion,
]
