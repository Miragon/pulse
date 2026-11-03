import type { Route } from "@miragon/pulse-engine-core/testing"
import { withToolErrors } from "@miragon/pulse-widget-shell/server"
import {
  engineStatusForModel,
  type EngineStatusArgs,
  type InspectArgs,
  inspectForModel,
} from "./composites.js"
import {
  clientFor,
  type FakeEngine,
  type FakeReply,
  type FakeRoutes,
  type RecordedRequest,
  startFakeEngine,
} from "../../tools/test-support/fake-engine.js"

/** The read composites on the wire: engine-core's rounds over the real client and a loopback engine. */

const engines: FakeEngine[] = []

/** Closes every engine `engineWith` started; each wire test file runs it after each test. */
export async function stopFakeEngines() {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
}

/** The REST path of each operation the fixture answers; `{id}` is its one path value. */
const PATHS: readonly (readonly [RegExp, string])[] = [
  [/^\/process-instance\/([^/]+)\/activity-instances$/, "getActivityInstanceTree"],
  [/^\/process-instance\/([^/]+)\/variables$/, "getProcessInstanceVariables"],
  [/^\/process-instance\/([^/]+)$/, "getProcessInstance"],
  [/^\/process-instance$/, "getProcessInstances"],
  [/^\/history\/process-instance\/([^/]+)$/, "getHistoricProcessInstance"],
  [/^\/history\/process-instance$/, "getHistoricProcessInstances"],
  [/^\/history\/activity-instance$/, "getHistoricActivityInstances"],
  [/^\/history\/incident$/, "getHistoricIncidents"],
  [/^\/history\/variable-instance$/, "getHistoricVariableInstances"],
  [/^\/job\/([^/]+)\/stacktrace$/, "getStacktrace"],
  [/^\/incident$/, "getIncidents"],
  [/^\/event-subscription$/, "getEventSubscriptions"],
  [/^\/task$/, "getTasks"],
  [/^\/external-task$/, "getExternalTasks"],
  [/^\/job$/, "getJobs"],
  [/^\/process-definition$/, "getProcessDefinitions"],
  [/^\/job-definition$/, "getJobDefinitions"],
]

/** The engine-core fixture's routes, answered over HTTP; an undefined answer is an engine 404. */
export function fixtureEngine(routes: Record<string, Route>) {
  return (request: RecordedRequest): FakeReply => {
    for (const [pattern, operationId] of PATHS) {
      const match = pattern.exec(request.path)
      const route = routes[operationId]
      if (!match || !route) continue
      const pathArgs = match[1] === undefined ? [] : [match[1]]
      const body = route({ pathArgs, query: request.query })
      if (body === undefined) {
        return { status: 404, body: { type: "InvalidRequestException", message: "missing" } }
      }
      return typeof body === "string" ? { body, contentType: "text/plain" } : { body }
    }
    return { status: 404, body: { type: "NotFoundException", message: request.path } }
  }
}

export async function engineWith(
  routes: FakeRoutes,
  fallback?: (request: RecordedRequest) => FakeReply,
) {
  const engine = await startFakeEngine(routes, fallback)
  engines.push(engine)
  return engine
}

export const inspect = (engine: FakeEngine, args: InspectArgs) =>
  inspectForModel(clientFor(engine), args, "fake")
export const status = (engine: FakeEngine, args: EngineStatusArgs) =>
  engineStatusForModel(clientFor(engine), args, "fake")

/** The text a model reads for a failed inspect, as the registrar prints a thrown error. */
export async function errorText(engine: FakeEngine, args: InspectArgs) {
  const result = await withToolErrors(() => inspect(engine, args))()
  return (result as { content: { text: string }[] }).content[0]?.text
}
