import { BpmnProcessId, ElementId } from "@miragon/pulse-engine-core"
import type { EngineTarget } from "@miragon/pulse-runtime-view/host-kit"
import type { WorkspaceFiles } from "@miragon/pulse-runtime-view/ports"
import { describe, expect, test } from "vitest"
import { CompositionRoot } from "../../src/host/composition-root.js"
import { LOCAL_TARGET } from "./support/local-target.js"

const CLUSTER: EngineTarget = {
  ...LOCAL_TARGET,
  name: "cluster",
  engine: "c8",
  endpoint: "http://localhost:8088/v2",
}

const MODELS: Readonly<Record<string, string>> = {
  "file:///shop/a/payment.bpmn": [
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">',
    '<bpmn:process id="payment"><bpmn:serviceTask id="Activity_Charge" camunda:type="external" camunda:topic="charge-payment" />',
    '<bpmn:serviceTask id="Activity_Notify" camunda:delegateExpression="${notifier}" />',
    '<bpmn:serviceTask id="Activity_Score" camunda:expression="${scoring.score(execution)}" />',
    '<bpmn:serviceTask id="Activity_Topic" camunda:topic="charge-payment" />',
    "</bpmn:process></bpmn:definitions>",
  ].join(""),
  "file:///shop/b/shipping.bpmn": [
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">',
    '<bpmn:process id="shipping"><bpmn:serviceTask id="Activity_Book"><bpmn:extensionElements>',
    '<zeebe:taskDefinition type="book-carrier" /></bpmn:extensionElements></bpmn:serviceTask>',
    "</bpmn:process></bpmn:definitions>",
  ].join(""),
  "file:///shop/c/migrated.bpmn": [
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
    ' xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">',
    '<bpmn:process id="migrated"><bpmn:serviceTask id="Activity_Charge"><bpmn:extensionElements>',
    '<zeebe:taskDefinition type="charge-payment" />',
    '<zeebe:ioMapping><zeebe:input source="=order.total" target="amount" /></zeebe:ioMapping>',
    "</bpmn:extensionElements></bpmn:serviceTask></bpmn:process></bpmn:definitions>",
  ].join(""),
}

const SOURCES: Readonly<Record<string, string>> = {
  "file:///shop/a/Topics.java":
    'class Topics { String CHARGE = "charge-payment"; String BOOK = "book-carrier"; }',
  "file:///shop/b/ChargeWorker.java": [
    "class ChargeWorker {",
    '  @ExternalTaskSubscription(topicName = "charge-payment")',
    "}",
  ].join("\n"),
  "file:///shop/c/BookWorker.java": [
    "class BookWorker {",
    '  @JobWorker(type = "book-carrier")',
    "}",
  ].join("\n"),
}

const FILES: WorkspaceFiles = {
  find: (glob) => Promise.resolve(Object.keys(glob.endsWith(".bpmn") ? MODELS : SOURCES)),
  read: (uri) => Promise.resolve(MODELS[uri] ?? SOURCES[uri] ?? ""),
}

async function configurationOf(bpmnProcessId: string, elementId: string) {
  const { models } = CompositionRoot.create().localSources(FILES)
  const model = await models.modelOf(BpmnProcessId(bpmnProcessId))
  return model === undefined
    ? undefined
    : (await models.elementIn(model, ElementId(elementId)))?.configuration
}

describe("the composition root", () => {
  test("falls back to the local engine of the C7 adapter", () => {
    expect(CompositionRoot.create().engines.localTarget()).toEqual(LOCAL_TARGET)
  })

  test("wires the C7 adapter and the C8 adapter, each for its dialect", () => {
    const { engines } = CompositionRoot.create()
    const cockpit = {
      ...LOCAL_TARGET,
      webUiUrl: "http://localhost:8080/camunda/app/cockpit/default/",
    }
    const operate = { ...CLUSTER, webUiUrl: "http://localhost:8088/operate" }
    const endpoint = { kind: "endpoint", endpoint: CLUSTER.endpoint } as const

    expect([engines.webUi(cockpit)?.name, engines.webUi(operate)?.name]).toEqual([
      "Cockpit",
      "Operate",
    ])
    expect(engines.commands(CLUSTER, { kind: "none" })).toBeUndefined()
    expect([engines.canWrite(LOCAL_TARGET), engines.canWrite(CLUSTER)]).toEqual([true, false])
    expect(engines.cli(CLUSTER, endpoint)).toBeUndefined()
  })

  test("reads Camunda 7, Camunda 8 and a model naming both with the adapters' BPMN dialects", async () => {
    expect((await configurationOf("payment", "Activity_Charge"))?.implementation).toEqual({
      kind: "workerTask",
      taskType: "charge-payment",
    })
    expect((await configurationOf("shipping", "Activity_Book"))?.implementation).toEqual({
      kind: "workerTask",
      taskType: "book-carrier",
    })
    expect(await configurationOf("migrated", "Activity_Charge")).toEqual({
      implementation: { kind: "workerTask", taskType: "charge-payment" },
      inputs: [{ target: "amount", source: "=order.total" }],
      outputs: [],
      errors: [],
    })
  })

  test("reads a delegate, an expression and a topic outside an external task by the C7 dialect", async () => {
    const read = async (elementId: string) =>
      (await configurationOf("payment", elementId))?.implementation
    expect([
      await read("Activity_Notify"),
      await read("Activity_Score"),
      await read("Activity_Topic"),
    ]).toEqual([
      { kind: "delegate", expression: "${notifier}" },
      { kind: "expression", expression: "${scoring.score(execution)}" },
      undefined,
    ])
  })

  test("finds the worker of each dialect by the adapters' markers, not the first mention", async () => {
    const { code } = CompositionRoot.create().localSources(FILES)
    expect([
      await code.locate({ kind: "workerTask", taskType: "charge-payment" }),
      await code.locate({ kind: "workerTask", taskType: "book-carrier" }),
    ]).toEqual([
      { uri: "file:///shop/b/ChargeWorker.java", line: 2 },
      { uri: "file:///shop/c/BookWorker.java", line: 2 },
    ])
  })
})
