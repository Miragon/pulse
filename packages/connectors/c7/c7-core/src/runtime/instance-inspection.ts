/**
 * The inspection of an instance for its detail: `loadInstance`'s rounds (with variables and stack
 * traces, without history) and, in parallel, the path the history recorded, read whole
 * (`GET /history/activity-instance` in BPMN order, each step checked for where and when it ran).
 * The history option of `loadInstance` would read every historic incident of the instance on each
 * live refresh too, so the path is read here. The path of an instance that no longer runs is read
 * once more after the rounds, so one that ended during them shows its whole path. The view
 * guarantees the version of the instance's definition.
 */

import { RuntimeError } from "@miragon/pulse-engine-core"
import { isWorkflowError } from "../errors.js"
import { type InspectOptions, loadInstance } from "../inspect.js"
import type { EnginePort } from "../port.js"
import { records } from "../records.js"
import { timelineOf } from "../timeline.js"
import type { DefinitionView, InstanceView, TimelineEntry } from "../types.js"
import { JsonView } from "../json-view.js"
import { readAll } from "./read-all.js"

/** The instance view of `loadInstance` with the version of its definition and its path. */
export type InspectView = InstanceView & {
  readonly definition: DefinitionView & { readonly version: number }
  readonly timeline: readonly TimelineEntry[]
}

/** What inspects an instance for its detail: undefined for an instance the engine does not know. */
export interface Inspection {
  inspect(id: string): Promise<InspectView | undefined>
}

const WITHOUT_HISTORY: InspectOptions = { variables: true, history: false, stacktrace: true }
/** The states of an instance whose path the parallel read holds whole. */
const LIVE_STATES: ReadonlySet<string> = new Set(["ACTIVE", "SUSPENDED"])

/** The value of a settled read; a failed read throws its failure. */
function valueOf<Value>(result: PromiseSettledResult<Value>): Value {
  if (result.status === "rejected") {
    throw result.reason
  }
  return result.value
}

/** `definition` with its version; a definition the engine does not list has none. */
function listed(definition: DefinitionView): DefinitionView & { readonly version: number } {
  const { version } = definition
  if (version === undefined) {
    throw new RuntimeError("unexpectedResponse", `definition ${definition.id} is missing`)
  }
  return { ...definition, version }
}

/** Inspects an instance over the engine's port. */
export class InstanceInspection implements Inspection {
  constructor(private readonly port: EnginePort) {}

  /** The view of instance `id`; undefined when neither the runtime nor the history knows it. */
  async inspect(id: string): Promise<InspectView | undefined> {
    const [view, path] = await Promise.allSettled([this.instanceView(id), this.pathOf(id)])
    const instance = valueOf(view)
    if (instance === undefined) {
      return undefined
    }
    return {
      ...instance,
      definition: listed(instance.definition),
      timeline: LIVE_STATES.has(instance.state) ? valueOf(path) : await this.pathOf(id),
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

  private async pathOf(id: string): Promise<TimelineEntry[]> {
    const rows = await readAll(this.port, "getHistoricActivityInstances", {
      processInstanceId: id,
      sortBy: "occurrence",
      sortOrder: "asc",
    })
    for (const step of JsonView.listOf(rows, "activity instance")) {
      step.requiredString("activityId")
      step.requiredString("startTime")
    }
    return timelineOf(records(rows), [])
  }
}
