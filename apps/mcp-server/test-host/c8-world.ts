import { readFileSync } from "node:fs"
import path from "node:path"
import type { EngineReply } from "../test/engine-goldens/fake-c8-cluster.js"

/**
 * The world of test:host's Camunda 8 cluster (c8-engine.ts), in the answers a cluster on 8.9 gives
 * under `/v2` (their shapes those of c8-core's recorded screen engine): one process, "Order
 * fulfillment" (`pulse-order`) in one version, a small Zeebe process with a service task; three
 * running orders that wait at "Charge payment", one of them with an incident there (a job without
 * retries); and ten thousand ended orders and more, which a cluster counts no further
 * (`hasMoreTotalItems`), so an ended or an all-lifecycle count is a lower bound. Its keys are a
 * cluster's, 16 to 19 digits, beyond 2^53. Each search answers by the filter fields Pulse sends
 * (process, version, lifecycle, incident, business id, active element, instance keys, variables),
 * newest first, paged by cursor; an instance, an incident or a version it does not hold is the
 * cluster's NOT_FOUND. What a board reads of it, and what the web app's screens read.
 */

const ORDER_DEFINITION_KEY = "2251799813685326"
/** The instance with an incident: a key beyond 2^53. */
export const FAILED_ORDER_KEY = "9007199254741009"
/** A key of 19 digits, the most a cluster gives, of an instance without a business id. */
export const LONG_ORDER_KEY = "4611686018427388111"
const QUIET_ORDER_KEY = "2251799813685400"
export const INCIDENT_KEY = "4611686018427388207"
/** The incident's job, at the failed order's "Charge payment". */
const FAILED_JOB_KEY = "9007199254741016"

/** How many ended orders the cluster counts before it stops counting: a lower bound beyond. */
export const COUNTED_ENDED = 10_000
/** The ended orders the cluster lists, newest first: more than a page of the screens' 50. */
const LISTED_ENDED = 120

const STARTED = "2026-11-15T08:41:12.345Z"
const PROBLEM_TYPE = "application/problem+json"

export const ZEEBE_ORDER = readFileSync(
  path.join(import.meta.dirname, "fixtures", "order.bpmn"),
  "utf8",
)

export const TOPOLOGY = {
  brokers: [
    {
      nodeId: 0,
      host: "camunda",
      port: 26501,
      partitions: [{ partitionId: 1, role: "leader", health: "healthy" }],
      version: "8.9.28",
    },
  ],
  clusterId: "6c1f9e3a-2b8d-4c47-9a5e-0d3f7b2e8c41",
  clusterSize: 1,
  partitionsCount: 1,
  replicationFactor: 1,
  gatewayVersion: "8.9.28",
  lastCompletedChangeId: "-1",
}

export const DEFINITION = {
  name: "Order fulfillment",
  resourceName: "order.bpmn",
  version: 2,
  versionTag: null,
  processDefinitionId: "pulse-order",
  tenantId: "<default>",
  processDefinitionKey: ORDER_DEFINITION_KEY,
  hasStartForm: false,
  state: "ACTIVE",
}

export const STATISTICS = [
  {
    processDefinitionId: "pulse-order",
    tenantId: "<default>",
    latestProcessDefinitionName: "Order fulfillment",
    hasMultipleVersions: false,
    activeInstancesWithoutIncidentCount: 2,
    activeInstancesWithIncidentCount: 1,
  },
]

export const VERSION_STATISTICS = [
  {
    processDefinitionId: "pulse-order",
    processDefinitionKey: ORDER_DEFINITION_KEY,
    processDefinitionName: "Order fulfillment",
    tenantId: "<default>",
    processDefinitionVersion: 2,
    activeInstancesWithIncidentCount: 1,
    activeInstancesWithoutIncidentCount: 2,
  },
]

export const ELEMENTS = [
  { elementId: "Event_OrderReceived", active: 0, canceled: 0, incidents: 0, completed: 3 },
  { elementId: "Activity_ChargePayment", active: 2, canceled: 0, incidents: 1, completed: 0 },
]

interface Order {
  readonly key: string
  readonly businessId: string | null
  readonly hasIncident: boolean
  readonly startDate: string
  readonly endDate: string | null
}

function instanceOf(order: Order) {
  return {
    processDefinitionId: "pulse-order",
    processDefinitionName: "Order fulfillment",
    processDefinitionVersion: 2,
    processDefinitionVersionTag: null,
    startDate: order.startDate,
    endDate: order.endDate,
    state: order.endDate === null ? "ACTIVE" : "COMPLETED",
    suspendedDate: null,
    hasIncident: order.hasIncident,
    tenantId: "<default>",
    processInstanceKey: order.key,
    processDefinitionKey: ORDER_DEFINITION_KEY,
    parentProcessInstanceKey: null,
    parentElementInstanceKey: null,
    rootProcessInstanceKey: order.key,
    tags: [],
    businessId: order.businessId,
  }
}

const running = (key: string, businessId: string | null, hasIncident: boolean, minute: number) =>
  ({ key, businessId, hasIncident, startDate: at(8, minute), endDate: null }) satisfies Order

/** 2026-11-15 at `hour`:`minute`, `second` s past the minute (12.345 by default). */
function at(hour: number, minute: number, second = "12.345"): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `2026-11-15T${pad(hour)}:${pad(minute)}:${second}Z`
}

const RUNNING: readonly Order[] = [
  running(FAILED_ORDER_KEY, "ORD-7001", true, 41),
  running(LONG_ORDER_KEY, null, false, 38),
  running(QUIET_ORDER_KEY, "ORD-7003", false, 35),
]

/** The `index`th newest ended order: one a minute before the running ones, each its own key. */
function ended(index: number): Order {
  const minutes = 8 * 60 + 30 - index
  return {
    key: String(2251799813700000 + index),
    businessId: `ORD-${String(6999 - index)}`,
    hasIncident: false,
    startDate: at(Math.floor(minutes / 60), minutes % 60),
    endDate: at(Math.floor(minutes / 60), minutes % 60, "52.345"),
  }
}

const ENDED: readonly Order[] = Array.from({ length: LISTED_ENDED }, (_, index) => ended(index))

/** The variables of each running order, as the cluster keeps them (values as JSON text). */
const VARIABLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [FAILED_ORDER_KEY]: { orderId: '"ORD-7001"', amount: "1250" },
  [LONG_ORDER_KEY]: { orderId: "null", amount: "80" },
  [QUIET_ORDER_KEY]: { orderId: '"ORD-7003"', amount: "310" },
}

export const INCIDENT = {
  processDefinitionId: "pulse-order",
  errorType: "JOB_NO_RETRIES",
  errorMessage: "the card gateway is unreachable",
  elementId: "Activity_ChargePayment",
  creationTime: STARTED,
  state: "ACTIVE",
  tenantId: "<default>",
  incidentKey: INCIDENT_KEY,
  processDefinitionKey: ORDER_DEFINITION_KEY,
  processInstanceKey: FAILED_ORDER_KEY,
  rootProcessInstanceKey: FAILED_ORDER_KEY,
  elementInstanceKey: "9007199254741015",
  jobKey: FAILED_JOB_KEY,
}

/**
 * A filter's field as a cluster takes it: a value, or `$in`, `$eq`, `$notIn`, `$like`, `$exists`
 * and the comparisons of a date.
 */
type Condition = unknown

/** A text as a regular expression that matches it alone. */
const escaped = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&")

/** The comparisons of a date filter, on the ISO text (which orders as the instant does). */
const COMPARISONS: Readonly<Record<string, (actual: string, bound: string) => boolean>> = {
  $gt: (actual, bound) => actual > bound,
  $gte: (actual, bound) => actual >= bound,
  $lt: (actual, bound) => actual < bound,
  $lte: (actual, bound) => actual <= bound,
}

export interface Search {
  readonly filter?: Readonly<Record<string, Condition>>
  readonly page?: { readonly limit?: number; readonly after?: string }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Whether `actual` meets `condition`: equality, or one of the operators Pulse sends. */
function meets(actual: unknown, condition: Condition): boolean {
  if (!isRecord(condition)) return actual === condition
  if ("$in" in condition) return (condition.$in as unknown[]).includes(actual)
  if ("$eq" in condition) return actual === condition.$eq
  if ("$notIn" in condition) return !(condition.$notIn as unknown[]).includes(actual)
  if ("$exists" in condition) return (actual !== null && actual !== undefined) === condition.$exists
  if ("$like" in condition) {
    const pattern = String(condition.$like).split("*").map(escaped).join(".*")
    return new RegExp(`^${pattern}$`).test(String(actual))
  }
  return Object.entries(condition).every(
    ([operator, bound]) =>
      typeof actual === "string" && COMPARISONS[operator]?.(actual, String(bound)) === true,
  )
}

/** Whether an order's variables meet every condition of `variables` (name and value). */
function variablesMeet(order: Order, variables: Condition): boolean {
  const held = VARIABLES[order.key] ?? {}
  return (variables as Array<{ name: string; value: Condition }>).every(
    ({ name, value }) => Object.hasOwn(held, name) && meets(held[name], value),
  )
}

/** The field of an order a filter key reads; undefined for a key no order answers. */
function fieldOf(order: Order, key: string): unknown {
  const instance: Readonly<Record<string, unknown>> = instanceOf(order)
  switch (key) {
    case "elementId":
      return order.endDate === null ? "Activity_ChargePayment" : undefined
    case "elementInstanceState":
      return order.endDate === null ? "ACTIVE" : undefined
    default:
      return instance[key]
  }
}

/** Whether an order meets every field of `filter`. */
function orderMeets(order: Order, filter: Readonly<Record<string, Condition>>): boolean {
  return Object.entries(filter).every(([key, condition]) =>
    key === "variables" ? variablesMeet(order, condition) : meets(fieldOf(order, key), condition),
  )
}

/**
 * A search's page of `items` (the first `total` of them listed): none of them under `limit: 0` (a
 * count), the rest after its cursor, the total the cluster counts to, `hasMoreTotalItems` beyond.
 */
export function pageOf(
  items: readonly unknown[],
  search: Search,
  total = items.length,
): EngineReply {
  const limit = search.page?.limit ?? 100
  const from = search.page?.after === undefined ? 0 : Number(search.page.after)
  const listed = items.slice(from, from + limit)
  const end = from + listed.length
  const page = {
    totalItems: Math.min(total, COUNTED_ENDED),
    hasMoreTotalItems: total > COUNTED_ENDED,
    startCursor: listed.length === 0 ? null : String(from),
    endCursor: listed.length === 0 ? null : String(end),
  }
  return { body: { items: listed, page } }
}

/** The orders a search names, newest first: no instance a running order called. */
export function instancesFor(search: Search): EngineReply {
  const filter = search.filter ?? {}
  if (filter.parentProcessInstanceKey !== undefined) return pageOf([], search)
  const runningOnes = RUNNING.filter((order) => orderMeets(order, filter))
  const endedOnes = ENDED.filter((order) => orderMeets(order, filter))
  // Where every ended order it lists meets the filter, so do the ones it counts beyond them; a
  // filter only some meet (an id, a business id) meets none of the others.
  const endedTotal = endedOnes.length === ENDED.length ? COUNTED_ENDED + 1 : endedOnes.length
  return pageOf(
    [...runningOnes, ...endedOnes].map(instanceOf),
    search,
    runningOnes.length + endedTotal,
  )
}

/** The incidents a search names: the one incident, where every field it names meets it. */
export function incidentsFor(search: Search): EngineReply {
  const filter = search.filter ?? {}
  const incident: Readonly<Record<string, unknown>> = INCIDENT
  const hit = Object.entries(filter).every(([key, condition]) => meets(incident[key], condition))
  return pageOf(hit ? [INCIDENT] : [], search)
}

/** An order's elements, newest first: its start event done, "Charge payment" waiting. */
function elementsOf(order: Order, activeOnly: boolean): unknown[] {
  if (order.endDate !== null) return []
  const element = (id: string, name: string, type: string, key: string, active: boolean) => ({
    processDefinitionId: "pulse-order",
    startDate: order.startDate,
    endDate: active ? null : order.startDate,
    elementId: id,
    elementName: name,
    type,
    state: active ? "ACTIVE" : "COMPLETED",
    hasIncident: active && order.hasIncident,
    tenantId: "<default>",
    elementInstanceKey: key,
    processInstanceKey: order.key,
    rootProcessInstanceKey: order.key,
    processDefinitionKey: ORDER_DEFINITION_KEY,
    ...(active && order.hasIncident ? { incidentKey: INCIDENT_KEY } : {}),
  })
  const base = BigInt(order.key)
  const charge = element(
    "Activity_ChargePayment",
    "Charge payment",
    "SERVICE_TASK",
    String(base + 6n),
    true,
  )
  if (activeOnly) return [charge]
  return [
    charge,
    element("Event_OrderReceived", "Order received", "START_EVENT", String(base + 2n), false),
  ]
}

/** The element instances a search names: an order's, or its active ones. */
export function elementsFor(search: Search): EngineReply {
  const { processInstanceKey, state } = search.filter ?? {}
  const order = RUNNING.find(({ key }) => key === processInstanceKey)
  return pageOf(order === undefined ? [] : elementsOf(order, state === "ACTIVE"), search)
}

/** "Charge payment"'s job of each running order: the failed order's has no retries left. */
function jobOf(order: Order) {
  return {
    jobKey: order.key === FAILED_ORDER_KEY ? FAILED_JOB_KEY : String(BigInt(order.key) + 7n),
    type: "charge-payment",
    state: order.hasIncident ? "FAILED" : "CREATED",
    kind: "BPMN_ELEMENT",
    elementInstanceKey: String(BigInt(order.key) + 6n),
    retries: order.hasIncident ? 0 : 3,
    creationTime: order.startDate,
    processInstanceKey: order.key,
  }
}

/** The jobs a search names, by their instance and element or by their keys. */
export function jobsFor(search: Search): EngineReply {
  const filter = search.filter ?? {}
  const jobs: Array<Readonly<Record<string, unknown>>> = RUNNING.map(jobOf)
  return pageOf(
    jobs.filter((job) => Object.entries(filter).every(([key, value]) => meets(job[key], value))),
    search,
  )
}

/** The variables a search names: those of the orders it lists. */
export function variablesFor(search: Search): EngineReply {
  const keys = (search.filter?.processInstanceKey as { $in?: string[] } | undefined)?.$in ?? []
  const rows = keys.flatMap((key) =>
    Object.entries(VARIABLES[key] ?? {}).map(([name, value], index) => ({
      value,
      isTruncated: false,
      name,
      tenantId: "<default>",
      variableKey: String(BigInt(key) + 20n + BigInt(index)),
      scopeKey: key,
      processInstanceKey: key,
      rootProcessInstanceKey: key,
    })),
  )
  return pageOf(rows, search)
}

/** An order by its key, else undefined. */
export function orderOf(key: string): unknown {
  const order = [...RUNNING, ...ENDED].find((candidate) => candidate.key === key)
  return order === undefined ? undefined : instanceOf(order)
}

/** The cluster's answer to a resource it does not hold. */
export const missing = (target: string): EngineReply => ({
  status: 404,
  contentType: PROBLEM_TYPE,
  body: {
    type: "about:blank",
    title: "NOT_FOUND",
    status: 404,
    detail: `No resource at ${target}.`,
    instance: target,
  },
})

/** The cluster's answer to an endpoint it does not have. */
export const notFound = (target: string): EngineReply => ({
  status: 404,
  contentType: PROBLEM_TYPE,
  body: { type: "about:blank", title: "Not Found", status: 404, detail: `No endpoint ${target}.` },
})

export { ORDER_DEFINITION_KEY }
