import {
  type EngineAnswer,
  type EngineReply,
  type LoopbackServer,
  type SentRequest,
  startC8Engine,
} from "../test/engine-goldens/fake-c8-cluster.js"
import {
  DEFINITION,
  ELEMENTS,
  elementsFor,
  INCIDENT,
  INCIDENT_KEY,
  incidentsFor,
  instancesFor,
  jobsFor,
  missing,
  notFound,
  ORDER_DEFINITION_KEY,
  orderOf,
  pageOf,
  type Search,
  STATISTICS,
  TOPOLOGY,
  variablesFor,
  VERSION_STATISTICS,
  ZEEBE_ORDER,
} from "./c8-world.js"

export { COUNTED_ENDED, FAILED_ORDER_KEY, INCIDENT_KEY, LONG_ORDER_KEY } from "./c8-world.js"

/**
 * The Camunda 8 cluster of the host simulation's Camunda 8 composition (global-setup.ts and
 * web/global-setup.ts): one loopback engine that is the cluster under `/v2` and, at Keycloak's
 * path, the token endpoint of its client credentials grant. It answers the reads a board and the
 * web app's screens make of a cluster on 8.9 (c8-world.ts: its world and its searches): the
 * version, the per-process and per-version statistics, the definitions and one definition's
 * diagram (a small Zeebe process with a service task, served as text as a cluster sends it), the
 * elements' statistics, the instance, element instance, incident, job, user task, message
 * subscription and variable searches, an instance and an incident by their keys. Every request is
 * recorded, so a scenario counts what the server asked for: `GET /__control/requests` answers them
 * as `METHOD target`, `DELETE` forgets them. Kept free of the server graph, so the spec's workers
 * never load it.
 */

const C8_TOKEN_PATH = "/realms/pulse/protocol/openid-connect/token"
const CONTROL_PATH = "/__control/requests"

const json = (body: unknown): EngineReply => ({ body })

const SEARCHES: Readonly<Record<string, (search: Search) => EngineReply>> = {
  "/v2/process-definitions/statistics/process-instances": (search) => pageOf(STATISTICS, search),
  "/v2/process-definitions/statistics/process-instances-by-version": (search) =>
    pageOf(search.filter?.processDefinitionId === "pulse-order" ? VERSION_STATISTICS : [], search),
  "/v2/process-definitions/search": (search) => {
    const id = search.filter?.processDefinitionId
    return pageOf(id === undefined || id === "pulse-order" ? [DEFINITION] : [], search)
  },
  "/v2/process-instances/search": instancesFor,
  "/v2/element-instances/search": elementsFor,
  "/v2/incidents/search": incidentsFor,
  "/v2/jobs/search": jobsFor,
  "/v2/user-tasks/search": (search) => pageOf([], search),
  "/v2/message-subscriptions/search": (search) => pageOf([], search),
  "/v2/variables/search": variablesFor,
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
  [`/v2/incidents/${INCIDENT_KEY}`]: json(INCIDENT),
}

/** A resource of a collection the cluster holds by key: an instance, an incident, a version. */
const RESOURCE =
  /^\/v2\/(?:process-instances|incidents|process-definitions|element-instances)\/\d+(?:\/xml)?$/

const TOKEN: EngineReply = json({
  access_token: "c8-host-sim-token",
  token_type: "Bearer",
  expires_in: 300,
})

/** A read by its target: the world's answer, an order by its key, else what the cluster lacks. */
function readOf(target: string): EngineReply {
  const read = READS[target]
  if (read !== undefined) return read
  const order = orderOf(target.replace(/^\/v2\/process-instances\//, ""))
  if (target.startsWith("/v2/process-instances/") && order !== undefined) return json(order)
  return RESOURCE.test(target) ? missing(target) : notFound(target)
}

/** The cluster's answer to `request`, the token endpoint's to a token request. */
const clusterAnswer: EngineAnswer = (request) => {
  if (request.target === C8_TOKEN_PATH) return TOKEN
  const search = SEARCHES[request.target]
  if (request.method === "POST" && search !== undefined) {
    return search(JSON.parse(request.body ?? "{}") as Search)
  }
  return readOf(request.target)
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
