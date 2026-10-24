/**
 * A scripted fake engine for the workflow commands: one process instance that waits at the user
 * task `approve`, then at the asynchronous service task `book` (whose job fails on its first
 * execution, creating a failedJob incident), then ends. Writes move it on, `tick()` is the job
 * executor (wire it to the fake runtime's `onSleep`). Instance ids are not checked (any id is the
 * instance, so documented command lines with `$INSTANCE_ID` run), deployments are kept, and every
 * batch is finished. Every request is recorded.
 */

import { engineError, json, type RecordedRequest } from "./fake-fetch.js"
import {
  type Definition,
  type EngineState,
  ERROR,
  IDS,
  routeTable,
  type Stage,
  T0,
  T1,
} from "./workflow-engine-routes.js"

export type { Stage } from "./workflow-engine-routes.js"

export const ENGINE_URL = "http://localhost:8080/engine-rest"

function urlOf(input: string | URL | Request): URL {
  if (typeof input === "string") return new URL(input)
  return new URL(input instanceof URL ? input.href : input.url)
}

/** The request as the tests see it; the path is relative to the REST root and the engine. */
function recorded(input: string | URL | Request, init: RequestInit | undefined): RecordedRequest {
  const url = urlOf(input)
  const body = init?.body
  return {
    method: init?.method ?? "GET",
    url: url.href,
    path: url.pathname.replace(/^\/engine-rest/, "").replace(/^\/engine\/[^/]+/, ""),
    query: url.searchParams,
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    body: typeof body === "string" || body instanceof FormData ? body : undefined,
  }
}

export class WorkflowEngine implements EngineState {
  readonly requests: RecordedRequest[] = []
  stage: Stage
  businessKey = "B-1"
  key = "invoice"
  attempts = 0
  readonly variables: Record<string, { value: unknown; type: string }> = {}
  readonly definitions: Definition[] = []
  readonly deployed = new Map<string, string>()
  /** Resource names per deployment id. */
  readonly resources = new Map<string, string[]>()
  private readonly routes: ReturnType<typeof routeTable>

  /**
   * `lenient` (for the documented command lines): unknown routes answer a generic `{}` (`[]` for
   * paged lists) and writes at the wrong stage succeed without changing anything.
   */
  constructor(
    stage: Stage = "approve",
    readonly lenient = false,
  ) {
    this.stage = stage
    // an instance with a failed job has had its first (failing) attempt
    if (stage === "failed") this.attempts = 1
    if (stage !== "none")
      this.definitions.push(this.definition("invoice", "invoice.bpmn", IDS.deployment))
    this.routes = routeTable(this)
  }

  readonly fetch: typeof globalThis.fetch = (input, init) => {
    const request = recorded(input, init)
    this.requests.push(request)
    for (const [method, pattern, route] of this.routes) {
      const match = method === request.method ? pattern.exec(request.path) : null
      if (match !== null) return Promise.resolve(route(request, match))
    }
    if (this.lenient) return Promise.resolve(json(request.query.has("maxResults") ? [] : {}))
    const message = `No fake route for ${request.method} ${request.path}`
    return Promise.resolve(engineError(404, "NotFoundException", message))
  }

  /** The job executor: runs the due job of `book` (it fails on the first attempt). */
  tick(): void {
    if (this.stage === "book") this.runJob()
  }

  runJob(): boolean {
    this.attempts += 1
    if (this.attempts === 1) {
      this.stage = "failed"
      return false
    }
    this.stage = "ended"
    return true
  }

  definition(key: string, resource: string, deploymentId: string): Definition {
    const version = this.definitions.filter((definition) => definition.key === key).length + 1
    return {
      id: `${key}:${version}:def-${this.definitions.length + 1}`,
      key,
      version,
      resource,
      deploymentId,
    }
  }

  get active(): boolean {
    return this.stage === "approve" || this.stage === "book" || this.stage === "failed"
  }

  get definitionId(): string {
    return (
      this.definitions.find((definition) => definition.key === this.key)?.id ?? `${this.key}:1:def`
    )
  }

  instanceDto(id: string) {
    return {
      id,
      definitionId: this.definitionId,
      definitionKey: this.key,
      businessKey: this.businessKey,
      ended: false,
      suspended: false,
    }
  }

  historyDto(id: string) {
    return {
      id,
      businessKey: this.businessKey,
      processDefinitionId: this.definitionId,
      processDefinitionKey: this.key,
      processDefinitionVersion: 1,
      startTime: T0,
      ...(this.active ? {} : { endTime: T1, durationInMillis: 5000 }),
      rootProcessInstanceId: id,
      state: this.active ? "ACTIVE" : "COMPLETED",
    }
  }

  activityTree(id: string) {
    const approve = {
      id: "approve:ai-1",
      activityId: "approve",
      activityName: "Approve",
      activityType: "userTask",
      executionIds: [id],
      childActivityInstances: [],
      childTransitionInstances: [],
    }
    const book = {
      id: "book:ti-1",
      activityId: "book",
      activityName: "Book",
      activityType: "serviceTask",
      executionId: id,
    }
    return {
      id,
      activityId: this.definitionId,
      activityType: "processDefinition",
      processInstanceId: id,
      executionIds: [id],
      childActivityInstances: this.stage === "approve" ? [approve] : [],
      childTransitionInstances: this.stage === "approve" ? [] : [book],
    }
  }

  tasks(id: string) {
    return this.stage === "approve"
      ? [
          {
            id: IDS.task,
            name: "Approve",
            taskDefinitionKey: "approve",
            executionId: id,
            processInstanceId: id,
            created: T0,
          },
        ]
      : []
  }

  jobs(id: string) {
    if (this.stage !== "book" && this.stage !== "failed") return []
    const failed = this.stage === "failed"
    return [
      {
        id: IDS.job,
        jobDefinitionId: "jd-1",
        processInstanceId: id,
        executionId: id,
        retries: failed ? 0 : 3,
        dueDate: null,
        createTime: T0,
        ...(failed ? { exceptionMessage: ERROR, failedActivityId: "book" } : {}),
      },
    ]
  }

  incidents(id: string, always = false) {
    return always || this.stage === "failed"
      ? [
          {
            id: IDS.incident,
            rootCauseIncidentId: IDS.incident,
            incidentType: "failedJob",
            activityId: "book",
            processInstanceId: id,
            processDefinitionId: this.definitionId,
            configuration: IDS.job,
            incidentMessage: ERROR,
            incidentTimestamp: T1,
          },
        ]
      : []
  }
}

/** Paths of the recorded requests, `METHOD /path`. */
export function routes(engine: WorkflowEngine): string[] {
  return engine.requests.map((request) => `${request.method} ${request.path}`)
}
