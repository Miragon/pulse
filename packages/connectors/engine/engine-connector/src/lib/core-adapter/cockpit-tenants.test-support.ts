/**
 * The chat cockpit on a key in two tenants (F17b), a case c7-runtime.engine.test.ts runs on its
 * seeded engine through tenant-world.test-support.ts: the read world deploys `pulse-label` without
 * a tenant (its instances, incidents and failed jobs), the kit's tenant world once more in
 * pulse-north and twice in pulse-south, and the case starts two instances in pulse-south (by the
 * key in the tenant, on its latest version), which fail into root incidents at the label's render
 * as the read world's do. Opened per tenant, the cockpit's process route, its flow (Running and
 * Throughput), an activity's incidents and the lists of its runs read that tenant's alone: south
 * its two instances, incidents and jobs without retries on its latest version, north none, and
 * none of the read world's; the overview lists a row per tenant. Opened by the key alone, the route
 * reads the process without a tenant exactly as it read it while the key had no tenant at all.
 */

import { isRootIncident } from "@miragon/pulse-c7-core"
import { C7_BOARD_ENGINE } from "@miragon/pulse-c7-core/testing"
import type { DefinitionId } from "@miragon/pulse-engine-core"
import { WORLD_ELEMENT, WORLD_PROCESS, WORLD_TENANT } from "@miragon/pulse-engine-core/testing"
import { expect } from "vitest"
import { buildActivityIncidentsData } from "../../data/activity-incidents-data.js"
import { buildActivityStatisticsData } from "../../data/activity-statistics-data.js"
import {
  buildCockpitDashboardData,
  buildJobPanelData,
  buildProcessInstancesData,
} from "../../data/cockpit-data.js"
import { buildProcessIncidentsData } from "../../data/process-incidents-data.js"
import { providerForEntry } from "../../providers/index.js"
import {
  createEngineRegistry,
  type ResolvedEngine,
  resolveEngine,
} from "../engine/resolve-engine.js"
import type { ContractSuite } from "./contract-cases.test-support.js"
import { engineImageOf } from "./engine-image.test-support.js"

/**
 * The board's engine at the suite's url on a registry of its own: its floors are empty, so its
 * reads see the deployments of the case (they reach the engine past the server's client, which
 * would drop its floors).
 */
function freshEngineAt(url: string): ResolvedEngine {
  const image = engineImageOf(process.env.PULSE_ENGINE_IMAGE)
  const entry = {
    id: C7_BOARD_ENGINE.engine,
    baseUrl: url,
    flavor: image.dialect === "c7" ? image.flavor : "operaton",
  }
  const registry = createEngineRegistry([entry], (e) =>
    providerForEntry(e).createClient(e, { type: "none" }),
  )
  return resolveEngine(entry.id, registry)
}

/** The process route of the label in `tenantId` (the key alone without one), its time left out. */
async function processRoute(engine: ResolvedEngine, tenantId?: string) {
  const data = await buildProcessIncidentsData(engine.client, {
    baseUrl: engine.baseUrl,
    provider: engine.provider,
    processDefinitionKey: WORLD_PROCESS.label,
    ...(tenantId === undefined ? {} : { tenantId }),
  })
  // When it was read differs between two reads of the same numbers.
  return { ...data, fetchedAt: undefined }
}

/** The label's process route before the tenants came: the process without a tenant, alone. */
export function cockpitBeforeTenants(suite: ContractSuite) {
  return processRoute(suite.resolve(C7_BOARD_ENGINE.engine))
}

/** The ids of the tenant world's versions by their alias. */
type TenantVersions = Readonly<Record<"north/label@1" | "south/label@2", DefinitionId>>

/** The instances the case starts in pulse-south, each failing into a root incident. */
const SOUTH_RUNS = 2

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Starts `count` instances of the label by its key in `tenantId` (its latest version there) and
 * waits, two minutes at most, until each holds its root incident at the render.
 */
async function startFailingIn(url: string, tenantId: string, count: number): Promise<void> {
  const key = WORLD_PROCESS.label
  for (let n = 0; n < count; n += 1) {
    const response = await fetch(
      `${url}/process-definition/key/${key}/tenant-id/${tenantId}/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessKey: `${tenantId}-${String(n)}` }),
      },
    )
    if (!response.ok) throw new Error(`starting ${key} in ${tenantId}: HTTP ${response.status}`)
  }
  const incidents = `${url}/incident?processDefinitionKeyIn=${key}&tenantIdIn=${tenantId}`
  for (let waited = 0; waited <= 120_000; waited += 1_000) {
    const rows = (await (await fetch(incidents)).json()) as Parameters<typeof isRootIncident>[0][]
    if (rows.filter(isRootIncident).length >= count) return
    await sleep(1_000)
  }
  throw new Error(`${key} in ${tenantId} holds no ${count} root incidents after two minutes`)
}

/** Each tenant's process of the label: its latest version and its own numbers alone. */
async function eachTenantItsOwn(engine: ResolvedEngine, versions: TenantVersions) {
  const south = await processRoute(engine, WORLD_TENANT.south)
  const north = await processRoute(engine, WORLD_TENANT.north)
  expect(south).toMatchObject({
    tenantId: WORLD_TENANT.south,
    sharesKey: true,
    diagramVersion: 2,
    diagramDefinitionId: versions["south/label@2"],
    runningInstances: SOUTH_RUNS,
    incidentCount: SOUTH_RUNS,
    failedJobs: SOUTH_RUNS,
  })
  // Its incidents' group at the render, every fact of it from its own scan.
  expect(south.activities).toHaveLength(1)
  const [render] = south.activities
  expect(render).toMatchObject({ activityId: WORLD_ELEMENT.renderLabel, incidentCount: SOUTH_RUNS })
  const facts = [render?.representativeMessage, render?.firstSeen, render?.latestIncident]
  expect(facts.every((fact) => typeof fact === "string")).toBe(true)
  expect(north).toMatchObject({
    tenantId: WORLD_TENANT.north,
    diagramVersion: 1,
    diagramDefinitionId: versions["north/label@1"],
    runningInstances: 0,
    incidentCount: 0,
    failedJobs: 0,
    activities: [],
  })
}

/** The label's flow in `tenantId`: what runs at each element now, and what started in the window. */
async function flowIn(engine: ResolvedEngine, tenantId: string) {
  const process = { processDefinitionKey: WORLD_PROCESS.label, tenantId }
  const [running, throughput] = await Promise.all([
    buildActivityStatisticsData(engine.client, { ...process, source: "runtime" }),
    buildActivityStatisticsData(engine.client, { ...process, source: "history" }),
  ])
  return { running, throughput }
}

/** Each tenant's flow: south's two instances at the render on its two versions, north's none. */
async function eachFlowItsOwn(engine: ResolvedEngine) {
  const south = await flowIn(engine, WORLD_TENANT.south)
  expect(south.running).toMatchObject({
    tenantId: WORLD_TENANT.south,
    versionCount: 2,
    activities: [
      expect.objectContaining({
        activityId: WORLD_ELEMENT.renderLabel,
        incidents: SOUTH_RUNS,
        failedJobs: SOUTH_RUNS,
      }),
    ],
  })
  expect(south.throughput).toMatchObject({ tenantId: WORLD_TENANT.south })
  expect(south.throughput).toHaveProperty("instanceCount", SOUTH_RUNS)
  const north = await flowIn(engine, WORLD_TENANT.north)
  expect(north.running).toMatchObject({ versionCount: 1, activities: [] })
  expect(north.throughput).toHaveProperty("instanceCount", 0)
}

/**
 * The lists of the label's runs per tenant, as the process view's drills open them (`onlyTenant`)
 * where the key holds other processes: south's two instances and jobs without retries, north's
 * none, the process without a tenant's as its view counts them.
 */
async function eachListItsOwn(
  engine: ResolvedEngine,
  before: Awaited<ReturnType<typeof cockpitBeforeTenants>>,
) {
  const listed = async (onlyTenant: string | null) => {
    const scope = { processDefinitionKey: WORLD_PROCESS.label, onlyTenant }
    const [instances, jobs] = await Promise.all([
      buildProcessInstancesData(engine.client, engine.engineId, scope),
      buildJobPanelData(engine.client, engine.engineId, { ...scope, failedOnly: true }),
    ])
    return [instances.totalCount, jobs.failedCount]
  }
  expect(await listed(WORLD_TENANT.south)).toEqual([SOUTH_RUNS, SOUTH_RUNS])
  expect(await listed(WORLD_TENANT.north)).toEqual([0, 0])
  expect(await listed(null)).toEqual([before.runningInstances, before.failedJobs])
}

/**
 * After the tenant world's deployments and south's failing runs: the key alone reads the process
 * without a tenant as `before` (its numbers, incidents and their activities), each tenant its own,
 * in its route, flow and lists, an activity's incidents the read world's only where no tenant is
 * named and south's two in south, and the overview a row per tenant.
 */
export async function cockpitPerTenant(
  suite: ContractSuite,
  before: Awaited<ReturnType<typeof cockpitBeforeTenants>>,
  versions: TenantVersions,
): Promise<void> {
  await startFailingIn(suite.url, WORLD_TENANT.south, SOUTH_RUNS)
  const engine = freshEngineAt(suite.url)
  const keyAlone = await processRoute(engine)
  expect({ ...keyAlone, sharesKey: undefined }).toEqual(before)
  expect(keyAlone).toMatchObject({ sharesKey: true })
  expect(keyAlone.tenantId).toBeUndefined()
  await eachTenantItsOwn(engine, versions)
  await eachFlowItsOwn(engine)
  await eachListItsOwn(engine, before)
  const [element] = before.activities
  const page = (tenantId?: string) =>
    buildActivityIncidentsData(engine.client, {
      baseUrl: engine.baseUrl,
      provider: engine.provider,
      processDefinitionKey: WORLD_PROCESS.label,
      ...(tenantId === undefined ? {} : { tenantId }),
      activityId: element?.activityId ?? WORLD_ELEMENT.renderLabel,
    })
  expect((await page()).totalCount).toBe(element?.incidentCount ?? 0)
  const south = await page(WORLD_TENANT.south)
  expect(south.incidents).toHaveLength(SOUTH_RUNS)
  expect(south.totalCount).toBe(SOUTH_RUNS)
  const overview = await buildCockpitDashboardData(engine.client, engine.engineId)
  const labels = overview.definitions.filter(({ key }) => key === WORLD_PROCESS.label)
  expect(labels.map(({ tenantId }) => tenantId ?? null).sort()).toEqual(
    [null, WORLD_TENANT.north, WORLD_TENANT.south].sort(),
  )
  expect(labels.find(({ tenantId }) => tenantId === WORLD_TENANT.south)).toMatchObject({
    instances: SOUTH_RUNS,
    sharesKey: true,
  })
}
