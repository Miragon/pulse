import { InstanceId } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakePort, type Route } from "../testing/fake-port.js"
import { InstanceDetailReader } from "./instance-detail-reader.js"
import type { InspectView } from "./instance-inspection.js"
import { type DefinitionsByInstance, treeVersionsOf } from "./tree-versions.js"
import { parseExact } from "../raw-json.js"
import type { TreeNode } from "../types.js"

/**
 * The detail of instances of the Pulse world as recorded engine answers: what the inspection
 * gave on Operaton (`test-support/inspect-*.json`, read digit for digit), and the typed variables
 * and the history the reader asks for besides. The recordings hold no version of a running called
 * instance, which the inspection hands on from what its rounds read of the runtime (`versions`,
 * `treeVersionsOf`): the reader derives it the same way from the tree a recording names and the
 * definitions of the run it was recorded in.
 */

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>
  }
}

const RECORDED = import.meta.glob("./test-support/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
})

const IDS = {
  order1: "pulse-order:1:63b7b305-cd7f-11f1-86d2-667bc3771e0d",
  label1: "pulse-label:1:63b14a61-cd7f-11f1-86d2-667bc3771e0d",
  dispatch1: "pulse-dispatch:1:63c0659d-cd7f-11f1-86d2-667bc3771e0d",
  review: "63d65e9e-cd7f-11f1-86d2-667bc3771e0d",
  charge: "63d9e117-cd7f-11f1-86d2-667bc3771e0d",
  ended: "63de4df1-cd7f-11f1-86d2-667bc3771e0d",
  dispatch: "63e79cda-cd7f-11f1-86d2-667bc3771e0d",
  label: "63e7c3f0-cd7f-11f1-86d2-667bc3771e0d",
  chargeIncident: "63e2bad0-cd7f-11f1-86d2-667bc3771e0d",
  labelIncident: "63ebbba0-cd7f-11f1-86d2-667bc3771e0d",
  chargeJob: "63da7d5e-cd7f-11f1-86d2-667bc3771e0d",
  labelJob: "63e7eb04-cd7f-11f1-86d2-667bc3771e0d",
  externalTaskInstance: "c727b084-cd79-11f1-9d36-92016cbb8c45",
} as const

const ORDER_V1 = {
  id: IDS.order1,
  bpmnProcessId: "pulse-order",
  tenantId: null,
  version: 1,
  name: "Order fulfillment",
}
const LABEL_V1 = {
  id: IDS.label1,
  bpmnProcessId: "pulse-label",
  tenantId: null,
  version: 1,
  name: "Print label",
}
const DISPATCH_V1 = {
  id: IDS.dispatch1,
  bpmnProcessId: "pulse-dispatch",
  tenantId: null,
  version: 1,
  name: "Dispatch order",
}

/**
 * The definitions the runtime of the recorded run lists, as the inspection's rounds read them: the
 * one version of each process its recorded instances run.
 */
const RUN_DEFINITIONS = [ORDER_V1, LABEL_V1, DISPATCH_V1].map(
  ({ id, bpmnProcessId, version, name }) => ({ id, key: bpmnProcessId, version, name }),
)
const CHARGE_MESSAGE =
  "Unknown property used in expression: ${paymentService.charge(amount)}. Cause: Cannot resolve identifier 'paymentService'"
const LABEL_MESSAGE =
  "Unknown property used in expression: ${labelPrinter.print(orderId)}. Cause: Cannot resolve identifier 'labelPrinter'"

function recorded(name: string): unknown {
  const text = RECORDED[`./test-support/${name}.json`]
  if (text === undefined) throw new Error(`no recorded answer ${name}`)
  return parseExact(text)
}

function stacktraceDetails(identifier: string) {
  return {
    kind: "stacktrace",
    text: expect.stringMatching(/^org\.operaton\.bpm\.engine\.ProcessEngineException/) as string,
    truncated: false,
    rootCause: `PropertyNotFoundException: Cannot resolve identifier '${identifier}'`,
    rootCauseLine: 82,
  }
}

/**
 * The version each running instance of the recorded `view` runs, as the inspection derives it:
 * `treeVersionsOf` over its tree (the instance and the instances it called, each of the run's
 * definition of its process) and the run's definitions.
 */
function runVersionsOf(view: Omit<InspectView, "versions">): DefinitionsByInstance {
  const definitionOf = (key: string | undefined) =>
    RUN_DEFINITIONS.find((definition) => definition.key === key)?.id ?? ""
  const tree: TreeNode[] = [
    { id: view.id, definitionId: view.definition.id, suspended: false, depth: 0 },
    ...view.children.map((child) => ({
      id: child.id,
      parentId: child.parentId,
      definitionId: definitionOf(child.key),
      suspended: false,
      depth: 1,
    })),
  ]
  return treeVersionsOf({ tree, definitions: RUN_DEFINITIONS })
}

/**
 * A reader whose inspection gives the recorded view `inspection` with the runtime's `versions` of
 * its tree (by default the run's, `runVersionsOf`), its port the `routes`.
 */
function readerOver(
  inspection: string,
  routes: Readonly<Record<string, Route>> = {},
  versions?: DefinitionsByInstance,
) {
  const port = fakePort(routes)
  const shown = recorded(inspection) as Omit<InspectView, "versions">
  const view: InspectView = { ...shown, versions: versions ?? runVersionsOf(shown) }
  return { port, reader: new InstanceDetailReader(port, { inspect: () => Promise.resolve(view) }) }
}

function operationsOf(port: ReturnType<typeof fakePort>): string[] {
  return port.calls.map((call) => call.operationId)
}

describe("the instance detail over recorded engine answers", () => {
  it("details a parent with the wait states and the root incident of its called instance, by the runtime's version", async () => {
    // No route to the history: at history level NONE, or once the cleanup removed it, it knows no
    // instance, and the detail of a running called instance asks it for none.
    const { port, reader } = readerOver("inspect-dispatch")

    const detail = await reader.read(InstanceId(IDS.dispatch))

    expect(detail?.instance).toEqual({
      id: IDS.dispatch,
      definition: {
        id: IDS.dispatch1,
        bpmnProcessId: "pulse-dispatch",
        tenantId: null,
        version: 1,
        name: "Dispatch order",
      },
      state: "running",
      hasIncident: true,
      businessKey: "DSP-3001",
      startedAt: "2026-10-21T18:44:04.586Z",
    })
    expect(detail?.calledInstances).toEqual([
      {
        id: IDS.label,
        parentInstanceId: IDS.dispatch,
        bpmnProcessId: "pulse-label",
        tenantId: null,
        state: "running",
        calledFromElementId: "Activity_PrintShippingLabel",
      },
    ])
    expect(detail?.waitStates).toEqual([
      {
        instanceId: IDS.label,
        elementId: "Activity_RenderLabel",
        elementName: "Render label",
        since: "2026-10-21T18:44:04.588Z",
        incidentId: IDS.labelIncident,
        kind: "asyncContinuation",
        retriesLeft: 0,
      },
    ])
    expect(detail?.incidents).toEqual([
      {
        id: IDS.labelIncident,
        instanceId: IDS.label,
        definition: LABEL_V1,
        elementId: "Activity_RenderLabel",
        type: "failedJob",
        message: LABEL_MESSAGE,
        createdAt: "2026-10-21T18:44:04.613Z",
        retriesLeft: 0,
        job: { id: IDS.labelJob },
        details: stacktraceDetails("labelPrinter"),
      },
    ])
    expect(detail?.variables).toEqual([
      {
        name: "orderId",
        scope: { kind: "instance" },
        valueJson: '"ORD-1001"',
        truncated: false,
        kind: "string",
      },
    ])
    expect(detail?.truncated).toBe(false)
    expect(operationsOf(port)).toEqual(["getVariableInstances"])
  })

  it("names the version of a called instance the runtime does not list from the history", async () => {
    const { port, reader } = readerOver(
      "inspect-dispatch",
      {
        queryHistoricProcessInstances: (input) =>
          JSON.stringify(input.body).includes(IDS.label)
            ? [
                {
                  id: IDS.label,
                  processDefinitionId: IDS.label1,
                  processDefinitionKey: "pulse-label",
                  processDefinitionVersion: 1,
                  processDefinitionName: "Print label",
                  state: "ACTIVE",
                  startTime: "2026-10-21T18:44:04.587+0000",
                },
              ]
            : [],
      },
      new Map(),
    )

    const detail = await reader.read(InstanceId(IDS.dispatch))

    expect(detail?.incidents).toEqual([
      expect.objectContaining({
        id: IDS.labelIncident,
        instanceId: IDS.label,
        definition: LABEL_V1,
      }),
    ])
    expect(operationsOf(port)).toEqual(["getVariableInstances", "queryHistoricProcessInstances"])
  })

  it("details a user task wait with the typed variables of every scope", async () => {
    const { port, reader } = readerOver("inspect-review", {
      getVariableInstances: (input) =>
        input.query.processInstanceIdIn === IDS.review ? recorded("variable-instances-review") : [],
    })

    const detail = await reader.read(InstanceId(IDS.review))

    expect(detail?.waitStates).toEqual([
      {
        instanceId: IDS.review,
        elementId: "Activity_ReviewOrder",
        elementName: "Review order",
        since: "2026-10-21T18:44:04.475Z",
        kind: "userTask",
        assignee: "demo",
      },
    ])
    const instanceScope = { kind: "instance" }
    expect(detail?.variables).toEqual([
      {
        name: "address",
        scope: instanceScope,
        valueJson: '{"city":"Munich"}',
        truncated: false,
        kind: "json",
        type: "Json",
      },
      {
        name: "invoice",
        scope: instanceScope,
        valueJson: '"rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcA=="',
        truncated: false,
        kind: "opaque",
        type: "Object",
      },
      {
        name: "ledger",
        scope: instanceScope,
        valueJson: "9007199254740993",
        truncated: false,
        kind: "integer",
        type: "Long",
      },
      {
        name: "nrOfInstances",
        scope: { kind: "element", elementId: "Activity_PackParcel" },
        valueJson: "2",
        truncated: false,
        kind: "integer",
        type: "Integer",
      },
      {
        name: "reviewNote",
        scope: { kind: "element", elementId: "Activity_ReviewOrder" },
        valueJson: '"Check the delivery address"',
        truncated: false,
        kind: "string",
        type: "String",
      },
      {
        name: "route",
        scope: instanceScope,
        valueJson: '"review"',
        truncated: false,
        kind: "string",
        type: "String",
      },
    ])
    expect(detail?.incidents).toEqual([])
    expect(detail?.instance.hasIncident).toBe(false)
    expect(operationsOf(port)).toEqual(["getVariableInstances"])
    expect(port.calls[0]?.input.query.deserializeValues).toBe("false")
  })

  it("details an incident at the failing element of the instance itself", async () => {
    const { port, reader } = readerOver("inspect-charge")

    const detail = await reader.read(InstanceId(IDS.charge))

    expect(detail?.incidents).toEqual([
      {
        id: IDS.chargeIncident,
        instanceId: IDS.charge,
        definition: ORDER_V1,
        elementId: "Activity_ChargePayment",
        type: "failedJob",
        message: CHARGE_MESSAGE,
        createdAt: "2026-10-21T18:44:04.554Z",
        retriesLeft: 0,
        job: { id: IDS.chargeJob },
        details: stacktraceDetails("paymentService"),
      },
    ])
    expect(detail?.path).toEqual([
      {
        elementId: "Event_OrderReceived",
        elementName: "Order received",
        startedAt: "2026-10-21T18:44:04.497Z",
        endedAt: "2026-10-21T18:44:04.497Z",
        canceled: false,
      },
      {
        elementId: "Gateway_Route",
        elementName: "Route?",
        startedAt: "2026-10-21T18:44:04.497Z",
        endedAt: "2026-10-21T18:44:04.497Z",
        canceled: false,
      },
    ])
    expect(operationsOf(port)).toEqual(["getVariableInstances"])
  })

  it("names the failed external task with its topic and maps the worker wait", async () => {
    const { reader } = readerOver("inspect-external-task")

    const detail = await reader.read(InstanceId(IDS.externalTaskInstance))

    expect(detail?.incidents.map((incident) => [incident.type, incident.job])).toEqual([
      ["failedJob", { id: "c729ac73-cd79-11f1-9d36-92016cbb8c45" }],
      [
        "failedExternalTask",
        { id: "c72a6fc7-cd79-11f1-9d36-92016cbb8c45", type: "notify-customer" },
      ],
    ])
    expect(detail?.waitStates.map((waitState) => waitState.kind)).toEqual([
      "asyncContinuation",
      "workerTask",
      "message",
      "userTask",
      "timer",
    ])
    expect(detail?.waitStates[1]).toEqual({
      instanceId: IDS.externalTaskInstance,
      elementId: "notify",
      elementName: "Notify customer",
      since: "2026-10-21T18:03:54.138Z",
      incidentId: "ccbde620-cd79-11f1-9d36-92016cbb8c45",
      kind: "workerTask",
      taskType: "notify-customer",
      retriesLeft: 0,
    })
    expect(detail?.variables.find((variable) => variable.name === "bigId")?.valueJson).toBe(
      "9007199254740993",
    )
  })

  it("details an ended instance without wait states and incidents", async () => {
    const { reader } = readerOver("inspect-ended")

    const detail = await reader.read(InstanceId(IDS.ended))

    expect(detail?.instance.state).toBe("completed")
    expect(detail?.instance.endedAt).toBe("2026-10-21T18:44:04.526Z")
    expect(detail?.waitStates).toEqual([])
    expect(detail?.incidents).toEqual([])
  })
})
