import { afterEach, describe, expect, it } from "vitest"
import {
  clientFor,
  type FakeEngine,
  type FakeRoutes,
  type RecordedRequest,
  startFakeEngine,
} from "../tools/test-support/fake-engine.js"
import { buildClusterDetailData } from "./cluster-detail-data.js"
import { type IncidentLike, UNKNOWN } from "./cluster-scan.js"
import { clusterProcessOf } from "./cluster-process.js"

// F17b: a cluster's "View process" opens the process its incidents lie in, its key in its
// versions' tenant, never the incident's (a tenant id provider gives a shared version's run one).

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** The world's versions of `label`: none's, shared (no tenant, its runs given one), south's. */
const VERSIONS = [
  { id: "label:1:none", key: "label", version: 1 },
  { id: "label:1:south", key: "label", version: 1, tenantId: "south" },
  { id: "label:2:south", key: "label", version: 2, tenantId: "south" },
  { id: "label:1:north", key: "label", version: 1, tenantId: "north" },
]

async function engineWith(routes: FakeRoutes = {}) {
  const engine = await startFakeEngine({
    "GET /process-definition": (r: RecordedRequest) => {
      const ids = r.query.processDefinitionIdIn?.split(",") ?? []
      return { body: VERSIONS.filter((version) => ids.includes(version.id)) }
    },
    ...routes,
  })
  engines.push(engine)
  return { engine, client: clientFor(engine) }
}

const at = (processDefinitionId: string, tenantId?: string): IncidentLike => ({
  id: `inc-${processDefinitionId}-${tenantId ?? "none"}`,
  processDefinitionId,
  ...(tenantId === undefined ? {} : { tenantId }),
})
const keyOf = () => "label"

describe("clusterProcessOf: the process a cluster lies in", () => {
  it("is its key's process without a tenant where no incident names one, reading nothing", async () => {
    const { engine, client } = await engineWith()

    const process = await clusterProcessOf(client, [at("label:1:none")], keyOf)

    expect(process).toEqual({ processDefinitionKey: "label" })
    expect(engine.requests).toEqual([])
  })

  it("is its versions' tenant where incidents name one, read once by their ids", async () => {
    const { engine, client } = await engineWith()

    const south = [at("label:1:south", "south"), at("label:2:south", "south")]
    expect(await clusterProcessOf(client, south, keyOf)).toEqual({
      processDefinitionKey: "label",
      tenantId: "south",
    })
    expect(engine.requests.map((r) => r.query.processDefinitionIdIn)).toEqual([
      "label:1:south,label:2:south",
    ])
  })

  it("is the version's tenant, never the one a tenant id provider gave the incident's run", async () => {
    const { client } = await engineWith()

    const shared = [at("label:1:none", "acme"), at("label:1:none")]
    expect(await clusterProcessOf(client, shared, keyOf)).toEqual({ processDefinitionKey: "label" })
  })

  it("is none where the incidents lie in two processes, name no key or their versions are unread", async () => {
    const { client } = await engineWith()
    const failing = await engineWith({ "GET /process-definition": { status: 500, body: {} } })

    const twoTenants = [at("label:1:south", "south"), at("label:1:north", "north")]
    expect(await clusterProcessOf(client, twoTenants, keyOf)).toBeNull()
    const noneAndNorth = [at("label:1:none"), at("label:1:north", "north")]
    expect(await clusterProcessOf(client, noneAndNorth, keyOf)).toBeNull()
    expect(await clusterProcessOf(client, [at("x:1:y")], () => UNKNOWN)).toBeNull()
    expect(await clusterProcessOf(client, [], keyOf)).toBeNull()
    expect(await clusterProcessOf(client, [at("label:9:gone", "south")], keyOf)).toBeNull()
    const south = [at("label:1:south", "south")]
    expect(await clusterProcessOf(failing.client, south, keyOf)).toBeNull()
  })

  it("names the cluster's process in its detail, a key in its tenant", async () => {
    const { client } = await engineWith({
      "GET /incident": {
        body: [
          {
            ...at("label:2:south", "south"),
            activityId: "work",
            incidentType: "failedJob",
            rootCauseIncidentId: "inc-label:2:south-south",
            incidentTimestamp: "2026-11-27T08:00:00.000+0000",
          },
        ],
      },
    })

    const data = await buildClusterDetailData(client, "fake", {
      activityId: "work",
      incidentType: "failedJob",
    })

    expect(data.processDefinitionKeys).toEqual(["label"])
    expect(data.process).toEqual({ processDefinitionKey: "label", tenantId: "south" })
  })
})
