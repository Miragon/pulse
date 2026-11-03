import {
  createEnginePort,
  isWorkflowError,
  loadInstance,
  type EnginePort,
  type InspectOptions,
  type InstanceView,
} from "@miragon/pulse-engine-core"
import type { EngineHttp } from "../http/engine-http.js"
import { JsonObject } from "../views/json-object.js"
import type { InspectView } from "../views/views.js"
import { HttpEngineTransport } from "./http-engine-transport.js"
import { InspectViews } from "./inspect-views.js"

const WITHOUT_HISTORY: InspectOptions = { variables: true, history: false, stacktrace: true }
const TIMELINE = "/history/activity-instance"
const LIVE_STATES: ReadonlySet<string> = new Set(["ACTIVE", "SUSPENDED"])

export class InstanceInspection {
  private readonly port: EnginePort

  constructor(private readonly http: EngineHttp) {
    this.port = createEnginePort(new HttpEngineTransport(http))
  }

  async inspect(id: string): Promise<InspectView | undefined> {
    const [view, timeline] = await Promise.allSettled([this.instanceView(id), this.timeline(id)])
    const instance = InstanceInspection.valueOf(view)
    if (instance === undefined) {
      return undefined
    }
    return InspectViews.of(
      instance,
      LIVE_STATES.has(instance.state)
        ? InstanceInspection.valueOf(timeline)
        : await this.timeline(id),
    )
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

  private async timeline(id: string): Promise<JsonObject[]> {
    const query = { processInstanceId: id, sortBy: "occurrence", sortOrder: "asc" }
    return JsonObject.listOf(await this.http.readAll(TIMELINE, query), TIMELINE)
  }

  private static valueOf<Value>(result: PromiseSettledResult<Value>): Value {
    if (result.status === "rejected") {
      throw result.reason
    }
    return result.value
  }
}
