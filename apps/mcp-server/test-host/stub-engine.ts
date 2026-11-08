import { readFileSync } from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { REALISTIC_PREFIX, realisticRoute } from "./realistic-engine.js"

export interface StubEngine {
  /** `baseUrl` of the healthy engine (`…/engine-rest`). */
  baseUrl: string
  /** `baseUrl` of an engine that answers every request with a 503. */
  brokenBaseUrl: string
  /** `baseUrl` of the realistic engine (`realistic-engine.ts`): long names, 160 instances, 73 jobs. */
  realisticBaseUrl: string
  /** Origin of the scenario control routes (see {@link startStubEngine}). */
  controlUrl: string
  close(): Promise<void>
}

interface ProcessDefinition {
  id: string
  name: string | null
  key: string
}

const DEFINITIONS = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures", "process-definitions.json"), "utf8"),
) as ProcessDefinition[]

/** The one diagram the stub serves (key `invoice`), for the BPMN canvas scenario. */
const INVOICE_BPMN = readFileSync(
  path.join(import.meta.dirname, "fixtures", "invoice.bpmn"),
  "utf8",
)

/**
 * What runs at each element now (the process flow's "Running"): two instances wait at the
 * invoice's `approveInvoice`; the other definitions run nothing the stub draws.
 */
function activityStatistics(key: string): unknown[] {
  return key === "invoice"
    ? [{ id: "approveInvoice", instances: 2, failedJobs: 0, incidents: [] }]
    : []
}

/** `/process-definition/{id}/{xml|statistics}` of a fixture definition, or null. */
function definitionResource(pathname: string): { status: number; body: unknown } | null {
  const match = /^\/engine-rest\/process-definition\/([^/]+)\/(xml|statistics)$/.exec(pathname)
  if (!match) return null
  const id = decodeURIComponent(match[1])
  const definition = DEFINITIONS.find((d) => d.id === id)
  if (!definition) return { status: 404, body: { type: "RestException", message: `No ${id}` } }
  if (match[2] === "statistics") return { status: 200, body: activityStatistics(definition.key) }
  // The other definitions have no diagram here: their names stay the engine's (enrichment).
  if (definition.key !== "invoice") {
    return { status: 404, body: { type: "RestException", message: `No diagram for ${id}` } }
  }
  return { status: 200, body: { id, bpmn20Xml: INVOICE_BPMN } }
}

/**
 * Per-definition statistics: distinct instance counts (2, 1, 0 in the fixture's order, 3 in
 * all, as `/process-instance/count` says), so the overview's issue-then-instances order is
 * the fixture's; no failed job and no incident.
 */
function definitionStatistics() {
  return DEFINITIONS.map((definition, i) => ({
    id: definition.id,
    instances: DEFINITIONS.length - 1 - i,
    failedJobs: 0,
    incidents: [],
    definition,
  }))
}

/**
 * The overview's engine-wide reads: statistics, the open incidents (none) and the counts; the
 * cross-engine landscape's backlog counts the external tasks (none).
 */
function overviewResource(pathname: string): { status: number; body: unknown } | null {
  switch (pathname) {
    case "/engine-rest/process-definition/statistics":
      return { status: 200, body: definitionStatistics() }
    case "/engine-rest/incident":
      return { status: 200, body: [] }
    case "/engine-rest/incident/count":
    case "/engine-rest/history/process-instance/count":
    case "/engine-rest/external-task/count":
      return { status: 200, body: { count: 0 } }
    case "/engine-rest/process-instance/count":
      return { status: 200, body: { count: 3 } }
    default:
      return null
  }
}

function filterDefinitions(query: URLSearchParams): ProcessDefinition[] {
  const key = query.get("key")
  return DEFINITIONS.filter((d) => !key || d.key === key)
}

function route(url: URL): { status: number; body: unknown } {
  const { pathname, searchParams } = url
  if (pathname.startsWith("/broken/")) {
    return {
      status: 503,
      body: { type: "ProcessEngineException", message: "Engine is shutting down" },
    }
  }
  if (pathname === "/engine-rest/process-definition/count") {
    return { status: 200, body: { count: filterDefinitions(searchParams).length } }
  }
  if (pathname === "/engine-rest/process-definition") {
    const first = Number(searchParams.get("firstResult") ?? 0)
    const max = Number(searchParams.get("maxResults") ?? DEFINITIONS.length)
    return { status: 200, body: filterDefinitions(searchParams).slice(first, first + max) }
  }
  const resource = overviewResource(pathname) ?? definitionResource(pathname)
  if (resource) return resource
  // Unmapped on purpose (and logged): a widget that starts needing another
  // endpoint shows its error state instead of rendering made-up data.
  console.warn(`[host-sim] stub engine: no fixture for ${pathname}`)
  return {
    status: 404,
    body: {
      type: "InvalidRequestException",
      message: `host-sim stub engine has no fixture for ${pathname}`,
    },
  }
}

interface StubJob {
  id: string
  processInstanceId: string
  processDefinitionKey: string
  processDefinitionId: string
  failedActivityId: string
  retries: number
  exceptionMessage: string
  dueDate: null
  suspended: boolean
  priority: number
  createTime: string
}

/** A failed job (no retries left) of the invoice fixture. */
function failedJob(id: string, processInstanceId: string, exceptionMessage: string): StubJob {
  return {
    id,
    processInstanceId,
    processDefinitionKey: "invoice",
    processDefinitionId: "invoice:3:7f1c2a9e-2f4b-11f1-9c7e-0242ac120004",
    failedActivityId: "chargeCard",
    retries: 0,
    exceptionMessage,
    dueDate: null,
    suspended: false,
    priority: 0,
    createTime: "2026-10-10T08:00:00.000+0000",
  }
}

/**
 * The stub's jobs. `job-1` is the write scenario's (`write-refresh.spec.ts`):
 * failed until a retry lands, the one stateful corner of the stub's engine
 * data (the search holds are scenario control), owned by that one scenario.
 * `job-2` and `job-3` are never written: the row menu scenario opens the
 * menu of a row with another row under it.
 */
function stubJobs(): Map<string, StubJob> {
  return new Map(
    [
      failedJob("job-1", "pi-1", "Card declined"),
      failedJob("job-2", "pi-2", "Card expired"),
      failedJob("job-3", "pi-3", "Billing address unknown"),
    ].map((job) => [job.id, job]),
  )
}

/**
 * `/job` reads, the count (GET, query) and the panel's query (POST, its
 * filter in the body), and the retries write; null for every other request.
 * The jobs are active and due now: an executable count takes those with
 * retries left, and none is suspended or due later (the landscape's backlog).
 */
function jobRoute(
  method: string,
  url: URL,
  body: unknown,
  jobs: Map<string, StubJob>,
): { status: number; body: unknown } | null {
  const { pathname, searchParams } = url
  const failedOnly =
    searchParams.get("noRetriesLeft") === "true" ||
    (body as { noRetriesLeft?: unknown } | undefined)?.noRetriesLeft === true
  const executableOnly = searchParams.get("executable") === "true"
  const none = searchParams.get("suspended") === "true" || searchParams.has("dueDates")
  const listed = () =>
    [...jobs.values()].filter(
      (j) => !none && (!failedOnly || j.retries === 0) && (!executableOnly || j.retries > 0),
    )
  if (method === "GET" && pathname === "/engine-rest/job/count") {
    return { status: 200, body: { count: listed().length } }
  }
  if (method === "POST" && pathname === "/engine-rest/job") return { status: 200, body: listed() }
  const retries = /^\/engine-rest\/job\/([^/]+)\/retries$/.exec(pathname)
  const job = retries ? jobs.get(decodeURIComponent(retries[1])) : undefined
  if (method === "PUT" && job) {
    job.retries = Number((body as { retries?: unknown } | undefined)?.retries ?? 0)
    return { status: 204, body: undefined }
  }
  return null
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString("utf8")
  return text ? (JSON.parse(text) as unknown) : undefined
}

/**
 * What a request searches for, without the `%` wildcards and lower-cased ("" = none): an
 * instance search's business key (`orQueries[0]`), or a control route's `term`.
 */
function searchTerm(url: URL, body: unknown): string {
  const businessKeyLike = (body as { orQueries?: Array<{ businessKeyLike?: unknown }> } | undefined)
    ?.orQueries?.[0]?.businessKeyLike
  const term =
    url.searchParams.get("term") ?? (typeof businessKeyLike === "string" ? businessKeyLike : "")
  return term.replaceAll("%", "").toLowerCase()
}

/**
 * Per-term holds on the engine's answers to a search (see
 * {@link startStubEngine}). Counted: a term stays held until EVERY scenario
 * that held it has released it, so two runs of one scenario in parallel
 * (`--repeat-each`) never release each other's in-flight state early.
 */
function createSearchHolds() {
  const held = new Map<string, { holders: number; waiting: Array<() => void> }>()
  return {
    hold(term: string): void {
      const entry = held.get(term) ?? { holders: 0, waiting: [] }
      entry.holders += 1
      held.set(term, entry)
    },
    /** Drops one hold; the last one answers the waiting requests. Returns how many it answered. */
    release(term: string): number {
      const entry = held.get(term)
      if (!entry) return 0
      entry.holders -= 1
      if (entry.holders > 0) return 0
      held.delete(term)
      for (const answer of entry.waiting) answer()
      return entry.waiting.length
    },
    /** Answers now or, while `term` is held, once it is released. */
    answer(term: string, send: () => void): void {
      const entry = term === "" ? undefined : held.get(term)
      if (entry) entry.waiting.push(send)
      else send()
    },
  }
}

/**
 * A CIB seven REST stand-in for the host simulation: the real cockpit tool runs
 * against it through the real server, so the view renders the payload the
 * server ACTUALLY builds (view envelope, data shape, engine id) from a fixed
 * engine response (`fixtures/process-definitions.json` with their statistics,
 * no open incident, the `invoice` diagram `fixtures/invoice.bpmn` with two instances at
 * `approveInvoice` and three failed jobs).
 * The broken base URL turns any tool into a genuine `isError` result: an
 * engine 503 through the server's own error mapping.
 *
 * Scenario control, so an in-flight state is observable without a timing
 * window: `POST /__control/hold?term=<term>` makes every request that
 * searches for `<term>` (its business-key search without the `%` wildcards,
 * case insensitive) wait; `POST /__control/release?term=<term>` drops that
 * hold, and the last release answers the waiting ones and lets later ones
 * through. Holds are per term, so scenarios searching for other terms never
 * wait on each other.
 */
export async function startStubEngine(): Promise<StubEngine> {
  const jobs = stubJobs()
  const holds = createSearchHolds()
  const server = http.createServer((req, res) => {
    void readJson(req).then((requestBody) => {
      const url = new URL(req.url ?? "/", "http://stub")
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" })
        res.end(body === undefined ? undefined : JSON.stringify(body))
      }
      const term = searchTerm(url, requestBody)
      if (req.method === "POST" && url.pathname === "/__control/hold") {
        holds.hold(term)
        send(200, { held: term })
      } else if (req.method === "POST" && url.pathname === "/__control/release") {
        send(200, { released: holds.release(term) })
      } else {
        const method = req.method ?? "GET"
        const { status, body } =
          realisticRoute(method, url, requestBody) ??
          jobRoute(method, url, requestBody, jobs) ??
          route(url)
        holds.answer(term, () => send(status, body))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${port}`
  return {
    baseUrl: `${origin}/engine-rest`,
    brokenBaseUrl: `${origin}/broken/engine-rest`,
    realisticBaseUrl: `${origin}${REALISTIC_PREFIX}/engine-rest`,
    controlUrl: origin,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
