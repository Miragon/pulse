/**
 * The routes of the scripted workflow engine (workflow-engine.ts): what each request answers at the
 * engine's stage, and the writes that move the instance on. The handlers read and change the engine
 * through the state they are given, so this module never imports the engine.
 */

import { engineError, json, noContent, type RecordedRequest, text } from "./fake-fetch.js"

export type Stage = "none" | "approve" | "book" | "failed" | "ended"

export interface Definition {
  readonly id: string
  readonly key: string
  readonly version: number
  readonly resource: string
  readonly deploymentId: string
}

/** What the routes read and change of the engine (WorkflowEngine implements it). */
export interface EngineState {
  stage: Stage
  businessKey: string
  key: string
  attempts: number
  readonly variables: Record<string, { value: unknown; type: string }>
  readonly definitions: Definition[]
  /** Deployment ids by deployment name and resource names. */
  readonly deployed: Map<string, string>
  /** Resource names per deployment id. */
  readonly resources: Map<string, string[]>
  /** Unknown routes answer a generic `{}`, writes at the wrong stage succeed without effect. */
  readonly lenient: boolean
  /** The instance runs: it waits at `approve` or `book`, or has the failed job. */
  readonly active: boolean
  readonly definitionId: string
  /** Runs the job of `book`: false on the first (failing) attempt. */
  runJob(): boolean
  definition(key: string, resource: string, deploymentId: string): Definition
  instanceDto(id: string): object
  historyDto(id: string): object
  activityTree(id: string): object
  tasks(id: string): readonly object[]
  jobs(id: string): readonly { readonly retries: number }[]
  incidents(id: string, always?: boolean): readonly object[]
}

export const T0 = "2026-10-09T10:00:00.000+0000"
export const T1 = "2026-10-09T10:00:05.000+0000"
export const ERROR =
  "Unknown property used in expression: ${missingBean.run()}. Cause: Cannot resolve identifier 'missingBean'"
const STACKTRACE = `org.camunda.bpm.engine.ProcessEngineException: ${ERROR}\n\tat x.y(Z.java:1)\nCaused by: org.camunda.bpm.impl.juel.PropertyNotFoundException: Cannot resolve identifier 'missingBean'\n`

export const IDS = {
  instance: "pi-1",
  task: "task-1",
  job: "job-1",
  incident: "inc-1",
  deployment: "dep-1",
} as const

type Route = (request: RecordedRequest, match: RegExpExecArray) => Response

function deploy(state: EngineState, request: RecordedRequest): Response {
  const form = request.body instanceof FormData ? request.body : new FormData()
  const parts = [...form.entries()].filter(([, value]) => typeof value !== "string")
  const field = form.get("deployment-name")
  const name = typeof field === "string" ? field : ""
  const fingerprint = `${name}|${parts.map(([field]) => field).join(",")}`
  const existing = state.deployed.get(fingerprint)
  if (existing !== undefined) {
    return json({
      id: existing,
      name,
      source: "pulse-cli",
      deploymentTime: T0,
      deployedProcessDefinitions: null,
      deployedDecisionDefinitions: null,
      deployedDecisionRequirementsDefinitions: null,
    })
  }
  const id = `dep-${state.deployed.size + 2}`
  state.deployed.set(fingerprint, id)
  state.resources.set(
    id,
    parts.map(([field]) => field),
  )
  const processes = parts
    .filter(([field]) => field.endsWith(".bpmn"))
    .map(([field]) =>
      state.definition((field.split("/").at(-1) ?? field).replace(/\.bpmn$/, ""), field, id),
    )
  state.definitions.push(...processes)
  const map = Object.fromEntries(processes.map((definition) => [definition.id, definition]))
  return json({
    id,
    name,
    source: "pulse-cli",
    deploymentTime: T1,
    deployedProcessDefinitions: processes.length > 0 ? map : null,
    deployedDecisionDefinitions: null,
    deployedDecisionRequirementsDefinitions: null,
  })
}

function start(state: EngineState, match: RegExpExecArray, request: RecordedRequest): Response {
  const body = JSON.parse(typeof request.body === "string" ? request.body : "{}") as {
    businessKey?: string
    variables?: Record<string, { value: unknown; type: string }>
  }
  state.key = decodeURIComponent(match[1] ?? "invoice")
  state.businessKey = body.businessKey ?? "B-1"
  Object.assign(state.variables, body.variables ?? {})
  state.stage = "approve"
  state.attempts = 0
  return json(state.instanceDto(IDS.instance))
}

/** The instance counts of the polls: with an incident, at an activity, or at all. */
function instanceCount(state: EngineState, request: RecordedRequest): number {
  if (!state.active) return 0
  if (request.query.get("withIncident") === "true") return state.stage === "failed" ? 1 : 0
  const activity = request.query.get("activityIdIn")
  if (activity === null) return 1
  return activity === (state.stage === "approve" ? "approve" : "book") ? 1 : 0
}

function count(value: number): Response {
  return json({ count: value })
}

/** The routes, in the order the engine tries them: `METHOD`, the path pattern and the handler. */
export function routeTable(state: EngineState): [string, RegExp, Route][] {
  const id = (match: RegExpExecArray) => decodeURIComponent(match[1] ?? IDS.instance)
  const missing = () =>
    engineError(404, "InvalidRequestException", "Process instance does not exist")
  return [
    ["GET", /^\/version$/, () => json({ version: "7.24.0" })],
    ["GET", /^\/engine$/, () => json([{ name: "default" }])],
    ["GET", /^\/process-instance\/count$/, (request) => count(instanceCount(state, request))],
    [
      "GET",
      /^\/process-instance$/,
      (request) =>
        json(
          state.active &&
            !request.query.has("superProcessInstance") &&
            !request.query.has("subProcessInstance")
            ? [state.instanceDto(IDS.instance)]
            : [],
        ),
    ],
    [
      "GET",
      /^\/process-instance\/([^/]+)$/,
      (_, match) => (state.active ? json(state.instanceDto(id(match))) : missing()),
    ],
    [
      "GET",
      /^\/process-instance\/([^/]+)\/activity-instances$/,
      (_, match) => json(state.activityTree(id(match))),
    ],
    ["GET", /^\/process-instance\/([^/]+)\/variables$/, () => json(state.variables)],
    ["PUT", /^\/process-instance\/([^/]+)\/variables\/([^/]+)$/, () => noContent()],
    [
      "POST",
      /^\/process-instance\/delete$/,
      () => json({ id: "batch-1", type: "instance-deletion", totalJobs: 1 }),
    ],
    [
      "GET",
      /^\/history\/process-instance$/,
      () => json(state.stage === "none" ? [] : [state.historyDto(IDS.instance)]),
    ],
    [
      "GET",
      /^\/history\/process-instance\/([^/]+)$/,
      (_, match) => (state.stage === "none" ? missing() : json(state.historyDto(id(match)))),
    ],
    [
      "GET",
      /^\/history\/variable-instance$/,
      () =>
        json(
          Object.entries(state.variables).map(([name, typed]) => ({
            name,
            ...typed,
            activityInstanceId: IDS.instance,
          })),
        ),
    ],
    [
      "GET",
      /^\/history\/activity-instance$/,
      () =>
        json([
          {
            activityId: "start",
            activityType: "startEvent",
            startTime: T0,
            endTime: T0,
            durationInMillis: 0,
          },
        ]),
    ],
    ["GET", /^\/history\/activity-instance\/count$/, () => count(1)],
    ["GET", /^\/history\/incident$/, () => json([])],
    [
      "GET",
      /^\/history\/batch\/([^/]+)$/,
      (_, match) =>
        json({
          id: id(match),
          type: "instance-deletion",
          totalJobs: 1,
          startTime: T0,
          endTime: T1,
        }),
    ],
    ["GET", /^\/batch\/statistics$/, () => json([])],
    ["GET", /^\/incident$/, () => json(state.incidents(IDS.instance))],
    ["GET", /^\/incident\/count$/, () => count(state.incidents(IDS.instance).length)],
    ["GET", /^\/incident\/([^/]+)$/, () => incident(state)],
    ["GET", /^\/event-subscription$/, () => json([])],
    ["GET", /^\/task$/, () => json(state.tasks(IDS.instance))],
    ["GET", /^\/task\/count$/, () => count(state.tasks(IDS.instance).length)],
    ["POST", /^\/task\/([^/]+)\/complete$/, (request) => complete(state, request)],
    ["GET", /^\/external-task$/, () => json([])],
    ["GET", /^\/external-task\/count$/, () => count(0)],
    [
      "GET",
      /^\/job$/,
      (request) =>
        json(
          request.query.get("timers") === "true"
            ? []
            : state
                .jobs(IDS.instance)
                .filter((job) => request.query.get("executable") !== "true" || job.retries > 0),
        ),
    ],
    [
      "GET",
      /^\/job\/count$/,
      (request) =>
        count(
          state
            .jobs(IDS.instance)
            .filter((job) => request.query.get("executable") !== "true" || job.retries > 0).length,
        ),
    ],
    [
      "GET",
      /^\/job\/([^/]+)$/,
      () =>
        state.jobs(IDS.instance)[0] === undefined
          ? engineError(404, "InvalidRequestException", "No job found")
          : json(state.jobs(IDS.instance)[0]),
    ],
    ["GET", /^\/job\/([^/]+)\/stacktrace$/, () => text(STACKTRACE, "text/plain")],
    ["POST", /^\/job\/([^/]+)\/execute$/, () => execute(state)],
    ["PUT", /^\/job\/([^/]+)\/retries$/, () => setRetries(state)],
    [
      "GET",
      /^\/job-definition$/,
      () => json([{ id: "jd-1", activityId: "book", jobType: "async-continuation" }]),
    ],
    ["GET", /^\/process-definition$/, (request) => json(definitionsFor(state, request))],
    ["GET", /^\/process-definition\/statistics$/, () => json(statistics(state))],
    [
      "POST",
      /^\/process-definition\/key\/([^/]+)\/start$/,
      (request, match) => start(state, match, request),
    ],
    ["GET", /^\/decision-definition$/, () => json([])],
    ["GET", /^\/decision-requirements-definition$/, () => json([])],
    ["GET", /^\/deployment$/, (request) => json(deployments(state, request))],
    ["POST", /^\/deployment\/create$/, (request) => deploy(state, request)],
    [
      "GET",
      /^\/deployment\/([^/]+)\/resources$/,
      (_, match) =>
        json((state.resources.get(id(match)) ?? []).map((name) => ({ id: `r-${name}`, name }))),
    ],
  ]
}

/** The incident of the failed job; a lenient engine always has it (documented examples). */
function incident(state: EngineState): Response {
  if (state.stage !== "failed" && !state.lenient) {
    return engineError(404, "InvalidRequestException", "Incident does not exist")
  }
  const [incident] = state.incidents(IDS.instance, true)
  return json(incident)
}

/** A write the stage does not allow: 404, or nothing at all when lenient. */
function refused(state: EngineState, message: string): Response {
  return state.lenient ? noContent() : engineError(404, "InvalidRequestException", message)
}

function execute(state: EngineState): Response {
  if (state.stage !== "book" && state.stage !== "failed") return refused(state, "No job found")
  return state.runJob() ? noContent() : engineError(404, "InvalidRequestException", ERROR)
}

function complete(state: EngineState, request: RecordedRequest): Response {
  if (state.stage !== "approve") return refused(state, "Cannot find task")
  const body = JSON.parse(typeof request.body === "string" ? request.body : "{}") as {
    variables?: Record<string, { value: unknown; type: string }>
  }
  Object.assign(state.variables, body.variables ?? {})
  state.stage = "book"
  return noContent()
}

function setRetries(state: EngineState): Response {
  if (state.stage !== "failed") return refused(state, "No job found")
  state.stage = "book"
  return noContent()
}

function definitionsFor(state: EngineState, request: RecordedRequest) {
  const resource = request.query.get("resourceName")
  const ids = request.query.get("processDefinitionIdIn")?.split(",")
  return state.definitions.filter(
    (definition) =>
      (resource === null || definition.resource === resource) &&
      (ids === undefined || ids.includes(definition.id)),
  )
}

/** The deployments of a name: the latest with `maxResults=1`, else all of them. */
function deployments(state: EngineState, request: RecordedRequest) {
  const name = request.query.get("name")
  const all = [...state.deployed.entries()]
    .filter(([fingerprint]) => fingerprint.startsWith(`${name ?? ""}|`))
    .map(([, id]) => ({ id, name, deploymentTime: T0 }))
  return request.query.get("maxResults") === "1" ? all.slice(-1) : all
}

function statistics(state: EngineState) {
  return state.definitions.map((definition) => ({
    id: definition.id,
    instances: state.active && definition.key === state.key ? 1 : 0,
    failedJobs: state.stage === "failed" && definition.key === state.key ? 1 : 0,
    incidents:
      state.stage === "failed" && definition.key === state.key
        ? [{ incidentType: "failedJob", incidentCount: 1 }]
        : [],
    definition,
  }))
}
