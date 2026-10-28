import { afterEach, describe, expect, it } from "vitest"
import { clientFor, startFakeEngine, type FakeEngine } from "../tools/test-support/fake-engine.js"
import {
  elementNameIn,
  fetchDefinitionsById,
  fetchNamesByDefinition,
  nameUnnamedDefinitions,
  NAMED_DEFINITIONS_LIMIT,
  processNameIn,
} from "./definition-info.js"

const LONG_KEY = "customerOnboardingApprovalProcess"
const UUID = "6f1c2a9e-0b7d-4c33-9a51-3d2e8f40b7aa"

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

describe("fetchNamesByDefinition", () => {
  const xml = (process: string) =>
    `<definitions><process id="${process}" name="${process} &amp; co"><task id="t" name="Check"/></process></definitions>`

  it("reads each version's diagram once, at most the limit, and leaves an unreadable one out", async () => {
    const ids = Array.from({ length: NAMED_DEFINITIONS_LIMIT + 2 }, (_, n) => `p${n}:1:d`)
    const engine = await startFakeEngine({
      "GET /process-definition/p0:1:d/xml": { body: { bpmn20Xml: xml("p0") } },
      "GET /process-definition/p1:1:d/xml": { status: 500, body: { message: "boom" } },
      "GET /process-definition/p2:1:d/xml": { body: { bpmn20Xml: null } },
    })
    engines.push(engine)

    const names = await fetchNamesByDefinition(clientFor(engine), [...ids, ids[0], null, undefined])

    // The process is named too: the process's name comes free.
    expect(names.get("p0:1:d")).toEqual({ processes: { p0: "p0 & co" }, elements: { t: "Check" } })
    // Failed and empty diagrams: no entry, so the names behind them are null.
    expect(names.has("p1:1:d")).toBe(false)
    expect(names.has("p2:1:d")).toBe(false)
    const reads = engine.requests.map((r) => r.path)
    expect(reads).toHaveLength(NAMED_DEFINITIONS_LIMIT)
    expect(new Set(reads).size).toBe(NAMED_DEFINITIONS_LIMIT)
    expect(reads).not.toContain(`/process-definition/${ids[NAMED_DEFINITIONS_LIMIT]}/xml`)
  })

  it("reads nothing for no ids", async () => {
    const engine = await startFakeEngine({})
    engines.push(engine)
    expect((await fetchNamesByDefinition(clientFor(engine), [null])).size).toBe(0)
    expect(engine.requests).toEqual([])
  })
})

// What the Modeler writes (#322 U13): a named pool around an unnamed process,
// `&#10;` and `&#38;`; camunda7 used to show them literally.
const MODELER_XML = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Pool" name="Miravelo - Bike Leasing" processRef="miraveloLeasing" />
  </bpmn:collaboration>
  <bpmn:process id="miraveloLeasing" isExecutable="true">
    <bpmn:serviceTask id="Activity_Check" name="Rechnung&#10;prüfen" />
    <bpmn:userTask id="Activity_Approve" name="Prüfen &#38; Freigeben" />
  </bpmn:process>
</bpmn:definitions>`
const LEASING_V1 = "miraveloLeasing:1:d"

describe("names from a Modeler diagram", () => {
  it("names the process by its pool and decodes the references in activity names", async () => {
    const engine = await startFakeEngine({
      [`GET /process-definition/${LEASING_V1}/xml`]: { body: { bpmn20Xml: MODELER_XML } },
    })
    engines.push(engine)

    const names = await fetchNamesByDefinition(clientFor(engine), [LEASING_V1])

    expect(processNameIn(names, LEASING_V1, "miraveloLeasing")).toBe("Miravelo - Bike Leasing")
    expect(elementNameIn(names, LEASING_V1, "Activity_Check")).toBe("Rechnung prüfen")
    expect(elementNameIn(names, LEASING_V1, "Activity_Approve")).toBe("Prüfen & Freigeben")
    // Unknown version, process, element or a missing id: null, the id stands in.
    expect(processNameIn(names, "other:1:d", "miraveloLeasing")).toBeNull()
    expect(processNameIn(names, LEASING_V1, "other")).toBeNull()
    expect(processNameIn(names, LEASING_V1, null)).toBeNull()
    expect(elementNameIn(names, LEASING_V1, "constructor")).toBeNull()
    expect(elementNameIn(names, null, "Activity_Check")).toBeNull()
    expect(elementNameIn(names, LEASING_V1, undefined)).toBeNull()
  })
})

describe("nameUnnamedDefinitions", () => {
  it("names a definition the engine knows by no name from its diagram's pool, in place", async () => {
    const engine = await startFakeEngine({
      [`GET /process-definition/${LEASING_V1}/xml`]: { body: { bpmn20Xml: MODELER_XML } },
      "GET /process-definition/plain:1:d/xml": {
        body: { bpmn20Xml: '<definitions><process id="plain"/></definitions>' },
      },
      "GET /process-definition/broken:1:d/xml": { status: 500, body: { message: "boom" } },
    })
    engines.push(engine)
    const rows = [
      { id: "order:2:d", key: "order", name: "Order" },
      { id: LEASING_V1, key: "miraveloLeasing", name: null },
      { id: "plain:1:d", key: "plain", name: null },
      { id: "broken:1:d", key: "broken", name: null },
      { id: null, key: "bare", name: null },
    ]

    const named = await nameUnnamedDefinitions(clientFor(engine), rows)

    expect(named).toBe(rows)
    expect(rows.map((r) => r.name)).toEqual([
      "Order",
      "Miravelo - Bike Leasing",
      // Named nowhere in its diagram, unreadable, or without a version id: still null.
      null,
      null,
      null,
    ])
    // A named definition costs no read; each unnamed one with an id costs one.
    expect(engine.requests.map((r) => r.path).sort()).toEqual([
      "/process-definition/broken:1:d/xml",
      `/process-definition/${LEASING_V1}/xml`,
      "/process-definition/plain:1:d/xml",
    ])
  })

  it("reads nothing while every definition is named", async () => {
    const engine = await startFakeEngine({})
    engines.push(engine)
    const rows = [{ id: "order:2:d", key: "order", name: "Order" }]
    expect(await nameUnnamedDefinitions(clientFor(engine), rows)).toBe(rows)
    expect(await nameUnnamedDefinitions(clientFor(engine), [])).toEqual([])
    expect(engine.requests).toEqual([])
  })
})

describe("fetchDefinitionsById", () => {
  it("asks once for every distinct id and maps the answer by id", async () => {
    const engine = await startFakeEngine({
      "GET /process-definition": {
        body: [
          { id: "order:2:d2", key: "order", name: "Order", version: 2 },
          { id: UUID, key: LONG_KEY, name: null, version: 1 },
          { key: "row-without-id" },
        ],
      },
    })
    engines.push(engine)

    const byId = await fetchDefinitionsById(clientFor(engine), [
      "order:2:d2",
      UUID,
      "order:2:d2",
      null,
    ])

    expect(engine.requests.map((r) => r.query)).toEqual([
      { processDefinitionIdIn: `order:2:d2,${UUID}`, maxResults: "2" },
    ])
    expect(byId.get("order:2:d2")).toEqual({
      id: "order:2:d2",
      key: "order",
      name: "Order",
      version: 2,
    })
    expect(byId.get(UUID)?.key).toBe(LONG_KEY)
    expect(byId.size).toBe(2)
  })

  it("reads nothing for no ids, and propagates a failed read", async () => {
    const engine = await startFakeEngine({
      "GET /process-definition": { status: 500, body: { message: "boom" } },
    })
    engines.push(engine)
    expect((await fetchDefinitionsById(clientFor(engine), [])).size).toBe(0)
    expect(engine.requests).toEqual([])
    await expect(fetchDefinitionsById(clientFor(engine), ["order:2:d2"])).rejects.toThrow()
  })
})
