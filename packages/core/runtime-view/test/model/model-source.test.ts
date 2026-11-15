import { BpmnProcessId, ElementId } from "@miragon/pulse-engine-core"
import type { BpmnDialect, ModelFile } from "../../src/ports/index.js"
import { describe, expect, test } from "vitest"
import { BpmnModelSource } from "../../src/model/index.js"
import paymentXml from "./fixtures/payment.bpmn"
import shippingXml from "./fixtures/shipping.bpmn"
import { CAMUNDA, DIALECTS, ZEEBE } from "./support/dialects.js"
import { MemoryFiles } from "./support/memory-files.js"

const PAYMENT_URI = "file:///workspace/src/main/resources/bpmn/payment.bpmn"
const SHIPPING_URI = "file:///workspace/src/main/resources/bpmn/shipping.bpmn"

const MIGRATED_URI = "file:///workspace/a/migrated.bpmn"
const MIGRATED = [
  '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
  ' xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">',
  '<bpmn:process id="migrated"><bpmn:serviceTask id="Activity_Charge"><bpmn:extensionElements>',
  '<zeebe:taskDefinition type="charge-payment" />',
  '<zeebe:ioMapping><zeebe:input source="=order.total" target="amount" /></zeebe:ioMapping>',
  "</bpmn:extensionElements></bpmn:serviceTask></bpmn:process></bpmn:definitions>",
].join("")

const TOPICS_URI = "file:///workspace/a/topics.bpmn"
const TOPICS = [
  '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">',
  '<bpmn:process id="topics"><bpmn:serviceTask id="Activity_Untyped" camunda:topic="charge-payment" />',
  '<bpmn:serviceTask id="Activity_Mail" camunda:type="mail" camunda:topic="charge-payment" />',
  "</bpmn:process></bpmn:definitions>",
].join("")

function source(
  files: Readonly<Record<string, string>> = {},
  dialects: readonly BpmnDialect[] = DIALECTS,
): BpmnModelSource {
  return new BpmnModelSource(
    new MemoryFiles({ [PAYMENT_URI]: paymentXml, [SHIPPING_URI]: shippingXml, ...files }),
    dialects,
  )
}

async function configurationIn(models: BpmnModelSource, bpmnProcessId: string, elementId: string) {
  const model = await models.modelOf(BpmnProcessId(bpmnProcessId))
  const element =
    model === undefined ? undefined : await models.elementIn(model, ElementId(elementId))
  return element?.configuration
}

async function modelOf(bpmnProcessId: string): Promise<ModelFile> {
  const model = await source().modelOf(BpmnProcessId(bpmnProcessId))
  if (model === undefined) {
    throw new Error(`no model for ${bpmnProcessId}`)
  }
  return model
}

async function configurationOf(bpmnProcessId: string, elementId: string) {
  const element = await source().elementIn(await modelOf(bpmnProcessId), ElementId(elementId))
  return element?.configuration
}

describe("the BPMN model source", () => {
  test("finds the local file that declares a process", async () => {
    expect(await modelOf("shipping")).toEqual({
      uri: SHIPPING_URI,
      fileName: "shipping.bpmn",
      bpmnProcessId: "shipping",
      xml: shippingXml,
    })
  })

  test("finds nothing for a process no local file declares", async () => {
    expect(await source().modelOf(BpmnProcessId("billing"))).toBeUndefined()
  })

  test("skips files that only mention the id or do not parse", async () => {
    const mentions = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:collaboration id="payment" /></bpmn:definitions>`
    const model = await source({
      "file:///workspace/a/broken.bpmn": '<bpmn:process id="payment"',
      "file:///workspace/a/mentions.bpmn": mentions,
    }).modelOf(BpmnProcessId("payment"))
    expect(model?.uri).toBe(PAYMENT_URI)
  })

  test("locates an element at its line in the file", async () => {
    const model = await modelOf("payment")
    const element = await source().elementIn(model, ElementId("Activity_ChargePayment"))
    const line = paymentXml
      .split("\n")
      .findIndex((text) => text.includes('"Activity_ChargePayment" name'))
    expect(element?.location).toEqual({ uri: PAYMENT_URI, line: line + 1 })
  })

  test("knows no element the file does not have", async () => {
    const model = await modelOf("payment")
    expect(await source().elementIn(model, ElementId("Activity_Missing"))).toBeUndefined()
  })

  test("reads a worker task with its mappings and the errors it may throw", async () => {
    expect(await configurationOf("payment", "Activity_ChargePayment")).toEqual({
      implementation: { kind: "workerTask", taskType: "charge-payment" },
      inputs: [{ target: "amount", source: "${order.total}" }],
      outputs: [{ target: "paymentId", source: "${receipt.id}" }],
      errors: [{ code: "CARD_EXPIRED", name: "CardExpired" }],
    })
  })

  test("reads a class, a delegate and an expression", async () => {
    const implementations = await Promise.all(
      ["Activity_NotifyCustomer", "Activity_WriteAuditLog", "Activity_RateRisk"].map(
        async (elementId) => (await configurationOf("payment", elementId))?.implementation,
      ),
    )
    expect(implementations).toEqual([
      { kind: "class", className: "io.miragon.shop.notify.NotifyCustomerDelegate" },
      { kind: "delegate", expression: "${auditLogger}" },
      { kind: "expression", expression: "${riskRating.rate(execution)}" },
    ])
  })

  test("reads a property only when the condition of its rule holds", async () => {
    const models = source({ [TOPICS_URI]: TOPICS })
    const plain = { inputs: [], outputs: [], errors: [] }

    expect(await configurationIn(models, "topics", "Activity_Untyped")).toEqual(plain)
    expect(await configurationIn(models, "topics", "Activity_Mail")).toEqual(plain)
  })

  test("reads a scripted input by its name and an error boundary without error as none", async () => {
    const [audit, notify] = await Promise.all([
      configurationOf("payment", "Activity_WriteAuditLog"),
      configurationOf("payment", "Activity_NotifyCustomer"),
    ])
    expect(audit?.inputs).toEqual([{ target: "entry" }])
    expect(notify?.errors).toEqual([])
  })

  test("reads a job worker with its input and output mapping", async () => {
    expect(await configurationOf("shipping", "Activity_BookCarrier")).toEqual({
      implementation: { kind: "workerTask", taskType: "book-carrier" },
      inputs: [{ target: "address", source: "=order.address" }],
      outputs: [{ target: "bookingId", source: "=booking.id" }],
      errors: [],
    })
  })

  test("reads a model that names both vendor namespaces with the dialect it is marked for", async () => {
    expect(
      await configurationIn(source({ [MIGRATED_URI]: MIGRATED }), "migrated", "Activity_Charge"),
    ).toEqual({
      implementation: { kind: "workerTask", taskType: "charge-payment" },
      inputs: [{ target: "amount", source: "=order.total" }],
      outputs: [],
      errors: [],
    })
  })

  test("reads a model with the dialects in either order alike", async () => {
    const reversed = source({ [MIGRATED_URI]: MIGRATED }, [ZEEBE, CAMUNDA])

    expect(await configurationIn(reversed, "payment", "Activity_ChargePayment")).toEqual(
      await configurationOf("payment", "Activity_ChargePayment"),
    )
    expect(await configurationIn(reversed, "migrated", "Activity_Charge")).toMatchObject({
      implementation: { kind: "workerTask", taskType: "charge-payment" },
    })
  })

  test("reads only the vocabulary of the dialects it is given", async () => {
    expect(
      await configurationIn(source({}, [CAMUNDA]), "shipping", "Activity_BookCarrier"),
    ).toEqual({ inputs: [], outputs: [], errors: [] })
    expect(await configurationIn(source({}, [ZEEBE]), "payment", "Activity_ChargePayment")).toEqual(
      { inputs: [], outputs: [], errors: [{ code: "CARD_EXPIRED", name: "CardExpired" }] },
    )
  })

  test("still finds the processes of a model without any dialect", async () => {
    const plain = source({}, [])

    expect((await plain.modelOf(BpmnProcessId("payment")))?.uri).toBe(PAYMENT_URI)
    expect(await configurationIn(plain, "payment", "Activity_NotifyCustomer")).toEqual({
      inputs: [],
      outputs: [],
      errors: [],
    })
  })

  test("reads an element without implementation as plain", async () => {
    expect(await configurationOf("payment", "Event_PaymentRequested")).toEqual({
      inputs: [],
      outputs: [],
      errors: [],
    })
  })
})
