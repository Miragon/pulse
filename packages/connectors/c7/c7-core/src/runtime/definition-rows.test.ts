import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakeFailure, fakePort } from "../testing/fake-port.js"
import { diagramReadOf, readDiagramXml } from "./definition-rows.js"

async function expectUnexpected(read: Promise<unknown>, message: string): Promise<void> {
  await expect(read).rejects.toBeInstanceOf(RuntimeError)
  await expect(read).rejects.toMatchObject({ failure: "unexpectedResponse", message })
}

describe("readDiagramXml", () => {
  it("reads the XML a version was deployed with, by its id", async () => {
    const port = fakePort({
      getProcessDefinitionBpmn20Xml: () => ({ id: "order:1:y", bpmn20Xml: "<definitions/>" }),
    })
    expect(await readDiagramXml(port, "order:1:y")).toBe("<definitions/>")
    expect(port.calls).toEqual([
      {
        operationId: "getProcessDefinitionBpmn20Xml",
        input: { pathArgs: ["order:1:y"], query: {} },
      },
    ])
  })

  it.each(["../x", "a b", ""])(
    "is undefined for %j, an id no engine assigns, unsent",
    async (id) => {
      const port = fakePort({})
      expect(await readDiagramXml(port, id)).toBeUndefined()
      expect(port.calls).toEqual([])
    },
  )

  it.each([
    ["missing", fakeFailure(404, "InvalidRequestException")],
    ["gone", fakeFailure(500, "NullValueException")],
  ])("is undefined for a version the engine reports %s", async (_kind, failure) => {
    const port = fakePort({
      getProcessDefinitionBpmn20Xml: () => {
        throw failure
      },
    })
    expect(await readDiagramXml(port, "nope:1:x")).toBeUndefined()
  })

  it("rejects a wrong REST root", async () => {
    const failure = fakeFailure(404, "NotFoundException")
    const port = fakePort({
      getProcessDefinitionBpmn20Xml: () => {
        throw failure
      },
    })
    await expect(readDiagramXml(port, "order:1:y")).rejects.toBe(failure)
  })

  it.each([
    ["an empty answer", undefined, "definition XML is not an object"],
    ["an answer without the XML", { id: "order:1:y" }, "bpmn20Xml is missing"],
  ])("fails %s as unexpected", async (_kind, answer, message) => {
    const port = fakePort({ getProcessDefinitionBpmn20Xml: () => answer })
    await expectUnexpected(readDiagramXml(port, "order:1:y"), message)
  })
})

describe("diagramReadOf", () => {
  it("reads over the port without a surface's read", async () => {
    const port = fakePort({
      getProcessDefinitionBpmn20Xml: () => ({ id: "order:1:y", bpmn20Xml: "<definitions/>" }),
    })
    expect(await diagramReadOf(port)("order:1:y")).toBe("<definitions/>")
    expect(port.calls.map((call) => call.operationId)).toEqual(["getProcessDefinitionBpmn20Xml"])
  })

  it("reads through the surface's read where it gives one, its none as none", async () => {
    const port = fakePort({})
    const asked: string[] = []
    const read = diagramReadOf(port, (id) => {
      asked.push(id)
      return Promise.resolve(id === "order:1:y" ? "<kept/>" : undefined)
    })
    expect(await read("order:1:y")).toBe("<kept/>")
    expect(await read("nope:1:x")).toBeUndefined()
    expect(asked).toEqual(["order:1:y", "nope:1:x"])
    expect(port.calls).toEqual([])
  })

  it.each(["../x", "a b", ""])(
    "reads %j, an id no engine assigns, as none, asking neither",
    async (id) => {
      const port = fakePort({})
      const asked: string[] = []
      const read = diagramReadOf(port, (definitionId) => {
        asked.push(definitionId)
        return Promise.resolve("<never/>")
      })
      expect(await read(id)).toBeUndefined()
      expect(asked).toEqual([])
      expect(port.calls).toEqual([])
    },
  )
})
