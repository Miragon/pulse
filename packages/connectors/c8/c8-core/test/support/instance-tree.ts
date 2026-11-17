import { Diagrams } from "../../src/reading/diagrams.js"
import { InstanceDetailReader } from "../../src/reading/instance-detail-reader.js"
import {
  clientWith,
  type FakeCamundaRest,
  page,
  pagedByCursor,
  type RestRoute,
  type SearchBody,
} from "./fake-transport.js"
import { instance } from "./rows.js"

export const ACTIVE_ONLY = '"state":"ACTIVE"'
export const OPEN_USER_TASKS = [
  "CREATING",
  "CREATED",
  "ASSIGNING",
  "UPDATING",
  "COMPLETING",
  "CANCELING",
]

export interface Waiting {
  readonly active: readonly unknown[]
  readonly jobs?: unknown
  readonly tasks?: unknown
  readonly subscriptions?: unknown
  readonly incidents?: unknown
}

export function about(instanceKey: string, ...parts: readonly string[]) {
  return (body: string) =>
    [`"processInstanceKey":"${instanceKey}"`, ...parts].every((part) => body.includes(part))
}

export function searchesOf(camunda: FakeCamundaRest, route: string): SearchBody[] {
  return camunda.bodiesOf(route) as SearchBody[]
}

export function aloneWaiting(waiting: Waiting): RestRoute[] {
  return [
    { route: "GET /process-instances/1", answer: instance("1") },
    { route: "POST /process-instances/search", answer: page([]) },
    { route: "POST /element-instances/search", answer: pagedByCursor(waiting.active) },
    { route: "POST /jobs/search", answer: waiting.jobs ?? page([]) },
    { route: "POST /user-tasks/search", answer: waiting.tasks ?? page([]) },
    { route: "POST /message-subscriptions/search", answer: waiting.subscriptions ?? page([]) },
    { route: "POST /incidents/search", answer: waiting.incidents ?? page([]) },
    { route: "POST /variables/search", answer: page([]) },
  ]
}

export function detailWith(routes: readonly RestRoute[]): {
  readonly camunda: FakeCamundaRest
  readonly reader: InstanceDetailReader
} {
  const { camunda, client } = clientWith(routes)
  return { camunda, reader: new InstanceDetailReader(client, new Diagrams(client)) }
}
