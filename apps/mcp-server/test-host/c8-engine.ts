import { readFileSync } from "node:fs"
import path from "node:path"
import {
  type EngineAnswer,
  type EngineReply,
  type LoopbackServer,
  type SentRequest,
  startC8Engine,
} from "../test/engine-goldens/fake-c8-cluster.js"

/**
 * The Camunda 8 cluster of the host simulation's Camunda 8 composition (global-setup.ts and
 * web/global-setup.ts): one loopback engine that is the cluster under `/v2` and, at Keycloak's
 * path, the token endpoint of its client credentials grant. It answers the reads a board makes
 * of a cluster on 8.9: the version, the per-process statistics, the latest definitions, one
 * definition and its diagram (a small Zeebe process with a service task, served as text as a
 * cluster sends it), the elements' statistics, the instance and incident searches. Its keys are
 * a cluster's, 16 to 19 digits, beyond 2^53. Every request is recorded, so a scenario counts what
 * the server asked for: `GET /__control/requests` answers them as `METHOD target`, `DELETE` forgets
 * them. Kept free of the server graph, so the spec's workers never load it.
 */

const C8_TOKEN_PATH = "/realms/pulse/protocol/openid-connect/token"
const CONTROL_PATH = "/__control/requests"

const ORDER_DEFINITION_KEY = "2251799813685326"
/** The instance with an incident: a key beyond 2^53. */
export const FAILED_ORDER_KEY = "9007199254741009"
/** A key of 19 digits, the most a cluster gives, of an instance without a business id. */
export const LONG_ORDER_KEY = "4611686018427388111"
const QUIET_ORDER_KEY = "2251799813685400"
const INCIDENT_KEY = "4611686018427388207"

const STARTED = "2026-11-15T08:41:12.345Z"
const PROBLEM_TYPE = "application/problem+json"

const ZEEBE_ORDER = readFileSync(path.join(import.meta.dirname, "fixtures", "order.bpmn"), "utf8")

const TOPOLOGY = {
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

const DEFINITION = {
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

const STATISTICS = [
  {
    processDefinitionId: "pulse-order",
    tenantId: "<default>",
    latestProcessDefinitionName: "Order fulfillment",
    hasMultipleVersions: false,
    activeInstancesWithoutIncidentCount: 2,
    activeInstancesWithIncidentCount: 1,
  },
]

function instanceOf(key: string, businessId: string | null, hasIncident: boolean, minute: number) {
  return {
    processDefinitionId: "pulse-order",
    processDefinitionName: "Order fulfillment",
    processDefinitionVersion: 2,
    processDefinitionVersionTag: null,
    startDate: `2026-11-15T08:${String(minute).padStart(2, "0")}:12.345Z`,
    endDate: null,
    state: "ACTIVE",
    suspendedDate: null,
    hasIncident,
    tenantId: "<default>",
    processInstanceKey: key,
    processDefinitionKey: ORDER_DEFINITION_KEY,
    parentProcessInstanceKey: null,
    parentElementInstanceKey: null,
    rootProcessInstanceKey: key,
    tags: [],
    businessId,
  }
}

const INSTANCES = [
  instanceOf(FAILED_ORDER_KEY, "ORD-7001", true, 41),
  instanceOf(LONG_ORDER_KEY, null, false, 38),
  instanceOf(QUIET_ORDER_KEY, "ORD-7003", false, 35),
]

const INCIDENT = {
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
  jobKey: "9007199254741016",
}

const ELEMENTS = [
  { elementId: "Event_OrderReceived", active: 0, canceled: 0, incidents: 0, completed: 3 },
  { elementId: "Activity_ChargePayment", active: 2, canceled: 0, incidents: 1, completed: 0 },
]

interface Search {
  readonly filter?: {
    readonly processDefinitionId?: string
    readonly hasIncident?: boolean
    readonly endDate?: { readonly $exists?: boolean }
  }
  readonly page?: { readonly limit?: number }
}

/** A search's page: none of the items under `limit: 0` (a count), its total always. */
function pageOf(items: readonly unknown[], search: Search): EngineReply {
  const limit = search.page?.limit ?? 100
  const page = { totalItems: items.length, hasMoreTotalItems: false, startCursor: null }
  return { body: { items: items.slice(0, limit), page: { ...page, endCursor: null } } }
}

/** The running orders a filter asks for: every one runs, one has an incident. */
function instancesFor({ filter = {} }: Search): readonly unknown[] {
  if (filter.endDate?.$exists === true) return []
  if (filter.processDefinitionId !== undefined && filter.processDefinitionId !== "pulse-order") {
    return []
  }
  return filter.hasIncident === true ? INSTANCES.filter((i) => i.hasIncident) : INSTANCES
}

const json = (body: unknown): EngineReply => ({ body })

const SEARCHES: Readonly<Record<string, (search: Search) => EngineReply>> = {
  "/v2/process-definitions/statistics/process-instances": (search) => pageOf(STATISTICS, search),
  "/v2/process-definitions/search": (search) => pageOf([DEFINITION], search),
  "/v2/process-instances/search": (search) => pageOf(instancesFor(search), search),
  "/v2/incidents/search": (search) => pageOf([INCIDENT], search),
  [`/v2/process-definitions/${ORDER_DEFINITION_KEY}/statistics/element-instances`]: () =>
    json({ items: ELEMENTS }),
}

const READS: Readonly<Record<string, EngineReply>> = {
  "/v2/topology": json(TOPOLOGY),
  [`/v2/process-definitions/${ORDER_DEFINITION_KEY}`]: json(DEFINITION),
  [`/v2/process-definitions/${ORDER_DEFINITION_KEY}/xml`]: {
    raw: ZEEBE_ORDER,
    contentType: "text/xml;charset=UTF-8",
  },
}

const TOKEN: EngineReply = json({
  access_token: "c8-host-sim-token",
  token_type: "Bearer",
  expires_in: 300,
})

const notFound = (target: string): EngineReply => ({
  status: 404,
  contentType: PROBLEM_TYPE,
  body: { type: "about:blank", title: "Not Found", status: 404, detail: `No endpoint ${target}.` },
})

/** The cluster's answer to `request`, the token endpoint's to a token request. */
const clusterAnswer: EngineAnswer = (request) => {
  if (request.target === C8_TOKEN_PATH) return TOKEN
  const search = SEARCHES[request.target]
  if (request.method === "POST" && search !== undefined) {
    return search(JSON.parse(request.body ?? "{}") as Search)
  }
  return READS[request.target] ?? notFound(request.target)
}

export interface C8Engine {
  /** `http://127.0.0.1:<port>`: the REST root is `${origin}/v2`, the token endpoint below it. */
  readonly origin: string
  /** A profile of this cluster: client credentials, the secret in `secretVariable`. */
  profile(secretVariable: string, extra?: Record<string, unknown>): Record<string, unknown>
  close(): Promise<void>
}

const lineOf = ({ method, target }: SentRequest) => `${method} ${target}`

/** Starts the cluster; its control answers and forgets what it was asked. */
export async function startC8HostEngine(): Promise<C8Engine> {
  const asked: SentRequest[] = []
  const answer: EngineAnswer = (request) => {
    if (request.target !== CONTROL_PATH) {
      asked.push(request)
      return clusterAnswer(request)
    }
    if (request.method === "DELETE") asked.length = 0
    return json(asked.map(lineOf))
  }
  const engine: LoopbackServer = await startC8Engine(answer)
  return {
    origin: engine.origin,
    profile: (secretVariable, extra = {}) => ({
      url: `${engine.origin}/v2`,
      flavor: "camunda8",
      auth: {
        type: "clientCredentials",
        tokenEndpoint: `${engine.origin}${C8_TOKEN_PATH}`,
        clientId: "pulse-host-sim",
        clientSecretEnv: secretVariable,
      },
      ...extra,
    }),
    close: () => engine.close(),
  }
}

/** What the cluster was asked since the last forget, as `METHOD target`; `forget` clears it. */
export async function c8Requests(control: string, forget = false): Promise<string[]> {
  const response = await fetch(`${control}${CONTROL_PATH}`, { method: forget ? "DELETE" : "GET" })
  return (await response.json()) as string[]
}
