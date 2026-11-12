/**
 * The fake engine and read options of the inspect tests (src/workflow/inspect*.test.ts): the
 * routes of c7-core's approve stage (`approveRoutes`), answered over fetch at the paths the
 * catalog gives their operation ids.
 */

import { findByOperationId, loadCatalog } from "../../src/catalog/catalog.js"
import { expandPath } from "../../src/operation/request.js"
import { approveRoutes, C, P, type Route } from "@miragon/pulse-c7-core/testing"
import { fakeServer, json, type RecordedRequest, text } from "./fake-fetch.js"

/** The reads the fake engine answers, each with the path values it knows. */
const READS: readonly (readonly [string, readonly (readonly string[])[]])[] = [
  ["getProcessInstance", [[P]]],
  ["getHistoricProcessInstance", [[P]]],
  ["getProcessInstances", [[]]],
  ["getActivityInstanceTree", [[P], [C]]],
  ["getIncidents", [[]]],
  ["getEventSubscriptions", [[]]],
  ["getTasks", [[]]],
  ["getExternalTasks", [[]]],
  ["getJobs", [[]]],
  ["getProcessDefinitions", [[]]],
  ["getJobDefinitions", [[]]],
  ["getProcessInstanceVariables", [[P]]],
  ["getStacktrace", [["j1"]]],
  ["getHistoricActivityInstances", [[]]],
  ["getHistoricIncidents", [[]]],
]

/** The answer of a route: a text as text/plain, anything else as JSON. */
function answer(route: Route, pathArgs: readonly string[], request: RecordedRequest): Response {
  const value = route({ pathArgs, query: Object.fromEntries(request.query) })
  return typeof value === "string" ? text(value, "text/plain") : json(value)
}

/** Parent waiting at its call activity, the child at `approve` with a failed job incident. */
export function approveEngine() {
  const catalog = loadCatalog()
  const routes = approveRoutes()
  const server = fakeServer()
  for (const [operationId, pathValues] of READS) {
    const operation = findByOperationId(catalog, operationId)
    const route = routes[operationId]
    if (operation === undefined || route === undefined) throw new Error(`no ${operationId}`)
    for (const pathArgs of pathValues) {
      server.on(operation.method, expandPath(operation, pathArgs), (request) =>
        answer(route, pathArgs, request),
      )
    }
  }
  return server
}

export const ALL = { variables: true, history: false, stacktrace: false }
