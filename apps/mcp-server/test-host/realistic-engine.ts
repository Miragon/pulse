/**
 * The REALISTIC engine of the host simulation (`/realistic/engine-rest`): the
 * shapes a real CIB seven answers with, sized like the playground — long
 * process names and keys, 160 running instances (a third without a business
 * key, long keys on the rest, a third with an incident, some suspended), 73
 * jobs on one activity with long and short error messages. The fixture
 * engine's short rows let a list fit any budget; these make the inline fit
 * (#396) prove itself on the row heights a chat really gets.
 */

export const REALISTIC_PREFIX = "/realistic"

interface Definition {
  id: string
  key: string
  name: string
  version: number
}

const UUID_TAIL = "c64b-11f1-82a7-06a9f4016af1"

const DEFINITIONS: Definition[] = [
  {
    id: "assessCreditworthiness:1:a1",
    key: "assessCreditworthiness",
    name: "Assess Customer credebility",
    version: 1,
  },
  {
    id: "miraveloLeasing:1:b1",
    key: "miraveloLeasing",
    name: "Miravelo - Bike Leasing",
    version: 1,
  },
  {
    id: "miraveloLeasing:2:b2",
    key: "miraveloLeasing",
    name: "Miravelo - Bike Leasing (v2)",
    version: 2,
  },
  {
    id: "kreditantragPruefen:3:c3",
    key: "kreditantragPruefen",
    name: "Kreditantrag prüfen und Bonität bewerten (Privatkunden)",
    version: 3,
  },
]

const hex8 = (n: number) => (0x01325deb + n * 0x0a1b2c3).toString(16).padStart(8, "0").slice(-8)

interface Instance {
  id: string
  definitionId: string
  businessKey: string | null
  suspended: boolean
  hasIncident: boolean
}

const INSTANCES: Instance[] = Array.from({ length: 160 }, (_, i) => ({
  id: `${hex8(i)}-${UUID_TAIL}`,
  definitionId: DEFINITIONS[i % DEFINITIONS.length].id,
  businessKey:
    i % 8 < 3
      ? null
      : i % 2 === 0
        ? `LEA-2026-${String(i).padStart(5, "0")}-RENEWAL-DE`
        : `CUST-${12000 + i * 7}`,
  suspended: i % 17 === 0,
  hasIncident: i % 3 === 0,
}))

const LONG_MESSAGE =
  "Blacklist provider unreachable (simulated): connection to https://blacklist.example.internal/api/v2/check timed out after 30000 ms while resolving the customer's credit record; the provider answered 503 Service Unavailable three times in a row, the circuit breaker is open and the next attempt is scheduled by the job executor once the retry time cycle allows it again."

const JOBS = Array.from({ length: 73 }, (_, i) => ({
  id: `job-${String(i).padStart(3, "0")}`,
  processInstanceId: INSTANCES[(i * 3) % INSTANCES.length].id,
  processDefinitionKey: "assessCreditworthiness",
  processDefinitionId: "assessCreditworthiness:1:a1",
  failedActivityId: "Activity_CheckBlacklist",
  retries: i === 72 ? 2 : 0,
  exceptionMessage: i === 5 ? LONG_MESSAGE : "Blacklist provider unreachable (simulated)",
  dueDate: null,
  suspended: false,
  priority: 0,
  createTime: "2026-10-12T21:02:00.000+0000",
}))

const CREDIT_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="assessCreditworthiness" name="Assess Customer credebility" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Application received" />
    <bpmn:serviceTask id="Activity_CheckBlacklist" name="Check blacklist" />
    <bpmn:endEvent id="EndEvent_1" name="Assessed" />
  </bpmn:process>
</bpmn:definitions>`

type Reply = { status: number; body: unknown }
type Filter = Record<string, unknown>

const ok = (body: unknown): Reply => ({ status: 200, body })

function definitionOf(id: string): Definition | undefined {
  return DEFINITIONS.find((d) => d.id === id)
}

/** The process-instance filters the list sends (POST body, or GET query for the flags). */
function matches(instance: Instance, filter: Filter): boolean {
  const key = filter.processDefinitionKey
  if (typeof key === "string" && definitionOf(instance.definitionId)?.key !== key) return false
  if (filter.withIncident === true || filter.withIncident === "true") {
    if (!instance.hasIncident) return false
  }
  if (filter.suspended === true && !instance.suspended) return false
  if (filter.active === true && instance.suspended) return false
  const ids = filter.processInstanceIds
  if (typeof ids === "string" && !ids.split(",").includes(instance.id)) return false
  const or = filter.orQueries as
    Array<{ businessKeyLike?: string; processInstanceIds?: string[] }> | undefined
  if (or?.[0]) {
    const term = (or[0].businessKeyLike ?? "").replaceAll("%", "")
    const byKey = !!instance.businessKey?.includes(term)
    if (!byKey && !(or[0].processInstanceIds ?? []).includes(instance.id)) return false
  }
  return true
}

/** By business key (no key first, as a database sorts NULL), the id breaking ties. */
function byBusinessKey(a: Instance, b: Instance): number {
  const ka = a.businessKey ?? ""
  const kb = b.businessKey ?? ""
  return ka === kb ? a.id.localeCompare(b.id) : ka.localeCompare(kb)
}

function page<T>(rows: T[], url: URL): T[] {
  const first = Number(url.searchParams.get("firstResult") ?? 0)
  const max = Number(url.searchParams.get("maxResults") ?? rows.length)
  return rows.slice(first, first + max)
}

const instanceRow = (i: Instance) => ({
  id: i.id,
  definitionId: i.definitionId,
  businessKey: i.businessKey,
  suspended: i.suspended,
})

function instanceRoute(method: string, path: string, url: URL, body: Filter): Reply | null {
  if (path === "/process-instance/count" && method === "POST") {
    return ok({ count: INSTANCES.filter((i) => matches(i, body)).length })
  }
  if (path === "/process-instance" && method === "POST") {
    const rows = INSTANCES.filter((i) => matches(i, body)).sort(byBusinessKey)
    return ok(page(rows, url).map(instanceRow))
  }
  if (path === "/process-instance" && method === "GET") {
    const filter = Object.fromEntries(url.searchParams)
    return ok(
      page(
        INSTANCES.filter((i) => matches(i, filter)),
        url,
      ).map(instanceRow),
    )
  }
  return null
}

function definitionRoute(path: string, url: URL): Reply | null {
  if (path === "/process-definition") {
    const ids = url.searchParams.get("processDefinitionIdIn")?.split(",")
    const key = url.searchParams.get("key")
    let rows = DEFINITIONS.filter((d) => (!ids || ids.includes(d.id)) && (!key || d.key === key))
    if (url.searchParams.get("latestVersion") === "true") {
      rows = rows.filter((d) => !DEFINITIONS.some((o) => o.key === d.key && o.version > d.version))
    }
    return ok(rows)
  }
  if (path === "/process-definition/statistics") return ok([])
  const xml = /^\/process-definition\/([^/]+)\/xml$/.exec(path)
  if (xml) {
    const id = decodeURIComponent(xml[1])
    return id === "assessCreditworthiness:1:a1"
      ? ok({ id, bpmn20Xml: CREDIT_BPMN })
      : { status: 404, body: { type: "RestException", message: `No diagram for ${id}` } }
  }
  return null
}

function jobRoute(method: string, path: string, url: URL, body: Filter): Reply | null {
  const wanted = (filter: Filter) =>
    JOBS.filter(
      (j) => (filter.noRetriesLeft !== true && filter.noRetriesLeft !== "true") || j.retries === 0,
    ).filter(
      (j) => !filter.processDefinitionKey || j.processDefinitionKey === filter.processDefinitionKey,
    )
  if (path === "/job/count" && method === "GET") {
    return ok({ count: wanted(Object.fromEntries(url.searchParams)).length })
  }
  if (path === "/job" && method === "POST") return ok(page(wanted(body), url))
  return null
}

/** The realistic engine's answer to a request under {@link REALISTIC_PREFIX}, or null. */
export function realisticRoute(method: string, url: URL, requestBody: unknown): Reply | null {
  const prefix = `${REALISTIC_PREFIX}/engine-rest`
  if (!url.pathname.startsWith(prefix)) return null
  const path = url.pathname.slice(prefix.length)
  const body = (requestBody ?? {}) as Filter
  return (
    instanceRoute(method, path, url, body) ??
    definitionRoute(path, url) ??
    jobRoute(method, path, url, body) ?? {
      status: 404,
      body: { type: "InvalidRequestException", message: `realistic engine has no ${path}` },
    }
  )
}
