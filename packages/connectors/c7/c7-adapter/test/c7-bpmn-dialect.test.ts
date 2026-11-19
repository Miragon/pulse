import { BpmnProcessId, ElementId } from "@miragon/pulse-engine-core"
import { BpmnModelSource, WorkspaceCodeLocator } from "@miragon/pulse-runtime-view/model"
import type { BpmnDialect, WorkspaceFiles } from "@miragon/pulse-runtime-view/ports"
import { describe, expect, test } from "vitest"
import { C7Adapter } from "../src/index.js"

interface Descriptor {
  readonly prefix: string
  readonly types: readonly {
    readonly name: string
    readonly properties?: readonly { readonly name: string }[]
  }[]
}

const MODEL = [
  '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">',
  '<bpmn:error id="Error_Card" name="CardExpired" errorCode="CARD_EXPIRED" />',
  '<bpmn:process id="payment"><bpmn:serviceTask id="Activity_Charge" camunda:type="external" camunda:topic="charge-payment">',
  "<bpmn:extensionElements><camunda:inputOutput>",
  '<camunda:inputParameter name="amount">${order.total}</camunda:inputParameter>',
  '<camunda:outputParameter name="paymentId">${receipt.id}</camunda:outputParameter>',
  '</camunda:inputOutput><camunda:errorEventDefinition id="Map_Card" errorRef="Error_Card" expression="${expired}" />',
  "</bpmn:extensionElements></bpmn:serviceTask>",
  '<bpmn:serviceTask id="Activity_Notify" camunda:class="io.miragon.shop.Notify" />',
  '<bpmn:serviceTask id="Activity_Audit" camunda:delegateExpression="${auditLogger}" />',
  '<bpmn:serviceTask id="Activity_Rate" camunda:expression="${riskRating.rate(execution)}" />',
  '<bpmn:serviceTask id="Activity_Untyped" camunda:topic="charge-payment" />',
  '<bpmn:serviceTask id="Activity_Mail" camunda:type="mail" camunda:topic="charge-payment" />',
  "</bpmn:process></bpmn:definitions>",
].join("")

const FILES: WorkspaceFiles = {
  find: () => Promise.resolve(["file:///shop/payment.bpmn"]),
  read: () => Promise.resolve(MODEL),
}

const CONSTANTS = "file:///shop/a/Topics.java"
const WORKER = "file:///shop/b/ChargePaymentWorker.java"
const SUBSCRIPTIONS = [
  '@ExternalTaskSubscription("charge-payment")',
  'client.subscribe("charge-payment")',
  '    topicName = "charge-payment",',
]

const dialect: BpmnDialect = new C7Adapter().bpmn
const descriptor = dialect.descriptor as unknown as Descriptor
const types = new Set(descriptor.types.map((type) => `${descriptor.prefix}:${type.name}`))
const properties = new Set(
  descriptor.types.flatMap((type) => (type.properties ?? []).map((property) => property.name)),
)

function knowsProperty(name: string): boolean {
  const local = name.startsWith(`${descriptor.prefix}:`)
    ? name.slice(descriptor.prefix.length + 1)
    : name
  return !local.includes(":") && properties.has(local)
}

async function configurationOf(elementId: string) {
  const models = new BpmnModelSource(FILES, [dialect])
  const model = await models.modelOf(BpmnProcessId("payment"))
  return model === undefined
    ? undefined
    : (await models.elementIn(model, ElementId(elementId)))?.configuration
}

function workerOf(subscription: string, dialects: readonly BpmnDialect[]) {
  const sources: Readonly<Record<string, string>> = {
    [CONSTANTS]: 'String CHARGE_PAYMENT = "charge-payment";',
    [WORKER]: ["class ChargePaymentWorker {", subscription, "}"].join("\n"),
  }
  const files: WorkspaceFiles = {
    find: () => Promise.resolve(Object.keys(sources)),
    read: (uri) => Promise.resolve(sources[uri] ?? ""),
  }
  return new WorkspaceCodeLocator(files, dialects).locate({
    kind: "workerTask",
    taskType: "charge-payment",
  })
}

describe("the BPMN dialect of the C7 adapter", () => {
  test("reads the files no other dialect marks, with camunda-bpmn-moddle's descriptor", () => {
    expect([dialect.fallback, descriptor.prefix]).toEqual([true, "camunda"])
  })

  test("names only extension elements its own descriptor defines", () => {
    const named = [...dialect.mappings.map((rule) => rule.container), ...dialect.errorDefinitions]
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((name) => !types.has(name))).toEqual([])
  })

  test("reads only properties its own descriptor defines", () => {
    const read = [
      ...dialect.implementations.flatMap((rule) => [
        rule.property,
        ...(rule.when === undefined ? [] : [rule.when.property]),
      ]),
      ...dialect.mappings.flatMap((rule) => [rule.inputs, rule.outputs, rule.target, rule.source]),
    ]
    expect(read.filter((name) => !knowsProperty(name))).toEqual([])
  })

  test("hands the model reader an external task with its mappings and errors, and a class", async () => {
    expect(await configurationOf("Activity_Charge")).toEqual({
      implementation: { kind: "workerTask", taskType: "charge-payment" },
      inputs: [{ target: "amount", source: "${order.total}" }],
      outputs: [{ target: "paymentId", source: "${receipt.id}" }],
      errors: [{ code: "CARD_EXPIRED", name: "CardExpired" }],
    })
    expect((await configurationOf("Activity_Notify"))?.implementation).toEqual({
      kind: "class",
      className: "io.miragon.shop.Notify",
    })
  })

  test("reads a delegate expression and an expression as what they are", async () => {
    const [audit, rate] = await Promise.all([
      configurationOf("Activity_Audit"),
      configurationOf("Activity_Rate"),
    ])
    expect([audit?.implementation, rate?.implementation]).toEqual([
      { kind: "delegate", expression: "${auditLogger}" },
      { kind: "expression", expression: "${riskRating.rate(execution)}" },
    ])
  })

  test("reads a topic as a worker task only on an external task", async () => {
    const plain = { inputs: [], outputs: [], errors: [] }
    expect(await configurationOf("Activity_Untyped")).toEqual(plain)
    expect(await configurationOf("Activity_Mail")).toEqual(plain)
  })

  test("has a subscription case for every worker marker it lists", () => {
    expect(
      dialect.workerMarkers.filter(
        (marker) => !SUBSCRIPTIONS.some((line) => line.includes(marker)),
      ),
    ).toEqual([])
  })

  test.each(SUBSCRIPTIONS)(
    "hands the code locator the worker that subscribes with %s, not a constant",
    async (subscription) => {
      expect(await workerOf(subscription, [dialect])).toEqual({ uri: WORKER, line: 2 })
      expect(await workerOf(subscription, [])).toEqual({ uri: CONSTANTS, line: 1 })
    },
  )
})
