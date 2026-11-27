/**
 * A key in three processes for the cockpit's tenant cases (F17b): `label` deployed without a tenant
 * (v1), in `north` (v1) and in `south` (v1 and v2), each process with numbers of its own, so a view
 * that folds the key over its tenants shows a sum no process has. The fake engine answers the reads
 * of the process route, its flow, an activity's page, the overview and the lists, the latest
 * version per tenant (`latestVersion=true`), the incidents by a version's id, and the tenant
 * filters of the counts and lists as Camunda 7 does (`tenantIdIn`, `withoutTenantId`, by the
 * tenant a run carries: its version's, or one a tenant id provider gave a shared version's runs).
 */

import { afterEach } from "vitest"
import {
  clientFor,
  type FakeEngine,
  type FakeReply,
  type RecordedRequest,
  startFakeEngine,
} from "../tools/test-support/fake-engine.js"

export const KEY = "label"
export const ELEMENT = "work"

/** A deployed version of the key: its id, tenant (null for none) and number. */
export interface Version {
  readonly id: string
  readonly tenantId: string | null
  readonly version: number
  /** Its running instances, its jobs without retries and its root incidents at the element. */
  readonly running: number
  readonly failedJobs: number
  readonly incidents: number
  /** The tenant its runs carry where it is not its own (a tenant id provider's, shared version). */
  readonly runTenant?: string
  /** How many minutes before the world's instant its newest incident was raised. */
  readonly incidentsAgo?: number
}

export const NONE: Version = {
  id: "label:1:none",
  tenantId: null,
  version: 1,
  running: 1,
  failedJobs: 0,
  incidents: 0,
}
export const NORTH: Version = {
  id: "label:1:north",
  tenantId: "north",
  version: 1,
  running: 2,
  failedJobs: 1,
  incidents: 1,
}
const SOUTH_1: Version = {
  id: "label:1:south",
  tenantId: "south",
  version: 1,
  running: 3,
  failedJobs: 0,
  incidents: 0,
}
export const SOUTH_2: Version = {
  id: "label:2:south",
  tenantId: "south",
  version: 2,
  running: 4,
  failedJobs: 0,
  incidents: 2,
}

const VERSIONS: readonly Version[] = [NONE, NORTH, SOUTH_1, SOUTH_2]

const XML = `<definitions><process id="${KEY}"><serviceTask id="${ELEMENT}" name="Work"/></process></definitions>`

const definitionRow = ({ id, tenantId, version }: Version) => ({
  id,
  key: KEY,
  name: "Label",
  version,
  ...(tenantId === null ? {} : { tenantId }),
})

/** The root incidents of a version at the element, newest first by their number. */
function incidentsOf(version: Version) {
  const newest = Date.UTC(2026, 10, 27, 8, 0) - (version.incidentsAgo ?? 0) * 60_000
  return Array.from({ length: version.incidents }, (_, n) => {
    const id = `inc-${version.tenantId ?? "none"}-${String(n)}`
    return {
      id,
      processDefinitionId: version.id,
      processInstanceId: `pi-${id}`,
      activityId: ELEMENT,
      incidentType: "failedJob",
      incidentMessage: `${version.tenantId ?? "none"} failed`,
      incidentTimestamp: new Date(newest - n * 60_000).toISOString(),
      configuration: `job-${id}`,
      rootCauseIncidentId: id,
    }
  })
}

/** A request's filters: a GET read's query, a POST read's body. */
function filtersOf({ method, query, body }: RecordedRequest): Readonly<Record<string, unknown>> {
  return method === "POST" && typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)
    : query
}

/** The tenants a read's `tenantIdIn` names, as a list or a comma list. */
function tenantsIn(value: unknown): readonly string[] | undefined {
  if (Array.isArray(value)) return value.map(String)
  return typeof value === "string" ? value.split(",") : undefined
}

/** The versions whose runs a read's tenant filter keeps, by the tenant each run carries. */
function inTenant(versions: readonly Version[], request: RecordedRequest): readonly Version[] {
  const filters = filtersOf(request)
  const runTenant = (v: Version) => v.runTenant ?? v.tenantId
  if (String(filters.withoutTenantId) === "true") return versions.filter((v) => !runTenant(v))
  const tenants = tenantsIn(filters.tenantIdIn)
  return tenants === undefined
    ? versions
    : versions.filter((v) => tenants.includes(runTenant(v) ?? ""))
}

const sum = (versions: readonly Version[], of: (version: Version) => number) =>
  versions.reduce((total, version) => total + of(version), 0)

const byNewest = (left: Version, right: Version) => right.version - left.version

/** A version's incidents per type, as the statistics list them. */
const incidentTypes = ({ incidents }: Version) =>
  incidents > 0 ? [{ incidentType: "failedJob", incidentCount: incidents }] : []

/** The answer to a read of one version by its id (its diagram, its element statistics); none else. */
function versionReply(versions: readonly Version[], path: string): FakeReply | undefined {
  const byId = /^\/process-definition\/([^/]+)\/(xml|statistics)$/.exec(path)
  const version = versions.find(({ id }) => id === byId?.[1])
  if (version === undefined) return undefined
  if (byId?.[2] === "xml") return { body: { id: version.id, bpmn20Xml: XML } }
  const { running: instances, failedJobs } = version
  return { body: [{ id: ELEMENT, instances, failedJobs, incidents: incidentTypes(version) }] }
}

/** The versions a definitions read lists: by their ids, the latest per tenant, or every one. */
function definitionsOf(versions: readonly Version[], query: Readonly<Record<string, string>>) {
  const ids = query.processDefinitionIdIn?.split(",")
  const listed = ids ? versions.filter(({ id }) => ids.includes(id)) : versions
  const latest = (v: Version) =>
    !listed.some((other) => other.tenantId === v.tenantId && other.version > v.version)
  const rows = query.latestVersion === "true" ? listed.filter(latest) : listed
  return [...rows].sort(byNewest).map(definitionRow)
}

/** The open incidents a read finds, newest first: at an activity, of one version, else the key's. */
function incidentsFound(versions: readonly Version[], query: Readonly<Record<string, string>>) {
  const rows = versions
    .filter((v) => query.processDefinitionId === undefined || v.id === query.processDefinitionId)
    .flatMap(incidentsOf)
    .filter((row) => query.activityId === undefined || row.activityId === query.activityId)
    .sort((left, right) => right.incidentTimestamp.localeCompare(left.incidentTimestamp))
  const first = Number(query.firstResult ?? 0)
  return rows.slice(first, first + Number(query.maxResults ?? rows.length))
}

/** The instances a list reads: one per running instance, each with the tenant its run carries. */
const instancesOf = (versions: readonly Version[]) =>
  versions.flatMap((v) =>
    Array.from({ length: v.running }, (_, n) => ({
      id: `pi-${v.id}-${String(n)}`,
      definitionId: v.id,
      ...((v.runTenant ?? v.tenantId) ? { tenantId: v.runTenant ?? v.tenantId } : {}),
    })),
  )

/** The engine's answer to one request of the world of `versions`. */
function replyOf(versions: readonly Version[], request: RecordedRequest): FakeReply {
  const { path, query } = request
  const ofVersion = versionReply(versions, path)
  if (ofVersion) return ofVersion
  const kept = () => inTenant(versions, request)
  switch (path) {
    case "/process-definition":
      return { body: definitionsOf(versions, query) }
    case "/process-definition/statistics":
      return {
        body: versions.map((v) => ({
          id: v.id,
          instances: v.running,
          failedJobs: v.failedJobs,
          incidents: incidentTypes(v),
          definition: definitionRow(v),
        })),
      }
    case "/process-instance/count":
      return { body: { count: sum(kept(), (v) => v.running) } }
    case "/process-instance":
      return { body: instancesOf(kept()) }
    case "/job/count":
      return { body: { count: sum(kept(), (v) => v.failedJobs) } }
    case "/incident":
      return { body: incidentsFound(versions, query) }
    case "/history/process-instance/count":
      return { body: { count: 0 } }
    default:
      return { body: [] }
  }
}

const engines: FakeEngine[] = []

/** Each test file that starts the world closes its engines after each test. */
export function closeTenantWorldsAfterEach(): void {
  afterEach(async () => {
    await Promise.all(engines.splice(0).map((engine) => engine.close()))
  })
}

/** A fake engine of the tenant world (or of the key's `versions`), its client and its requests. */
export async function tenantWorld(versions: readonly Version[] = VERSIONS) {
  const engine = await startFakeEngine({}, (request) => replyOf(versions, request))
  engines.push(engine)
  const requests = engine.requests
  return {
    engine,
    client: clientFor(engine),
    /** The queries of the requests to `path`, in the order they came. */
    queriesOf: (path: string) => requests.filter((r) => r.path === path).map((r) => r.query),
    /** The bodies of the POST requests to `path`. */
    bodiesOf: (path: string) =>
      requests.filter((r) => r.method === "POST" && r.path === path).map((r) => r.body),
  }
}
