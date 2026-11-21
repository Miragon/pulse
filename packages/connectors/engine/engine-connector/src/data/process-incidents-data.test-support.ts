import { afterEach } from "vitest"
import { cibsevenProvider } from "../providers/index.js"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
} from "../tools/test-support/fake-engine.js"
import { buildProcessIncidentsData } from "./process-incidents-data.js"

// #335 N60: every number spans all versions. Fixture: `leasing` v1 still runs next to v2.

export const engines: FakeEngine[] = []

/** Each test file that starts fake engines closes them after each test. */
export function closeEnginesAfterEach(): void {
  afterEach(async () => {
    await Promise.all(engines.splice(0).map((engine) => engine.close()))
  })
}

export const KEY = "leasing"
export const V1 = "leasing:1:d1"
export const V2 = "leasing:2:d2"
const XML =
  '<definitions><process id="leasing"><serviceTask id="assess" name="Assess creditworthiness"/><serviceTask id="sendPolicy" name="Send policy"/></process></definitions>'

const TENANT_LESS_404 = {
  status: 404,
  body: {
    type: "InvalidRequestException",
    message: `No matching process definition with key: ${KEY} and no tenant-id`,
  },
}

export const row = (n: number, activityId: string, definitionId: string) => ({
  id: `inc-${activityId}-${n}`,
  processDefinitionId: definitionId,
  processInstanceId: `pi-${activityId}-${n}`,
  activityId,
  incidentType: "failedJob",
  incidentMessage: `${activityId} failed`,
  // Newest first, one minute apart.
  incidentTimestamp: new Date(Date.UTC(2026, 9, 10, 12, 0) - n * 60_000).toISOString(),
  configuration: `job-${n}`,
})

/**
 * The engine's statistics with `rootIncidents=true`: the key's root incidents on its latest
 * version, none of another key.
 */
const rootStatistics = (rootIncidents: number) => ({
  id: V2,
  instances: 0,
  incidents: rootIncidents ? [{ incidentType: "failedJob", incidentCount: rootIncidents }] : [],
  definition: { id: V2, key: KEY, name: "Leasing", version: 2 },
})

// `rootIncidents` is what the definition statistics count for the key.
export function definitionRoutes(scan: unknown[], rootIncidents: number): FakeRoutes {
  return {
    // The key's latest version over every tenant (the list endpoint).
    "GET /process-definition": {
      body: [{ id: V2, key: KEY, name: "Leasing", version: 2, tenantId: "acme" }],
    },
    // What the engine answers a tenant deployment on the tenant-less endpoints.
    [`GET /process-definition/key/${KEY}`]: TENANT_LESS_404,
    [`GET /process-definition/key/${KEY}/xml`]: TENANT_LESS_404,
    [`GET /process-definition/${V2}/xml`]: { body: { id: V2, bpmn20Xml: XML } },
    "GET /process-instance/count": { body: { count: 99 } },
    "GET /job/count": { body: { count: 6 } },
    "GET /process-definition/statistics": { body: [rootStatistics(rootIncidents)] },
    "GET /incident": { body: scan },
  }
}

export async function build(routes: FakeRoutes) {
  const engine = await startFakeEngine(routes, { body: [] })
  engines.push(engine)
  const data = await buildProcessIncidentsData(clientFor(engine), {
    baseUrl: engine.baseUrl,
    provider: cibsevenProvider,
    processDefinitionKey: KEY,
  })
  return { data, requests: engine.requests }
}
