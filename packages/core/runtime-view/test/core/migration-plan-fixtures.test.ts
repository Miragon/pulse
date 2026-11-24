import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  type ElementMapping,
  type ElementStatistics,
  type VersionSummary,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import {
  BLOCKED_MIGRATION_PLAN_VIEW,
  BROKEN_PLAN_PROBLEM,
  MIGRATION_PLAN_VIEW,
} from "../../dev/webview/fixtures/migration-plan.js"
import orderXml from "../../dev/webview/fixtures/order-fulfillment.bpmn"
import { PlanProblems } from "../../src/core/plans/plan-problems.js"
import { PlanViewBuilder, type PlanState } from "../../src/core/plans/plan-view-builder.js"
import type { MigrationPlanView } from "../../src/core/protocol/index.js"

const RESERVE = "Activity_ReserveStock"
const CREDIT = "Activity_CheckCredit"
const APPROVE = "Activity_ApproveOrder"
const PICKUP = "Event_WaitForPickup"
const PAYMENT = "Event_PaymentReceived"
const SHIP = "Activity_ShipOrder"

function ref(version: number) {
  return {
    id: DefinitionId(
      version === 7 ? "order-fulfillment:7:4a1c" : `order-fulfillment:${version}:91e0`,
    ),
    bpmnProcessId: BpmnProcessId("order-fulfillment"),
    version,
    name: "Order fulfillment",
  }
}

function versions(...numbers: readonly number[]): VersionSummary[] {
  return numbers.map((version) => ({
    definition: ref(version),
    running: 0,
    withIncident: 0,
    incidents: 0,
  }))
}

function same(...elementIds: readonly string[]): ElementMapping[] {
  return elementIds.map((id) => ({
    sourceElementId: ElementId(id),
    targetElementId: ElementId(id),
  }))
}

function tokens(counts: Readonly<Record<string, number>>): ElementStatistics[] {
  return Object.entries(counts).map(([elementId, active]) => ({
    elementId: ElementId(elementId),
    active,
    incidents: 0,
    incidentsInCalledInstances: 0,
  }))
}

function state(change: Partial<PlanState>): PlanState {
  return {
    asOf: new Date(MIGRATION_PLAN_VIEW.asOf),
    versions: versions(7, 6),
    source: ref(6),
    target: ref(7),
    sourceXml: orderXml,
    targetXml: orderXml,
    statistics: tokens({ [RESERVE]: 1, [CREDIT]: 5, [APPROVE]: 3, [SHIP]: 1 }),
    instanceIds: [],
    leftOut: [],
    waiting: new Map(),
    mappings: same(RESERVE, CREDIT, APPROVE, PICKUP, PAYMENT, SHIP),
    problems: [],
    checking: false,
    checkFailure: undefined,
    focused: CREDIT,
    fileName: MIGRATION_PLAN_VIEW.fileName,
    refused: [],
    notes: [],
    running: 12,
    withIncident: 2,
    ...change,
  }
}

function built(plan: PlanState): MigrationPlanView {
  return PlanViewBuilder.build(plan, { engine: MIGRATION_PLAN_VIEW.engine })
}

describe("the dev page's migration plans", () => {
  test("are what the builder makes of a plan that fits", () => {
    expect(built(state({}))).toEqual(MIGRATION_PLAN_VIEW)
  })

  test("are what the builder makes of a plan with a left-out pair, a problem and a gap", () => {
    const view = built(
      state({
        versions: versions(8, 7, 6),
        statistics: tokens({ [RESERVE]: 1, [CREDIT]: 5, [APPROVE]: 3 }),
        mappings: same(RESERVE, CREDIT, PICKUP, PAYMENT),
        refused: [
          {
            mapping: { sourceElementId: SHIP, targetElementId: "Activity_ShipParcel" },
            refusal: "targetMissing",
          },
        ],
        problems: [
          {
            mapping: same(CREDIT)[0]!,
            message:
              "The boundary event of Check credit has no mapping, so its subscription can't follow.",
          },
        ],
        notes: [{ path: "title", code: "ignoredKey" }],
        running: 1204,
        withIncident: 7,
        focused: SHIP,
      }),
    )

    expect(view).toEqual(BLOCKED_MIGRATION_PLAN_VIEW)
  })

  test("are what the plan's problems make of a file that is not JSON", () => {
    expect(
      PlanProblems.broken(MIGRATION_PLAN_VIEW.fileName, [{ path: "(file)", code: "notJson" }]),
    ).toEqual(BROKEN_PLAN_PROBLEM)
  })
})
