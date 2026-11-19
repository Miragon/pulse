import { BpmnProcessId, ElementId } from "@miragon/pulse-engine-core"
import { BpmnModelSource, WorkspaceCodeLocator } from "@miragon/pulse-runtime-view/model"
import type { BpmnDialect, WorkspaceFiles } from "@miragon/pulse-runtime-view/ports"
import { describe, expect, test } from "vitest"
import { C8Adapter } from "../src/index.js"

interface Descriptor {
  readonly prefix: string
  readonly uri: string
  readonly types: readonly {
    readonly name: string
    readonly properties?: readonly { readonly name: string }[]
  }[]
}

const MODEL = [
  '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">',
  '<bpmn:process id="shipping"><bpmn:serviceTask id="Activity_Book"><bpmn:extensionElements>',
  '<zeebe:taskDefinition type="book-carrier" retries="3" />',
  '<zeebe:ioMapping><zeebe:input source="=order.address" target="address" />',
  '<zeebe:output source="=booking.id" target="bookingId" /></zeebe:ioMapping>',
  "</bpmn:extensionElements></bpmn:serviceTask></bpmn:process></bpmn:definitions>",
].join("")

const FILES: WorkspaceFiles = {
  find: () => Promise.resolve(["file:///shop/shipping.bpmn"]),
  read: () => Promise.resolve(MODEL),
}

const CONSTANTS = "file:///shop/a/JobTypes.java"
const WORKER = "file:///shop/b/BookCarrierWorker.java"
const SUBSCRIPTIONS = [
  '@JobWorker(type = "book-carrier")',
  '@ZeebeWorker(type = "book-carrier")',
  'client.newWorker().jobType("book-carrier")',
]

const dialect: BpmnDialect = new C8Adapter().bpmn
const descriptor = dialect.descriptor as unknown as Descriptor
const types = new Set(descriptor.types.map((type) => `${descriptor.prefix}:${type.name}`))
const properties = new Set(
  descriptor.types.flatMap((type) => (type.properties ?? []).map((property) => property.name)),
)

function workerOf(subscription: string, dialects: readonly BpmnDialect[]) {
  const sources: Readonly<Record<string, string>> = {
    [CONSTANTS]: 'String BOOK_CARRIER = "book-carrier";',
    [WORKER]: ["class BookCarrierWorker {", subscription, "}"].join("\n"),
  }
  const files: WorkspaceFiles = {
    find: () => Promise.resolve(Object.keys(sources)),
    read: (uri) => Promise.resolve(sources[uri] ?? ""),
  }
  return new WorkspaceCodeLocator(files, dialects).locate({
    kind: "workerTask",
    taskType: "book-carrier",
  })
}

describe("the BPMN dialect of the C8 adapter", () => {
  test("reads only the files that name its namespace, with zeebe-bpmn-moddle's descriptor", () => {
    expect([dialect.fallback, descriptor.prefix, descriptor.uri]).toEqual([
      false,
      "zeebe",
      "http://camunda.org/schema/zeebe/1.0",
    ])
  })

  test("names only extension elements its own descriptor defines", () => {
    const named = [
      ...dialect.implementations.flatMap((rule) =>
        rule.extension === undefined ? [] : [rule.extension],
      ),
      ...dialect.mappings.map((rule) => rule.container),
      ...dialect.errorDefinitions,
    ]
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((name) => !types.has(name))).toEqual([])
  })

  test("reads only properties its own descriptor defines", () => {
    const read = [
      ...dialect.implementations.map((rule) => rule.property),
      ...dialect.mappings.flatMap((rule) => [rule.inputs, rule.outputs, rule.target, rule.source]),
    ]
    expect(read.filter((name) => !properties.has(name))).toEqual([])
  })

  test("hands the model reader a job worker with its input and output mapping", async () => {
    const models = new BpmnModelSource(FILES, [dialect])
    const model = await models.modelOf(BpmnProcessId("shipping"))
    const element =
      model === undefined ? undefined : await models.elementIn(model, ElementId("Activity_Book"))

    expect(element?.configuration).toEqual({
      implementation: { kind: "workerTask", taskType: "book-carrier" },
      inputs: [{ target: "address", source: "=order.address" }],
      outputs: [{ target: "bookingId", source: "=booking.id" }],
      errors: [],
    })
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
