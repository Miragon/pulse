import { afterEach, describe, expect, it } from "vitest"
import { clientFor, startFakeEngine, type FakeEngine } from "../tools/test-support/fake-engine.js"
import {
  definitionKeyInId,
  definitionKeyResolver,
  fetchDefinitionVersions,
  fetchDefinitionXml,
  fetchVersionIdsDeployedAfter,
  foldStatsByKey,
  processDefinitionKeyFromId,
  resolveDefinitionKeys,
} from "./definition-info.js"

// Past 64 chars the engine stores a bare id; a UUID parsed as a key matches no filter.

const LONG_KEY = "customerOnboardingApprovalProcess"
const UUID = "6f1c2a9e-0b7d-4c33-9a51-3d2e8f40b7aa"
const STATS = [{ id: UUID, definition: { id: UUID, key: LONG_KEY, version: 1 } }]

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

describe("definitionKeyInId", () => {
  it("names the key of a key:version:deployment id, and none for a bare id", () => {
    expect(definitionKeyInId("order:2:d2")).toBe("order")
    expect(definitionKeyInId(UUID)).toBeNull()
    // No key is empty: a leading ":" names none either.
    expect(definitionKeyInId(":2:d2")).toBeNull()
  })

  it("is the display parse's source, which shows a bare id as itself", () => {
    expect(processDefinitionKeyFromId("order:2:d2")).toBe("order")
    expect(processDefinitionKeyFromId(UUID)).toBe(UUID)
  })
})

describe("definitionKeyResolver", () => {
  it("resolves a listed bare id, parses an unlisted keyed id, and never returns a UUID", () => {
    const keyOf = definitionKeyResolver(foldStatsByKey(STATS))
    expect(keyOf(UUID)).toBe(LONG_KEY)
    expect(keyOf("order:3:d3")).toBe("order")
    expect(keyOf("0d9e8f7a-0000-4000-8000-000000000000")).toBeNull()
  })
})

describe("resolveDefinitionKeys", () => {
  async function engineWithStats() {
    const engine = await startFakeEngine({
      "GET /process-definition/statistics": { body: STATS },
    })
    engines.push(engine)
    return engine
  }

  it("reads the statistics ONCE, and only when an id is bare", async () => {
    const engine = await engineWithStats()

    const parsed = await resolveDefinitionKeys(clientFor(engine), ["order:2:d2", null, undefined])
    expect(parsed("order:2:d2")).toBe("order")
    expect(engine.requests).toEqual([])

    const resolved = await resolveDefinitionKeys(clientFor(engine), ["order:2:d2", UUID, UUID])
    expect(resolved(UUID)).toBe(LONG_KEY)
    expect(resolved("order:2:d2")).toBe("order")
    expect(engine.requests.map((r) => r.path)).toEqual(["/process-definition/statistics"])
  })
})

describe("fetchDefinitionVersions", () => {
  it("lists every version of the key over every tenant, newest first, uncapped", async () => {
    const engine = await startFakeEngine({
      "GET /process-definition": {
        body: [
          { id: "leasing:3:t1", key: "leasing", version: 3, tenantId: "acme" },
          // How long its history stays: the throughput window never claims more.
          { id: "leasing:2:d2", key: "leasing", name: "Leasing", version: 2, historyTimeToLive: 7 },
          // A row without an id names no version to read.
          { key: "leasing", version: 1 },
        ],
      },
    })
    engines.push(engine)

    expect(await fetchDefinitionVersions(clientFor(engine), "leasing")).toEqual([
      {
        id: "leasing:3:t1",
        key: "leasing",
        name: null,
        version: 3,
        historyTimeToLive: null,
        tenantId: "acme",
      },
      {
        id: "leasing:2:d2",
        key: "leasing",
        name: "Leasing",
        version: 2,
        historyTimeToLive: 7,
        tenantId: null,
      },
    ])
    // Key-scoped: never the engine-wide statistics, never a capped page.
    expect(engine.requests.map((r) => [r.path, r.query])).toEqual([
      ["/process-definition", { key: "leasing", sortBy: "version", sortOrder: "desc" }],
    ])
  })

  it("propagates a failed read", async () => {
    const engine = await startFakeEngine({
      "GET /process-definition": { status: 500, body: { message: "db down" } },
    })
    engines.push(engine)
    await expect(fetchDefinitionVersions(clientFor(engine), "leasing")).rejects.toThrow()
  })
})

describe("fetchVersionIdsDeployedAfter", () => {
  it("asks the key's versions deployed after a time, over every tenant, uncapped", async () => {
    const engine = await startFakeEngine({
      "GET /process-definition": {
        body: [
          { id: "leasing:3:t1", key: "leasing", version: 3, tenantId: "acme" },
          { id: "leasing:2:d2", key: "leasing", version: 2 },
          { key: "leasing", version: 1 },
        ],
      },
    })
    engines.push(engine)
    const since = "2026-10-09T11:00:00.000+0000"

    expect(await fetchVersionIdsDeployedAfter(clientFor(engine), "leasing", since)).toEqual(
      new Set(["leasing:3:t1", "leasing:2:d2"]),
    )
    expect(engine.requests.map((r) => [r.path, r.query])).toEqual([
      ["/process-definition", { key: "leasing", deployedAfter: since }],
    ])
  })

  it("propagates a failed read", async () => {
    const engine = await startFakeEngine({
      "GET /process-definition": { status: 500, body: { message: "db down" } },
    })
    engines.push(engine)
    await expect(
      fetchVersionIdsDeployedAfter(clientFor(engine), "leasing", "2026-10-09T11:00:00.000+0000"),
    ).rejects.toThrow()
  })
})

describe("fetchDefinitionXml", () => {
  it("reads one version's XML by id; a reply without XML is null", async () => {
    const engine = await startFakeEngine({
      "GET /process-definition/order:2:d2/xml": { body: { id: "order:2:d2", bpmn20Xml: "<x/>" } },
      "GET /process-definition/order:1:d1/xml": { body: { id: "order:1:d1" } },
      "GET /process-definition/order:0:d0/xml": { body: null },
    })
    engines.push(engine)
    expect(await fetchDefinitionXml(clientFor(engine), "order:2:d2")).toBe("<x/>")
    expect(await fetchDefinitionXml(clientFor(engine), "order:1:d1")).toBeNull()
    expect(await fetchDefinitionXml(clientFor(engine), "order:0:d0")).toBeNull()
  })
})
