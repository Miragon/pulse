import {
  createEnginePort,
  isWorkflowError,
  loadInstance,
  records,
  timelineOf,
  type DefinitionView,
  type EnginePort,
  type InspectOptions,
  type InstanceView,
  type TimelineEntry,
} from "@miragon/pulse-c7-core"
import type { EngineHttp } from "../http/engine-http.js"
import { JsonObject } from "../views/json-object.js"
import { UnexpectedAnswerError } from "../views/unexpected-answer-error.js"
import type { InspectView } from "../views/views.js"
import { HttpEngineTransport } from "./http-engine-transport.js"

const WITHOUT_HISTORY: InspectOptions = { variables: true, history: false, stacktrace: true }
const TIMELINE = "/history/activity-instance"
const LIVE_STATES: ReadonlySet<string> = new Set(["ACTIVE", "SUSPENDED"])

export class InstanceInspection {
  private readonly port: EnginePort

  constructor(private readonly http: EngineHttp) {
    this.port = createEnginePort(HttpEngineTransport.over(http))
  }

  async inspect(id: string): Promise<InspectView | undefined> {
    const [view, timeline] = await Promise.allSettled([this.instanceView(id), this.timeline(id)])
    const instance = InstanceInspection.valueOf(view)
    if (instance === undefined) {
      return undefined
    }
    return {
      ...instance,
      definition: InstanceInspection.listed(instance.definition),
      timeline: LIVE_STATES.has(instance.state)
        ? InstanceInspection.valueOf(timeline)
        : await this.timeline(id),
    }
  }

  private async instanceView(id: string): Promise<InstanceView | undefined> {
    try {
      return await loadInstance(this.port, id, WITHOUT_HISTORY)
    } catch (error: unknown) {
      if (isWorkflowError(error) && error.reason.kind === "instance-missing") {
        return undefined
      }
      throw error
    }
  }

  private async timeline(id: string): Promise<TimelineEntry[]> {
    const query = { processInstanceId: id, sortBy: "occurrence", sortOrder: "asc" }
    const rows = await this.http.readAll(TIMELINE, query)
    InstanceInspection.requireWhereAndWhenEachStepRan(rows)
    return timelineOf(records(rows), [])
  }

  private static requireWhereAndWhenEachStepRan(rows: readonly unknown[]): void {
    for (const row of JsonObject.listOf(rows, "activity instance")) {
      row.requiredString("activityId")
      row.requiredString("startTime")
    }
  }

  private static listed(definition: DefinitionView): DefinitionView & { readonly version: number } {
    const { version } = definition
    if (version === undefined) {
      throw new UnexpectedAnswerError(`definition ${definition.id} is missing`)
    }
    return { ...definition, version }
  }

  private static valueOf<Value>(result: PromiseSettledResult<Value>): Value {
    if (result.status === "rejected") {
      throw result.reason
    }
    return result.value
  }
}
