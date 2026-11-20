import {
  BpmnProcessId,
  ElementId,
  IsoTimestamp,
  type InstanceDetail,
  type InstanceSummary,
  type Variable,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { InstanceScreen, ScreenJson } from "../../src/builder/index.js"
import { Instances } from "./support/instances.js"

const WAITS = [
  Instances.wait({
    kind: "userTask",
    elementName: "Review order",
    since: Instances.SINCE,
    assignee: "mia",
    dueAt: IsoTimestamp("2026-10-22T08:00:00.000Z"),
  }),
  Instances.wait({ kind: "workerTask", taskType: "charge-card", incidentId: "i-1" } as never),
  Instances.wait({ kind: "asyncContinuation", retriesLeft: 2 }),
  Instances.wait({ kind: "message", messageName: "Paid", correlationKey: "ORD-1" } as never),
  Instances.wait({ kind: "signal", signalName: "Stop" } as never),
  Instances.wait({ kind: "timer", attachedToElementId: ElementId("Activity_Wait") } as never),
  Instances.wait({ kind: "other", description: "conditionalEvent", instanceId: Instances.CHILD }),
]

const VARIABLES: Variable[] = [
  { name: "amount", scope: { kind: "instance" }, valueJson: "42", truncated: false },
  {
    name: "note",
    scope: { kind: "element", elementId: ElementId("Activity_Review") },
    valueJson: '"long"',
    truncated: true,
    type: "String",
    kind: "string",
  },
]

describe("the JSON form of an instance screen", () => {
  test("holds the instance, its caller and each row with codes, ids, times and the engine's words", () => {
    const detail = Instances.detail({
      instance: Instances.summary({
        businessKey: "ORD-1",
        startedAt: Instances.SINCE,
        parentInstanceId: Instances.CALLER,
        hasIncident: true,
      }),
      ...Instances.chain(),
      waitStates: WAITS,
      variables: VARIABLES,
    })
    const caller: InstanceSummary = {
      ...Instances.summary({ id: Instances.CALLER, businessKey: "BATCH-7", state: "suspended" }),
      definition: Instances.SCORING,
    }

    const data = ScreenJson.instance(InstanceScreen.of(Instances.facts(detail, { caller })))

    expect(data.asOf).toBe("2026-11-19T09:00:00.000Z")
    expect(data.instance).toStrictEqual({
      id: Instances.ROOT,
      definition: { id: "order:1", bpmnProcessId: "order", version: 1, name: "Order fulfillment" },
      state: "running",
      hasIncident: true,
      businessKey: "ORD-1",
      startedAt: Instances.SINCE,
    })
    expect(data.caller).toStrictEqual({
      instanceId: Instances.CALLER,
      found: {
        definition: { id: "scoring:3", bpmnProcessId: "scoring", version: 3 },
        state: "suspended",
        businessKey: "BATCH-7",
      },
    })
    expect(data.headline).toBeNull()
    expect(data.waits).toStrictEqual([
      {
        elementId: "Activity_Wait",
        kind: "userTask",
        elementName: "Review order",
        since: Instances.SINCE,
        dueAt: "2026-10-22T08:00:00.000Z",
        assignee: "mia",
        liesIn: null,
      },
      {
        elementId: "Activity_Wait",
        kind: "workerTask",
        incidentId: "i-1",
        taskType: "charge-card",
        liesIn: null,
      },
      { elementId: "Activity_Wait", kind: "asyncContinuation", retriesLeft: 2, liesIn: null },
      { elementId: "Activity_Wait", kind: "message", messageName: "Paid", liesIn: null },
      { elementId: "Activity_Wait", kind: "signal", signalName: "Stop", liesIn: null },
      { elementId: "Activity_Wait", kind: "timer", liesIn: null },
      {
        elementId: "Activity_Wait",
        kind: "other",
        description: "conditionalEvent",
        liesIn: { instanceId: Instances.CHILD, bpmnProcessId: "scoring" },
      },
    ])
    expect(data.variables).toStrictEqual([
      { name: "amount", valueJson: "42", truncated: false },
      {
        name: "note",
        valueJson: '"long"',
        truncated: true,
        scopeElementId: "Activity_Review",
        type: "String",
        kind: "string",
      },
    ])
  })

  test("keeps of the read models only the fields the form names", () => {
    const extra = { deployedAt: "2026-11-01", tenantId: "t1" }
    const detail = {
      ...Instances.detail({
        instance: { ...Instances.summary(), ...extra },
        incidents: [
          {
            ...Instances.incident("a", { job: { id: "j", ...extra } }),
            ...extra,
            definition: { ...Instances.ORDER, ...extra },
          },
        ],
        path: [
          {
            ...{ elementId: Instances.ELEMENT, startedAt: Instances.SINCE, canceled: false },
            ...extra,
          },
        ],
        variables: [{ ...VARIABLES[0], ...extra } as Variable],
      }),
      ...extra,
    } as InstanceDetail

    const data = ScreenJson.instance(
      InstanceScreen.of(Instances.facts(detail, { calledProcesses: undefined })),
    )

    expect(JSON.stringify(data)).not.toContain("tenantId")
    expect(data.incidents[0]?.job).toStrictEqual({ id: "j" })
    expect(data.unread).toStrictEqual(["calledProcesses"])
  })

  test("travels as JSON: written and read back it is the same screen", () => {
    const detail = Instances.detail({
      ...Instances.chain(),
      incidents: [Instances.incident("down", { instanceId: Instances.GRANDCHILD })],
      waitStates: WAITS,
      variables: VARIABLES,
    })
    const data = ScreenJson.instance(
      InstanceScreen.of(
        Instances.facts(detail, {
          calledProcesses: [{ elementId: ElementId("X"), bpmnProcessId: BpmnProcessId("x") }],
        }),
      ),
    )

    expect(JSON.parse(JSON.stringify(data))).toStrictEqual(data)
  })
})
