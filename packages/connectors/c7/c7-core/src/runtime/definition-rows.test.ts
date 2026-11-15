import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakeFailure, fakePort } from "../testing/fake-port.js"
import { readDefinitionStatistics, readDiagramXml } from "./definition-rows.js"

const FULL = {
  id: "invoice:2:x",
  key: "invoice",
  version: 2,
  name: "Invoice Receipt",
  deploymentId: "d2",
  versionTag: "stable",
}
const BARE = { id: "order:1:y", key: "order", version: 1 }

function statisticsPort(answer: unknown) {
  return fakePort({ getProcessDefinitionStatistics: () => answer })
}

async function expectUnexpected(read: Promise<unknown>, message: string): Promise<void> {
  await expect(read).rejects.toBeInstanceOf(RuntimeError)
  await expect(read).rejects.toMatchObject({ failure: "unexpectedResponse", message })
}

describe("readDefinitionStatistics", () => {
  it("reads every version with its running instances, in one request without values", async () => {
    const port = statisticsPort([
      { definition: FULL, instances: 3, failedJobs: 0, incidents: [] },
      { definition: { ...BARE, name: null, deploymentId: null }, instances: 0 },
    ])
    expect(await readDefinitionStatistics(port)).toStrictEqual([
      { definition: FULL, instances: 3 },
      { definition: BARE, instances: 0 },
    ])
    expect(port.calls).toEqual([
      { operationId: "getProcessDefinitionStatistics", input: { pathArgs: [], query: {} } },
    ])
  })

  it.each([
    ["an answer that is no list", {}, "definition statistics is not a list"],
    ["a row that is no object", [1], "definition statistics[0] is not an object"],
    ["a row without its definition", [{ instances: 1 }], "statistics definition is not an object"],
    ["a row without its count", [{ definition: BARE }], "instances is missing"],
    ["a definition without its id", [{ definition: { key: "a", version: 1 } }], "id is missing"],
    ["a definition without its key", [{ definition: { id: "a", version: 1 } }], "key is missing"],
    [
      "a definition without its version",
      [{ definition: { id: "a", key: "a" }, instances: 1 }],
      "version is missing",
    ],
    [
      "a name that is no text",
      [{ definition: { ...BARE, name: 1 }, instances: 1 }],
      "name is not a string",
    ],
    [
      "a deployment that is no text",
      [{ definition: { ...BARE, deploymentId: 1 }, instances: 1 }],
      "deploymentId is not a string",
    ],
    [
      "a version tag that is no text",
      [{ definition: { ...BARE, versionTag: 1 }, instances: 1 }],
      "versionTag is not a string",
    ],
  ])("fails %s as unexpected", async (_kind, answer, message) => {
    await expectUnexpected(readDefinitionStatistics(statisticsPort(answer)), message)
  })
})

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
