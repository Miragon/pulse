import { afterEach, describe, expect, it } from "vitest"
import { clientFor, startFakeEngine, type FakeEngine } from "../tools/test-support/fake-engine.js"
import {
  definitionKeyInId,
  definitionKeyResolver,
  fetchDefinitionXml,
  fetchLatestDefinitionXml,
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

  it("is the display parse's source — which shows a bare id as itself", () => {
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

// `GET /process-definition/key/{key}/xml` only finds tenant-less definitions,
// so a tenant deployment had no diagram (#322 follow-up).
describe("fetchLatestDefinitionXml", () => {
  const TENANT_DEFINITION = { id: "leasing:3:t1", key: "leasing", version: 3, tenantId: "acme" }

  async function tenantEngine() {
    const engine = await startFakeEngine({
      "GET /process-definition": (request) => ({
        body: request.query.key === "leasing" ? [TENANT_DEFINITION] : [],
      }),
      "GET /process-definition/leasing:3:t1/xml": {
        body: { id: TENANT_DEFINITION.id, bpmn20Xml: "<definitions id='leasing'/>" },
      },
      // What the tenant-less key endpoint answers for a tenant deployment.
      "GET /process-definition/key/leasing/xml": {
        status: 404,
        body: { type: "InvalidRequestException", message: "No matching definition" },
      },
    })
    engines.push(engine)
    return engine
  }

  it("resolves a tenant-deployed key to its latest version and reads that version's XML by id", async () => {
    const engine = await tenantEngine()

    expect(await fetchLatestDefinitionXml(clientFor(engine), "leasing")).toBe(
      "<definitions id='leasing'/>",
    )
    expect(engine.requests.map((r) => [r.path, r.query])).toEqual([
      [
        "/process-definition",
        {
          key: "leasing",
          latestVersion: "true",
          sortBy: "version",
          sortOrder: "desc",
          maxResults: "1",
        },
      ],
      ["/process-definition/leasing:3:t1/xml", {}],
    ])
  })

  it("is null for a key with no deployed version — and reads no XML", async () => {
    const engine = await tenantEngine()
    expect(await fetchLatestDefinitionXml(clientFor(engine), "unknown")).toBeNull()
    expect(engine.requests.map((r) => r.path)).toEqual(["/process-definition"])
  })

  it("propagates a failed read — the caller decides whether the diagram is enrichment", async () => {
    const engine = await startFakeEngine({
      "GET /process-definition": { status: 500, body: { message: "db down" } },
    })
    engines.push(engine)
    await expect(fetchLatestDefinitionXml(clientFor(engine), "leasing")).rejects.toThrow()
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
